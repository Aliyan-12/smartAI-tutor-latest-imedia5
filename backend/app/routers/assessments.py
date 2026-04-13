import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_student, require_any_authenticated
from app.models.user import User, ROLE_STUDENT, ROLE_PARENT
from app.schemas.assessment import AssessmentStart, AnswerSubmit, AssessmentResponse, AssessmentQuestionResponse
from app.services import assessment_service, gemini_service, email_service
from app.services.user_service import get_user_by_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assessments", tags=["assessments"])


@router.post("/start", response_model=AssessmentResponse)
async def start_assessment(
    payload: AssessmentStart,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    try:
        questions_data = gemini_service.generate_mcq_questions(
            topic=payload.topic,
            subject=payload.subject,
            key_stage=payload.key_stage,
            num_questions=5,
        )
    except Exception as e:
        logger.error(f"MCQ generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to generate quiz questions. Please try again.")

    assessment = await assessment_service.create_assessment(
        db=db,
        student_id=current_user.id,
        subject=payload.subject,
        key_stage=payload.key_stage,
        topic=payload.topic,
        questions_data=questions_data,
        chat_session_id=payload.chat_session_id,
    )

    loaded = await assessment_service.get_assessment(db, assessment.id)
    response = AssessmentResponse.model_validate(loaded)

    for q in response.questions:
        q.correct_answer = None
        q.explanation = None

    return response


@router.post("/{assessment_id}/answer")
async def submit_answer(
    assessment_id: int,
    payload: AnswerSubmit,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    assessment = await assessment_service.get_assessment(db, assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your assessment")
    if assessment.status != "in_progress":
        raise HTTPException(status_code=400, detail="Assessment already completed")

    question = await assessment_service.submit_answer(
        db, assessment, payload.question_index, payload.student_answer
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    return {
        "is_correct": question.is_correct,
        "correct_answer": question.correct_answer,
        "explanation": question.explanation,
    }


@router.post("/{assessment_id}/complete", response_model=AssessmentResponse)
async def complete_assessment(
    assessment_id: int,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    assessment = await assessment_service.get_assessment(db, assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your assessment")

    completed = await assessment_service.complete_assessment(db, assessment)

    try:
        report = gemini_service.generate_assessment_report(
            topic=completed.topic,
            subject=completed.subject,
            score_percent=completed.score_percent,
            weak_topics=completed.weak_topics or [],
            strong_topics=completed.strong_topics or [],
        )
        completed.report_text = report
        await db.flush()
    except Exception as e:
        logger.warning(f"Report generation failed: {e}")

    parent_email = None
    if current_user.parent_id:
        parent_user = await get_user_by_id(db, current_user.parent_id)
        if parent_user:
            parent_email = parent_user.email

    email_service.send_assessment_report(
        student_email=current_user.email,
        student_name=current_user.name,
        topic=completed.topic,
        score_percent=completed.score_percent,
        parent_email=parent_email,
    )

    # Award XP and update mastery
    try:
        from app.services import gamification_service
        await gamification_service.award_xp(db, current_user.id, 50, "quiz_complete")
        if completed.score_percent >= 80:
            await gamification_service.award_xp(db, current_user.id, 100, "quiz_high_score")
        if completed.score_percent >= 100:
            await gamification_service.award_xp(db, current_user.id, 200, "quiz_perfect")
        await gamification_service.check_and_update_streak(db, current_user.id)

        for topic_tag in (completed.strong_topics or []) + (completed.weak_topics or []):
            await gamification_service.update_topic_mastery(
                db, current_user.id, completed.subject,
                completed.key_stage, topic_tag, completed.score_percent,
            )
    except Exception as e:
        logger.warning(f"Gamification update failed: {e}")

    return AssessmentResponse.model_validate(completed)


@router.get("/{assessment_id}", response_model=AssessmentResponse)
async def get_assessment(
    assessment_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    assessment = await assessment_service.get_assessment(db, assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    if current_user.role == ROLE_STUDENT and assessment.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == ROLE_PARENT:
        student = await get_user_by_id(db, assessment.student_id)
        if not student or student.parent_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    return AssessmentResponse.model_validate(assessment)


@router.get("/student/{student_id}", response_model=List[AssessmentResponse])
async def list_student_assessments(
    student_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == ROLE_STUDENT and current_user.id != student_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == ROLE_PARENT:
        student = await get_user_by_id(db, student_id)
        if not student or student.parent_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    assessments = await assessment_service.list_student_assessments(db, student_id)
    return [AssessmentResponse.model_validate(a) for a in assessments]
