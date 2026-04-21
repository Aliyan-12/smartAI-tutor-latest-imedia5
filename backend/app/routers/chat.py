import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db, async_session_factory
from app.middleware.auth import get_current_user
from app.core.security import decode_access_token
from app.models.user import User, ROLE_STUDENT
from app.schemas.chat import MessageCreate, ChatResponse, ChatListItem, MessageResponse
from app.services import chat_service, gemini_service, credit_service, session_agent_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _ensure_student(user: User):
    if user.role != ROLE_STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can use the chat feature",
        )


async def _ensure_credits(db: AsyncSession, user: User):
    if not user.has_credits:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please subscribe to continue.",
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
        "cost_per_message": credit_service.COST_PER_MESSAGE,
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


@router.post("/stream")
async def stream_message(
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_student(current_user)
    await _ensure_credits(db, current_user)

    if payload.session_id:
        chat = await chat_service.get_chat_by_session(db, payload.session_id, current_user.id)
        if not chat:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    else:
        chat = await chat_service.create_chat(db, current_user.id)

    await chat_service.add_message(db, chat.id, "user", payload.message)
    history, rag_chunks = await chat_service.build_context(db, chat.id, user_query=payload.message)

    # Build a session-specific system prompt when this chat belongs to an appointment
    session_system_prompt: str | None = None
    if getattr(chat, "appointment_id", None):
        try:
            session_system_prompt = await session_agent_service.build_session_system_prompt(
                db, chat.appointment_id, current_user.id
            )
        except Exception:
            logger.warning(
                f"Failed to build session prompt for appointment {chat.appointment_id}, using default"
            )

    async def event_stream():
        full_response = []
        yield f"data: {json.dumps({'type': 'start', 'session_id': chat.session_id})}\n\n"

        async for token in gemini_service.stream_response_async(
            history[:-1],
            payload.message,
            rag_chunks=rag_chunks,
            system_prompt_override=session_system_prompt,
        ):
            full_response.append(token)
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        complete_text = "".join(full_response)

        quiz_topic = gemini_service.extract_quiz_offer(complete_text)
        clean_text = gemini_service.strip_quiz_offer(complete_text)

        async with async_session_factory() as save_session:
            await chat_service.add_message(save_session, chat.id, "assistant", clean_text)

            from app.services.user_service import get_user_by_id
            from app.services import gamification_service
            fresh_user = await get_user_by_id(save_session, current_user.id)
            if fresh_user:
                await credit_service.check_and_deduct_credit(save_session, fresh_user)
                yield f"data: {json.dumps({'type': 'credits', 'content': str(float(fresh_user.credits))})}\n\n"
                try:
                    await gamification_service.award_xp(save_session, current_user.id, 5, "chat_message")
                    await gamification_service.check_and_update_streak(save_session, current_user.id)
                except Exception:
                    pass

            if chat.title == "New Chat":
                saved_chat = await chat_service.get_chat_by_session(save_session, chat.session_id, current_user.id)
                if saved_chat:
                    title = gemini_service.generate_chat_title(payload.message)
                    await chat_service.update_chat_title(save_session, saved_chat, title)
                    yield f"data: {json.dumps({'type': 'title', 'content': title})}\n\n"
            await save_session.commit()

        if quiz_topic:
            yield f"data: {json.dumps({'type': 'quiz_offer', 'content': quiz_topic})}\n\n"

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
    user_role = payload.get("role", "")
    if not user_id or user_role != ROLE_STUDENT:
        await websocket.close(code=4003, reason="Only students can use chat")
        return

    try:
        while True:
            data = await websocket.receive_json()
            message_text = data.get("message", "")
            session_id = data.get("session_id")

            if not message_text:
                continue

            async with async_session_factory() as db:
                from app.services.user_service import get_user_by_id
                user = await get_user_by_id(db, user_id)
                if not user or not user.has_credits:
                    await websocket.send_json({"type": "error", "content": "Insufficient credits"})
                    continue

                if session_id:
                    chat = await chat_service.get_chat_by_session(db, session_id, user_id)
                    if not chat:
                        chat = await chat_service.create_chat(db, user_id)
                else:
                    chat = await chat_service.create_chat(db, user_id)

                await chat_service.add_message(db, chat.id, "user", message_text)
                history, rag_chunks = await chat_service.build_context(db, chat.id, user_query=message_text)
                chat_session_id = chat.session_id
                chat_id = chat.id
                chat_title = chat.title
                await db.commit()

            await websocket.send_json({"type": "start", "session_id": chat_session_id})

            full_response = []
            async for token_text in gemini_service.stream_response_async(history[:-1], message_text, rag_chunks=rag_chunks):
                full_response.append(token_text)
                await websocket.send_json({"type": "token", "content": token_text})

            complete_text = "".join(full_response)

            async with async_session_factory() as db:
                await chat_service.add_message(db, chat_id, "assistant", complete_text)

                user = await get_user_by_id(db, user_id)
                if user:
                    await credit_service.check_and_deduct_credit(db, user)
                    await websocket.send_json({"type": "credits", "content": str(float(user.credits))})

                if chat_title == "New Chat":
                    saved_chat = await chat_service.get_chat_by_session(db, chat_session_id, user_id)
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
