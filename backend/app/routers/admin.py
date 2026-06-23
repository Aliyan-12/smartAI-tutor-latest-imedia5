from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.middleware.auth import require_admin, require_administrator
from app.models.user import (
    User, ROLE_STUDENT, ROLE_TEACHER, ROLE_PARENT, ROLE_ADMIN, ROLE_ADMINISTRATOR,
    APPROVAL_APPROVED, APPROVAL_PENDING, APPROVAL_REJECTED,
)
from app.models.chat import Chat, Message
from app.models.subscription import CreditTransaction
from app.schemas.user import (
    UserResponse, AdminUserCreate, AdminUserUpdate, CreditAdjust,
)
from app.schemas.chat import ChatResponse, ChatListItem
from app.schemas.subscription import CreditTransactionResponse
from app.services import platform_service
from app.services.user_service import (
    create_user, get_user_by_id, get_user_by_email, list_users, count_users, update_user,
)
from app.services.platform_service import add_credits, get_transactions

router = APIRouter(prefix="/api/admin", tags=["admin"])


# A school admin only ever sees/manages their own school's data. The platform
# ADMINISTRATOR is unscoped — they see and manage every school and every user.
def _scope(caller: User) -> Optional[int]:
    return None if caller.role == ROLE_ADMINISTRATOR else caller.school_id


def _guard_school(caller: User, user: User) -> None:
    if caller.role == ROLE_ADMINISTRATOR:
        return
    if user.school_id != caller.school_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")


@router.get("/dashboard")
async def admin_dashboard(
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    sid = _scope(caller)
    # School admins never see (or count) the platform administrator(s).
    excl = caller.role != ROLE_ADMINISTRATOR
    total_users = await count_users(db, school_id=sid, exclude_administrators=excl)
    total_students = await count_users(db, role="student", school_id=sid)
    total_teachers = await count_users(db, role="teacher", school_id=sid)

    chat_q = select(func.count(Chat.id))
    msg_q = select(func.count(Message.id)).select_from(Message).join(Chat, Chat.id == Message.chat_id)
    if sid is not None:
        chat_q = chat_q.join(User, User.id == Chat.user_id).where(User.school_id == sid)
        msg_q = msg_q.join(User, User.id == Chat.user_id).where(User.school_id == sid)
    chat_count = await db.execute(chat_q)
    message_count = await db.execute(msg_q)

    return {
        "total_users": total_users,
        "total_students": total_students,
        "total_teachers": total_teachers,
        "total_chats": chat_count.scalar() or 0,
        "total_messages": message_count.scalar() or 0,
    }


@router.get("/users", response_model=List[UserResponse])
async def get_all_users(
    role: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    users = await list_users(
        db, role=role, is_active=is_active, limit=limit, offset=offset,
        school_id=_scope(caller), exclude_administrators=caller.role != ROLE_ADMINISTRATOR,
    )
    return [UserResponse.model_validate(u) for u in users]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_any_user(
    payload: AdminUserCreate,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    # Admin-created accounts are pre-verified (no email loop needed) and belong to
    # the admin's school. Students still complete onboarding on first login.
    is_student = payload.role == ROLE_STUDENT
    user = await create_user(
        db, payload.name, payload.email, payload.password,
        role=payload.role, credits=payload.credits,
        school_id=caller.school_id,
        account_type="school",
        is_verified=True,
        onboarding_completed=not is_student,
    )
    await db.commit()
    return UserResponse.model_validate(user)


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user_detail(
    user_id: int,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _guard_school(caller, user)
    return UserResponse.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_any_user(
    user_id: int,
    payload: AdminUserUpdate,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _guard_school(caller, user)

    update_fields = payload.model_dump(exclude_unset=True)
    if "email" in update_fields and update_fields["email"]:
        conflict = await get_user_by_email(db, update_fields["email"])
        if conflict and conflict.id != user_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already taken")

    user = await update_user(db, user, **update_fields)
    return UserResponse.model_validate(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _guard_school(caller, user)
    if user.id == caller.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    await db.delete(user)
    await db.flush()


@router.post("/users/{user_id}/credits", response_model=CreditTransactionResponse)
async def adjust_credits(
    user_id: int,
    payload: CreditAdjust,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _guard_school(caller, user)

    tx = await add_credits(db, user, payload.amount, "admin_adjustment", payload.description)
    return CreditTransactionResponse.model_validate(tx)


@router.get("/users/{user_id}/transactions", response_model=List[CreditTransactionResponse])
async def get_user_transactions(
    user_id: int,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    transactions = await get_transactions(db, user_id)
    return [CreditTransactionResponse.model_validate(t) for t in transactions]


@router.get("/users/{user_id}/chats", response_model=List[ChatListItem])
async def get_user_chats(
    user_id: int,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Chat).where(Chat.user_id == user_id).order_by(desc(Chat.created_at))
    )
    chats = list(result.scalars().all())
    return [ChatListItem(id=c.id, session_id=c.session_id, title=c.title, created_at=c.created_at) for c in chats]


@router.get("/chats")
async def list_all_chats(
    limit: int = Query(100, ge=1, le=500),
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Chat, User.name)
        .join(User, User.id == Chat.user_id)
        .order_by(desc(Chat.created_at))
        .limit(limit)
    )
    rows = result.all()
    return [
        {
            "id": chat.id,
            "session_id": chat.session_id,
            "title": chat.title,
            "created_at": chat.created_at.isoformat(),
            "student_name": name,
        }
        for chat, name in rows
    ]


@router.get("/chats/{session_id}", response_model=ChatResponse)
async def view_any_chat(
    session_id: str,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.messages)).where(Chat.session_id == session_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return ChatResponse.model_validate(chat)


@router.post("/users/{student_id}/generate-invite")
async def generate_invite_code(
    student_id: int,
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.parent_student import InviteCode
    from app.models.user import ROLE_STUDENT

    student = await get_user_by_id(db, student_id)
    if not student or student.role != ROLE_STUDENT:
        raise HTTPException(status_code=404, detail="Student not found")
    _guard_school(caller, student)

    code = InviteCode.generate_code()
    invite = InviteCode(code=code, student_id=student_id)
    db.add(invite)
    await db.flush()

    return {"code": code, "student_id": student_id, "student_name": student.name}


@router.post("/users/{parent_id}/link-student")
async def link_student_to_parent(
    parent_id: int,
    student_id: int = Query(...),
    caller: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.user import ROLE_PARENT, ROLE_STUDENT

    parent = await get_user_by_id(db, parent_id)
    if not parent or parent.role != ROLE_PARENT:
        raise HTTPException(status_code=404, detail="Parent not found")
    _guard_school(caller, parent)

    student = await get_user_by_id(db, student_id)
    if not student or student.role != ROLE_STUDENT:
        raise HTTPException(status_code=404, detail="Student not found")
    _guard_school(caller, student)

    student.parent_id = parent.id
    await db.flush()

    return {"message": f"Linked {student.name} to {parent.name}"}


# ── Administrator-only: school-admin approvals + cross-school views ──────────────
@router.get("/pending-approvals", response_model=List[UserResponse])
async def pending_approvals(
    caller: User = Depends(require_administrator),
    db: AsyncSession = Depends(get_db),
):
    """School admins awaiting approval (administrator reviews these)."""
    res = await db.execute(
        select(User).where(User.approval_status == APPROVAL_PENDING).order_by(desc(User.created_at))
    )
    return [UserResponse.model_validate(u) for u in res.scalars().all()]


@router.post("/users/{user_id}/approve", response_model=UserResponse)
async def approve_user(
    user_id: int,
    caller: User = Depends(require_administrator),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.approval_status = APPROVAL_APPROVED
    await db.commit()
    await db.refresh(user)
    try:
        await platform_service.send_school_approved(user.email, user.name)
    except Exception:  # noqa: BLE001
        pass
    return UserResponse.model_validate(user)


@router.post("/users/{user_id}/reject", response_model=UserResponse)
async def reject_user(
    user_id: int,
    caller: User = Depends(require_administrator),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.approval_status = APPROVAL_REJECTED
    await db.commit()
    await db.refresh(user)
    try:
        await platform_service.send_school_rejected(user.email, user.name)
    except Exception:  # noqa: BLE001
        pass
    return UserResponse.model_validate(user)


@router.get("/schools")
async def list_all_schools(
    caller: User = Depends(require_administrator),
    db: AsyncSession = Depends(get_db),
):
    """Every school + its admin + member counts (administrator only)."""
    from app.models.school import School

    schools = (await db.execute(select(School).order_by(School.id))).scalars().all()
    out = []
    for s in schools:
        admin = await get_user_by_id(db, s.superadmin_user_id) if s.superadmin_user_id else None
        students = (await db.execute(
            select(func.count(User.id)).where(User.school_id == s.id, User.role == ROLE_STUDENT)
        )).scalar() or 0
        teachers = (await db.execute(
            select(func.count(User.id)).where(User.school_id == s.id, User.role == ROLE_TEACHER)
        )).scalar() or 0
        parents = (await db.execute(
            select(func.count(User.id)).where(User.school_id == s.id, User.role == ROLE_PARENT)
        )).scalar() or 0
        out.append({
            "id": s.id, "name": s.name, "country": s.country,
            "is_default": s.is_default, "account_type": s.account_type,
            "admin": {
                "id": admin.id, "name": admin.name, "email": admin.email,
                "approval_status": admin.approval_status,
            } if admin else None,
            "students": students, "teachers": teachers, "parents": parents,
        })
    return out
