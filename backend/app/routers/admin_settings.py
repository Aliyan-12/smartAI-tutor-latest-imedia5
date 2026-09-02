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


@router.get("/public/disclosure")
async def ai_disclosure(db: AsyncSession = Depends(get_db)):
    """Unauthenticated: the AI disclosure text the frontend shows to learners."""
    try:
        text = await svc.value(db, "ai_disclosure_text")
    except KeyError:
        raise HTTPException(500, "disclosure setting missing")
    await db.commit()
    return {"disclosure": text}
