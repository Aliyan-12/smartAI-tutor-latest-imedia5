import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import (
    require_student,
    require_parent_or_teacher,
    require_any_authenticated,
)
from app.models.user import User
from app.schemas.lesson import LessonPlanCreate, LessonPlanResponse, TopicListResponse
from app.services import lesson_service, gamification_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lessons", tags=["lessons"])


@router.get("/topics", response_model=TopicListResponse)
async def list_topics(
    subject: str = Query(..., description="Subject name, e.g. 'Maths'"),
    key_stage: str = Query(..., description="Key stage, e.g. 'KS3'"),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return the list of available unit topics for a given subject and key stage."""
    topics = await lesson_service.get_topics_for_subject(db, subject, key_stage)
    return TopicListResponse(topics=topics)


@router.get("/subtopics")
async def list_subtopics(
    subject: str = Query(..., description="Subject name"),
    unit_name: str = Query(..., description="Unit / topic name"),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return the list of subtopic tags for a given subject and unit."""
    subtopics = await lesson_service.get_subtopics(db, subject, unit_name)
    return {"subtopics": subtopics}


@router.post("/create", response_model=LessonPlanResponse)
async def create_lesson_plan(
    payload: LessonPlanCreate,
    current_user: User = Depends(require_parent_or_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Create a new lesson plan. Only teachers, parents, and admins may create plans."""
    plan = await lesson_service.create_lesson_plan(
        db=db,
        student_id=payload.student_id,
        created_by=current_user.id,
        subject=payload.subject,
        key_stage=payload.key_stage,
        exam_board=payload.exam_board or "None",
        tier=payload.tier or "None",
        unit_name=payload.unit_name,
        subtopic=payload.subtopic,
        ability_level=payload.ability_level,
        goal=payload.goal,
        teacher_notes=payload.teacher_notes,
        appointment_id=payload.appointment_id,
    )
    return LessonPlanResponse.model_validate(plan)


@router.get("/{plan_id}", response_model=LessonPlanResponse)
async def get_lesson_plan(
    plan_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve a lesson plan by ID."""
    plan = await lesson_service.get_lesson_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Lesson plan not found")
    return LessonPlanResponse.model_validate(plan)


@router.post("/{plan_id}/start", response_model=LessonPlanResponse)
async def start_lesson_plan(
    plan_id: int,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Mark a lesson plan as in_progress. Only the assigned student may start it."""
    plan = await lesson_service.get_lesson_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Lesson plan not found")
    if plan.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="This lesson plan is not assigned to you")
    if plan.status == "completed":
        raise HTTPException(status_code=400, detail="This lesson plan is already completed")

    plan = await lesson_service.update_lesson_status(db, plan, "in_progress")

    # Award XP for starting a lesson and update streak
    await gamification_service.award_xp(db, current_user.id, 10, reason="lesson_started")
    await gamification_service.check_and_update_streak(db, current_user.id)

    return LessonPlanResponse.model_validate(plan)


@router.post("/{plan_id}/complete", response_model=LessonPlanResponse)
async def complete_lesson_plan(
    plan_id: int,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """
    Mark a lesson plan as completed and generate an AI session summary via Gemini.
    Awards XP and updates mastery for the topic.
    """
    plan = await lesson_service.get_lesson_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Lesson plan not found")
    if plan.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="This lesson plan is not assigned to you")
    if plan.status == "completed":
        raise HTTPException(status_code=400, detail="This lesson plan is already completed")

    # Generate session summary using Gemini
    try:
        from app.services.gemini_service import _get_client
        from app.core.config import settings
        from google.genai import types as genai_types

        lesson_context = lesson_service.build_lesson_context(plan)
        summary_prompt = (
            f"A student has just completed the following tutoring session:\n\n"
            f"{lesson_context}\n\n"
            f"Write a concise session summary (3–5 sentences) covering what was likely learned, "
            f"what the student should practise next, and an encouraging sign-off. "
            f"Keep the tone warm and motivational."
        )
        client = _get_client()
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=summary_prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction="You are a supportive AI tutor summarising a completed lesson session.",
            ),
        )
        plan.session_summary = response.text.strip()
    except Exception as exc:
        logger.warning(f"Failed to generate session summary for plan {plan_id}: {exc}")
        plan.session_summary = (
            f"Session completed: {plan.subject} – {plan.unit_name or plan.subtopic or 'General topic'}."
        )

    plan = await lesson_service.update_lesson_status(db, plan, "completed")

    # Award XP for completing a lesson
    await gamification_service.award_xp(db, current_user.id, 50, reason="lesson_completed")

    # Update topic mastery with a completion score of 70 (baseline for completing)
    topic_label = plan.subtopic or plan.unit_name or plan.subject
    await gamification_service.update_topic_mastery(
        db=db,
        student_id=current_user.id,
        subject=plan.subject,
        key_stage=plan.key_stage,
        topic=topic_label,
        score=70.0,
    )

    # Update streak
    await gamification_service.check_and_update_streak(db, current_user.id)

    return LessonPlanResponse.model_validate(plan)
