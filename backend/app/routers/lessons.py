import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import (
    require_student,
    require_parent_or_teacher,
    require_any_authenticated,
)
from app.models.user import User
from app.schemas.lesson import (
    LessonPlanCreate,
    LessonPlanResponse,
    TopicListResponse,
    GenerateLessonPlanRequest,
    GeneratedLessonPlanResponse,
    CheckpointSaveRequest,
    ContinuationResponse,
)
from app.services import lesson_service, platform_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lessons", tags=["lessons"])


@router.get("/available-filters")
async def available_filters(
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return distinct subjects and key stages that have ready documents."""
    from sqlalchemy import select, distinct
    from app.models.documents import Document

    subj_result = await db.execute(
        select(distinct(Document.subject)).where(Document.status == "ready").order_by(Document.subject)
    )
    subjects = [r[0] for r in subj_result.all()]

    ks_result = await db.execute(
        select(distinct(Document.key_stage)).where(Document.status == "ready").order_by(Document.key_stage)
    )
    key_stages = [r[0] for r in ks_result.all()]

    return {"subjects": subjects, "key_stages": key_stages}


@router.get("/units")
async def list_units(
    subject: str = Query(...),
    key_stage: str = Query(...),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return document titles (units/lessons) for a subject + key stage from knowledge base."""
    from sqlalchemy import select
    from app.models.documents import Document

    result = await db.execute(
        select(Document.id, Document.title, Document.unit_name)
        .where(Document.subject == subject, Document.key_stage == key_stage, Document.status == "ready")
        .order_by(Document.title)
    )
    rows = result.all()
    return {
        "units": [
            {"id": r.id, "title": r.title, "unit_name": r.unit_name or r.title}
            for r in rows
        ]
    }


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


# Task 1: AI lesson plan generation
@router.post("/generate-plan")
async def generate_lesson_plan(
    payload: GenerateLessonPlanRequest,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a personalised AI lesson plan for a student.
    Auth: student, teacher, or admin.
    If appointment_id is provided and the current user is the student, save plan_blocks to the LessonPlan.
    """
    # Determine which student to personalise for
    if current_user.role == "student":
        student_id = current_user.id
    else:
        # For teachers/admins generating a plan, use their own id as a fallback
        # (no personalisation data will be loaded)
        student_id = current_user.id

    plan_data = await lesson_service.generate_lesson_plan(
        db=db,
        student_id=student_id,
        subject=payload.subject,
        topic=payload.topic,
        goal=payload.goal,
        duration_minutes=payload.duration_minutes,
        subtopic=payload.subtopic,
    )

    # If appointment_id provided, save to LessonPlan.plan_blocks
    if payload.appointment_id:
        from sqlalchemy import select
        from app.models.lesson_plan import LessonPlan

        lp_result = await db.execute(
            select(LessonPlan).where(LessonPlan.appointment_id == payload.appointment_id)
        )
        lp = lp_result.scalar_one_or_none()
        if lp:
            lp.plan_blocks = plan_data
            lp.updated_at = datetime.now(timezone.utc)
            await db.flush()
            await db.refresh(lp)
            await db.commit()
            logger.info(f"Saved plan_blocks to lesson_plan for appointment_id={payload.appointment_id}")

    return plan_data


# Task 2: Checkpoint save
@router.post("/{lesson_plan_id}/checkpoint")
async def save_checkpoint(
    lesson_plan_id: int,
    payload: CheckpointSaveRequest,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Save a mid-session checkpoint for a lesson plan."""
    try:
        checkpoint_data = payload.model_dump()
        plan = await lesson_service.save_checkpoint(db, lesson_plan_id, checkpoint_data)
        await db.commit()
        return {
            "lesson_plan_id": plan.id,
            "session_state": plan.session_state,
            "message": "Checkpoint saved",
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Task 2: Get continuation state
@router.get("/continuation", response_model=ContinuationResponse)
async def get_continuation(
    student_id: int = Query(..., description="Student user ID"),
    subject: str = Query(..., description="Subject"),
    topic: str = Query(..., description="Topic to resume"),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """
    Query for the last session state for this student/subject/topic.
    Returns last checkpoint data so the next session can resume.
    """
    result = await lesson_service.get_continuation(db, student_id, subject, topic)
    if result is None:
        return ContinuationResponse(found=False)
    return ContinuationResponse(**result)


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
    await db.commit()
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
    await platform_service.award_xp(db, current_user.id, 10, reason="lesson_started")
    await platform_service.check_and_update_streak(db, current_user.id)
    await db.commit()

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
    await platform_service.award_xp(db, current_user.id, 50, reason="lesson_completed")

    # Update topic mastery with a completion score of 70 (baseline for completing)
    topic_label = plan.subtopic or plan.unit_name or plan.subject
    await platform_service.update_topic_mastery(
        db=db,
        student_id=current_user.id,
        subject=plan.subject,
        key_stage=plan.key_stage,
        topic=topic_label,
        score=70.0,
    )

    # Update streak
    await platform_service.check_and_update_streak(db, current_user.id)
    await db.commit()

    return LessonPlanResponse.model_validate(plan)
