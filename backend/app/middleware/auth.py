from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import get_db
from app.services.user_service import get_user_by_id
from app.models.user import (
    User, ROLE_ADMINISTRATOR, ROLE_ADMIN, ROLE_TEACHER, ROLE_STUDENT, ROLE_PARENT,
)

security_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload invalid",
        )

    user = await get_user_by_id(db, int(user_id))
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # "Log out of all devices" bumps token_version; a token minted before that is stale.
    # Legacy tokens (no "tv" claim) read as 0 and keep working until the first bump.
    token_tv = int(payload.get("tv", 0) or 0)
    if token_tv != int(getattr(user, "token_version", 0) or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session ended. Please sign in again.",
        )

    return user


def require_role(*allowed_roles: str):
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {', '.join(allowed_roles)}",
            )
        return current_user
    return role_checker


require_administrator = require_role(ROLE_ADMINISTRATOR)
# Most "admin" surfaces are shared by the platform administrator + school admins.
require_admin = require_role(ROLE_ADMINISTRATOR, ROLE_ADMIN)
require_teacher = require_role(ROLE_ADMINISTRATOR, ROLE_ADMIN, ROLE_TEACHER)
require_student = require_role(ROLE_STUDENT)
require_parent = require_role(ROLE_PARENT)
require_parent_or_teacher = require_role(ROLE_PARENT, ROLE_TEACHER, ROLE_ADMIN, ROLE_ADMINISTRATOR)
require_any_authenticated = require_role(
    ROLE_ADMINISTRATOR, ROLE_ADMIN, ROLE_TEACHER, ROLE_STUDENT, ROLE_PARENT
)


def require_permission(obj: str, act: str):
    """Casbin-backed dependency: allow only if the user's role may `act` on `obj`.
    Use for new (especially school-scoped) endpoints. Existing routes keep using
    the simpler `require_role(...)` dependencies above."""
    async def permission_checker(current_user: User = Depends(get_current_user)) -> User:
        from app.services import casbin_service
        allowed = await casbin_service.check_permission(
            current_user.role, current_user.school_id, obj, act
        )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: cannot {act} {obj}",
            )
        return current_user
    return permission_checker


async def get_current_school_id(current_user: User = Depends(get_current_user)) -> Optional[int]:
    """The caller's tenant id (None for the rare unattached account)."""
    return current_user.school_id
