"""School (tenant) management — for the school superadmin (and platform admin).

All reads/writes are scoped to the caller's own school_id, so one school can
never see or modify another school's users. Platform admin (cross-school) is
allowed by Casbin but still operates within its own school_id here.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_admin, require_permission
from app.models.user import User, ROLE_TEACHER, ROLE_STUDENT, ROLE_PARENT, DEFAULT_CREDITS
from app.schemas.school import (
    SchoolStats, SchoolResponse, SchoolUpdate,
    SchoolUserResponse, SchoolUserCreate, SchoolUsersList,
)
from app.services import school_service
from app.services.user_service import get_user_by_email, create_user, get_user_by_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/school", tags=["school"])


async def _require_school(current_user: User) -> int:
    if not current_user.school_id:
        raise HTTPException(status_code=400, detail="Account is not attached to a school")
    return current_user.school_id


@router.get("/me", response_model=SchoolStats)
async def my_school(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    school_id = await _require_school(current_user)
    school = await school_service.get_school(db, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    async def _count(role: str) -> int:
        res = await db.execute(
            select(func.count(User.id)).where(User.school_id == school_id, User.role == role)
        )
        return res.scalar() or 0

    teachers = await _count(ROLE_TEACHER)
    students = await _count(ROLE_STUDENT)
    parents = await _count(ROLE_PARENT)
    return SchoolStats(
        school=SchoolResponse.model_validate(school),
        teachers=teachers, students=students, parents=parents,
        total=teachers + students + parents,
    )


@router.patch("", response_model=SchoolResponse)
async def update_school(
    payload: SchoolUpdate,
    current_user: User = Depends(require_permission("school", "manage")),
    db: AsyncSession = Depends(get_db),
):
    school_id = await _require_school(current_user)
    school = await school_service.get_school(db, school_id)
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    if payload.name is not None:
        school.name = payload.name
    if payload.country is not None:
        school.country = payload.country
    await db.commit()
    await db.refresh(school)
    return SchoolResponse.model_validate(school)


@router.get("/users", response_model=SchoolUsersList)
async def list_users(
    role: str | None = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    school_id = await _require_school(current_user)
    users = await school_service.list_school_users(db, school_id, role=role)
    return SchoolUsersList(
        users=[SchoolUserResponse.model_validate(u) for u in users],
        total=len(users),
    )


@router.post("/users", response_model=SchoolUserResponse, status_code=status.HTTP_201_CREATED)
async def add_user(
    payload: SchoolUserCreate,
    current_user: User = Depends(require_permission("school", "manage")),
    db: AsyncSession = Depends(get_db),
):
    school_id = await _require_school(current_user)
    if await get_user_by_email(db, payload.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    # School-managed accounts are pre-verified (the school vouches for them) but
    # still complete onboarding (profile/preferences) on first login.
    user = await create_user(
        db, name=payload.name, email=payload.email, password=payload.password,
        role=payload.role,
        credits=DEFAULT_CREDITS if payload.role == ROLE_STUDENT else 0,
        school_id=school_id, account_type="school",
        auth_provider="password", is_verified=True, onboarding_completed=False,
    )
    await db.commit()
    await db.refresh(user)
    return SchoolUserResponse.model_validate(user)


@router.patch("/users/{user_id}/active", response_model=SchoolUserResponse)
async def set_user_active(
    user_id: int,
    is_active: bool,
    current_user: User = Depends(require_permission("school", "manage")),
    db: AsyncSession = Depends(get_db),
):
    school_id = await _require_school(current_user)
    user = await get_user_by_id(db, user_id)
    if not user or user.school_id != school_id:
        raise HTTPException(status_code=404, detail="User not found in your school")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't deactivate your own account")
    user.is_active = is_active
    await db.commit()
    await db.refresh(user)
    return SchoolUserResponse.model_validate(user)
