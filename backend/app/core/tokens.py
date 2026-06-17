"""Single-use email verification / password-reset tokens (DB-backed)."""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth_tokens import EmailVerificationToken, PURPOSE_VERIFY

VERIFY_TTL_HOURS = 24


async def create_token(
    db: AsyncSession,
    user_id: int,
    purpose: str = PURPOSE_VERIFY,
    ttl_hours: int = VERIFY_TTL_HOURS,
) -> str:
    token = secrets.token_urlsafe(32)  # ~43 chars, fits VARCHAR(64)
    row = EmailVerificationToken(
        user_id=user_id,
        token=token,
        purpose=purpose,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
    )
    db.add(row)
    await db.flush()
    return token


async def consume_token(
    db: AsyncSession,
    token: str,
    purpose: str = PURPOSE_VERIFY,
) -> Optional[int]:
    """Validate the token (right purpose, unused, unexpired) and mark it used.
    Returns the user_id on success, else None."""
    res = await db.execute(
        select(EmailVerificationToken).where(EmailVerificationToken.token == token)
    )
    row = res.scalar_one_or_none()
    if not row or row.used or row.purpose != purpose:
        return None
    exp = row.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        return None
    row.used = True
    await db.flush()
    return row.user_id
