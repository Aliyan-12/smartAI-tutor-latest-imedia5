import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.middleware.auth import get_current_user
from app.models.user import User, ROLE_STUDENT
from app.schemas.chat import ChatResponse, ChatListItem
from app.services import chat_service, platform_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _ensure_student(user: User):
    if user.role != ROLE_STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can use the chat feature",
        )


@router.get("/list", response_model=List[ChatListItem])
async def list_chats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)
    chats = await chat_service.get_user_chats(db, current_user.id)
    return [
        ChatListItem(id=c.id, session_id=c.session_id, title=c.title, created_at=c.created_at)
        for c in chats
    ]


@router.get("/credits")
async def get_credits(
    current_user: User = Depends(get_current_user),
):
    return {
        "credits": float(current_user.credits),
        "cost_per_message": platform_service.COST_PER_MESSAGE,
    }


@router.get("/{session_id}", response_model=ChatResponse)
async def get_chat(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)
    chat = await chat_service.get_chat_by_session(db, session_id, current_user.id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return ChatResponse.model_validate(chat)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)
    deleted = await chat_service.delete_chat_by_session(db, session_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")


@router.post("/for-appointment/{appointment_id}")
async def get_or_create_session_chat(
    appointment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)

    from app.models.chat import Chat as ChatModel
    from sqlalchemy import select as sa_select

    # The session chat title is a stable key used to find the right chat later
    session_title_key = f"[session:{appointment_id}]"

    # Look up by stable title key + user — no migration dependency
    result = await db.execute(
        sa_select(ChatModel)
        .options(selectinload(ChatModel.messages))
        .where(
            ChatModel.user_id == current_user.id,
            ChatModel.title.like(f"{session_title_key}%"),
        )
        .order_by(ChatModel.id.desc())
        .limit(1)
    )
    chat = result.scalar_one_or_none()

    if not chat:
        from app.services import appointment_service
        appt = await appointment_service.get_appointment(db, appointment_id)
        if not appt:
            raise HTTPException(status_code=404, detail="Appointment not found")

        logger.info(
            f"Session chat init: appt_id={appointment_id} "
            f"appt.student_id={appt.student_id} current_user.id={current_user.id}"
        )

        if appt.student_id != current_user.id:
            raise HTTPException(status_code=403, detail="This appointment does not belong to you")

        display_title = appt.title or f"{appt.subject} Session"
        full_title = f"{session_title_key} {display_title}"
        chat = await chat_service.create_chat(db, current_user.id, title=full_title)

        # Also try to set appointment_id FK if the column exists (non-fatal)
        try:
            chat.appointment_id = appointment_id
        except Exception:
            pass

        await db.commit()
        await db.refresh(chat)

        # Reload with messages
        result2 = await db.execute(
            sa_select(ChatModel)
            .options(selectinload(ChatModel.messages))
            .where(ChatModel.id == chat.id)
        )
        chat = result2.scalar_one()

    messages_out = [
        {
            "id": m.id,
            "chat_id": chat.id,
            "role": m.role,
            "content": m.content,
            "timestamp": m.timestamp.isoformat(),
        }
        for m in sorted(chat.messages, key=lambda m: m.timestamp)
    ]

    return {"session_id": chat.session_id, "messages": messages_out}


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    """Simple-chat WebSocket (text + voice). Thin transport; all logic in chat_service."""
    await chat_service.run_chat_ws(websocket)
