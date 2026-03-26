from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional

from app.models.chat import Chat, Message

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


async def build_context(db: AsyncSession, chat_id: int) -> List[dict]:
    messages = await get_chat_history(db, chat_id)
    recent = messages[-MAX_CONTEXT_MESSAGES:] if len(messages) > MAX_CONTEXT_MESSAGES else messages
    return [{"role": msg.role, "content": msg.content} for msg in recent]


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
