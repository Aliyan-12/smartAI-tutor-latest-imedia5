"""Administrator settings centre. Platform administrators change global settings;
school admins change only school-scoped settings for their own school. Every change is
validated against the registry and written to the audit trail."""
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_admin
from app.models.user import User
from app.services import platform_settings_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])


class SettingUpdate(BaseModel):
    value: Any
    reason: Optional[str] = None
    school_id: Optional[int] = None  # platform admin may target a specific school


@router.get("")
async def get_settings(user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Grouped settings schema with resolved (masked, where sensitive) values, filtered
    to what the caller may see."""
    return await svc.schema_for(db, user)


@router.put("/{key}")
async def update_setting(key: str, payload: SettingUpdate,
                         user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    coerced = await svc.set_value(db, user, key, payload.value, reason=payload.reason or "",
                                  school_id=payload.school_id)
    await db.commit()
    return {"key": key, "value": coerced}


@router.get("/audit/log")
async def audit_log(user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return {"changes": await svc.audit_list(db, user)}


@router.get("/audit/access")
async def access_audit(user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Recent access to sensitive child data (feature 14). School admins see their own school;
    administrators see all."""
    from sqlalchemy import select, desc
    from app.models.notification import AccessAudit
    from app.models.user import ROLE_ADMINISTRATOR
    q = select(AccessAudit).order_by(desc(AccessAudit.created_at)).limit(100)
    if user.role != ROLE_ADMINISTRATOR and user.school_id:
        q = select(AccessAudit).where(AccessAudit.school_id == user.school_id) \
            .order_by(desc(AccessAudit.created_at)).limit(100)
    rows = (await db.execute(q)).scalars().all()
    return {"access": [{
        "actor_id": r.actor_id, "actor_role": r.actor_role, "subject_user_id": r.subject_user_id,
        "resource": r.resource, "action": r.action, "created_at": r.created_at,
    } for r in rows]}


@router.get("/public/disclosure")
async def ai_disclosure(db: AsyncSession = Depends(get_db)):
    """Unauthenticated: the AI disclosure text the frontend shows to learners."""
    try:
        text = await svc.value(db, "ai_disclosure_text")
    except KeyError:
        raise HTTPException(500, "disclosure setting missing")
    await db.commit()
    return {"disclosure": text}
