"""Teacher settings API: profile, class settings, teaching preferences, notifications,
account/security. Class defaults feed the booking flow (GET /defaults). School-owned
policies are read-only (GET /policy)."""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password, hash_password
from app.db.session import get_db
from app.middleware.auth import require_teacher
from app.models.user import User
from app.services import teacher_settings_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/teacher/settings", tags=["teacher-settings"])


class TeacherProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    timezone: Optional[str] = None


class ClassSettingsUpdate(BaseModel):
    default_session_length: Optional[int] = None
    default_key_stage: Optional[str] = None
    default_subjects: Optional[List[str]] = None
    teaching_approach: Optional[str] = None
    default_objectives: Optional[str] = None
    report_visibility: Optional[str] = None
    availability: Optional[Dict[str, List[str]]] = None


class NotificationPrefs(BaseModel):
    prefs: Dict[str, bool]


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


def _profile_dto(user: User, p) -> Dict[str, Any]:
    return {
        "name": user.name, "email": user.email, "phone": p.phone, "timezone": p.timezone,
    }


def _class_dto(p) -> Dict[str, Any]:
    return {
        "default_session_length": p.default_session_length,
        "default_key_stage": p.default_key_stage,
        "default_subjects": p.default_subjects or [],
        "teaching_approach": p.teaching_approach,
        "default_objectives": p.default_objectives or "",
        "report_visibility": p.report_visibility,
        "availability": p.availability or {},
    }


@router.get("/profile")
async def get_profile(user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await svc.get_or_create_profile(db, user.id)
    await db.commit()
    return _profile_dto(user, p)


@router.put("/profile")
async def update_profile(payload: TeacherProfileUpdate, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await svc.update_profile(db, user, payload.model_dump(exclude_none=True))
    await db.commit()
    return _profile_dto(user, p)


@router.get("/class")
async def get_class_settings(user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await svc.get_or_create_profile(db, user.id)
    await db.commit()
    return _class_dto(p)


@router.put("/class")
async def update_class_settings(payload: ClassSettingsUpdate, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await svc.update_class_settings(db, user.id, payload.model_dump(exclude_none=True))
    await db.commit()
    return _class_dto(p)


@router.get("/notifications")
async def get_notifications(user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await svc.get_or_create_profile(db, user.id)
    await db.commit()
    return {"prefs": p.notification_prefs}


@router.put("/notifications")
async def update_notifications(payload: NotificationPrefs, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    p = await svc.update_notifications(db, user.id, payload.prefs)
    await db.commit()
    return {"prefs": p.notification_prefs}


@router.get("/defaults")
async def booking_defaults(user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    """Consumed by the booking form to pre-fill a new session."""
    p = await svc.get_or_create_profile(db, user.id)
    await db.commit()
    return {
        "default_session_length": p.default_session_length,
        "default_key_stage": p.default_key_stage,
        "default_subjects": p.default_subjects or [],
        "default_objectives": p.default_objectives or "",
        "teaching_approach": p.teaching_approach,
    }


@router.get("/policy")
async def school_policy(user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    """School-owned permissions, shown read-only. Configured by the admin (feature 08);
    teachers can never change these themselves."""
    from app.services import platform_settings_service
    can_manage = await platform_settings_service.value(db, "teachers_can_manage_assignments", user.school_id)
    await db.commit()
    return {
        "can_manage_assignments": bool(can_manage),
        "report_visibility_locked": False,
        "billing_managed_by": "school" if user.school_id else "self",
    }


@router.post("/account/change-password")
async def change_password(payload: ChangePassword, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    if not user.password_hash or not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Your current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    await svc.logout_all_devices(db, user)
    await db.commit()
    return {"message": "Password updated. Other devices have been signed out."}


@router.post("/account/logout-all")
async def logout_all(user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    version = await svc.logout_all_devices(db, user)
    await db.commit()
    return {"message": "Signed out of all devices.", "token_version": version}
