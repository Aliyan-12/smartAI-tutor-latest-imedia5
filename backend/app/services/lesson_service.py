"""
Lesson plan service: topic discovery, CRUD for lesson plans, AI context builder,
pre-lesson intelligence, session checkpoints, and post-session report generation.
"""
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.lesson_plan import LessonPlan

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Topic / subtopic discovery
# ---------------------------------------------------------------------------

async def get_topics_for_subject(
    db: AsyncSession, subject: str, key_stage: str
) -> List[Dict[str, Any]]:
    """
    Return the units for the given subject + key stage from the Resource Hub
    mirror, shaped as {unit_name, document_count} for backward compatibility.
    """
    from app.services import curriculum_service

    units = await curriculum_service.get_units_by_subject_name(db, subject, key_stage)
    return [{"unit_name": u["title"], "document_count": 0} for u in units]


async def get_subtopics(
    db: AsyncSession, subject: str, unit_name: str
) -> List[str]:
    """
    Return the topic titles for a unit (matched by title) from the Resource Hub
    mirror.
    """
    from app.models.resource_hub import RHUnit, RHTopic

    unit = (await db.execute(
        select(RHUnit).where(RHUnit.title == unit_name)
    )).scalar_one_or_none()
    if unit is None:
        return []

    rows = (await db.execute(
        select(RHTopic.title)
        .where(RHTopic.unit_hub_id == unit.hub_id)
        .order_by(RHTopic.position, RHTopic.id)
    )).all()
    return [r[0] for r in rows]


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


# ---------------------------------------------------------------------------
# Task 1: Pre-Lesson Intelligence + AI Lesson Plan Generation
# ---------------------------------------------------------------------------

async def generate_lesson_plan(
    db: AsyncSession,
    student_id: int,
    subject: str,
    topic: str,
    goal: str,
    duration_minutes: int,
    subtopic: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate an AI-powered lesson plan for a student, personalised using their
    TopicMastery data and StudentProfile preferences.
    Returns the generated plan as a dict (also suitable for storing in plan_blocks).
    """
    from app.models.student_profile import StudentProfile, TopicMastery
    from app.services.llm_service import get_llm
    from langchain_core.messages import SystemMessage, HumanMessage

    # 1. Fetch student's topic mastery for personalisation
    mastery_result = await db.execute(
        select(TopicMastery).where(
            TopicMastery.student_id == student_id,
            TopicMastery.subject == subject,
            TopicMastery.topic == topic,
        )
    )
    mastery = mastery_result.scalar_one_or_none()

    weak_areas: List[str] = []
    mastery_level = "not_started"
    score_history_summary = "No prior attempts"
    if mastery:
        mastery_level = mastery.mastery_level
        scores = [e["score"] for e in (mastery.score_history or []) if "score" in e]
        avg = 0.0
        if scores:
            avg = sum(scores) / len(scores)
            score_history_summary = f"Average score: {avg:.0f}% over {len(scores)} attempt(s)"
        # Derive weak areas from poor scores (or if no attempts yet)
        if not scores or avg < 50:
            weak_areas = [topic]

    # 2. Fetch student profile for interests and learning style
    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.student_id == student_id)
    )
    profile = profile_result.scalar_one_or_none()

    interests = []
    preferred_subjects = []
    learning_style = []
    teaching_pace = "just_right"
    teaching_preferences: Dict[str, Any] = {}

    if profile:
        interests = profile.interests or []
        preferred_subjects = profile.preferred_subjects or []
        # New fields from Task 5 (gracefully handle if not yet migrated)
        learning_style = getattr(profile, "learning_style", None) or []
        teaching_pace = getattr(profile, "teaching_pace", "just_right") or "just_right"
        teaching_preferences = getattr(profile, "teaching_preferences", None) or {}

    # 3. Build session-length guidance
    if duration_minutes <= 30:
        session_guidance = (
            "This is a SHORT 30-minute session. Cover ONLY 1 concept. "
            "Use light practice (1-2 exercises). End with a quick 2-question recap. "
            "Keep each block concise."
        )
    else:
        session_guidance = (
            "This is a FULL 60-minute session. Cover 1-2 concepts in depth. "
            "Include meaningful practice with 3-5 exercises. Use a proper assessment at the end."
        )

    # 4. Build goal-specific guidance
    goal_guidance_map = {
        "teach_from_scratch": (
            "Goal: TEACH FROM SCRATCH. The student has NO prior knowledge. "
            "Start with fundamentals. Use lots of explanation. Minimal jumping ahead."
        ),
        "practice": (
            "Goal: PRACTICE. Student already knows the basics. "
            "Skip lengthy introductions. Jump straight to problems and exercises."
        ),
        "test_prep": (
            "Goal: TEST PREPARATION. Minimal teaching. "
            "Focus on exam-style questions, time-pressure practice, and weak area drilling."
        ),
        "help_homework": (
            "Goal: HOMEWORK HELP. Walk through specific problems step by step."
        ),
        "revise_quickly": (
            "Goal: QUICK REVISION. Rapid recap of key points, then short self-test."
        ),
    }
    goal_guidance = goal_guidance_map.get(goal, f"Goal: {goal}")

    # 5. Build personalisation context
    personalisation_parts = []
    if mastery_level != "not_started":
        personalisation_parts.append(f"Student mastery level: {mastery_level}. {score_history_summary}.")
    if weak_areas:
        personalisation_parts.append(f"Known weak areas: {', '.join(weak_areas)}.")
    if interests:
        personalisation_parts.append(f"Student interests (use in examples): {', '.join(interests)}.")
    if learning_style:
        personalisation_parts.append(f"Preferred learning styles: {', '.join(learning_style)}.")
    if teaching_pace == "slower":
        personalisation_parts.append("Student learns better at a slower pace — explain more carefully.")
    elif teaching_pace == "faster":
        personalisation_parts.append("Student prefers a faster pace — be concise and move ahead quickly.")
    if teaching_preferences.get("real_life_examples"):
        personalisation_parts.append("Always use real-world examples.")
    if teaching_preferences.get("step_by_step"):
        personalisation_parts.append("Always break explanations into numbered steps.")
    if teaching_preferences.get("practice_as_we_go"):
        personalisation_parts.append("Interleave small practice tasks within explanations.")

    personalisation_context = " ".join(personalisation_parts) if personalisation_parts else "No specific personalisation data."

    topic_line = f"Topic: {topic}"
    if subtopic:
        topic_line += f" (focusing on subtopic: {subtopic})"

    prompt = f"""You are an expert UK curriculum lesson planner. Generate a structured lesson plan as JSON.

Subject: {subject}
{topic_line}
Duration: {duration_minutes} minutes

{session_guidance}
{goal_guidance}

Student personalisation:
{personalisation_context}

Generate a lesson plan with this EXACT JSON structure (no markdown, no extra text — raw JSON only):
{{
  "lesson_title": "A specific, engaging title for this lesson",
  "preview_summary": "In this lesson you will: [2-3 bullet points of what student will learn/do]",
  "blocks": [
    {{"type": "intro", "title": "...", "duration_minutes": 2, "description": "What the AI tutor will say/do in this block"}},
    {{"type": "teach", "title": "...", "duration_minutes": 15, "description": "...", "subtopics": ["subtopic1", "subtopic2"]}},
    {{"type": "practice", "title": "...", "duration_minutes": 10, "description": "..."}},
    {{"type": "check", "title": "...", "duration_minutes": 5, "description": "..."}},
    {{"type": "summary", "title": "...", "duration_minutes": 3, "description": "..."}}
  ],
  "personalisation_notes": "Brief note on how this plan was adapted for this specific student",
  "continuation_point": null
}}

Rules:
- Total block durations must sum to approximately {duration_minutes} minutes
- For short sessions (<=30 min): use fewer blocks, shorter durations
- For test_prep goal: make "check" block the largest
- For practice goal: make "practice" block the largest
- For teach_from_scratch: make "teach" block the largest
- Block types allowed: intro, teach, practice, check, summary
- Only include "subtopics" field on "teach" blocks
- Return ONLY valid JSON, no markdown fences"""

    try:
        import asyncio
        lc_messages = [
            SystemMessage(content="You are a lesson plan generator. Output only valid JSON."),
            HumanMessage(content=prompt),
        ]
        response = await asyncio.to_thread(get_llm().invoke, lc_messages)
        raw = response.content.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        plan_data = json.loads(raw)
        logger.info(f"Generated lesson plan for student={student_id}, topic={topic}")
        return plan_data
    except Exception as exc:
        logger.error(f"Failed to generate lesson plan via Gemini: {exc}")
        # Fallback: return a basic structure
        fallback_teach_mins = max(5, duration_minutes - 10)
        return {
            "lesson_title": f"{subject}: {topic}",
            "preview_summary": f"In this lesson you will study {topic} in {subject}.",
            "blocks": [
                {"type": "intro", "title": "Introduction", "duration_minutes": 2, "description": f"Overview of {topic}"},
                {"type": "teach", "title": f"Learning {topic}", "duration_minutes": fallback_teach_mins, "description": f"AI tutor teaches {topic}", "subtopics": [topic]},
                {"type": "summary", "title": "Recap", "duration_minutes": 3, "description": "Summary and next steps"},
            ],
            "personalisation_notes": "Default plan — AI generation failed.",
            "continuation_point": None,
        }


# ---------------------------------------------------------------------------
# Task 2: Session Checkpoint + Smart Continuation
# ---------------------------------------------------------------------------

async def save_checkpoint(
    db: AsyncSession,
    lesson_plan_id: int,
    checkpoint_data: Dict[str, Any],
) -> LessonPlan:
    """
    Save the current session state (progress) to LessonPlan.session_state.
    Automatically stamps last_checkpoint_at if not provided.
    """
    plan = await get_lesson_plan(db, lesson_plan_id)
    if plan is None:
        raise ValueError(f"LessonPlan id={lesson_plan_id} not found")

    if "last_checkpoint_at" not in checkpoint_data or not checkpoint_data["last_checkpoint_at"]:
        checkpoint_data["last_checkpoint_at"] = datetime.now(timezone.utc).isoformat()

    plan.session_state = checkpoint_data
    plan.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(plan)
    logger.info(f"Saved checkpoint for lesson_plan_id={lesson_plan_id}, block_index={checkpoint_data.get('current_block_index')}")
    return plan


async def get_continuation(
    db: AsyncSession,
    student_id: int,
    subject: str,
    topic: str,
) -> Optional[Dict[str, Any]]:
    """
    Find the most recent LessonPlan for this student/subject/topic that has
    session_state data, so the next session can resume from where it left off.
    Returns None if no continuation found.
    """
    result = await db.execute(
        select(LessonPlan)
        .where(
            LessonPlan.student_id == student_id,
            LessonPlan.subject == subject,
            LessonPlan.session_state.isnot(None),
        )
        .order_by(LessonPlan.updated_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()

    if plan is None:
        return None

    # Check topic match against unit_name or subtopic
    topic_lower = topic.lower()
    unit_match = plan.unit_name and topic_lower in plan.unit_name.lower()
    subtopic_match = plan.subtopic and topic_lower in plan.subtopic.lower()
    if not unit_match and not subtopic_match:
        return None

    return {
        "found": True,
        "lesson_plan_id": plan.id,
        "subject": plan.subject,
        "topic": plan.unit_name or plan.subtopic,
        "session_state": plan.session_state,
    }


# ---------------------------------------------------------------------------
# Task 3: Post-Session Report Generation
# ---------------------------------------------------------------------------

async def generate_session_report(
    db: AsyncSession,
    appointment: Any,
    lesson_plan: Optional[Any],
    assessments: List[Any],
    student_name: Optional[str] = None,
    messages: Optional[List[Any]] = None,
) -> Dict[str, Any]:
    """
    Generate a phase-wise AI session report from actual conversation content.
    Quiz score is only set when a real quiz was taken in this session.
    Weak/strong areas come from quiz results only — not the mastery database.
    """
    from app.services.llm_service import get_llm
    from langchain_core.messages import SystemMessage, HumanMessage

    # IMMUTABLE: once an AUTHENTIC (successfully AI-generated) report exists for this
    # appointment it is FINAL — never regenerate or overwrite it (re-entry from the tool, the
    # time-up fallback, or a report re-fetch all return the same saved report). A report saved
    # from the crash fallback is marked `_ok: false`, so we DON'T lock that in — the next call
    # gets one more chance to produce the real thing.
    if lesson_plan is not None and getattr(lesson_plan, "session_summary", None):
        try:
            cached = json.loads(lesson_plan.session_summary)
            if cached.get("_ok", True):  # legacy reports (no flag) are treated as final
                return cached
            logger.info("Prior report for appointment_id=%s was a fallback — regenerating once",
                        appointment.id)
        except Exception:
            pass  # malformed JSON only → allow a single regeneration below

    subject = appointment.subject
    key_stage = appointment.key_stage
    duration = appointment.duration_minutes
    if student_name is None:
        student_name = "Student"

    goal = lesson_plan.goal if lesson_plan else "teach_from_scratch"
    unit = (lesson_plan.unit_name if lesson_plan else "") or appointment.subject
    subtopic = lesson_plan.subtopic if lesson_plan else ""

    # --- Quiz stats: only COMPLETED assessments linked to THIS appointment ---
    # Filter to finished quizzes so an abandoned/in-progress quiz (0 correct so far) can't
    # dilute the real score — e.g. a completed 90% quiz was showing as 60% because an
    # unfinished quiz's questions were being counted as all-wrong.
    scored = [a for a in assessments if getattr(a, "status", None) == "completed"]
    if not scored:  # nothing completed → fall back to whatever assessments we have
        scored = list(assessments)
    total_questions = sum(getattr(a, "total_questions", 0) for a in scored)
    total_correct = sum(getattr(a, "correct_answers", 0) for a in scored)
    quiz_taken = total_questions > 0
    quiz_score: Optional[float] = (total_correct / total_questions * 100) if quiz_taken else None

    quiz_weak: List[str] = []
    quiz_strong: List[str] = []
    if quiz_taken:
        for a in scored:
            weak = a.weak_topics if hasattr(a, "weak_topics") and a.weak_topics else {}
            strong = a.strong_topics if hasattr(a, "strong_topics") and a.strong_topics else {}
            if isinstance(weak, dict):
                quiz_weak.extend(weak.keys())
            elif isinstance(weak, list):
                quiz_weak.extend(weak)
            if isinstance(strong, dict):
                quiz_strong.extend(strong.keys())
            elif isinstance(strong, list):
                quiz_strong.extend(strong)
        quiz_weak = list(dict.fromkeys(quiz_weak))
        quiz_strong = list(dict.fromkeys(quiz_strong))

    # --- Build conversation digest from actual messages ---
    msg_lines: List[str] = []
    if messages:
        for m in messages[:80]:
            if not m.content or m.content.strip() in ("__LESSON_START__", ""):
                continue
            role_label = "Student" if m.role == "user" else "AI Tutor"
            content = m.content[:600] + "..." if len(m.content) > 600 else m.content
            msg_lines.append(f"[{role_label}]: {content}")
    conversation_text = "\n".join(msg_lines) if msg_lines else "(no messages recorded)"

    student_msg_count = sum(1 for m in (messages or []) if m.role == "user" and m.content.strip() not in ("__LESSON_START__", ""))
    ai_msg_count = sum(1 for m in (messages or []) if m.role == "assistant")

    # --- Build planned phase structure from plan_blocks ---
    phase_plan_text = ""
    phases_schema: List[dict] = []
    if lesson_plan and lesson_plan.plan_blocks:
        steps = lesson_plan.plan_blocks.get("steps", [])
        phase_lines = []
        for step in steps:
            phase_lines.append(
                f"  Phase {step['order']}: \"{step['title']}\" "
                f"({step.get('duration_minutes', '?')} min, type={step['type']})"
            )
            phases_schema.append({
                "phase_title": step["title"],
                "phase_type": step["type"],
                "planned_minutes": step.get("duration_minutes"),
                "what_was_covered": "",
                "student_engagement": "",
                "status": "completed",
            })
        phase_plan_text = "Planned lesson phases:\n" + "\n".join(phase_lines)
    else:
        phase_plan_text = "No structured lesson plan (open session)."

    # --- Quiz section for prompt ---
    if quiz_taken:
        quiz_section = f"Quiz taken: YES — {total_correct}/{total_questions} correct ({quiz_score:.0f}%)\nWeak quiz topics: {', '.join(quiz_weak) or 'none'}\nStrong quiz topics: {', '.join(quiz_strong) or 'none'}"
    else:
        quiz_section = "Quiz taken: NO — do NOT invent a quiz score."

    phases_json_template = json.dumps(phases_schema, indent=2) if phases_schema else '[{"phase_title": "Session", "phase_type": "teach", "planned_minutes": null, "what_was_covered": "...", "student_engagement": "...", "status": "completed"}]'

    prompt = f"""You are writing a post-session report for a UK GCSE student. Analyse the actual conversation below and produce an accurate, honest report.

SESSION CONTEXT
Student: {student_name}
Subject: {subject} ({key_stage})
Topic: {unit}{(' — ' + subtopic) if subtopic else ''}
Goal: {goal}
Planned duration: {duration} minutes
Student messages: {student_msg_count}
AI tutor messages: {ai_msg_count}
{phase_plan_text}
{quiz_section}

ACTUAL CONVERSATION
{conversation_text}

INSTRUCTIONS
1. Analyse the conversation above to determine what was actually covered in each phase.
2. summary: 2-3 sentences describing what happened — be specific to THIS session, no generic filler.
3. phases: fill in each planned phase. "what_was_covered" = specific concepts discussed. "student_engagement" = how the student responded (e.g. "answered correctly", "asked clarifying questions", "gave no response"). "status" = "completed" | "partial" | "not_started".
4. topics_covered: list only topics explicitly discussed in the conversation.
5. quiz_score_percent: ONLY set this if a quiz was actually taken (see above). Otherwise use null.
6. weak_areas / strong_areas: ONLY from quiz results above. If no quiz, use empty arrays.
7. understanding_level: infer from how the student responded in conversation — "Excellent" | "Good" | "Developing" | "Needs Support".
8. next_session_recommendation: based on what was NOT covered or where the student struggled.

Output raw JSON only (no markdown fences):
{{
  "summary": "...",
  "phases": {phases_json_template},
  "topics_covered": [],
  "student_messages_count": {student_msg_count},
  "ai_messages_count": {ai_msg_count},
  "quiz_score_percent": {json.dumps(quiz_score)},
  "weak_areas": {json.dumps(quiz_weak)},
  "strong_areas": {json.dumps(quiz_strong)},
  "understanding_level": "...",
  "next_session_recommendation": "...",
  "time_spent_minutes": {duration},
  "encouragement": "A short warm motivational message for the student"
}}"""

    try:
        import asyncio
        lc_messages = [
            SystemMessage(content="You are a tutor writing a student session report. Output only valid JSON. Do not invent quiz scores."),
            HumanMessage(content=prompt),
        ]
        response = await asyncio.to_thread(get_llm().invoke, lc_messages)
        # Gemini 2.5 (thinking) can return `.content` as a LIST of parts → `.strip()` on a
        # list crashes and drops us into the generic fallback report. Flatten it first.
        from app.services.gemini_service import response_text as _resp_text
        raw = _resp_text(response)
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        report = json.loads(raw)
        # Safety: ensure quiz_score_percent stays null if no quiz was taken
        if not quiz_taken:
            report["quiz_score_percent"] = None
            report["weak_areas"] = []
            report["strong_areas"] = []
        report["_ok"] = True  # authentic AI report → immutability guard will lock it in
    except Exception as exc:
        logger.error(f"Failed to generate session report via Gemini: {exc}")
        topic_label = unit or subject
        report = {
            "_ok": False,  # crash fallback → NOT final; a later call may regenerate
            "summary": f"{student_name} completed a {subject} session on {topic_label}. {student_msg_count} exchanges with the AI tutor.",
            "phases": phases_schema,
            "topics_covered": [topic_label] if topic_label else [subject],
            "student_messages_count": student_msg_count,
            "ai_messages_count": ai_msg_count,
            "quiz_score_percent": round(quiz_score, 1) if quiz_taken else None,
            "weak_areas": quiz_weak,
            "strong_areas": quiz_strong,
            "understanding_level": "Good",
            "next_session_recommendation": f"Continue practising {subject} in the next session.",
            "time_spent_minutes": duration,
            "encouragement": "Well done for completing your session!",
        }

    # Save to lesson_plan.session_summary as JSON string.
    # If no lesson plan exists for this appointment, create a stub so the report is persisted.
    report_json = json.dumps(report)
    if lesson_plan is None:
        lesson_plan = LessonPlan(
            appointment_id=appointment.id,
            student_id=appointment.student_id,
            created_by=appointment.teacher_id or appointment.student_id,
            subject=appointment.subject,
            key_stage=appointment.key_stage or "KS4",
            exam_board="None",
            tier="None",
            unit_name=appointment.title or appointment.subject,
            ability_level="intermediate",
            goal="session",
            status="completed",
            session_summary=report_json,
        )
        db.add(lesson_plan)
        await db.flush()
        logger.info(f"Created stub LessonPlan for appointment_id={appointment.id}")
    else:
        lesson_plan.session_summary = report_json
        lesson_plan.updated_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(lesson_plan)
        logger.info(f"Saved session report to lesson_plan_id={lesson_plan.id}")

    return report


async def ensure_report_for_appointment(
    db: AsyncSession,
    appointment_id: int,
) -> Optional[Dict[str, Any]]:
    """Guarantee an authentic session report exists for this appointment, generating it
    from the REAL session (conversation messages + this session's quiz assessments) if the
    AI never called the report tool. Idempotent + immutable: if a report is already saved,
    it's returned unchanged. Used by the time-up fallback so the student ALWAYS gets a real
    report (never a missing/placeholder one) the moment the lesson ends."""
    from app.models.appointment import Appointment
    from app.models.assessment import Assessment
    from app.models.chat import Chat, Message
    from app.models.user import User

    appt = (await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )).scalar_one_or_none()
    if not appt:
        return None

    lesson_plan = (await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )).scalar_one_or_none()

    # Already have an authentic report → return it (immutable, no regeneration).
    if lesson_plan is not None and getattr(lesson_plan, "session_summary", None):
        try:
            return json.loads(lesson_plan.session_summary)
        except Exception:
            pass

    chat = (await db.execute(
        select(Chat).where(Chat.appointment_id == appointment_id)
    )).scalar_one_or_none()
    messages: List[Any] = []
    if chat:
        messages = list((await db.execute(
            select(Message).where(Message.chat_id == chat.id)
            .order_by(Message.timestamp).limit(100)
        )).scalars().all())

    assessments = list((await db.execute(
        select(Assessment).where(Assessment.appointment_id == appointment_id)
        .order_by(Assessment.created_at.desc()).limit(20)
    )).scalars().all())

    student = (await db.execute(
        select(User).where(User.id == appt.student_id)
    )).scalar_one_or_none()

    return await generate_session_report(
        db=db, appointment=appt, lesson_plan=lesson_plan, assessments=assessments,
        student_name=student.name if student else "Student", messages=messages,
    )


async def get_appointment_report(
    db: AsyncSession,
    appointment_id: int,
) -> Optional[Dict[str, Any]]:
    """
    Retrieve the session report for a given appointment.
    Returns parsed JSON dict from lesson_plan.session_summary, or None.
    """
    result = await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )
    plan = result.scalar_one_or_none()
    if plan is None or not plan.session_summary:
        return None

    try:
        return json.loads(plan.session_summary)
    except (json.JSONDecodeError, TypeError):
        # If stored as plain text (legacy), return wrapped
        return {"summary": plan.session_summary}


# ===========================================================================
# Structured lesson-plan blocks  (merged from lesson_structure_service)
# Auto-generates time-boxed plan_blocks at booking time for the session AI.
# ===========================================================================

_STEPS_BY_MODE_GOAL: Dict[str, Dict[str, List[str]]] = {
    "ai_recommended": {
        "homework":      ["Quick Recap", "Review Homework Problem", "Work Through Together", "Practice Similar Question", "Review & Next Steps"],
        "learn_scratch": ["Quick Recap", "Core Concept Introduction", "Worked Examples", "Guided Practice", "Review & Next Steps"],
        "catch_up":      ["Quick Recap", "Missed Content Overview", "Worked Examples", "Catch-Up Exercises", "Review & Next Steps"],
        "revision":      ["Quick Recap", "Key Concept Review", "Exam-Style Questions", "Mark Scheme Discussion", "Review & Next Steps"],
    },
    "slides": {
        "_any": ["Quick Recap", "Slide: Key Concepts", "Slide: Worked Examples", "Guided Questions", "Summary"],
    },
    "worksheet": {
        "_any": ["Introduction", "Guided Worksheet", "Check & Explain Answers", "Extension Question", "Summary"],
    },
    "quiz": {
        "_any": ["Warm Up", "Quiz Round 1", "Review Mistakes", "Quiz Round 2", "Final Score & Next Steps"],
    },
}

_STEP_META: Dict[str, tuple] = {
    "Quick Recap":           ("recap",    "Ask ONE prior-knowledge question. Accept any answer — if the student says 'I don't know', reply 'No problem, we'll cover that!' and move straight to the next teaching step. Do NOT try to teach during this step. Maximum 1-2 student exchanges, then MOVE ON."),
    "Warm Up":               ("recap",    "Ask ONE prior-knowledge question. Accept any answer — if the student says 'I don't know', reply 'No problem, we'll cover that!' and move straight to the next teaching step. Maximum 1-2 student exchanges, then MOVE ON."),
    "Introduction":          ("recap",    "In 1-2 sentences tell the student what they'll learn today. Ask what they already know about this topic, accept any answer, then move on to teaching."),
    "Core Concept Introduction": ("teach",   "TEACH ONLY — do NOT ask questions. Explain this concept clearly in 2-3 sentences with one real-world example. Then immediately move on to the next step."),
    "Missed Content Overview":   ("teach",   "TEACH ONLY — do NOT ask questions. Explain the missed concept clearly in 2-3 sentences with one real-world example. Then immediately move on to the next step."),
    "Key Concept Review":        ("teach",   "TEACH ONLY — do NOT ask questions. Explain this concept clearly in 2-3 sentences, reinforcing key points and correcting misconceptions. Then move on to the next step."),
    "Slide: Key Concepts":       ("teach",   "TEACH ONLY — do NOT ask questions. Present ONE key concept per response. Explain it in 2-3 sentences with an example. Then move on."),
    "Slide: Worked Examples":    ("teach",   "TEACH ONLY — do NOT ask questions. Work through ONE example step-by-step out loud ('I do — watch me'). Narrate each step clearly. Then move on to practice."),
    "Review Homework Problem":   ("teach",   "Ask which specific question the student is stuck on. Walk through the method step-by-step — narrate each step clearly without asking questions mid-explanation. Move to practice once explained."),
    "Work Through Together":     ("practice", "Pose ONE practice question. Say 'Have a go — what would you do first?' Wait for their attempt. Guide step-by-step only if stuck. Give specific one-sentence feedback, then move on."),
    "Worked Examples":           ("practice", "Show ONE worked example fully ('I do'). Then say 'Now you try a similar one' and give them a parallel problem ('We do'). Give specific feedback, then move on to the next step."),
    "Guided Practice":           ("practice", "Give 1-2 practice questions ('You do'). Ask the student to attempt independently. Guide only if stuck — don't give the answer. Give specific feedback after each attempt, then move to the next step."),
    "Catch-Up Exercises":        ("practice", "Give 1-2 catch-up questions directly on the missed topic. Ask the student to attempt each one. Provide clear, specific feedback. Move to review once complete."),
    "Practice Similar Question": ("practice", "Give ONE question similar to the homework problem. Ask the student to attempt it. Guide only if stuck. Give one-sentence feedback confirming or correcting, then wrap up."),
    "Guided Worksheet":          ("practice", "Give the first worksheet question. Ask the student to attempt it. If stuck, ask 'What information do you have?' to guide them. Give feedback, then move to the next question."),
    "Check & Explain Answers":   ("practice", "Go through each answer one at a time. For any mistakes, explain the correct method in 1-2 sentences — do not just give the answer. Move on once all reviewed."),
    "Extension Question":        ("practice", "Offer ONE challenging extension question. Say 'This one's harder — give it your best shot.' Give detailed feedback after their attempt, then wrap up."),
    "Guided Questions":          ("practice", "Give ONE guided question. Say 'Have a go — what do you think?' Wait for their attempt. Guide step-by-step only if stuck. Give specific feedback, then move on."),
    "Exam-Style Questions":      ("practice", "Give ONE exam-style question. Ask the student to attempt it fully before any help. Give specific exam-focused feedback on their answer, then move on."),
    "Mark Scheme Discussion":    ("practice", "Walk through the mark scheme for the attempted question. Highlight where marks are awarded and 1-2 common errors to avoid. Move on once discussed."),
    "Quiz Round 1":              ("quiz",     "Call the generate_quiz tool to offer an interactive quiz on the specific concepts taught this session. Before calling, say: 'We have covered a lot -- let me set you a quick test!'"),
    "Quiz Round 2":              ("quiz",     "Call the generate_quiz tool to offer a second interactive quiz focusing on any gaps identified in Round 1. Before calling, say: 'Let us go again -- this time focusing on what we need to sharpen up!'"),
    "Review Mistakes":           ("review",   "Go through any incorrect answers from the previous quiz. Clarify each misconception in 1-2 sentences. Move on once all reviewed."),
    "Final Score & Next Steps":  ("review",   "Summarise the 3 most important things learned. Give personalised encouragement. Suggest one thing to review independently. Then continue — offer harder practice or move to a new topic. Do NOT say goodbye or imply the session is ending."),
    "Review & Next Steps":       ("review",   "Give a brief mid-topic recap: 2-3 sentences summarising what was just covered. Highlight one thing the student did well. Then IMMEDIATELY continue — either move to the next topic in the TOPICS list, or deepen practice. Do NOT say goodbye, 'see you next time', or imply the session is ending. The student ends the session — you do not."),
    "Summary":                   ("review",   "Give a brief mid-topic recap: 2-3 sentences summarising what was just covered. Then IMMEDIATELY continue to the next topic or offer harder practice. Do NOT say goodbye or imply the session is over."),
}

_DEFAULT_AI_INSTRUCTION = "Guide the student through this step clearly and check understanding before moving on."
_DEFAULT_TYPE = "teach"


def _distribute_time(n_middle_steps: int, duration: int) -> List[int]:
    """First step = 5 min recap, last = 10 min review, rest split evenly."""
    if duration <= 20:
        each = max(5, (duration - 5) // max(1, n_middle_steps))
        return [5] + [each] * n_middle_steps
    reserved = 5 + 10
    middle = duration - reserved
    each = max(5, middle // max(1, n_middle_steps))
    return [5] + [each] * n_middle_steps + [10]


def generate_plan_blocks(
    learn_mode: str,
    goal: str,
    duration_minutes: int,
    topics: List[str],
    subject: str,
) -> dict:
    """Returns a plan_blocks dict containing a 'steps' list of structured lesson steps."""
    mode = learn_mode or "ai_recommended"
    goal = goal or "learn_scratch"
    topic_label = topics[0] if topics else subject

    mode_goals = _STEPS_BY_MODE_GOAL.get(mode)
    if mode_goals is None:
        mode_goals = _STEPS_BY_MODE_GOAL["ai_recommended"]

    if "_any" in mode_goals:
        raw_titles = mode_goals["_any"]
    else:
        raw_titles = mode_goals.get(goal, mode_goals.get("learn_scratch", [
            "Quick Recap", "Core Concept Introduction", "Guided Practice", "Review & Next Steps"
        ]))

    _substitutable = {"Core Concept Introduction", "Missed Content Overview", "Key Concept Review", "Worked Examples"}
    titles: List[str] = []
    for t in raw_titles:
        if t in _substitutable and topic_label:
            titles.append(f"{t}: {topic_label}")
        else:
            titles.append(t)

    n_steps = len(titles)
    if n_steps == 0:
        return {"steps": []}

    if n_steps == 1:
        durations = [duration_minutes]
    elif n_steps == 2:
        durations = [5, max(5, duration_minutes - 5)]
    else:
        n_middle = n_steps - 2
        durations = _distribute_time(n_middle, duration_minutes)
        while len(durations) < n_steps:
            durations.append(5)
        durations = durations[:n_steps]

    steps = []
    for i, (title, dur) in enumerate(zip(titles, durations), start=1):
        base_title = title.split(":")[0].strip() if ":" in title else title
        meta = _STEP_META.get(base_title) or _STEP_META.get(title)
        step_type = meta[0] if meta else _DEFAULT_TYPE
        ai_instruction = meta[1] if meta else _DEFAULT_AI_INSTRUCTION
        steps.append({
            "order": i, "title": title, "duration_minutes": dur,
            "type": step_type, "ai_instruction": ai_instruction,
        })

    return {"steps": steps, "learn_mode": mode, "goal": goal, "total_duration_minutes": duration_minutes}


async def auto_create_lesson_plan(db: AsyncSession, appointment, student_id: int,
                                  subtopic: Optional[str] = None) -> None:
    """Automatically create (or update) a LessonPlan with structured plan_blocks
    for a student self-booked AI session. Called non-fatally from /book.

    `subtopic` is the Resource-Hub subtopic the student picked (or None to start from the top of
    the topic). It's stored on LessonPlan.subtopic so the session prompt, the RAG scope and the
    manipulative topic-matcher can all focus on it. Falls back to a "Subtopic:" line in the
    appointment description so an older client that only embeds it there still works."""
    desc = appointment.description or ""
    type_match = re.search(r"Session type:\s*([^\n]+)", desc, re.IGNORECASE)
    session_type = type_match.group(1).strip() if type_match else "General Tutoring"

    goal_map = {
        "Homework Help": "homework", "Learn from Scratch": "learn_scratch",
        "Catch Up": "catch_up", "Revision": "revision",
    }
    goal = goal_map.get(session_type, "learn_scratch")

    topics_match = re.search(r"Topics?:\s*([^\n]+)", desc, re.IGNORECASE)
    topics = [t.strip() for t in topics_match.group(1).split(",") if t.strip()] if topics_match else []
    unit_name = topics[0] if topics else None

    # Prefer the explicit param; fall back to a "Subtopic:" line in the description.
    if not subtopic:
        sub_match = re.search(r"Subtopic:\s*([^\n]+)", desc, re.IGNORECASE)
        subtopic = sub_match.group(1).strip() if sub_match else None
    subtopic = (subtopic or "").strip() or None

    learn_mode = getattr(appointment, "learn_mode", "ai_recommended") or "ai_recommended"

    plan_blocks = generate_plan_blocks(
        learn_mode=learn_mode, goal=goal,
        duration_minutes=appointment.duration_minutes or 60,
        topics=topics, subject=appointment.subject,
    )

    result = await db.execute(select(LessonPlan).where(LessonPlan.appointment_id == appointment.id))
    existing = result.scalar_one_or_none()

    if existing:
        existing.plan_blocks = plan_blocks
        existing.unit_name = unit_name
        existing.subtopic = subtopic
        logger.info(f"Updated existing LessonPlan for appointment_id={appointment.id}")
    else:
        lp = LessonPlan(
            appointment_id=appointment.id, student_id=student_id, created_by=student_id,
            subject=appointment.subject, key_stage=appointment.key_stage,
            unit_name=unit_name, subtopic=subtopic,
            goal=goal, plan_blocks=plan_blocks, status="planned",
        )
        db.add(lp)
        logger.info(
            f"Created LessonPlan for appointment_id={appointment.id}, "
            f"learn_mode={learn_mode}, goal={goal}, unit={unit_name!r}, subtopic={subtopic!r}, "
            f"steps={len(plan_blocks.get('steps', []))}"
        )

    await db.flush()
