from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List

from app.models.user import User, ROLE_STUDENT
from app.core.security import hash_password, verify_password


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession,
    name: str,
    email: str,
    password: Optional[str] = None,
    role: str = ROLE_STUDENT,
    credits: float = 100,
    school_id: Optional[int] = None,
    account_type: str = "individual",
    auth_provider: str = "password",
    is_verified: bool = False,
    onboarding_completed: bool = False,
) -> User:
    user = User(
        name=name,
        email=email,
        # OAuth-only accounts have no local password.
        password_hash=hash_password(password) if password else None,
        role=role,
        credits=credits,
        school_id=school_id,
        account_type=account_type,
        auth_provider=auth_provider,
        is_verified=is_verified,
        onboarding_completed=onboarding_completed,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    user = await get_user_by_email(db, email)
    # No password_hash → OAuth-only account; can't log in with a password.
    if not user or not user.password_hash or not verify_password(password, user.password_hash):
        return None
    return user


async def list_users(
    db: AsyncSession,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[User]:
    query = select(User)
    if role:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    query = query.order_by(User.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())


async def count_users(db: AsyncSession, role: Optional[str] = None) -> int:
    query = select(func.count(User.id))
    if role:
        query = query.where(User.role == role)
    result = await db.execute(query)
    return result.scalar() or 0


async def update_user(db: AsyncSession, user: User, **fields) -> User:
    for key, value in fields.items():
        if value is not None and hasattr(user, key):
            if key == "password":
                user.password_hash = hash_password(value)
            else:
                setattr(user, key, value)
    await db.flush()
    await db.refresh(user)
    return user


async def toggle_user_active(db: AsyncSession, user: User) -> User:
    user.is_active = not user.is_active
    await db.flush()
    await db.refresh(user)
    return user
