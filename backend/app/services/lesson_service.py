"""
Lesson plan service: topic discovery, CRUD for lesson plans, AI context builder,
pre-lesson intelligence, session checkpoints, and post-session report generation.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
    from app.services.gemini_service import _get_client
    from app.core.config import settings
    from google.genai import types as genai_types

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
        client = _get_client()
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction="You are a lesson plan generator. Output only valid JSON.",
            ),
        )
        raw = response.text.strip()
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
    from app.services.gemini_service import _get_client
    from app.core.config import settings
    from google.genai import types as genai_types

    subject = appointment.subject
    key_stage = appointment.key_stage
    duration = appointment.duration_minutes
    if student_name is None:
        student_name = "Student"

    goal = lesson_plan.goal if lesson_plan else "teach_from_scratch"
    unit = (lesson_plan.unit_name if lesson_plan else "") or appointment.subject
    subtopic = lesson_plan.subtopic if lesson_plan else ""

    # --- Quiz stats: only from assessments linked to THIS appointment ---
    total_questions = sum(getattr(a, "total_questions", 0) for a in assessments)
    total_correct = sum(getattr(a, "correct_answers", 0) for a in assessments)
    quiz_taken = total_questions > 0
    quiz_score: Optional[float] = (total_correct / total_questions * 100) if quiz_taken else None

    quiz_weak: List[str] = []
    quiz_strong: List[str] = []
    if quiz_taken:
        for a in assessments:
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
        client = _get_client()
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                system_instruction="You are a tutor writing a student session report. Output only valid JSON. Do not invent quiz scores.",
            ),
        )
        raw = response.text.strip()
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
    except Exception as exc:
        logger.error(f"Failed to generate session report via Gemini: {exc}")
        topic_label = unit or subject
        report = {
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
