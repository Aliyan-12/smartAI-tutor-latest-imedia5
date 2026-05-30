"""
Session tools bound to Gemini during AI lessons.
All tools are created via make_session_tools(ctx) which injects session context.
ctx is captured in closures — never passed as Gemini-visible parameters.
"""
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from langchain_core.tools import tool
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


@dataclass
class ToolContext:
    db: AsyncSession
    student_id: int
    appointment_id: int
    subject: str
    key_stage: str
    chat_session_id: Optional[str] = None


def make_session_tools(ctx: ToolContext) -> list:
    """
    Create session-bound tool functions for a single request.
    ctx is captured in each closure — Gemini never sees db, student_id, etc.
    Returns a list of LangChain tool callables ready for get_llm(tools=...).
    """

    @tool
    async def generate_quiz(
        topic: str,
        difficulty: str = "medium",
        num_questions: int = 5,
    ) -> dict:
        """
        Generate an interactive multiple-choice quiz for the student on the given topic.
        Call after finishing teaching a concept and the student seems ready to be tested.
        difficulty: easy | medium | hard
        """
        from app.services import gemini_service, assessment_service
        questions = gemini_service.generate_mcq_questions(
            topic=topic,
            subject=ctx.subject,
            key_stage=ctx.key_stage,
            num_questions=num_questions,
        )
        assessment = await assessment_service.create_assessment(
            db=ctx.db,
            student_id=ctx.student_id,
            subject=ctx.subject,
            key_stage=ctx.key_stage,
            topic=topic,
            questions_data=questions,
            chat_session_id=ctx.chat_session_id,
            appointment_id=ctx.appointment_id,
            assessment_type=f"session_{difficulty}",
        )
        return {
            "assessment_id": assessment.id,
            "topic": topic,
            "difficulty": difficulty,
            "questions": questions,
            "action": "show_quiz",
        }

    @tool
    async def set_homework(
        title: str,
        topic: str,
        instructions: str,
        due_days: int = 7,
        estimated_minutes: int = 30,
        assignment_type: str = "homework",
    ) -> dict:
        """
        Set a homework assignment for the student.
        Call at the end of a session or when revision/practice material should be set.
        assignment_type: homework | revision | reading | prep
        """
        from app.models.assignment import Homework, HomeworkAssignment
        hw = Homework(
            teacher_id=ctx.student_id,
            title=title,
            subject=ctx.subject,
            key_stage=ctx.key_stage,
            topic=topic,
            instructions=instructions,
            due_date=datetime.now(timezone.utc) + timedelta(days=due_days),
            estimated_minutes=estimated_minutes,
            assignment_type=assignment_type,
        )
        ctx.db.add(hw)
        await ctx.db.flush()
        ctx.db.add(HomeworkAssignment(
            homework_id=hw.id,
            student_id=ctx.student_id,
            status="assigned",
        ))
        await ctx.db.flush()
        return {
            "homework_id": hw.id,
            "title": title,
            "due_date": hw.due_date.isoformat(),
            "action": "show_homework",
        }

    @tool
    async def get_student_mastery(topics: List[str]) -> dict:
        """
        Get this student's current mastery level for the given topics.
        Call at the start of a session or before deciding what depth to teach at.
        Returns mastery_level per topic: not_started | learning | developing | proficient | mastered
        """
        from app.services.session_agent_service import _load_topic_mastery
        records = await _load_topic_mastery(ctx.db, ctx.student_id, ctx.subject, ctx.key_stage)
        result = {}
        for topic in topics:
            r = next((x for x in records if x.topic == topic), None)
            result[topic] = {
                "mastery_level": r.mastery_level if r else "not_started",
                "attempts": r.attempts if r else 0,
                "last_practiced": r.last_practiced_at.isoformat() if r and r.last_practiced_at else None,
            }
        return {"mastery": result}

    @tool
    async def update_topic_mastery(
        topic: str,
        performance: str,
        score_percent: float = 0.0,
    ) -> dict:
        """
        Update this student's mastery level for a topic after a quiz or practice activity.
        performance: struggling | improving | confident | mastered
        score_percent: 0-100, from the assessment result if available.
        Call after receiving a quiz score or observing practice performance.
        """
        from app.services import gamification_service
        await gamification_service.update_topic_mastery(
            db=ctx.db,
            student_id=ctx.student_id,
            subject=ctx.subject,
            key_stage=ctx.key_stage,
            topic=topic,
            score=score_percent,
        )
        return {"topic": topic, "performance": performance, "score_percent": score_percent}

    @tool
    async def advance_lesson_phase(
        completed_step: str,
        student_performance: str = "good",
        notes: str = "",
    ) -> dict:
        """
        Mark the current lesson step complete and advance to the next planned step.
        Call ONLY when the current step's learning goal is fully achieved.
        student_performance: struggling | good | excellent
        Updates LessonPlan.session_state in the database.
        """
        from sqlalchemy import select
        from app.models.lesson_plan import LessonPlan
        result = await ctx.db.execute(
            select(LessonPlan).where(LessonPlan.appointment_id == ctx.appointment_id)
        )
        plan = result.scalar_one_or_none()
        if not plan or not plan.plan_blocks:
            return {"error": "no_plan", "next_step": None}

        state = plan.session_state or {"current_step": 0, "completed_steps": []}
        state["completed_steps"].append({
            "step": completed_step,
            "performance": student_performance,
            "notes": notes,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
        state["current_step"] = state.get("current_step", 0) + 1
        plan.session_state = state
        await ctx.db.flush()

        blocks = plan.plan_blocks.get("steps", [])
        next_idx = state["current_step"]
        next_block = blocks[next_idx] if next_idx < len(blocks) else None
        return {
            "completed": completed_step,
            "next_step": next_block["title"] if next_block else "session_complete",
            "ai_instruction": next_block.get("ai_instruction", "") if next_block else "",
            "step_type": next_block.get("type", "") if next_block else "",
        }

    @tool
    async def evaluate_answer(
        question: str,
        student_answer: str,
        mark_scheme: str = "",
        topic: str = "",
    ) -> dict:
        """
        Evaluate the student's open-ended answer against the mark scheme.
        Call for practice questions and exam-style questions.
        Returns a structured score 0-3, specific feedback, and misconceptions identified.
        """
        from app.services.llm_service import get_llm
        from app.services import gamification_service

        class AnswerEvaluation(BaseModel):
            score: int
            correct: bool
            feedback: str
            misconceptions: List[str]
            reinforce: List[str]

        eval_llm = get_llm().with_structured_output(AnswerEvaluation)
        prompt = (
            f"Subject: {ctx.subject} {ctx.key_stage}\n"
            f"Question: {question}\n"
            f"Mark scheme: {mark_scheme or 'Use your knowledge of the subject'}\n"
            f"Student answer: {student_answer}\n\n"
            "Evaluate the student's answer. Be specific about what they got right and wrong. "
            "Identify exact misconceptions. Score out of 3."
        )
        try:
            evaluation = eval_llm.invoke(prompt)
        except Exception as e:
            logger.error(f"evaluate_answer structured output failed: {e}")
            return {
                "score": 0,
                "max_score": 3,
                "correct": False,
                "feedback": "Could not evaluate answer at this time.",
                "misconceptions": [],
                "reinforce": [],
                "action": "show_answer_feedback",
            }

        if topic:
            score_pct = (evaluation.score / 3.0) * 100
            try:
                await gamification_service.update_topic_mastery(
                    db=ctx.db,
                    student_id=ctx.student_id,
                    subject=ctx.subject,
                    key_stage=ctx.key_stage,
                    topic=topic,
                    score=score_pct,
                )
            except Exception as e:
                logger.warning(f"update_topic_mastery in evaluate_answer failed: {e}")

        return {
            "score": evaluation.score,
            "max_score": 3,
            "correct": evaluation.correct,
            "feedback": evaluation.feedback,
            "misconceptions": evaluation.misconceptions,
            "reinforce": evaluation.reinforce,
            "action": "show_answer_feedback",
        }

    return [
        generate_quiz,
        set_homework,
        get_student_mastery,
        update_topic_mastery,
        advance_lesson_phase,
        evaluate_answer,
    ]
