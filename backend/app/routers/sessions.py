"""
Sessions router — practice and test assessments scoped to a booked AI session
(Appointment). Endpoints are used by the session UI to start quizzes and
retrieve the most recent attempt.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.middleware.auth import require_any_authenticated
from app.models.appointment import Appointment
from app.models.assessment import Assessment
from app.models.user import User, ROLE_STUDENT
from app.schemas.assessment import AssessmentResponse
from app.services import session_agent_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class StartQuizBody(BaseModel):
    topic: Optional[str] = None


async def _verify_appointment_access(
    db: AsyncSession,
    appointment_id: int,
    current_user: User,
) -> Appointment:
    """Load the appointment and verify the caller may access it."""
    result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    appointment = result.scalar_one_or_none()
    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found",
        )

    # Students may only access their own appointment.
    # Teachers, admins, and parents with broader access are allowed through.
    if current_user.role == ROLE_STUDENT and appointment.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This appointment does not belong to you",
        )

    return appointment


def _student_id_for(appointment: Appointment, current_user: User) -> int:
    """Return the student ID to use when creating / querying assessments."""
    if current_user.role == ROLE_STUDENT:
        return current_user.id
    # Non-student roles (parent booking on behalf, teacher reviewing) use the
    # appointment's student_id.
    return appointment.student_id


async def _latest_assessment(
    db: AsyncSession,
    appointment_id: int,
    assessment_type: str,
) -> Assessment | None:
    result = await db.execute(
        select(Assessment)
        .options(selectinload(Assessment.questions))
        .where(
            Assessment.appointment_id == appointment_id,
            Assessment.assessment_type == assessment_type,
        )
        .order_by(desc(Assessment.created_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Practice (5 questions)
# ---------------------------------------------------------------------------

@router.post("/{appointment_id}/practice", response_model=AssessmentResponse)
async def start_practice(
    appointment_id: int,
    body: StartQuizBody = Body(default=StartQuizBody()),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Start a 5-question practice quiz for the session topic."""
    appointment = await _verify_appointment_access(db, appointment_id, current_user)
    student_id = _student_id_for(appointment, current_user)

    try:
        assessment = await session_agent_service.generate_session_practice(
            db=db,
            appointment_id=appointment_id,
            student_id=student_id,
            n_questions=5,
            assessment_type="practice",
            topic_override=body.topic,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:
        logger.error(f"Practice generation failed for appointment {appointment_id}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to generate practice questions. Please try again.",
        )

    response = AssessmentResponse.model_validate(assessment)
    # Hide answers and explanations until the student submits
    for q in response.questions:
        q.correct_answer = None
        q.explanation = None
    return response


@router.get("/{appointment_id}/practice/latest", response_model=AssessmentResponse)
async def get_latest_practice(
    appointment_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return the most recent practice assessment for this appointment."""
    await _verify_appointment_access(db, appointment_id, current_user)

    assessment = await _latest_assessment(db, appointment_id, "practice")
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No practice assessment found for this session",
        )

    response = AssessmentResponse.model_validate(assessment)
    # Only hide answers if still in progress
    if assessment.status == "in_progress":
        for q in response.questions:
            q.correct_answer = None
            q.explanation = None
    return response


# ---------------------------------------------------------------------------
# Test (10 questions)
# ---------------------------------------------------------------------------

@router.post("/{appointment_id}/test", response_model=AssessmentResponse)
async def start_test(
    appointment_id: int,
    body: StartQuizBody = Body(default=StartQuizBody()),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Start a 10-question end-of-session test for the session topic."""
    appointment = await _verify_appointment_access(db, appointment_id, current_user)
    student_id = _student_id_for(appointment, current_user)

    try:
        assessment = await session_agent_service.generate_session_practice(
            db=db,
            appointment_id=appointment_id,
            student_id=student_id,
            n_questions=10,
            assessment_type="test",
            topic_override=body.topic,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:
        logger.error(f"Test generation failed for appointment {appointment_id}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to generate test questions. Please try again.",
        )

    response = AssessmentResponse.model_validate(assessment)
    for q in response.questions:
        q.correct_answer = None
        q.explanation = None
    return response


@router.get("/{appointment_id}/test/latest", response_model=AssessmentResponse)
async def get_latest_test(
    appointment_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return the most recent test assessment for this appointment."""
    await _verify_appointment_access(db, appointment_id, current_user)

    assessment = await _latest_assessment(db, appointment_id, "test")
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No test found for this session",
        )

    response = AssessmentResponse.model_validate(assessment)
    if assessment.status == "in_progress":
        for q in response.questions:
            q.correct_answer = None
            q.explanation = None
    return response
