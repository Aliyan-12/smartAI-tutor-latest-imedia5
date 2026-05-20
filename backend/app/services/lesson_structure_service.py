"""
Lesson Structure Service — auto-generates structured lesson plan blocks for AI sessions.

Called at appointment booking time (for student self-bookings) to populate
LessonPlan.plan_blocks with time-boxed steps that the session AI will follow.
"""
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Step definitions per learn_mode + goal
# ---------------------------------------------------------------------------

_STEPS_BY_MODE_GOAL: dict[str, dict[str, list[str]]] = {
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

# Map step titles to semantic type + ai_instruction
_STEP_META: dict[str, tuple[str, str]] = {
    # recap / activation
    "Quick Recap":           ("recap",    "Ask ONE prior-knowledge question. Accept any answer — if the student says 'I don't know', reply 'No problem, we'll cover that!' and move straight to the next teaching step. Do NOT try to teach during this step. Maximum 1-2 student exchanges, then MOVE ON."),
    "Warm Up":               ("recap",    "Ask ONE prior-knowledge question. Accept any answer — if the student says 'I don't know', reply 'No problem, we'll cover that!' and move straight to the next teaching step. Maximum 1-2 student exchanges, then MOVE ON."),
    "Introduction":          ("recap",    "In 1-2 sentences tell the student what they'll learn today. Ask what they already know about this topic, accept any answer, then move on to teaching."),
    # teach / slides
    "Core Concept Introduction": ("teach",   "Explain this concept clearly in 2-3 sentences with one real-world example. Ask ONE short check question, accept any answer, give one-sentence feedback, then move on to the next step."),
    "Missed Content Overview":   ("teach",   "Explain the missed concept clearly in 2-3 sentences with one real-world example. Ask ONE short check question, give one-sentence feedback, then move on."),
    "Key Concept Review":        ("teach",   "Explain this concept clearly in 2-3 sentences — reinforce key points and correct any misconceptions. Ask ONE exam-style question, give one-sentence feedback, then move on."),
    "Slide: Key Concepts":       ("teach",   "Present ONE key concept per response. Explain it in 2-3 sentences with an example. Ask ONE short check question, then move on to the next concept or step."),
    "Slide: Worked Examples":    ("teach",   "Work through ONE example step-by-step out loud ('I do — watch me'). Then ask the student to state the next step before you show it. Move on once they've engaged."),
    "Review Homework Problem":   ("teach",   "Ask which specific question the student is stuck on. Walk through the method step-by-step — ask 'What do you think the first step is?' before giving it. Move to practice once explained."),
    # practice / worksheet
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
    # quiz
    "Quiz Round 1":              ("quiz",     "Offer an interactive quiz on this topic using the [QUIZ_OFFER] marker."),
    "Quiz Round 2":              ("quiz",     "Offer a second interactive quiz focusing on any gaps identified in Round 1 using the [QUIZ_OFFER] marker."),
    "Review Mistakes":           ("review",   "Go through any incorrect answers from the previous quiz. Clarify each misconception in 1-2 sentences. Move on once all reviewed."),
    "Final Score & Next Steps":  ("review",   "Summarise the 3 most important things learned today. Give personalised encouragement and ONE clear next-steps recommendation."),
    # review / summary
    "Review & Next Steps":       ("review",   "Summarise the 3 most important things learned today. Highlight one thing the student did well. Give ONE clear next-steps recommendation. Then close warmly."),
    "Summary":                   ("review",   "Summarise the 3 most important things learned today. Give ONE clear next-steps recommendation. Close warmly."),
}

_DEFAULT_AI_INSTRUCTION = "Guide the student through this step clearly and check understanding before moving on."
_DEFAULT_TYPE = "teach"


def _distribute_time(n_middle_steps: int, duration: int) -> list[int]:
    """First step = 5 min recap, last = 10 min review, rest split evenly."""
    if duration <= 20:
        # For short sessions skip the 10-min tail reservation
        each = max(5, (duration - 5) // max(1, n_middle_steps))
        return [5] + [each] * n_middle_steps
    reserved = 5 + 10  # first + last
    middle = duration - reserved
    each = max(5, middle // max(1, n_middle_steps))
    return [5] + [each] * n_middle_steps + [10]


def generate_plan_blocks(
    learn_mode: str,
    goal: str,
    duration_minutes: int,
    topics: list[str],
    subject: str,
) -> dict:
    """
    Returns a plan_blocks dict containing a 'steps' list of structured lesson steps.

    Each step: {"order": N, "title": "...", "duration_minutes": M,
                 "type": "recap|teach|practice|quiz|review", "ai_instruction": "..."}
    """
    mode = learn_mode or "ai_recommended"
    goal = goal or "learn_scratch"
    topic_label = topics[0] if topics else subject

    # Resolve step titles
    mode_goals = _STEPS_BY_MODE_GOAL.get(mode)
    if mode_goals is None:
        # Fallback to ai_recommended
        mode_goals = _STEPS_BY_MODE_GOAL["ai_recommended"]

    if "_any" in mode_goals:
        raw_titles = mode_goals["_any"]
    else:
        raw_titles = mode_goals.get(goal, mode_goals.get("learn_scratch", [
            "Quick Recap", "Core Concept Introduction", "Guided Practice", "Review & Next Steps"
        ]))

    # Substitute topic label into step titles where generic labels are used
    _substitutable = {
        "Core Concept Introduction",
        "Missed Content Overview",
        "Key Concept Review",
        "Worked Examples",
    }
    titles: list[str] = []
    for t in raw_titles:
        if t in _substitutable and topic_label:
            titles.append(f"{t}: {topic_label}")
        else:
            titles.append(t)

    n_steps = len(titles)
    if n_steps == 0:
        return {"steps": []}

    # Distribute time across steps
    # First step is always index 0 (recap), last step is always index -1 (review)
    # Middle steps are everything in between
    if n_steps == 1:
        durations = [duration_minutes]
    elif n_steps == 2:
        durations = [5, max(5, duration_minutes - 5)]
    else:
        n_middle = n_steps - 2
        durations = _distribute_time(n_middle, duration_minutes)
        # If distribute_time returns fewer entries than n_steps, pad
        while len(durations) < n_steps:
            durations.append(5)
        durations = durations[:n_steps]

    steps = []
    for i, (title, dur) in enumerate(zip(titles, durations), start=1):
        # Look up meta using the original (non-substituted) base title
        base_title = title.split(":")[0].strip() if ":" in title else title
        meta = _STEP_META.get(base_title) or _STEP_META.get(title)
        step_type = meta[0] if meta else _DEFAULT_TYPE
        ai_instruction = meta[1] if meta else _DEFAULT_AI_INSTRUCTION

        steps.append({
            "order": i,
            "title": title,
            "duration_minutes": dur,
            "type": step_type,
            "ai_instruction": ai_instruction,
        })

    return {
        "steps": steps,
        "learn_mode": mode,
        "goal": goal,
        "total_duration_minutes": duration_minutes,
    }


async def auto_create_lesson_plan(
    db: AsyncSession,
    appointment,
    student_id: int,
) -> None:
    """
    Automatically create (or update) a LessonPlan with structured plan_blocks
    for a student self-booked AI session.

    Called non-fatally from the /book endpoint after appointment confirmation.
    """
    from app.models.lesson_plan import LessonPlan

    # Parse goal from appointment description
    desc = appointment.description or ""
    type_match = re.search(r"Session type:\s*([^\n]+)", desc, re.IGNORECASE)
    session_type = type_match.group(1).strip() if type_match else "General Tutoring"

    goal_map = {
        "Homework Help": "homework",
        "Learn from Scratch": "learn_scratch",
        "Catch Up": "catch_up",
        "Revision": "revision",
    }
    goal = goal_map.get(session_type, "learn_scratch")

    topics_match = re.search(r"Topics?:\s*([^\n]+)", desc, re.IGNORECASE)
    topics = (
        [t.strip() for t in topics_match.group(1).split(",") if t.strip()]
        if topics_match else []
    )

    learn_mode = getattr(appointment, "learn_mode", "ai_recommended") or "ai_recommended"

    plan_blocks = generate_plan_blocks(
        learn_mode=learn_mode,
        goal=goal,
        duration_minutes=appointment.duration_minutes or 60,
        topics=topics,
        subject=appointment.subject,
    )

    # Check if a LessonPlan already exists for this appointment
    result = await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment.id)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.plan_blocks = plan_blocks
        logger.info(f"Updated existing LessonPlan for appointment_id={appointment.id}")
    else:
        lp = LessonPlan(
            appointment_id=appointment.id,
            student_id=student_id,
            created_by=student_id,
            subject=appointment.subject,
            key_stage=appointment.key_stage,
            goal=goal,
            plan_blocks=plan_blocks,
            status="planned",
        )
        db.add(lp)
        logger.info(
            f"Created LessonPlan for appointment_id={appointment.id}, "
            f"learn_mode={learn_mode}, goal={goal}, steps={len(plan_blocks.get('steps', []))}"
        )

    await db.flush()
