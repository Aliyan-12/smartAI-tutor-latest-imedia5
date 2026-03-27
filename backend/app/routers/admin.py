from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.middleware.auth import require_admin
from app.models.user import User
from app.models.chat import Chat, Message
from app.models.subscription import CreditTransaction
from app.schemas.user import (
    UserResponse, AdminUserCreate, AdminUserUpdate, CreditAdjust,
)
from app.schemas.chat import ChatResponse, ChatListItem
from app.schemas.subscription import CreditTransactionResponse
from app.services.user_service import (
    create_user, get_user_by_id, get_user_by_email, list_users, count_users, update_user,
)
from app.services.credit_service import add_credits, get_transactions

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/dashboard")
async def admin_dashboard(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    total_users = await count_users(db)
    total_students = await count_users(db, role="student")
    total_teachers = await count_users(db, role="teacher")

    chat_count = await db.execute(select(func.count(Chat.id)))
    message_count = await db.execute(select(func.count(Message.id)))

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
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    users = await list_users(db, role=role, is_active=is_active, limit=limit, offset=offset)
    return [UserResponse.model_validate(u) for u in users]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_any_user(
    payload: AdminUserCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = await create_user(
        db, payload.name, payload.email, payload.password,
        role=payload.role, credits=payload.credits,
    )
    return UserResponse.model_validate(user)


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user_detail(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserResponse.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_any_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

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
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    await db.delete(user)
    await db.flush()


@router.post("/users/{user_id}/credits", response_model=CreditTransactionResponse)
async def adjust_credits(
    user_id: int,
    payload: CreditAdjust,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    tx = await add_credits(db, user, payload.amount, "admin_adjustment", payload.description)
    return CreditTransactionResponse.model_validate(tx)


@router.get("/users/{user_id}/transactions", response_model=List[CreditTransactionResponse])
async def get_user_transactions(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    transactions = await get_transactions(db, user_id)
    return [CreditTransactionResponse.model_validate(t) for t in transactions]


@router.get("/users/{user_id}/chats", response_model=List[ChatListItem])
async def get_user_chats(
    user_id: int,
    admin: User = Depends(require_admin),
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
    admin: User = Depends(require_admin),
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
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.messages)).where(Chat.session_id == session_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return ChatResponse.model_validate(chat)
