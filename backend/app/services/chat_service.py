import logging
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional, Tuple

from app.models.chat import Chat, Message
from app.schemas.documents import RetrievedChunk

logger = logging.getLogger(__name__)

MAX_CONTEXT_MESSAGES = 20


async def create_chat(db: AsyncSession, user_id: int, title: str = "New Chat") -> Chat:
    chat = Chat(user_id=user_id, title=title)
    db.add(chat)
    await db.flush()
    await db.refresh(chat)
    return chat


async def get_chat_by_session(db: AsyncSession, session_id: str, user_id: int) -> Optional[Chat]:
    result = await db.execute(
        select(Chat)
        .options(selectinload(Chat.messages))
        .where(Chat.session_id == session_id, Chat.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def get_chat_by_id(db: AsyncSession, chat_id: int) -> Optional[Chat]:
    result = await db.execute(
        select(Chat).options(selectinload(Chat.messages)).where(Chat.id == chat_id)
    )
    return result.scalar_one_or_none()


async def get_or_create_session_chat(
    db: AsyncSession, user_id: int, appointment_id: int
) -> Optional[Chat]:
    """
    Resolve (or create) the single chat tied to an appointment session.

    Mirrors the lookup in routers/chat.py:get_or_create_session_chat so the
    session WebSocket can reuse it. Returns None if the appointment does not
    belong to the user. Caller is responsible for committing.
    """
    session_title_key = f"[session:{appointment_id}]"
    result = await db.execute(
        select(Chat)
        .options(selectinload(Chat.messages))
        .where(Chat.user_id == user_id, Chat.title.like(f"{session_title_key}%"))
        .order_by(desc(Chat.id))
        .limit(1)
    )
    chat = result.scalar_one_or_none()
    if chat:
        return chat

    from app.services import appointment_service

    appt = await appointment_service.get_appointment(db, appointment_id)
    if not appt or appt.student_id != user_id:
        return None

    display_title = appt.title or f"{appt.subject} Session"
    full_title = f"{session_title_key} {display_title}"
    chat = await create_chat(db, user_id, title=full_title)
    try:
        chat.appointment_id = appointment_id
    except Exception:
        pass
    await db.flush()
    await db.refresh(chat)
    return chat


async def get_user_chats(db: AsyncSession, user_id: int, limit: int = 50) -> List[Chat]:
    result = await db.execute(
        select(Chat)
        .where(Chat.user_id == user_id)
        .order_by(desc(Chat.created_at))
        .limit(limit)
    )
    return list(result.scalars().all())


async def add_message(db: AsyncSession, chat_id: int, role: str, content: str) -> Message:
    message = Message(chat_id=chat_id, role=role, content=content)
    db.add(message)
    await db.flush()
    await db.refresh(message)
    return message


async def get_chat_history(db: AsyncSession, chat_id: int) -> List[Message]:
    result = await db.execute(
        select(Message)
        .where(Message.chat_id == chat_id)
        .order_by(Message.timestamp)
    )
    return list(result.scalars().all())


async def build_context(
    db: AsyncSession,
    chat_id: int,
    user_query: Optional[str] = None,
) -> Tuple[List[dict], List[RetrievedChunk]]:
    messages = await get_chat_history(db, chat_id)
    recent = messages[-MAX_CONTEXT_MESSAGES:] if len(messages) > MAX_CONTEXT_MESSAGES else messages
    history = [{"role": msg.role, "content": msg.content} for msg in recent]

    rag_chunks: List[RetrievedChunk] = []

    if user_query:
        try:
            from app.core.config import settings
            if settings.rag_enabled:
                from app.services.rag_service import retrieve_relevant_chunks
                rag_chunks = await retrieve_relevant_chunks(db=db, query=user_query)
        except Exception as e:
            logger.warning(f"RAG retrieval skipped: {e}")

    return history, rag_chunks


async def update_chat_title(db: AsyncSession, chat: Chat, title: str):
    chat.title = title
    await db.flush()


async def delete_chat_by_session(db: AsyncSession, session_id: str, user_id: int) -> bool:
    chat = await get_chat_by_session(db, session_id, user_id)
    if not chat:
        return False
    await db.delete(chat)
    await db.flush()
    return True
