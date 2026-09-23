import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.middleware.auth import require_parent
from app.models.user import User, ROLE_STUDENT
from app.models.chat import Chat
from app.models.parent_student import InviteCode
from app.schemas.user import UserResponse
from app.schemas.chat import ChatListItem, ChatResponse
from app.schemas.assessment import AssessmentResponse, StudentProgressResponse
from app.services import assessment_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/parent", tags=["parent"])


async def _get_children(db: AsyncSession, parent_id: int) -> List[User]:
    result = await db.execute(
        select(User).where(User.parent_id == parent_id, User.role == ROLE_STUDENT)
    )
    return list(result.scalars().all())


async def _assert_is_child(db: AsyncSession, parent_id: int, student_id: int):
    result = await db.execute(
        select(User.id).where(
            User.id == student_id, User.parent_id == parent_id, User.role == ROLE_STUDENT
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student is not linked to your account")


class LinkCodePayload(BaseModel):
    code: str


@router.get("/dashboard")
async def parent_dashboard(
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    children = await _get_children(db, parent.id)
    child_data = []
    for child in children:
        progress = await assessment_service.get_student_progress(db, child.id)
        child_data.append({
            "student": UserResponse.model_validate(child),
            "progress": progress,
        })

    return {
        "linked_students": len(children),
        "children": child_data,
    }


@router.get("/students", response_model=List[UserResponse])
async def list_children(
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    children = await _get_children(db, parent.id)
    return [UserResponse.model_validate(c) for c in children]


@router.get("/students/{student_id}/progress")
async def get_student_progress(
    student_id: int,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    await _assert_is_child(db, parent.id, student_id)
    progress = await assessment_service.get_student_progress(db, student_id)
    assessments = await assessment_service.list_student_assessments(db, student_id)

    student = await db.execute(select(User).where(User.id == student_id))
    student_user = student.scalar_one()

    return StudentProgressResponse(
        student_id=student_id,
        student_name=student_user.name,
        total_assessments=progress["total_assessments"],
        average_score=progress["average_score"],
        latest_score=progress["latest_score"],
        weak_topics=progress["weak_topics"],
        strong_topics=progress["strong_topics"],
        assessments=[AssessmentResponse.model_validate(a) for a in assessments],
    )


@router.get("/students/{student_id}/chats", response_model=List[ChatListItem])
async def get_student_chats(
    student_id: int,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    await _assert_is_child(db, parent.id, student_id)
    result = await db.execute(
        select(Chat).where(Chat.user_id == student_id).order_by(desc(Chat.created_at))
    )
    chats = list(result.scalars().all())
    return [ChatListItem(id=c.id, session_id=c.session_id, title=c.title, created_at=c.created_at) for c in chats]


@router.get("/students/{student_id}/assessments", response_model=List[AssessmentResponse])
async def get_student_assessments(
    student_id: int,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    await _assert_is_child(db, parent.id, student_id)
    assessments = await assessment_service.list_student_assessments(db, student_id)
    return [AssessmentResponse.model_validate(a) for a in assessments]


@router.get("/students/{student_id}/mastery")
async def child_mastery(
    student_id: int,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    """Authorised evidence-based mastery for a linked child."""
    await _assert_is_child(db, parent.id, student_id)
    from app.services import mastery_service
    payload = await mastery_service.engine_payload(db, student_id)
    await db.commit()
    return payload


@router.get("/students/{student_id}/mastery/topic")
async def child_mastery_topic(
    student_id: int, subject: str, topic: str,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    await _assert_is_child(db, parent.id, student_id)
    from app.services import mastery_service
    result = await mastery_service.topic_breakdown(db, student_id, subject, topic)
    await db.commit()
    return result


@router.get("/students/{student_id}/overview")
async def child_overview(
    student_id: int,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    """Consolidated, plain-language progress overview for a linked child."""
    await _assert_is_child(db, parent.id, student_id)
    from app.services import mastery_service
    from app.models.appointment import Appointment
    from app.models.student_profile import StudentProfile

    topics = await mastery_service.mastery_overview(db, student_id)
    counts: dict = {}
    for t in topics:
        counts[t.state] = counts.get(t.state, 0) + 1
    progress = await assessment_service.get_student_progress(db, student_id)
    profile = await db.get(StudentProfile, student_id)

    appts = await db.execute(
        select(Appointment).where(Appointment.student_id == student_id)
    )
    appt_list = list(appts.scalars().all())
    appts_done = sum(1 for a in appt_list if getattr(a, "status", "") in ("completed", "ended"))

    await db.commit()
    return {
        "mastery_counts": counts,
        "topics_tracked": len([t for t in topics if t.evidence_count > 0]),
        "recommendations": await mastery_service.recommend_next(db, student_id),
        "assessments": {
            "total": progress.get("total_assessments", 0),
            "average_score": progress.get("average_score", 0),
            "latest_score": progress.get("latest_score", 0),
            "weak_topics": progress.get("weak_topics", []),
            "strong_topics": progress.get("strong_topics", []),
        },
        "sessions_completed": appts_done,
        "streak": getattr(profile, "current_streak", 0) if profile else 0,
        "xp_total": getattr(profile, "xp_total", 0) if profile else 0,
    }


@router.post("/link")
async def link_with_code(
    payload: LinkCodePayload,
    parent: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InviteCode).where(InviteCode.code == payload.code.strip().upper(), InviteCode.used == False)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or already used invite code")

    student = await db.execute(select(User).where(User.id == invite.student_id))
    student_user = student.scalar_one_or_none()
    if not student_user or student_user.role != ROLE_STUDENT:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")

    if student_user.parent_id and student_user.parent_id != parent.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Student already linked to another parent")

    student_user.parent_id = parent.id
    invite.used = True
    await db.flush()

    return {"message": f"Successfully linked to {student_user.name}", "student": UserResponse.model_validate(student_user)}
