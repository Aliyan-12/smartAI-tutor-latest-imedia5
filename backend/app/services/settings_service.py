"""
Settings service: student learning preferences and profile update operations.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student_profile import StudentProfile
from app.models.user import User

logger = logging.getLogger(__name__)


async def get_student_settings(db: AsyncSession, student_id: int) -> StudentProfile:
    """Fetch or create a StudentProfile for the given student."""
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
            teaching_pace="just_right",
            default_session_length=60,
            voice_responses=True,
            show_hints=True,
            auto_start_next_topic=False,
        )
        db.add(profile)
        await db.flush()
        await db.refresh(profile)
        logger.info(f"Created StudentProfile for student_id={student_id} via settings")
    return profile


async def update_learning_preferences(
    db: AsyncSession,
    student_id: int,
    data: Dict[str, Any],
) -> StudentProfile:
    """
    Update learning preferences on a student's profile.
    Only sets fields that are present and non-None in data.
    """
    profile = await get_student_settings(db, student_id)

    updatable_fields = [
        "learning_style",
        "teaching_pace",
        "teaching_preferences",
        "learning_goals",
        "default_session_length",
        "voice_responses",
        "show_hints",
        "auto_start_next_topic",
        "interests",
        "preferred_subjects",
    ]
    for field in updatable_fields:
        if field in data and data[field] is not None:
            setattr(profile, field, data[field])

    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    logger.info(f"Updated learning preferences for student_id={student_id}")
    return profile


async def update_profile(
    db: AsyncSession,
    user_id: int,
    student_id: int,
    name: Optional[str] = None,
    year_group: Optional[str] = None,
    key_stage: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update the user's display name and/or year_group and/or key_stage.
    Returns a combined profile dict.
    """
    # Update User.name if provided
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user and name is not None:
        user.name = name
        await db.flush()

    # Update year_group on StudentProfile
    profile = await get_student_settings(db, student_id)
    if year_group is not None:
        profile.year_group = year_group
        profile.updated_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(profile)

    if key_stage is not None:
        profile.key_stage = key_stage
        profile.updated_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(profile)

    return {
        "user_id": user_id,
        "name": user.name if user else "",
        "email": user.email if user else "",
        "year_group": profile.year_group,
        "key_stage": profile.key_stage,
        "xp_total": profile.xp_total,
        "xp_level": profile.xp_level,
        "current_streak": profile.current_streak,
        "longest_streak": profile.longest_streak,
    }


async def update_notifications(
    db: AsyncSession,
    student_id: int,
    prefs: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Update notification preferences. Merges with existing prefs (partial update).
    Returns the updated prefs dict.
    """
    profile = await get_student_settings(db, student_id)

    existing: Dict[str, Any] = profile.notification_prefs or {
        "assignment_reminders": True,
        "session_reminders": True,
        "messages": True,
        "weekly_progress": True,
    }
    # Merge — only update keys that are provided
    for key, value in prefs.items():
        if value is not None:
            existing[key] = value

    profile.notification_prefs = existing
    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    logger.info(f"Updated notification prefs for student_id={student_id}")
    return existing
