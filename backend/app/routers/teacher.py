from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.middleware.auth import require_teacher
from app.models.user import User, ROLE_STUDENT
from app.models.chat import Chat, Message
from app.models.parent_student import InviteCode
from app.schemas.user import UserResponse
from app.schemas.chat import ChatResponse, ChatListItem

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


class TeacherCreateStudent(BaseModel):
    name: str
    email: str
    password: str
    year_group: Optional[str] = None

router = APIRouter(prefix="/api/teacher", tags=["teacher"])


@router.get("/dashboard")
async def teacher_dashboard(
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    student_count = await db.execute(
        select(func.count(User.id)).where(User.role == ROLE_STUDENT)
    )
    active_count = await db.execute(
        select(func.count(User.id)).where(User.role == ROLE_STUDENT, User.is_active == True)
    )
    chat_count = await db.execute(select(func.count(Chat.id)))
    message_count = await db.execute(select(func.count(Message.id)))

    return {
        "total_students": student_count.scalar() or 0,
        "active_students": active_count.scalar() or 0,
        "total_chats": chat_count.scalar() or 0,
        "total_messages": message_count.scalar() or 0,
    }


@router.get("/students", response_model=List[UserResponse])
async def list_students(
    is_active: Optional[bool] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    query = select(User).where(User.role == ROLE_STUDENT)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    query = query.order_by(desc(User.created_at)).limit(limit).offset(offset)
    result = await db.execute(query)
    students = list(result.scalars().all())
    return [UserResponse.model_validate(s) for s in students]


@router.get("/students/{student_id}", response_model=UserResponse)
async def get_student_detail(
    student_id: int,
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.id == student_id, User.role == ROLE_STUDENT)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    return UserResponse.model_validate(student)


@router.get("/students/{student_id}/chats", response_model=List[ChatListItem])
async def get_student_chats(
    student_id: int,
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    student_check = await db.execute(
        select(User.id).where(User.id == student_id, User.role == ROLE_STUDENT)
    )
    if not student_check.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")

    result = await db.execute(
        select(Chat).where(Chat.user_id == student_id).order_by(desc(Chat.created_at))
    )
    chats = list(result.scalars().all())
    return [ChatListItem(id=c.id, session_id=c.session_id, title=c.title, created_at=c.created_at) for c in chats]


@router.get("/chats/{session_id}", response_model=ChatResponse)
async def view_student_chat(
    session_id: str,
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Chat).options(selectinload(Chat.messages)).where(Chat.session_id == session_id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return ChatResponse.model_validate(chat)


@router.get("/activity")
async def recent_activity(
    limit: int = Query(20, ge=1, le=100),
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Message, Chat.session_id)
        .join(Chat, Chat.id == Message.chat_id)
        .join(User, User.id == Chat.user_id)
        .where(User.role == ROLE_STUDENT, Message.role == "user")
        .order_by(desc(Message.timestamp))
        .limit(limit)
    )
    rows = result.all()
    items = []
    for msg, session_id in rows:
        items.append({
            "message_id": msg.id,
            "session_id": session_id,
            "content": msg.content[:200],
            "timestamp": msg.timestamp.isoformat(),
        })
    return items


@router.post("/students", status_code=status.HTTP_201_CREATED)
async def create_student(
    payload: TeacherCreateStudent,
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=_pwd_ctx.hash(payload.password),
        role=ROLE_STUDENT,
        is_active=True,
        credits=100.0,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    invite = InviteCode(
        code=InviteCode.generate_code(),
        student_id=user.id,
        used=False,
    )
    db.add(invite)
    await db.flush()

    return {
        "student": UserResponse.model_validate(user),
        "invite_code": invite.code,
    }


@router.post("/students/{student_id}/invite-code", status_code=status.HTTP_201_CREATED)
async def generate_invite_code(
    student_id: int,
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.id == student_id, User.role == ROLE_STUDENT)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")

    invite = InviteCode(
        code=InviteCode.generate_code(),
        student_id=student.id,
        used=False,
    )
    db.add(invite)
    await db.flush()

    return {
        "invite_code": invite.code,
        "student_name": student.name,
    }
