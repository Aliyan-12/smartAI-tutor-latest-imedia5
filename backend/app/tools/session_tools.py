"""
Session tools bound to Gemini during AI lessons.
All tools are created via make_session_tools(ctx) which injects session context.
ctx is captured in closures — never passed as Gemini-visible parameters.
"""
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Union

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
    # Turn-scoped guard: at most ONE slide move (advance/retreat/show) per reply,
    # so the AI can't race several slides ahead in a single turn. Reset each turn
    # because a fresh ToolContext is built per turn in _run_turn.
    slide_moved: bool = False


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

        # Copy + setdefault so we coexist with other session_state keys
        # (e.g. slide_state written by the slide tools) and never KeyError.
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
        from app.services import lesson_service

        # Load appointment
        appt_result = await ctx.db.execute(
            select(Appointment).where(Appointment.id == ctx.appointment_id)
        )
        appointment = appt_result.scalar_one_or_none()
        if not appointment:
            return {"error": "appointment_not_found", "action": "show_report"}

        # Skip if report already saved (idempotent)
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

        # Load chat messages
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

        # Load assessments
        asmt_result = await ctx.db.execute(
            select(Assessment)
            .where(Assessment.appointment_id == ctx.appointment_id)
            .order_by(Assessment.created_at.desc())
            .limit(20)
        )
        assessments = list(asmt_result.scalars().all())

        # Load student name
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
            f"[generate_session_report tool] Report generated for appointment_id={ctx.appointment_id}"
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

    @tool
    async def show_resource(resource_hub_id: int, slide_index: int = 1) -> dict:
        """
        Display a teaching resource (slide deck, worksheet, mark scheme, or link) on
        the student's screen and jump DIRECTLY to a specific slide/page. Use this ONLY
        when the student explicitly asks to see a particular slide/topic ("show me the
        touch slide", "go to that slide") — it may skip several slides at once to reach
        the one they asked for. For normal sequential teaching use advance_lesson_slide
        instead. slide_index is 1-based. The returned slide_content is the text on that
        slide — teach from it.
        """
        from app.services.session_resource_service import slide_action
        # An explicit, student-requested jump — allowed to span several slides in one
        # call. It still counts as this turn's slide move, so a stray sequential
        # advance/retreat afterwards is suppressed.
        ctx.slide_moved = True
        return await slide_action(
            ctx.db, ctx.appointment_id, mode="show",
            resource_hub_id=resource_hub_id, slide_index=slide_index,
        )

    @tool
    async def advance_lesson_slide() -> dict:
        """
        Move the on-screen resource FORWARD by exactly ONE slide/page (or to the next
        resource when the current deck ends). This is the normal sequential teaching
        step — call it ONCE per reply, only after the student has understood the current
        slide and answered its question. The returned slide_content is the next slide's
        text — teach from it. (To jump straight to a slide the student asked for by name,
        use show_resource instead.)
        """
        from app.services.session_resource_service import slide_action
        if ctx.slide_moved:
            # Teaching advances one slide per turn — don't race ahead.
            payload = await slide_action(ctx.db, ctx.appointment_id, mode="show")
            payload["note"] = (
                "You've already moved a slide this turn. Teaching goes ONE slide per "
                "reply — teach the current slide now and advance on the next turn."
            )
            return payload
        ctx.slide_moved = True
        return await slide_action(ctx.db, ctx.appointment_id, mode="advance")

    @tool
    async def retreat_lesson_slide() -> dict:
        """
        Move the on-screen resource BACK by exactly ONE slide/page. Call ONCE when the
        student did not understand the current slide or answered its question
        incorrectly, so you can re-teach the earlier slide. The returned slide_content
        is that slide's text — re-teach from it.
        """
        from app.services.session_resource_service import slide_action
        if ctx.slide_moved:
            payload = await slide_action(ctx.db, ctx.appointment_id, mode="show")
            payload["note"] = (
                "You've already moved a slide this turn. Teach the current slide now; "
                "move again on the next turn."
            )
            return payload
        ctx.slide_moved = True
        return await slide_action(ctx.db, ctx.appointment_id, mode="retreat")

    @tool
    async def list_available_puzzles() -> dict:
        """
        List the interactive visual puzzles available for THIS lesson's subject and
        key stage (e.g. fraction bars, number lines, label-the-diagram). Call this
        before show_puzzle so you choose a real puzzle_id with valid params — never
        invent a puzzle_id. Returns each puzzle's id, what it shows, and its params.
        """
        from app.services import puzzle_service
        return {"puzzles": puzzle_service.list_available(ctx.subject, ctx.key_stage)}

    @tool
    async def show_puzzle(puzzle_id: str, params: Optional[Union[dict, str]] = None) -> dict:
        """
        Display an interactive visual puzzle on the student's screen to teach or check
        a concept (Synthesis-style). Use for hands-on Maths/Science moments — e.g. naming
        a fraction on a bar, reading a number line, labelling a diagram. Pick puzzle_id
        from list_available_puzzles and pass its params (see each puzzle's `params`),
        using the EXACT param names shown there (e.g. total_parts, shaded_parts).
        After showing it, ask the student to solve it and WAIT — their answer arrives as a
        [PUZZLE RESULT] message; then praise + advance, or give a hint and try again.
        Call this SILENTLY (never write the call as text).
        """
        from app.services import puzzle_service
        # Gemini sometimes serializes the params object as a JSON string — coerce it.
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except Exception:
                params = {}
        if not isinstance(params, dict):
            params = {}
        payload = puzzle_service.build(puzzle_id, params)
        if not payload.get("error"):
            try:
                await puzzle_service.save_puzzle_state(ctx.db, ctx.appointment_id, payload)
            except Exception as e:  # noqa: BLE001
                logger.warning("save_puzzle_state failed: %s", e)
        return payload

    @tool
    async def clear_puzzle() -> dict:
        """
        Remove the current puzzle from the student's screen (e.g. once they've mastered
        it and you're moving on to teaching/slides). Call silently.
        """
        from app.services import puzzle_service
        try:
            await puzzle_service.save_puzzle_state(ctx.db, ctx.appointment_id, None)
        except Exception as e:  # noqa: BLE001
            logger.warning("clear puzzle_state failed: %s", e)
        return {"action": "clear_puzzle"}

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

    return [
        generate_quiz,
        set_homework,
        get_student_mastery,
        update_topic_mastery,
        advance_lesson_phase,
        evaluate_answer,
        generate_session_report,
        show_resource,
        advance_lesson_slide,
        retreat_lesson_slide,
        list_available_puzzles,
        show_puzzle,
        clear_puzzle,
        web_search,
        deep_research,
    ]
