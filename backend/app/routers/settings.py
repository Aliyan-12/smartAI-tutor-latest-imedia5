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
from app.services import settings_service


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: get their profile (name, email, year group, XP, streak)."""
    data = await settings_service.update_profile(
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
    """Student: update their display name and/or year group."""
    data = await settings_service.update_profile(
        db,
        user_id=current_user.id,
        student_id=current_user.id,
        name=payload.name,
        year_group=payload.year_group,
    )
    await db.commit()
    return ProfileResponse(**data)


@router.get("/learning-preferences", response_model=LearningPreferencesResponse)
async def get_learning_preferences(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: get their learning preferences."""
    profile = await settings_service.get_student_settings(db, current_user.id)
    await db.commit()
    return LearningPreferencesResponse.model_validate(profile)


@router.patch("/learning-preferences", response_model=LearningPreferencesResponse)
async def update_learning_preferences(
    payload: LearningPreferencesUpdate,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: update their learning preferences."""
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    profile = await settings_service.update_learning_preferences(
        db, current_user.id, data
    )
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
    updated = await settings_service.update_notifications(
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
