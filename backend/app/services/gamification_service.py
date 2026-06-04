"""
Gamification service: XP, levels, streaks, topic mastery, daily plan, dashboard.
"""
import logging
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student_profile import StudentProfile, TopicMastery
from app.models.lesson_plan import LessonPlan

logger = logging.getLogger(__name__)

# XP thresholds for each level (index = level - 1).
# Level 1 starts at 0 XP, Level 10 starts at 22 000 XP.
XP_LEVELS: List[int] = [0, 200, 500, 1000, 2000, 4000, 7000, 11000, 16000, 22000]


def _calculate_level(xp: int) -> int:
    """Return the level that corresponds to the given total XP amount."""
    level = 1
    for threshold in XP_LEVELS:
        if xp >= threshold:
            level = XP_LEVELS.index(threshold) + 1
        else:
            break
    return level


def _xp_to_next_level(xp: int, current_level: int) -> int:
    """Return the XP needed to reach the next level, or 0 if at max level."""
    next_level_index = current_level  # current_level is 1-based; next threshold is at index current_level
    if next_level_index >= len(XP_LEVELS):
        return 0
    return XP_LEVELS[next_level_index] - xp


# ---------------------------------------------------------------------------
# Profile helpers
# ---------------------------------------------------------------------------

async def get_or_create_profile(db: AsyncSession, student_id: int) -> StudentProfile:
    """Fetch the StudentProfile for *student_id*, creating one if it does not exist."""
    result = await db.execute(
        select(StudentProfile).where(StudentProfile.student_id == student_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = StudentProfile(
            student_id=student_id,
            xp_total=0,
            xp_level=1,
            current_streak=0,
            longest_streak=0,
            last_active_date=None,
            interests=[],
            preferred_subjects=[],
        )
        db.add(profile)
        await db.flush()
        await db.refresh(profile)
        logger.info(f"Created StudentProfile for student_id={student_id}")
    return profile


async def award_xp(db: AsyncSession, student_id: int, amount: int, reason: str = "") -> StudentProfile:
    """Add *amount* XP to the student's profile and recalculate their level."""
    profile = await get_or_create_profile(db, student_id)
    profile.xp_total = (profile.xp_total or 0) + amount
    profile.xp_level = _calculate_level(profile.xp_total)
    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    logger.info(
        f"Awarded {amount} XP to student_id={student_id} (reason={reason!r}). "
        f"New total={profile.xp_total}, level={profile.xp_level}"
    )
    return profile


async def check_and_update_streak(db: AsyncSession, student_id: int) -> StudentProfile:
    """
    Compare last_active_date to today UTC and update the streak accordingly.

    - Same day → no change (already counted today).
    - Yesterday → increment streak.
    - Older (or None) → reset streak to 1.

    Also updates longest_streak when the current streak surpasses it.
    """
    profile = await get_or_create_profile(db, student_id)
    today = datetime.now(timezone.utc).date()

    if profile.last_active_date is None:
        profile.current_streak = 1
        profile.longest_streak = max(profile.longest_streak or 0, 1)
    elif profile.last_active_date == today:
        # Already recorded today – nothing to do
        return profile
    elif profile.last_active_date == today - timedelta(days=1):
        profile.current_streak = (profile.current_streak or 0) + 1
        if profile.current_streak > (profile.longest_streak or 0):
            profile.longest_streak = profile.current_streak
    else:
        # Streak broken
        profile.current_streak = 1

    profile.last_active_date = today
    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    return profile


# ---------------------------------------------------------------------------
# Topic mastery
# ---------------------------------------------------------------------------

def _compute_mastery_level(average_score: float) -> str:
    """Derive a mastery label from the student's average score on a topic."""
    if average_score < 40:
        return "learning"
    if average_score < 70:
        return "practicing"
    return "mastered"


async def update_topic_mastery(
    db: AsyncSession,
    student_id: int,
    subject: str,
    key_stage: str,
    topic: str,
    score: float,
) -> TopicMastery:
    """
    Update (or create) a TopicMastery record for the given student/subject/topic.
    Appends the new score to score_history and recalculates mastery_level from
    the average of all recorded scores.
    """
    result = await db.execute(
        select(TopicMastery).where(
            TopicMastery.student_id == student_id,
            TopicMastery.subject == subject,
            TopicMastery.topic == topic,
        )
    )
    mastery = result.scalar_one_or_none()

    score_entry = {"score": score, "date": datetime.now(timezone.utc).isoformat()}

    if mastery is None:
        mastery = TopicMastery(
            student_id=student_id,
            subject=subject,
            key_stage=key_stage,
            topic=topic,
            mastery_level="not_started",
            score_history=[score_entry],
            attempts=1,
            last_practiced_at=datetime.now(timezone.utc),
        )
        db.add(mastery)
    else:
        history: List[Dict[str, Any]] = list(mastery.score_history or [])
        history.append(score_entry)
        mastery.score_history = history
        mastery.attempts = (mastery.attempts or 0) + 1
        mastery.last_practiced_at = datetime.now(timezone.utc)

    # Recalculate mastery level from average score
    all_scores = [entry["score"] for entry in (mastery.score_history or []) if "score" in entry]
    avg = sum(all_scores) / len(all_scores) if all_scores else 0.0
    mastery.mastery_level = _compute_mastery_level(avg)

    await db.flush()
    await db.refresh(mastery)
    return mastery


async def get_mastery_overview(db: AsyncSession, student_id: int) -> List[TopicMastery]:
    """Return all TopicMastery records for a student."""
    result = await db.execute(
        select(TopicMastery).where(TopicMastery.student_id == student_id)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Daily plan
# ---------------------------------------------------------------------------

async def generate_daily_plan(db: AsyncSession, student_id: int) -> Dict[str, Any]:
    """
    Build a daily learning plan for the student.

    - weak_spots: mastery_level is 'learning' or 'practicing' with avg score < 70, limited to 3.
    - spaced_review: topics not practiced in the last 5 days, limited to 3.
    - confidence_boost: mastered topics to reinforce confidence, limited to 2.
    - upcoming_sessions: planned lesson plans for the student, limited to 3.
    """
    all_mastery = await get_mastery_overview(db, student_id)
    now_utc = datetime.now(timezone.utc)
    five_days_ago = now_utc - timedelta(days=5)

    weak_spots: List[Dict[str, Any]] = []
    spaced_review: List[Dict[str, Any]] = []
    confidence_boost: List[Dict[str, Any]] = []

    for m in all_mastery:
        entry: Dict[str, Any] = {
            "id": m.id,
            "subject": m.subject,
            "key_stage": m.key_stage,
            "topic": m.topic,
            "mastery_level": m.mastery_level,
            "attempts": m.attempts,
        }

        # Weak spots: still in learning or practicing
        if m.mastery_level in ("learning", "practicing", "not_started") and len(weak_spots) < 3:
            weak_spots.append(entry)

        # Spaced review: mastered or practicing but not touched recently
        if m.last_practiced_at is not None:
            last_practiced = m.last_practiced_at
            if last_practiced.tzinfo is None:
                last_practiced = last_practiced.replace(tzinfo=timezone.utc)
            if last_practiced < five_days_ago and len(spaced_review) < 3:
                spaced_review.append(entry)

        # Confidence boost: mastered topics
        if m.mastery_level == "mastered" and len(confidence_boost) < 2:
            confidence_boost.append(entry)

    # Upcoming sessions
    sessions_result = await db.execute(
        select(LessonPlan)
        .where(
            LessonPlan.student_id == student_id,
            LessonPlan.status == "planned",
        )
        .order_by(LessonPlan.created_at.asc())
        .limit(3)
    )
    upcoming_lesson_plans = sessions_result.scalars().all()
    upcoming_sessions: List[Dict[str, Any]] = [
        {
            "id": lp.id,
            "subject": lp.subject,
            "key_stage": lp.key_stage,
            "unit_name": lp.unit_name,
            "subtopic": lp.subtopic,
            "goal": lp.goal,
            "status": lp.status,
        }
        for lp in upcoming_lesson_plans
    ]

    return {
        "weak_spots": weak_spots,
        "spaced_review": spaced_review,
        "confidence_boost": confidence_boost,
        "upcoming_sessions": upcoming_sessions,
    }


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

async def get_dashboard_data(db: AsyncSession, student_id: int) -> Dict[str, Any]:
    """
    Assemble the full gamified dashboard payload for a student.

    Returns a dict with:
      - profile: StudentProfile ORM instance
      - mastery_overview: list of TopicMastery ORM instances
      - daily_plan: dict from generate_daily_plan()
      - continue_learning: the last incomplete lesson plan or the weakest topic
      - xp_to_next_level: XP remaining to reach the next level
    """
    profile = await get_or_create_profile(db, student_id)
    mastery_list = await get_mastery_overview(db, student_id)
    daily_plan = await generate_daily_plan(db, student_id)

    # continue_learning: find last in_progress lesson plan, else last planned, else weakest topic
    continue_learning: Optional[Dict[str, Any]] = None

    in_progress_result = await db.execute(
        select(LessonPlan)
        .where(
            LessonPlan.student_id == student_id,
            LessonPlan.status == "in_progress",
        )
        .order_by(LessonPlan.updated_at.desc())
        .limit(1)
    )
    in_progress_plan = in_progress_result.scalar_one_or_none()

    if in_progress_plan:
        continue_learning = {
            "type": "lesson_plan",
            "id": in_progress_plan.id,
            "subject": in_progress_plan.subject,
            "key_stage": in_progress_plan.key_stage,
            "unit_name": in_progress_plan.unit_name,
            "subtopic": in_progress_plan.subtopic,
            "status": in_progress_plan.status,
        }
    else:
        # Fall back to the weakest topic (lowest average score)
        weakest: Optional[TopicMastery] = None
        lowest_avg = float("inf")
        for m in mastery_list:
            if m.mastery_level in ("learning", "not_started"):
                scores = [e["score"] for e in (m.score_history or []) if "score" in e]
                avg = sum(scores) / len(scores) if scores else 0.0
                if avg < lowest_avg:
                    lowest_avg = avg
                    weakest = m
        if weakest:
            continue_learning = {
                "type": "topic",
                "subject": weakest.subject,
                "key_stage": weakest.key_stage,
                "topic": weakest.topic,
                "mastery_level": weakest.mastery_level,
            }

    xp_remaining = _xp_to_next_level(profile.xp_total, profile.xp_level)

    return {
        "profile": profile,
        "mastery_overview": mastery_list,
        "daily_plan": daily_plan,
        "continue_learning": continue_learning,
        "xp_to_next_level": xp_remaining,
    }


async def get_next_topic_recommendations(
    db: AsyncSession,
    student_id: int,
    subject: Optional[str] = None,
    key_stage: Optional[str] = None,
) -> Dict[str, Any]:
    """Use RAG to suggest topics the student should study next."""
    mastery_list = await get_mastery_overview(db, student_id)

    relevant = [m for m in mastery_list if not subject or m.subject == subject]
    mastered = [m for m in relevant if m.mastery_level in ("mastered", "practicing")]
    studied_topics = {m.topic.lower() for m in relevant}

    if not mastered:
        return {"recommendations": []}

    query = "Next topics to learn after mastering: " + ", ".join(m.topic for m in mastered[:6])

    from app.services.rag_service import retrieve_relevant_chunks
    chunks = await retrieve_relevant_chunks(
        db, query, subject=subject, key_stage=key_stage, top_k=15
    )

    seen: set[str] = set()
    recommendations: List[Dict[str, Any]] = []
    for chunk in chunks:
        title = chunk.document_title
        key = title.lower()
        if key not in seen and key not in studied_topics:
            seen.add(key)
            preview = chunk.content.strip()
            recommendations.append({
                "topic": title,
                "subject": chunk.subject,
                "key_stage": chunk.key_stage,
                "preview": preview[:120] + "…" if len(preview) > 120 else preview,
            })
        if len(recommendations) >= 4:
            break

    return {"recommendations": recommendations}
