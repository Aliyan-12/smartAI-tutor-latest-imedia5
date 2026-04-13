import logging
from typing import List, Optional

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.assessment import Assessment, AssessmentQuestion

logger = logging.getLogger(__name__)


async def create_assessment(
    db: AsyncSession,
    student_id: int,
    subject: str,
    key_stage: str,
    topic: str,
    questions_data: list,
    chat_session_id: Optional[str] = None,
) -> Assessment:
    assessment = Assessment(
        student_id=student_id,
        subject=subject,
        key_stage=key_stage,
        topic=topic,
        chat_session_id=chat_session_id,
        total_questions=len(questions_data),
        status="in_progress",
    )
    db.add(assessment)
    await db.flush()

    for q in questions_data:
        question = AssessmentQuestion(
            assessment_id=assessment.id,
            question_index=q["question_index"],
            question_text=q["question_text"],
            options=q["options"],
            correct_answer=q["correct_answer"],
            explanation=q.get("explanation", ""),
            topic_tag=q.get("topic_tag", topic),
        )
        db.add(question)

    await db.flush()
    await db.refresh(assessment)
    return assessment


async def get_assessment(db: AsyncSession, assessment_id: int) -> Optional[Assessment]:
    result = await db.execute(
        select(Assessment)
        .options(selectinload(Assessment.questions))
        .where(Assessment.id == assessment_id)
    )
    return result.scalar_one_or_none()


async def list_student_assessments(
    db: AsyncSession, student_id: int, limit: int = 50
) -> List[Assessment]:
    result = await db.execute(
        select(Assessment)
        .where(Assessment.student_id == student_id)
        .order_by(desc(Assessment.created_at))
        .limit(limit)
    )
    return list(result.scalars().all())


async def submit_answer(
    db: AsyncSession,
    assessment: Assessment,
    question_index: int,
    student_answer: int,
) -> Optional[AssessmentQuestion]:
    result = await db.execute(
        select(AssessmentQuestion)
        .where(
            AssessmentQuestion.assessment_id == assessment.id,
            AssessmentQuestion.question_index == question_index,
        )
    )
    question = result.scalar_one_or_none()
    if not question:
        return None

    question.student_answer = student_answer
    question.is_correct = (student_answer == question.correct_answer)
    await db.flush()
    await db.refresh(question)
    return question


async def complete_assessment(db: AsyncSession, assessment: Assessment) -> Assessment:
    result = await db.execute(
        select(AssessmentQuestion)
        .where(AssessmentQuestion.assessment_id == assessment.id)
        .order_by(AssessmentQuestion.question_index)
    )
    questions = list(result.scalars().all())

    correct = sum(1 for q in questions if q.is_correct)
    total = len(questions)

    weak = list(set(q.topic_tag for q in questions if q.is_correct is False))
    strong = list(set(q.topic_tag for q in questions if q.is_correct is True))

    assessment.correct_answers = correct
    assessment.total_questions = total
    assessment.score_percent = (correct / total * 100) if total > 0 else 0
    assessment.weak_topics = weak
    assessment.strong_topics = strong
    assessment.status = "completed"

    await db.flush()
    await db.refresh(assessment)
    return assessment


async def get_student_progress(db: AsyncSession, student_id: int) -> dict:
    assessments = await list_student_assessments(db, student_id)

    completed = [a for a in assessments if a.status == "completed"]
    scores = [a.score_percent for a in completed]

    all_weak = []
    all_strong = []
    for a in completed:
        if a.weak_topics:
            all_weak.extend(a.weak_topics)
        if a.strong_topics:
            all_strong.extend(a.strong_topics)

    return {
        "total_assessments": len(completed),
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
        "latest_score": scores[0] if scores else None,
        "weak_topics": list(set(all_weak)),
        "strong_topics": list(set(all_strong)),
    }
