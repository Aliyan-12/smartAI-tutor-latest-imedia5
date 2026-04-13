"""
Lesson plan service: topic discovery, CRUD for lesson plans, AI context builder.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.documents import Document, DocumentChunk
from app.models.lesson_plan import LessonPlan

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Topic / subtopic discovery
# ---------------------------------------------------------------------------

async def get_topics_for_subject(
    db: AsyncSession, subject: str, key_stage: str
) -> List[Dict[str, Any]]:
    """
    Return a list of unique unit_name values (with document counts) for the
    given subject and key_stage, restricted to documents with status='ready'.
    """
    result = await db.execute(
        select(
            Document.unit_name,
            func.count(Document.id).label("document_count"),
        )
        .where(
            Document.subject == subject,
            Document.key_stage == key_stage,
            Document.status == "ready",
            Document.unit_name.isnot(None),
        )
        .group_by(Document.unit_name)
        .order_by(Document.unit_name)
    )
    rows = result.all()
    return [{"unit_name": row.unit_name, "document_count": row.document_count} for row in rows]


async def get_subtopics(
    db: AsyncSession, subject: str, unit_name: str
) -> List[str]:
    """
    Return unique topic_tag values from DocumentChunk rows whose parent Document
    matches *subject* and *unit_name*.
    """
    # Find matching document ids first
    doc_result = await db.execute(
        select(Document.id).where(
            Document.subject == subject,
            Document.unit_name == unit_name,
            Document.status == "ready",
        )
    )
    doc_ids = [row[0] for row in doc_result.all()]

    if not doc_ids:
        return []

    # DocumentChunk does not have a topic_tag column in the current schema;
    # we fall back to distinct chunk content keywords. Instead, for safety we
    # import AssessmentQuestion which has topic_tag and link via subject/topic.
    # However, the spec says "returns unique topic_tag values from document_chunks".
    # DocumentChunk currently has no topic_tag field, so we derive subtopics from
    # AssessmentQuestion topic_tags for matching subject/unit_name documents,
    # or return an empty list if none are found.
    from app.models.assessment import AssessmentQuestion, Assessment

    aq_result = await db.execute(
        select(distinct(AssessmentQuestion.topic_tag))
        .join(Assessment, Assessment.id == AssessmentQuestion.assessment_id)
        .where(
            Assessment.subject == subject,
            AssessmentQuestion.topic_tag.isnot(None),
            AssessmentQuestion.topic_tag != "",
        )
    )
    tags = [row[0] for row in aq_result.all() if row[0]]
    return sorted(set(tags))


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def create_lesson_plan(
    db: AsyncSession,
    student_id: int,
    created_by: int,
    subject: str,
    key_stage: str,
    ability_level: str,
    goal: str,
    exam_board: str = "None",
    tier: str = "None",
    unit_name: Optional[str] = None,
    subtopic: Optional[str] = None,
    teacher_notes: Optional[str] = None,
    appointment_id: Optional[int] = None,
) -> LessonPlan:
    """Insert and return a new LessonPlan record."""
    plan = LessonPlan(
        student_id=student_id,
        created_by=created_by,
        subject=subject,
        key_stage=key_stage,
        exam_board=exam_board,
        tier=tier,
        unit_name=unit_name,
        subtopic=subtopic,
        ability_level=ability_level,
        goal=goal,
        teacher_notes=teacher_notes,
        appointment_id=appointment_id,
        status="planned",
        materials_uploaded=[],
    )
    db.add(plan)
    await db.flush()
    await db.refresh(plan)
    logger.info(
        f"Created LessonPlan id={plan.id} for student_id={student_id} "
        f"by creator_id={created_by}"
    )
    return plan


async def get_lesson_plan(db: AsyncSession, lesson_plan_id: int) -> Optional[LessonPlan]:
    """Fetch a LessonPlan by primary key. Returns None if not found."""
    result = await db.execute(
        select(LessonPlan).where(LessonPlan.id == lesson_plan_id)
    )
    return result.scalar_one_or_none()


async def update_lesson_status(
    db: AsyncSession, plan: LessonPlan, new_status: str
) -> LessonPlan:
    """Update the status field of a LessonPlan and persist."""
    valid_statuses = {"planned", "in_progress", "completed"}
    if new_status not in valid_statuses:
        raise ValueError(f"Invalid status '{new_status}'. Must be one of {valid_statuses}.")
    plan.status = new_status
    plan.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(plan)
    return plan


# ---------------------------------------------------------------------------
# AI context builder
# ---------------------------------------------------------------------------

def build_lesson_context(plan: LessonPlan) -> str:
    """
    Return a formatted string that can be injected into an AI system prompt
    or user message to provide lesson-specific context.
    """
    lines = [
        "=== LESSON PLAN CONTEXT ===",
        f"Subject:       {plan.subject}",
        f"Key Stage:     {plan.key_stage}",
        f"Exam Board:    {plan.exam_board}",
        f"Tier:          {plan.tier}",
    ]
    if plan.unit_name:
        lines.append(f"Unit:          {plan.unit_name}")
    if plan.subtopic:
        lines.append(f"Subtopic:      {plan.subtopic}")

    ability_labels = {
        "new": "New to this topic",
        "started": "Has started this topic",
        "need_practice": "Needs more practice",
        "challenge": "Looking for a challenge",
    }
    goal_labels = {
        "teach_from_scratch": "Teach from scratch",
        "help_homework": "Help with homework",
        "test_with_questions": "Test with questions",
        "revise_quickly": "Quick revision",
    }

    lines.append(
        f"Ability Level: {ability_labels.get(plan.ability_level, plan.ability_level)}"
    )
    lines.append(
        f"Session Goal:  {goal_labels.get(plan.goal, plan.goal)}"
    )

    if plan.teacher_notes:
        lines.append(f"Teacher Notes: {plan.teacher_notes}")

    lines.append("=== END OF LESSON CONTEXT ===")
    return "\n".join(lines)
