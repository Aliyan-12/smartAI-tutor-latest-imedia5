"""
platform_tools.py — PLATFORM / LIFECYCLE / DATA tools for AI lessons.

These change platform state or pull platform data/lifecycle (quizzes, mastery,
reports, assignments, resources, and the pause/resume/end lifecycle) — as opposed
to the in-lesson view tools in `session_tools.py`. Assembled per turn by
`tools/registry.py`, which binds only the groups relevant to the current lesson
state (anti-hallucination — fewer tools per call).

Grouped: assessment · mastery · platform · lifecycle · research.
`end_lesson` is hard-guarded by `session_state_service.is_end_allowed` so the AI
can NEVER end a lesson mid-flight — only after the watchdog's `lesson.timeout` or a
student end-request flips `end_allowed`.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from langchain_core.tools import tool
from pydantic import BaseModel

from app.tools.session_tools import ToolContext

logger = logging.getLogger(__name__)


def platform_tool_groups(ctx: ToolContext) -> dict:
    """Build the platform tools, grouped by capability for the registry."""

    # ── assessment ───────────────────────────────────────────────────────────
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
        from app.models.assessment import Assessment
        from sqlalchemy import func, select as _select
        # ONE QUIZ PER SESSION — HARD STOP. Once a quiz exists for this appointment, never make
        # another. Without this the model kept calling generate_quiz and re-announcing "I've put
        # a quiz up" after the quiz was already done. The refusal is `suppressed` so the thinking
        # strip doesn't show a phantom step, and legible so the model stops offering.
        existing = (await ctx.db.execute(
            _select(func.count()).select_from(Assessment).where(
                Assessment.appointment_id == ctx.appointment_id,
                Assessment.student_id == ctx.student_id,
            )
        )).scalar() or 0
        if existing >= 1:
            logger.info("generate_quiz refused — quiz already done appt=%s", ctx.appointment_id)
            return {
                "action": "show_quiz", "error": "quiz_already_done", "suppressed": True,
                "message": (
                    "REFUSED — this student has ALREADY had their quiz this session, and there is "
                    "only ONE quiz per lesson. Nothing was created. Do NOT call generate_quiz "
                    "again and do NOT tell the student a quiz is ready or coming. Move on: talk "
                    "through how they did, or continue to the summary."
                ),
            }
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
        logger.info("generate_quiz: assessment=%s topic=%r diff=%s", assessment.id, topic, difficulty)
        # Coverage ledger — one quiz per lesson. Flag it so the anchor's "ALREADY COVERED" block
        # tells every agent the quiz is done and never to set another. Best-effort.
        try:
            from app.services import coverage_ledger
            await coverage_ledger.set_flag(ctx.db, ctx.appointment_id, "quiz_done", True)
        except Exception:  # noqa: BLE001 — ledger must never break quiz creation
            logger.warning("ledger quiz_done flag failed appt=%s", ctx.appointment_id, exc_info=True)
        return {
            "assessment_id": assessment.id,
            "topic": topic,
            "difficulty": difficulty,
            "questions": questions,
            "action": "show_quiz",
        }

    # ── mastery ──────────────────────────────────────────────────────────────
    @tool
    async def get_student_mastery(topics: List[str]) -> dict:
        """
        Get this student's current mastery level for the given topics.
        Call at the start of a session or before deciding what depth to teach at.
        Returns mastery_level per topic: not_started | learning | developing | proficient | mastered
        """
        from app.services.agent.session.core import _load_topic_mastery
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
        from app.services import platform_service
        await platform_service.update_topic_mastery(
            db=ctx.db,
            student_id=ctx.student_id,
            subject=ctx.subject,
            key_stage=ctx.key_stage,
            topic=topic,
            score=score_percent,
        )
        return {"topic": topic, "performance": performance, "score_percent": score_percent}

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
        from app.services import platform_service

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
                await platform_service.update_topic_mastery(
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

    # ── platform (state mutations / agentic actions) ─────────────────────────
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

        state = dict(plan.session_state) if plan.session_state else {}
        state.setdefault("current_step", 0)
        state.setdefault("completed_steps", [])
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
        logger.info("advance_lesson_phase: appt=%s → step %s", ctx.appointment_id, next_idx)
        return {
            "completed": completed_step,
            "next_step": next_block["title"] if next_block else "session_complete",
            "ai_instruction": next_block.get("ai_instruction", "") if next_block else "",
            "step_type": next_block.get("type", "") if next_block else "",
        }

    @tool
    async def create_assignment(
        title: str,
        topic: str,
        instructions: str,
        due_days: int = 7,
        estimated_minutes: int = 30,
        assignment_type: str = "homework",
    ) -> dict:
        """
        Create a follow-up assignment (homework/revision/reading) for the student.
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
        logger.info("create_assignment: hw=%s title=%r student=%s", hw.id, title, ctx.student_id)
        return {
            "homework_id": hw.id,
            "title": title,
            "due_date": hw.due_date.isoformat(),
            "action": "show_homework",
        }

    @tool
    async def load_resource(query: str) -> dict:
        """
        Bring a specific teaching resource onto the student's screen by describing it
        (e.g. "the photosynthesis slides", "forces worksheet"). Finds the best-matching
        resource for THIS lesson and displays its first slide. Use when the student asks
        to see material on something, or you want to teach from a specific resource.
        Call silently.
        """
        from app.services import appointment_service
        from app.services.agent.session.resources import build_playlist, slide_action
        try:
            appt = await appointment_service.get_appointment(ctx.db, ctx.appointment_id)
            if not appt:
                return {"action": "load_resource", "error": "no_appointment"}
            playlist = await build_playlist(ctx.db, appt)
            if not playlist:
                return {
                    "action": "load_resource", "error": "no_resources",
                    "message": "No teaching resources exist for this lesson — teach from your "
                               "own knowledge or use a puzzle.",
                }
            q = (query or "").lower()

            def _score(r) -> int:
                hay = f"{getattr(r, 'title', '')} {getattr(r, 'unit_title', '')} {getattr(r, 'topic_title', '')}".lower()
                return sum(1 for w in q.split() if w and w in hay)

            best = max(playlist, key=_score)
            ctx.slide_moved = True
            payload = await slide_action(
                ctx.db, ctx.appointment_id, mode="show",
                resource_hub_id=best.hub_id, slide_index=1,
            )
            logger.info("load_resource: query=%r → hub_id=%s title=%r",
                        query, best.hub_id, getattr(best, "title", ""))
            return payload
        except Exception as e:  # noqa: BLE001
            logger.warning("load_resource failed: %s", e)
            return {"action": "load_resource", "error": "failed"}

    @tool
    async def pause_lesson(reason: str = "short break") -> dict:
        """
        Pause the lesson clock for a short brain break — the session timer freezes until
        you call resume_lesson. Use sparingly (e.g. the mandatory brain break in long
        sessions). Call silently.
        """
        from app.services import appointment_service
        try:
            appt = await appointment_service.get_appointment(ctx.db, ctx.appointment_id)
            if appt and appt.status == "started":
                await appointment_service.update_status(ctx.db, appt, "paused")
                logger.info("pause_lesson: appt=%s reason=%r", ctx.appointment_id, reason)
        except Exception as e:  # noqa: BLE001
            logger.warning("pause_lesson failed: %s", e)
        return {"action": "pause_lesson", "reason": reason}

    @tool
    async def resume_lesson() -> dict:
        """
        Resume the lesson clock after a brain break (undoes pause_lesson). Call silently.
        """
        from app.services import appointment_service
        try:
            appt = await appointment_service.get_appointment(ctx.db, ctx.appointment_id)
            if appt and appt.status == "paused":
                await appointment_service.update_status(ctx.db, appt, "started")
                logger.info("resume_lesson: appt=%s", ctx.appointment_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("resume_lesson failed: %s", e)
        return {"action": "resume_lesson"}

    # ── lifecycle (gated) ────────────────────────────────────────────────────
    @tool
    async def end_lesson(closing_note: str = "") -> dict:
        """
        End the lesson. ONLY allowed after time is up (lesson.timeout) OR the student
        asked to stop — otherwise it is REFUSED and you must keep teaching. When allowed
        it finalises the session, generates the report card, and the student is taken to
        it. Deliver your short, warm closing summary in your reply BEFORE calling this.
        Call silently.
        """
        from app.services import appointment_service
        from app.services.agent.session import state as session_state_service
        allowed = await session_state_service.is_end_allowed(ctx.db, ctx.appointment_id)
        if not allowed:
            logger.info("end_lesson DENIED (end_not_allowed) appt=%s", ctx.appointment_id)
            return {
                "action": "end_lesson", "error": "end_not_allowed",
                "message": "You cannot end mid-lesson. Encourage the student to keep going "
                           "and continue teaching the next thing.",
            }
        try:
            appt = await appointment_service.get_appointment(ctx.db, ctx.appointment_id)
            if appt and appt.status in ("started", "paused"):
                await appointment_service.update_status(ctx.db, appt, "terminated")
            logger.info("end_lesson ALLOWED → terminated appt=%s", ctx.appointment_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("end_lesson terminate failed: %s", e)
        return {"action": "end_lesson", "ended": True, "closing_note": closing_note}

    @tool
    async def allow_end_lesson() -> dict:
        """
        Unlock ending. Call this ONCE at the very end of the lesson — after you have
        delivered the recap AND written the report — to sanction the student ending the
        session. It does NOT end the lesson itself: it flips the `end_allowed` flag so the
        student may click 'End Lesson' whenever they're ready. After calling it, tell the
        student the lesson is complete and they can end it when they like. Call silently.
        """
        from app.services.agent.session import state as session_state_service
        await session_state_service.set_end_allowed(ctx.db, ctx.appointment_id, True)
        logger.info("allow_end_lesson → end_allowed=True appt=%s", ctx.appointment_id)
        return {"action": "allow_end_lesson", "ok": True}

    @tool
    async def generate_session_report(
        topics_covered: List[str],
        student_performance: str = "good",
        session_notes: str = "",
    ) -> dict:
        """
        Generate and save the session report at the end of the lesson.
        Call after delivering the final summary/review — summarise what was taught,
        how the student performed, and recommend next steps.
        topics_covered: specific concepts actually taught this session (e.g. ["mitosis", "cell division"])
        student_performance: struggling | developing | good | excellent
        session_notes: any notable observations (optional)
        """
        from sqlalchemy import select
        from app.models.chat import Chat, Message
        from app.models.assessment import Assessment
        from app.models.lesson_plan import LessonPlan
        from app.models.user import User
        from app.models.appointment import Appointment
        from app.services.agent.session import plan as lesson_service

        appt_result = await ctx.db.execute(
            select(Appointment).where(Appointment.id == ctx.appointment_id)
        )
        appointment = appt_result.scalar_one_or_none()
        if not appointment:
            return {"error": "appointment_not_found", "action": "show_report"}

        lp_result = await ctx.db.execute(
            select(LessonPlan).where(LessonPlan.appointment_id == ctx.appointment_id)
        )
        lesson_plan = lp_result.scalar_one_or_none()
        if lesson_plan and lesson_plan.session_summary:
            try:
                import json as _json
                existing = _json.loads(lesson_plan.session_summary)
                return {
                    "report_saved": True,
                    "already_existed": True,
                    "summary": existing.get("summary", ""),
                    "understanding_level": existing.get("understanding_level", "Good"),
                    "encouragement": existing.get("encouragement", ""),
                    "action": "show_report",
                }
            except Exception:
                pass  # malformed JSON — regenerate

        chat_result = await ctx.db.execute(
            select(Chat).where(Chat.appointment_id == ctx.appointment_id)
        )
        chat = chat_result.scalar_one_or_none()
        messages = []
        if chat:
            msg_result = await ctx.db.execute(
                select(Message)
                .where(Message.chat_id == chat.id)
                .order_by(Message.timestamp)
                .limit(100)
            )
            messages = list(msg_result.scalars().all())

        asmt_result = await ctx.db.execute(
            select(Assessment)
            .where(Assessment.appointment_id == ctx.appointment_id)
            .order_by(Assessment.created_at.desc())
            .limit(20)
        )
        assessments = list(asmt_result.scalars().all())

        student_result = await ctx.db.execute(
            select(User).where(User.id == ctx.student_id)
        )
        student = student_result.scalar_one_or_none()

        report = await lesson_service.generate_session_report(
            db=ctx.db,
            appointment=appointment,
            lesson_plan=lesson_plan,
            assessments=assessments,
            student_name=student.name if student else "Student",
            messages=messages,
        )

        logger.info(
            "[generate_session_report tool] Report generated for appointment_id=%s",
            ctx.appointment_id,
        )
        return {
            "report_saved": True,
            "summary": report.get("summary", ""),
            "topics_covered": report.get("topics_covered", topics_covered),
            "quiz_score_percent": report.get("quiz_score_percent"),
            "understanding_level": report.get("understanding_level", "Good"),
            "next_session_recommendation": report.get("next_session_recommendation", ""),
            "encouragement": report.get("encouragement", ""),
            "action": "show_report",
        }

    # ── research ─────────────────────────────────────────────────────────────
    @tool
    async def web_search(query: str, num_results: int = 5) -> dict:
        """
        Search the web for current information relevant to the student's question.
        Use when the student asks about recent events, news, or topics that benefit from
        up-to-date web information beyond the lesson knowledge base.
        query: specific search query related to the lesson topic
        num_results: how many results to fetch (default 5)
        """
        import asyncio
        from app.services.llm_service import get_llm
        from langchain_core.messages import HumanMessage

        search_prompt = (
            f"Subject: {ctx.subject} {ctx.key_stage}\n\n"
            f"Search the web and find current, accurate information to answer this query: {query}\n\n"
            f"Provide a concise, factual summary of what you find. Include any relevant dates, "
            f"statistics, or key facts. Focus on information relevant to GCSE {ctx.subject} students."
        )

        try:
            from langchain_google_genai import GoogleSearchRetrieval
            search_llm = get_llm(tools=[GoogleSearchRetrieval()])
            response = await asyncio.to_thread(
                search_llm.invoke,
                [HumanMessage(content=search_prompt)]
            )
            content = response.content if hasattr(response, "content") else str(response)
            if isinstance(content, list):
                content = " ".join(
                    p.get("text", "") if isinstance(p, dict) else str(p) for p in content
                )
            return {
                "query": query,
                "results": content,
                "action": "show_search_results",
            }
        except Exception as e:
            logger.warning(f"web_search tool failed: {e}")
            return {
                "query": query,
                "results": "Web search unavailable at this time. Using knowledge base only.",
                "action": "show_search_results",
            }

    @tool
    async def deep_research(
        topic: str,
        research_questions: Optional[List[str]] = None,
    ) -> dict:
        """
        Conduct thorough research on a topic using multiple search queries and synthesize findings.
        Use when the student asks for in-depth understanding of a complex topic, wants to explore
        multiple perspectives, or needs comprehensive background knowledge beyond the lesson.
        topic: the main research topic
        research_questions: optional list of specific questions to investigate
        """
        import asyncio
        from app.services.llm_service import get_llm
        from langchain_core.messages import HumanMessage, SystemMessage

        questions = research_questions or [
            f"What are the key concepts of {topic} in {ctx.subject}?",
            f"What are common misconceptions about {topic}?",
            f"How does {topic} relate to {ctx.key_stage} GCSE exam requirements?",
        ]

        try:
            from langchain_google_genai import GoogleSearchRetrieval
            research_llm = get_llm(tools=[GoogleSearchRetrieval()])

            research_prompt = (
                f"You are a research assistant helping a GCSE {ctx.subject} {ctx.key_stage} student "
                f"understand '{topic}' in depth.\n\n"
                f"Research the following questions thoroughly:\n"
                + "\n".join(f"- {q}" for q in questions)
                + f"\n\nSynthesize your findings into a comprehensive, student-friendly explanation. "
                f"Include: key facts, real-world examples, exam-relevant points, and any recent developments. "
                f"Format with clear sections."
            )

            response = await asyncio.to_thread(
                research_llm.invoke,
                [
                    SystemMessage(
                        content=f"You are a thorough research assistant for GCSE {ctx.subject} students."
                    ),
                    HumanMessage(content=research_prompt),
                ],
            )
            content = response.content if hasattr(response, "content") else str(response)
            if isinstance(content, list):
                content = " ".join(
                    p.get("text", "") if isinstance(p, dict) else str(p) for p in content
                )

            return {
                "topic": topic,
                "research": content,
                "questions_investigated": questions,
                "action": "show_research",
            }
        except Exception as e:
            logger.warning(f"deep_research tool failed: {e}")
            return {
                "topic": topic,
                "research": f"Research synthesis unavailable. Please ask your teacher for more resources on {topic}.",
                "questions_investigated": questions,
                "action": "show_research",
            }

    return {
        "assessment": [generate_quiz],
        "mastery": [get_student_mastery, update_topic_mastery, evaluate_answer],
        "platform": [advance_lesson_phase, create_assignment, load_resource, pause_lesson, resume_lesson],
        "lifecycle": [end_lesson, allow_end_lesson, generate_session_report],
        "research": [web_search, deep_research],
    }


def make_platform_tools(ctx: ToolContext) -> list:
    """All platform tools as a flat list."""
    return [t for grp in platform_tool_groups(ctx).values() for t in grp]
