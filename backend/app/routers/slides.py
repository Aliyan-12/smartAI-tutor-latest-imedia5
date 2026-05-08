import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func as sa_func

from app.db.session import async_session_factory
from app.middleware.auth import get_current_user
from app.models.session_slide import SessionPresentation
from app.models.user import User, ROLE_STUDENT
from app.services.slides_service import extract_topic, generate_presenton_slide

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/slides", tags=["slides"])


class SlideGenerateRequest(BaseModel):
    text: str
    subject: str = ""
    key_stage: str = ""
    appointment_id: Optional[int] = None
    existing_topics: list[str] = []


def _ensure_student(user: User) -> None:
    if user.role != ROLE_STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can generate lesson slides",
        )


async def _run_presenton_and_update(
    slide_id: int,
    topic: str,
    subject: str,
    key_stage: str,
    ai_text: str,
) -> None:
    """Background task: call Presenton, update DB row to ready or failed."""
    result = await generate_presenton_slide(topic, subject, key_stage, ai_text)

    async with async_session_factory() as db:
        row = await db.get(SessionPresentation, slide_id)
        if row is None:
            return
        if result:
            row.presentation_id = result["presentation_id"]
            row.viewer_url = result["viewer_url"]
            row.pptx_url = result["pptx_url"]
            row.status = "ready"
        else:
            row.status = "failed"
        await db.commit()


@router.post("/generate")
async def generate_slide_endpoint(
    body: SlideGenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """
    Step 1: Fast Gemini topic extraction (synchronous, < 1s).
    Step 2: Presenton slide generation dispatched as a background task (30-120s).
    Returns {slide_id, status: "generating", topic} immediately so the
    frontend can show a loading placeholder and poll GET /api/slides/{id}.
    Returns {slide_id: null} when the text is not slide-worthy.
    """
    _ensure_student(current_user)

    if not body.text or not body.text.strip() or not body.appointment_id:
        return {"slide_id": None}

    topic = extract_topic(body.text, body.subject, body.existing_topics)
    if not topic:
        return {"slide_id": None}

    async with async_session_factory() as db:
        count_result = await db.execute(
            select(sa_func.count()).select_from(SessionPresentation).where(
                SessionPresentation.appointment_id == body.appointment_id,
                SessionPresentation.student_id == current_user.id,
            )
        )
        slide_order = count_result.scalar_one() or 0

        row = SessionPresentation(
            appointment_id=body.appointment_id,
            student_id=current_user.id,
            slide_order=slide_order,
            topic=topic,
            status="generating",
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        slide_id = row.id

    background_tasks.add_task(
        _run_presenton_and_update,
        slide_id,
        topic,
        body.subject,
        body.key_stage,
        body.text,
    )

    return {"slide_id": slide_id, "status": "generating", "topic": topic}


@router.get("/session/{appointment_id}")
async def get_session_slides(
    appointment_id: int,
    current_user: User = Depends(get_current_user),
):
    """Return all Presenton slides for a session, ordered by slide_order."""
    _ensure_student(current_user)

    async with async_session_factory() as db:
        result = await db.execute(
            select(SessionPresentation)
            .where(
                SessionPresentation.appointment_id == appointment_id,
                SessionPresentation.student_id == current_user.id,
            )
            .order_by(SessionPresentation.slide_order)
        )
        slides = result.scalars().all()

    return [
        {
            "slide_id": s.id,
            "status": s.status,
            "topic": s.topic,
            "presentation_id": s.presentation_id or None,
            "viewer_url": s.viewer_url or None,
            "pptx_url": s.pptx_url or None,
        }
        for s in slides
    ]


@router.get("/{slide_id}")
async def get_slide(
    slide_id: int,
    current_user: User = Depends(get_current_user),
):
    """Poll a single slide's status. Returns full slide data when ready."""
    _ensure_student(current_user)

    async with async_session_factory() as db:
        row = await db.get(SessionPresentation, slide_id)

    if row is None or row.student_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Slide not found")

    return {
        "slide_id": row.id,
        "status": row.status,
        "topic": row.topic,
        "presentation_id": row.presentation_id or None,
        "viewer_url": row.viewer_url or None,
        "pptx_url": row.pptx_url or None,
    }
