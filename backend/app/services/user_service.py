from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List

from app.models.user import User, ROLE_STUDENT, ROLE_ADMINISTRATOR
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
    approval_status: str = "approved",
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
        approval_status=approval_status,
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
    school_id: Optional[int] = None,
    exclude_administrators: bool = False,
) -> List[User]:
    query = select(User)
    if role:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    if school_id is not None:
        query = query.where(User.school_id == school_id)
    if exclude_administrators:
        query = query.where(User.role != ROLE_ADMINISTRATOR)
    query = query.order_by(User.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())


async def count_users(
    db: AsyncSession,
    role: Optional[str] = None,
    school_id: Optional[int] = None,
    exclude_administrators: bool = False,
) -> int:
    query = select(func.count(User.id))
    if role:
        query = query.where(User.role == role)
    if school_id is not None:
        query = query.where(User.school_id == school_id)
    if exclude_administrators:
        query = query.where(User.role != ROLE_ADMINISTRATOR)
    result = await db.execute(query)
    return result.scalar() or 0


async def delete_user_cascade(db: AsyncSession, user_id: int) -> None:
    """Delete a user and every row that references them, in FK-dependency order.

    Use this instead of `db.delete(user)`: several FKs (appointments, chats,
    documents, subscriptions, credit_transactions) have NO `ON DELETE CASCADE`, so a
    plain delete raises a ForeignKeyViolation. Runs inside the caller's transaction —
    the caller commits.
    """
    from sqlalchemy import text
    p = {"u": user_id}
    appt = "SELECT id FROM appointments WHERE student_id=:u OR teacher_id=:u OR booked_by=:u"
    statements = [
        f"DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id=:u OR appointment_id IN ({appt}))",
        f"DELETE FROM chats WHERE user_id=:u OR appointment_id IN ({appt})",
        f"DELETE FROM assessments WHERE student_id=:u OR appointment_id IN ({appt})",
        f"DELETE FROM lesson_plans WHERE student_id=:u OR created_by=:u OR appointment_id IN ({appt})",
        "DELETE FROM appointments WHERE student_id=:u OR teacher_id=:u OR booked_by=:u",
        "DELETE FROM documents WHERE uploaded_by=:u",
        "DELETE FROM subscriptions WHERE user_id=:u",
        "DELETE FROM credit_transactions WHERE user_id=:u",
        # users delete cascades student_profiles, topic_mastery, invite_codes,
        # homework/homework_assignments, email_verification_tokens, oauth_identities.
        "DELETE FROM users WHERE id=:u",
    ]
    for sql in statements:
        await db.execute(text(sql), p)


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
