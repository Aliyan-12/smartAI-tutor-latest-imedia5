import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password, hash_password
from app.db.session import get_db
from app.middleware.auth import require_student, require_any_authenticated
from app.models.user import User
from app.schemas.settings import (
    LearningPreferencesUpdate,
    LearningPreferencesResponse,
    ProfileUpdate,
    ProfileResponse,
    NotificationPrefsUpdate,
    NotificationPrefsResponse,
)
from app.services import platform_service
from app.services.user_service import get_user_by_id


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Bounded, allowed values — preferences change HOW the tutor teaches, never curriculum/safety.
_ALLOWED_STYLES = {"visual", "examples", "step_by_step", "concise", "analogies", "diagrams", "worked_examples"}
_ALLOWED_PACE = {"slower", "just_right", "faster"}


def _sanitize_prefs(data: dict) -> dict:
    """Keep preference writes bounded + safe. Students may NOT change curriculum entitlement
    (key stage / year group) via preferences — that stays authoritative from onboarding/school."""
    if isinstance(data.get("learning_style"), list):
        data["learning_style"] = [s for s in data["learning_style"] if s in _ALLOWED_STYLES]
    if data.get("teaching_pace") not in _ALLOWED_PACE:
        data.pop("teaching_pace", None)
    if "default_session_length" in data:
        try:
            data["default_session_length"] = max(20, min(90, int(data["default_session_length"])))
        except (TypeError, ValueError):
            data.pop("default_session_length", None)
    data.pop("key_stage", None)
    data.pop("year_group", None)
    return data


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: get their profile (name, email, year group, XP, streak)."""
    data = await platform_service.update_profile(
        db, user_id=current_user.id, student_id=current_user.id
    )
    await db.commit()
    return ProfileResponse(**data)


@router.patch("/profile", response_model=ProfileResponse)
async def update_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: update their display name only.

    Key Stage + Year Group are set once during onboarding and are NOT editable from
    settings (the UI dropdowns are locked). They will later be advanced automatically
    by school-term management — so we deliberately ignore those fields here even if a
    request includes them.
    """
    data = await platform_service.update_profile(
        db,
        user_id=current_user.id,
        student_id=current_user.id,
        name=payload.name,
    )
    await db.commit()
    return ProfileResponse(**data)


@router.get("/learning-preferences", response_model=LearningPreferencesResponse)
async def get_learning_preferences(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: get their learning preferences."""
    profile = await platform_service.get_student_settings(db, current_user.id)
    await db.commit()
    return LearningPreferencesResponse.model_validate(profile)


@router.patch("/learning-preferences", response_model=LearningPreferencesResponse)
async def update_learning_preferences(
    payload: LearningPreferencesUpdate,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: update their learning preferences (bounded — HOW the tutor teaches)."""
    data = _sanitize_prefs({k: v for k, v in payload.model_dump().items() if v is not None})
    profile = await platform_service.update_learning_preferences(
        db, current_user.id, data
    )
    await db.commit()
    return LearningPreferencesResponse.model_validate(profile)


@router.get("/learning-preferences/for/{student_id}", response_model=LearningPreferencesResponse)
async def view_student_preferences(
    student_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Parent (of the child) or teacher/admin (same school) read-only view of a
    student's learning preferences. Enforces the authorisation boundary itself so a
    parent can never read another family's child, and a teacher never another school's."""
    student = await get_user_by_id(db, student_id)
    if student is None or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found")

    allowed = False
    if current_user.role == "parent" and getattr(student, "parent_id", None) == current_user.id:
        allowed = True
    elif current_user.role in ("teacher", "admin", "administrator"):
        # Administrators are cross-school; teachers/admins are scoped to their own school.
        allowed = current_user.role == "administrator" or (
            current_user.school_id is not None and student.school_id == current_user.school_id
        )
    if not allowed:
        raise HTTPException(status_code=403, detail="You are not authorised to view this student's preferences")

    profile = await platform_service.get_student_settings(db, student_id)
    await db.commit()
    return LearningPreferencesResponse.model_validate(profile)


@router.patch("/notifications", response_model=NotificationPrefsResponse)
async def update_notifications(
    payload: NotificationPrefsUpdate,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: update their notification preferences."""
    prefs_data = {k: v for k, v in payload.model_dump().items()}
    updated = await platform_service.update_notifications(
        db, current_user.id, prefs_data
    )
    await db.commit()
    return NotificationPrefsResponse(**updated)


@router.post("/change-password", status_code=200)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Student: change their account password."""
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=422, detail="New password must be at least 6 characters")
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one()
    user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"message": "Password updated successfully"}
