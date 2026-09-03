"""Parent account settings: profile, children (secure linking + audit), notifications,
account security and privacy. Every child mutation is authorisation-checked here and
recorded in the parent_child_events audit trail."""
import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, ROLE_STUDENT, DEFAULT_CREDITS
from app.models.parent_student import InviteCode, ParentChildEvent
from app.models.parent_profile import ParentProfile, DEFAULT_PARENT_NOTIFICATIONS
from app.models.student_profile import StudentProfile
from app.services.user_service import get_user_by_id, get_user_by_email, create_user

logger = logging.getLogger(__name__)


# ── audit ────────────────────────────────────────────────────────────────
async def log_event(
    db: AsyncSession, parent_id: int, student_id: Optional[int],
    actor_id: Optional[int], action: str, detail: str = "",
) -> None:
    db.add(ParentChildEvent(
        parent_id=parent_id, student_id=student_id, actor_id=actor_id,
        action=action, detail=detail,
    ))


async def list_events(db: AsyncSession, parent_id: int, limit: int = 50) -> List[ParentChildEvent]:
    res = await db.execute(
        select(ParentChildEvent).where(ParentChildEvent.parent_id == parent_id)
        .order_by(desc(ParentChildEvent.created_at)).limit(limit)
    )
    return list(res.scalars().all())


# ── profile ──────────────────────────────────────────────────────────────
async def get_or_create_profile(db: AsyncSession, user_id: int) -> ParentProfile:
    profile = await db.get(ParentProfile, user_id)
    if profile is None:
        profile = ParentProfile(user_id=user_id, notification_prefs=dict(DEFAULT_PARENT_NOTIFICATIONS))
        db.add(profile)
        await db.flush()
    return profile


async def update_profile(db: AsyncSession, user: User, data: Dict[str, Any]) -> ParentProfile:
    if data.get("name"):
        user.name = data["name"].strip()[:120]
    profile = await get_or_create_profile(db, user.id)
    for field in ("phone", "timezone", "language"):
        if field in data and data[field] is not None:
            setattr(profile, field, str(data[field]).strip()[:60])
    if data.get("default_child_credits") is not None:
        try:
            profile.default_child_credits = max(0, min(100000, int(data["default_child_credits"])))
        except (TypeError, ValueError):
            pass
    await db.flush()
    return profile


async def update_notifications(db: AsyncSession, user_id: int, prefs: Dict[str, bool]) -> ParentProfile:
    profile = await get_or_create_profile(db, user_id)
    merged = dict(DEFAULT_PARENT_NOTIFICATIONS)
    merged.update(profile.notification_prefs or {})
    for k, v in prefs.items():
        if k in DEFAULT_PARENT_NOTIFICATIONS:
            merged[k] = bool(v)
    profile.notification_prefs = merged
    await db.flush()
    return profile


# ── children ─────────────────────────────────────────────────────────────
def _prefs_summary(profile: Optional[StudentProfile]) -> str:
    if profile is None:
        return "No preferences set yet"
    bits: List[str] = []
    if profile.learning_style:
        bits.append(", ".join(profile.learning_style[:3]).replace("_", " "))
    if profile.teaching_pace and profile.teaching_pace != "just_right":
        bits.append(f"{profile.teaching_pace} pace")
    return " · ".join(bits) if bits else "Standard preferences"


async def children_summary(db: AsyncSession, parent_id: int) -> List[Dict[str, Any]]:
    res = await db.execute(
        select(User).where(User.parent_id == parent_id, User.role == ROLE_STUDENT).order_by(User.name)
    )
    children = list(res.scalars().all())
    out: List[Dict[str, Any]] = []
    for child in children:
        profile = await db.get(StudentProfile, child.id)
        out.append({
            "id": child.id,
            "name": child.name,
            "email": child.email,
            "is_active": child.is_active,
            "year_group": getattr(profile, "year_group", None) if profile else None,
            "key_stage": getattr(profile, "key_stage", None) if profile else None,
            "preferences_summary": _prefs_summary(profile),
        })
    return out


async def _assert_child(db: AsyncSession, parent_id: int, student_id: int) -> User:
    child = await get_user_by_id(db, student_id)
    if child is None or child.role != ROLE_STUDENT or child.parent_id != parent_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child not linked to your account")
    return child


async def create_child(db: AsyncSession, parent: User, name: str, email: str, password: str) -> User:
    if await get_user_by_email(db, email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")
    child = await create_user(
        db, name=name, email=email, password=password, role=ROLE_STUDENT,
        credits=DEFAULT_CREDITS, school_id=parent.school_id,
        account_type=getattr(parent, "account_type", "individual"),
        auth_provider="password", is_verified=True, onboarding_completed=False,
    )
    child.parent_id = parent.id
    await db.flush()
    await log_event(db, parent.id, child.id, parent.id, "child_created", f"Created and linked {name}")
    return child


async def link_child_by_code(db: AsyncSession, parent: User, code: str) -> User:
    clean = (code or "").strip().upper()
    res = await db.execute(select(InviteCode).where(InviteCode.code == clean))
    invite = res.scalar_one_or_none()
    if invite is None or not invite.is_redeemable():
        await log_event(db, parent.id, None, parent.id, "link_failed", f"Bad/expired code {clean}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This code is invalid or has expired")

    child = await get_user_by_id(db, invite.student_id)
    if child is None or child.role != ROLE_STUDENT:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    if child.parent_id and child.parent_id != parent.id:
        await log_event(db, parent.id, child.id, parent.id, "link_failed", "Already linked elsewhere")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This child is already linked to another parent")

    child.parent_id = parent.id
    invite.used = True
    invite.used_by_id = parent.id
    from datetime import datetime, timezone
    invite.used_at = datetime.now(timezone.utc)
    await db.flush()
    await log_event(db, parent.id, child.id, parent.id, "linked", f"Linked via code {clean}")
    return child


async def unlink_child(db: AsyncSession, parent: User, student_id: int) -> None:
    child = await _assert_child(db, parent.id, student_id)
    child.parent_id = None
    await db.flush()
    await log_event(db, parent.id, student_id, parent.id, "unlinked", f"Unlinked {child.name}")


# ── account security ─────────────────────────────────────────────────────
async def logout_all_devices(db: AsyncSession, user: User) -> int:
    user.token_version = int(user.token_version or 0) + 1
    await db.flush()
    return user.token_version
