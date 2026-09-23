"""In-app notification centre (feature 14)."""
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_any_authenticated
from app.models.user import User
from app.services import notification_service as notif

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(30, ge=1, le=100),
    user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    rows = await notif.list_for_user(db, user.id, limit=limit, unread_only=unread_only)
    unread = await notif.unread_count(db, user.id)
    await db.commit()
    return {
        "unread": unread,
        "notifications": [{
            "id": n.id, "category": n.category, "type": n.type, "title": n.title,
            "body": n.body, "read": n.read, "link": n.link, "created_at": n.created_at,
        } for n in rows],
    }


@router.get("/unread-count")
async def unread(user: User = Depends(require_any_authenticated), db: AsyncSession = Depends(get_db)):
    count = await notif.unread_count(db, user.id)
    await db.commit()
    return {"unread": count}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: int, user: User = Depends(require_any_authenticated), db: AsyncSession = Depends(get_db)):
    ok = await notif.mark_read(db, user.id, notification_id)
    await db.commit()
    return {"ok": ok}


@router.post("/read-all")
async def mark_all_read(user: User = Depends(require_any_authenticated), db: AsyncSession = Depends(get_db)):
    n = await notif.mark_all_read(db, user.id)
    await db.commit()
    return {"marked": n}
