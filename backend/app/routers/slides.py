import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func as sa_func

from app.db.session import async_session_factory
from app.middleware.auth import get_current_user
from app.models.session_slide import SessionSlide
from app.models.user import User, ROLE_STUDENT
from app.services.slides_service import generate_slide

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/slides", tags=["slides"])


class SlideGenerateRequest(BaseModel):
    text: str
    subject: str = ""
    appointment_id: Optional[int] = None
    existing_titles: list[str] = []


def _ensure_student(user: User) -> None:
    if user.role != ROLE_STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can generate lesson slides",
        )


@router.post("/generate")
async def generate_slide_endpoint(
    body: SlideGenerateRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate a structured lesson slide from an AI tutor response text.

    Returns the slide dict on success, or {"slide": null} when the text is
    too short, is a greeting/error, or when Gemini cannot produce a valid slide.

    If appointment_id is provided and a slide is generated, the slide is
    persisted to the session_slides table for later retrieval.
    """
    _ensure_student(current_user)

    if not body.text or not body.text.strip():
        return {"slide": None}

    slide = generate_slide(body.text, body.subject, body.existing_titles)

    if slide and body.appointment_id:
        async with async_session_factory() as save_db:
            result = await save_db.execute(
                select(sa_func.count()).select_from(SessionSlide).where(
                    SessionSlide.appointment_id == body.appointment_id,
                    SessionSlide.student_id == current_user.id,
                )
            )
            count = result.scalar_one() or 0
            db_slide = SessionSlide(
                appointment_id=body.appointment_id,
                student_id=current_user.id,
                slide_order=count,
                title=slide["title"],
                emoji=slide.get("emoji", "📄"),
                bullets=slide.get("bullets", []),
                key_terms=slide.get("keyTerms", []),
                highlight=slide.get("highlight", ""),
            )
            save_db.add(db_slide)
            await save_db.commit()

    return {"slide": slide}


@router.get("/session/{appointment_id}")
async def get_session_slides(
    appointment_id: int,
    current_user: User = Depends(get_current_user),
):
    """Return all persisted slides for a given appointment session, ordered by
    slide_order. Only the student who owns the slides can retrieve them."""
    _ensure_student(current_user)

    async with async_session_factory() as db:
        result = await db.execute(
            select(SessionSlide)
            .where(
                SessionSlide.appointment_id == appointment_id,
                SessionSlide.student_id == current_user.id,
            )
            .order_by(SessionSlide.slide_order)
        )
        slides = result.scalars().all()

    return [
        {
            "title": s.title,
            "emoji": s.emoji,
            "bullets": s.bullets,
            "keyTerms": s.key_terms,
            "highlight": s.highlight,
        }
        for s in slides
    ]
