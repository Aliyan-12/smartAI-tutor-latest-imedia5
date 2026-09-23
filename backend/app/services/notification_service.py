"""Central, preference-aware notification service (feature 14).

- One entry point, `notify(...)`, used by every producer.
- Checks the recipient's notification preferences (per role) before sending.
- Deduplicates by (user, dedup_key) so a retried/repeated event never spams.
- Records delivery status; in-app is delivered immediately, email is best-effort.
- Security/account events always send (transactional), ignoring marketing-style prefs.
- Titles must never carry sensitive child data (enforced by convention + short length).
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select, desc, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, ROLE_STUDENT, ROLE_PARENT, ROLE_TEACHER
from app.models.notification import Notification, AccessAudit, STATUS_SENT, STATUS_FAILED, STATUS_QUEUED
from app.observability import metrics

logger = logging.getLogger(__name__)

# Categories that always deliver regardless of preferences.
ALWAYS_SEND = {"security", "account"}


async def _prefs_for(db: AsyncSession, user: User) -> Dict[str, Any]:
    try:
        if user.role == ROLE_STUDENT:
            from app.models.student_profile import StudentProfile
            p = await db.get(StudentProfile, user.id)
            return (getattr(p, "notification_prefs", None) or {}) if p else {}
        if user.role == ROLE_PARENT:
            from app.models.parent_profile import ParentProfile
            p = await db.get(ParentProfile, user.id)
            return (p.notification_prefs or {}) if p else {}
        if user.role == ROLE_TEACHER:
            from app.models.teacher_profile import TeacherProfile
            p = await db.get(TeacherProfile, user.id)
            return (p.notification_prefs or {}) if p else {}
    except Exception:
        logger.exception("notification prefs lookup failed")
    return {}


async def preference_allows(db: AsyncSession, user: User, category: str) -> bool:
    if category in ALWAYS_SEND:
        return True
    prefs = await _prefs_for(db, user)
    # Opt-out model: a category is allowed unless explicitly set False.
    return prefs.get(category, True) is not False


async def notify(
    db: AsyncSession, *, user_id: int, category: str, type: str, title: str, body: str = "",
    dedup_key: Optional[str] = None, link: Optional[str] = None, channel: str = "inapp",
    data: Optional[Dict[str, Any]] = None,
) -> Optional[Notification]:
    """Create + deliver a notification if the user allows the category and it isn't a dup."""
    user = await db.get(User, user_id)
    if user is None:
        return None
    if not await preference_allows(db, user, category):
        metrics.incr("notifications.suppressed_by_pref")
        return None

    if dedup_key:
        exists = await db.scalar(select(Notification.id).where(
            Notification.user_id == user_id, Notification.dedup_key == dedup_key))
        if exists is not None:
            metrics.incr("notifications.deduplicated")
            return None

    n = Notification(user_id=user_id, category=category, type=type, title=title[:160],
                     body=body, channel=channel, dedup_key=dedup_key, link=link, data=data or {})
    try:
        async with db.begin_nested():
            db.add(n)
            await db.flush()
    except IntegrityError:
        metrics.incr("notifications.deduplicated")
        return None

    # Deliver. In-app is immediate; email is best-effort via the platform email path.
    try:
        n.attempts += 1
        if channel == "email":
            await _send_email(user, n)
        n.status = STATUS_SENT
        n.sent_at = datetime.now(timezone.utc)
        metrics.incr("notifications.sent")
    except Exception:
        n.status = STATUS_FAILED
        metrics.incr("notifications.failed")
        logger.exception("notification delivery failed id=%s", n.id)
    await db.flush()
    return n


async def _send_email(user: User, n: Notification) -> None:
    """Best-effort email. Subject carries NO sensitive child data — just the title."""
    try:
        from app.services import platform_service
        sender = getattr(platform_service, "send_generic_email", None)
        if sender:
            await sender(user.email, subject=n.title, body=n.body)
        else:
            logger.info("EMAIL (noop) to=%s subject=%r", user.email, n.title)
    except Exception:
        raise


async def list_for_user(db: AsyncSession, user_id: int, limit: int = 30, unread_only: bool = False) -> List[Notification]:
    q = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        q = q.where(Notification.read == False)  # noqa: E712
    q = q.order_by(desc(Notification.created_at)).limit(limit)
    return list((await db.execute(q)).scalars().all())


async def unread_count(db: AsyncSession, user_id: int) -> int:
    return int(await db.scalar(select(func.count(Notification.id)).where(
        Notification.user_id == user_id, Notification.read == False)) or 0)  # noqa: E712


async def mark_read(db: AsyncSession, user_id: int, notification_id: int) -> bool:
    n = await db.get(Notification, notification_id)
    if n is None or n.user_id != user_id:
        return False
    n.read = True
    n.read_at = datetime.now(timezone.utc)
    await db.flush()
    return True


async def mark_all_read(db: AsyncSession, user_id: int) -> int:
    rows = await db.execute(select(Notification).where(
        Notification.user_id == user_id, Notification.read == False))  # noqa: E712
    count = 0
    now = datetime.now(timezone.utc)
    for n in rows.scalars().all():
        n.read = True
        n.read_at = now
        count += 1
    await db.flush()
    return count


# ── sensitive-access audit ─────────────────────────────────────────────────
async def record_access(db: AsyncSession, actor: User, subject_user_id: Optional[int],
                        resource: str, action: str = "view", detail: str = "") -> None:
    db.add(AccessAudit(
        actor_id=actor.id, actor_role=actor.role, subject_user_id=subject_user_id,
        resource=resource, action=action, school_id=getattr(actor, "school_id", None), detail=detail))
    # Flushed with the surrounding request commit.
