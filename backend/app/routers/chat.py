import asyncio
import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, async_session_factory
from app.middleware.auth import get_current_user
from app.core.security import decode_access_token
from app.models.user import User
from app.schemas.chat import MessageCreate, ChatResponse, ChatListItem, MessageResponse
from app.services import chat_service, gemini_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/list", response_model=List[ChatListItem])
async def list_chats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    chats = await chat_service.get_user_chats(db, current_user.id)
    items = []
    for c in chats:
        items.append(ChatListItem(
            id=c.id,
            title=c.title,
            created_at=c.created_at,
        ))
    return items


@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    chat = await chat_service.get_chat(db, chat_id, current_user.id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return ChatResponse.model_validate(chat)


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deleted = await chat_service.delete_chat(db, chat_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")


@router.post("/send", response_model=MessageResponse)
async def send_message(
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.chat_id:
        chat = await chat_service.get_chat(db, payload.chat_id, current_user.id)
        if not chat:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    else:
        chat = await chat_service.create_chat(db, current_user.id)

    await chat_service.add_message(db, chat.id, "user", payload.message)

    history = await chat_service.build_context(db, chat.id)
    ai_text = gemini_service.generate_response(history[:-1], payload.message)

    assistant_msg = await chat_service.add_message(db, chat.id, "assistant", ai_text)

    if chat.title == "New Chat":
        title = gemini_service.generate_chat_title(payload.message)
        await chat_service.update_chat_title(db, chat, title)

    return MessageResponse.model_validate(assistant_msg)


@router.post("/stream")
async def stream_message(
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.chat_id:
        chat = await chat_service.get_chat(db, payload.chat_id, current_user.id)
        if not chat:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    else:
        chat = await chat_service.create_chat(db, current_user.id)

    await chat_service.add_message(db, chat.id, "user", payload.message)
    history = await chat_service.build_context(db, chat.id)

    async def event_stream():
        full_response = []
        yield f"data: {json.dumps({'type': 'start', 'chat_id': chat.id})}\n\n"

        async for token in gemini_service.stream_response_async(history[:-1], payload.message):
            full_response.append(token)
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        complete_text = "".join(full_response)

        async with async_session_factory() as save_session:
            await chat_service.add_message(save_session, chat.id, "assistant", complete_text)
            if chat.title == "New Chat":
                saved_chat = await chat_service.get_chat(save_session, chat.id, current_user.id)
                if saved_chat:
                    title = gemini_service.generate_chat_title(payload.message)
                    await chat_service.update_chat_title(save_session, saved_chat, title)
                    yield f"data: {json.dumps({'type': 'title', 'content': title})}\n\n"
            await save_session.commit()

        yield f"data: {json.dumps({'type': 'end'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.websocket("/ws")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()

    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing auth token")
        return

    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return

    user_id = int(payload.get("sub", 0))
    if not user_id:
        await websocket.close(code=4001, reason="Invalid token payload")
        return

    try:
        while True:
            data = await websocket.receive_json()
            message_text = data.get("message", "")
            chat_id = data.get("chat_id")

            if not message_text:
                continue

            async with async_session_factory() as db:
                if chat_id:
                    chat = await chat_service.get_chat(db, chat_id, user_id)
                    if not chat:
                        chat = await chat_service.create_chat(db, user_id)
                else:
                    chat = await chat_service.create_chat(db, user_id)

                await chat_service.add_message(db, chat.id, "user", message_text)
                history = await chat_service.build_context(db, chat.id)
                await db.commit()

            await websocket.send_json({"type": "start", "chat_id": chat.id})

            full_response = []
            async for token_text in gemini_service.stream_response_async(history[:-1], message_text):
                full_response.append(token_text)
                await websocket.send_json({"type": "token", "content": token_text})

            complete_text = "".join(full_response)

            async with async_session_factory() as db:
                await chat_service.add_message(db, chat.id, "assistant", complete_text)
                if chat.title == "New Chat":
                    saved_chat = await chat_service.get_chat(db, chat.id, user_id)
                    if saved_chat:
                        title = gemini_service.generate_chat_title(message_text)
                        await chat_service.update_chat_title(db, saved_chat, title)
                        await websocket.send_json({"type": "title", "content": title})
                await db.commit()

            await websocket.send_json({"type": "end"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close(code=1011, reason="Internal error")
