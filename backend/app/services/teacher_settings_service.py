"""Teacher account + classroom settings. Class defaults are consumed by the booking
flow. School-owned policies are surfaced read-only and never writable here."""
import logging
from typing import Any, Dict

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.teacher_profile import (
    TeacherProfile, DEFAULT_TEACHER_NOTIFICATIONS, TEACHING_APPROACHES, REPORT_VISIBILITY,
)

logger = logging.getLogger(__name__)


async def get_or_create_profile(db: AsyncSession, user_id: int) -> TeacherProfile:
    profile = await db.get(TeacherProfile, user_id)
    if profile is None:
        profile = TeacherProfile(user_id=user_id, notification_prefs=dict(DEFAULT_TEACHER_NOTIFICATIONS))
        db.add(profile)
        await db.flush()
    return profile


async def update_profile(db: AsyncSession, user: User, data: Dict[str, Any]) -> TeacherProfile:
    if data.get("name"):
        user.name = str(data["name"]).strip()[:120]
    profile = await get_or_create_profile(db, user.id)
    if data.get("phone") is not None:
        profile.phone = str(data["phone"]).strip()[:40]
    if data.get("timezone"):
        profile.timezone = str(data["timezone"]).strip()[:60]
    await db.flush()
    return profile


async def update_class_settings(db: AsyncSession, user_id: int, data: Dict[str, Any]) -> TeacherProfile:
    profile = await get_or_create_profile(db, user_id)
    if "default_session_length" in data and data["default_session_length"] is not None:
        try:
            profile.default_session_length = max(20, min(90, int(data["default_session_length"])))
        except (TypeError, ValueError):
            pass
    if "default_key_stage" in data:
        profile.default_key_stage = data["default_key_stage"]
    if isinstance(data.get("default_subjects"), list):
        profile.default_subjects = [str(s)[:60] for s in data["default_subjects"]][:12]
    if data.get("teaching_approach") in TEACHING_APPROACHES:
        profile.teaching_approach = data["teaching_approach"]
    if "default_objectives" in data and data["default_objectives"] is not None:
        profile.default_objectives = str(data["default_objectives"])[:2000]
    if "default_student_credits" in data and data["default_student_credits"] is not None:
        try:
            profile.default_student_credits = max(0, min(100000, int(data["default_student_credits"])))
        except (TypeError, ValueError):
            pass
    if data.get("report_visibility") in REPORT_VISIBILITY:
        profile.report_visibility = data["report_visibility"]
    if isinstance(data.get("availability"), dict):
        # Keep it a shallow {day: [windows]} shape; ignore anything malformed.
        clean = {}
        for day, windows in data["availability"].items():
            if isinstance(windows, list):
                clean[str(day)[:3].lower()] = [str(w)[:20] for w in windows][:6]
        profile.availability = clean
    await db.flush()
    return profile


async def update_notifications(db: AsyncSession, user_id: int, prefs: Dict[str, bool]) -> TeacherProfile:
    profile = await get_or_create_profile(db, user_id)
    merged = dict(DEFAULT_TEACHER_NOTIFICATIONS)
    merged.update(profile.notification_prefs or {})
    for k, v in prefs.items():
        if k in DEFAULT_TEACHER_NOTIFICATIONS:
            merged[k] = bool(v)
    profile.notification_prefs = merged
    await db.flush()
    return profile


async def logout_all_devices(db: AsyncSession, user: User) -> int:
    user.token_version = int(user.token_version or 0) + 1
    await db.flush()
    return user.token_version
