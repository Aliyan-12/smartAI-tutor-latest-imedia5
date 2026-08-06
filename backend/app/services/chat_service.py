import asyncio
import base64
import logging
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional, Tuple

from app.core.security import decode_access_token
from app.db.session import async_session_factory
from app.models.chat import Chat, Message
from app.models.user import ROLE_STUDENT
from app.schemas.documents import RetrievedChunk
from app.services import gemini_service

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
    rag_scope: Optional[dict] = None,
) -> Tuple[List[dict], List[RetrievedChunk]]:
    messages = await get_chat_history(db, chat_id)
    # Only real conversation turns go to the LLM. Persisted lifecycle/interactive
    # events (role="event"/"quiz_result") are display-only — they'd otherwise become
    # stray AIMessages and pollute the model's context. Filter BEFORE truncating so
    # we keep MAX real turns.
    convo = [m for m in messages if m.role in ("user", "assistant")]
    recent = convo[-MAX_CONTEXT_MESSAGES:] if len(convo) > MAX_CONTEXT_MESSAGES else convo
    history = [{"role": msg.role, "content": msg.content} for msg in recent]

    rag_chunks: List[RetrievedChunk] = []

    if user_query:
        try:
            from app.core.config import settings
            if settings.rag_enabled:
                from app.services.rag_service import retrieve_hub_chunks
                if rag_scope:
                    # LESSON turn: retrieval must be scoped to the SUBTOPIC being taught.
                    # Unscoped similarity search pulled neighbouring subtopics out of the same
                    # unit — a "2. The sine ratio" lesson was fed tangent and cosine chunks and
                    # duly taught all three. Widen only if the tight scope finds nothing, so a
                    # subtopic with no vectorised slides still gets context instead of silence.
                    # `resource_types` (worksheet-led lessons) is a HARD constraint — keep it at every
                    # widening level, so a widen never pulls slide chunks back into a worksheet lesson.
                    ladder = [
                        dict(rag_scope),
                        {k: v for k, v in rag_scope.items() if k != "topic_title"},
                        {k: v for k, v in rag_scope.items()
                         if k in ("subject", "key_stage", "resource_types")},
                    ]
                    for i, flt in enumerate(ladder):
                        rag_chunks = await retrieve_hub_chunks(
                            db=db, query=user_query,
                            **{k: v for k, v in flt.items() if v},
                        )
                        if rag_chunks:
                            if i:
                                logger.info(
                                    "RAG scope widened to level %d (%s) — no chunks at the "
                                    "tighter scope", i, ",".join(sorted(flt)))
                            break
                else:
                    # Free simple chat: loosely grounded in Resource Hub content
                    # (no curriculum filter — just similarity).
                    rag_chunks = await retrieve_hub_chunks(db=db, query=user_query)
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


# ===========================================================================
# Simple-chat WebSocket pipeline  (/chat — the FREE chat for everyone)
#
# A standalone, non-session chat: SIMPLE_CHAT_SYSTEM_PROMPT + RAG, NO tools
# (web/deep search + file/photo come later). Same transport/segment/TTS/voice
# plumbing as the premium session, but its own turn logic. The session pipeline
# (premium, full tools, lessons) lives in session_agent_service and is separate.
# ===========================================================================

_active_chat_ws: dict = {}


async def _run_chat_turn(send, chat_id: int, user_id: int, *, saved_user_text,
                         ai_content, image_b64=None, image_mime="image/jpeg",
                         research=False, tts=True):
    """One simple-chat turn: save user msg, stream + segment reply, save once, turn_end."""
    from app.services.agent.session import core as _sa  # shared segment/thinking/turn helpers (lazy → no cycle)

    turn_id = uuid4().hex
    await send({"type": "turn_start", "turn_id": turn_id})

    # Steps for the "thinking" strip (tool labels + brief thought lines), persisted as a
    # role="thinking" message so they survive a refresh (mirrors the session pipeline).
    thinking_steps: list = []

    # Attached PDF/DOCX/PPTX → extract text + inject; images stay for Gemini vision.
    if image_b64 and image_mime and not image_mime.startswith("image/"):
        doc_text = await asyncio.to_thread(_sa._extract_doc_text, image_b64, image_mime)
        image_b64 = None
        if doc_text:
            ai_content = f"[ATTACHED FILE CONTENT]\n{doc_text[:8000]}\n\n{ai_content}"

    if research and ai_content:
        ai_content = _sa._RESEARCH_PREFIX + ai_content

    message_id = None
    clean = ""
    async with async_session_factory() as db:
        chat = await get_chat_by_id(db, chat_id)
        if not chat:
            await send({"type": "error", "message": "Chat not found.", "recoverable": False})
            await send({"type": "turn_end", "message_id": None, "full_text": ""})
            return

        if saved_user_text is not None:
            await add_message(db, chat_id, "user", saved_user_text)
        history, rag_chunks = await build_context(db, chat_id, user_query=saved_user_text or ai_content)
        chat_title = chat.title
        chat_session_id = chat.session_id
        await db.commit()

        # Simple system prompt (+ the student's learning preferences). NO session tools.
        from app.services.gemini_service import SIMPLE_CHAT_SYSTEM_PROMPT, build_personalised_system_prompt
        system_prompt = SIMPLE_CHAT_SYSTEM_PROMPT
        try:
            from app.services.platform_service import get_student_settings
            prof = await get_student_settings(db, user_id)
            system_prompt = build_personalised_system_prompt({
                "teaching_pace": prof.teaching_pace,
                "learning_style": prof.learning_style or [],
                "teaching_preferences": prof.teaching_preferences or {},
                "interests": prof.interests or [],
                "learning_goals": prof.learning_goals,
            }, base_prompt=SIMPLE_CHAT_SYSTEM_PROMPT)
        except Exception:
            pass

        # /chat tool subset (web_search + deep_research) bound to the chat LLM.
        from app.tools.session_tools import ToolContext
        chat_tool_ctx = ToolContext(
            db=db, student_id=user_id, appointment_id=0,
            subject="", key_stage="", chat_session_id=chat_session_id,
        )

        hist_slice = history[:-1] if saved_user_text is not None else history
        segmenter = _sa.SentenceSegmenter()
        seq = 0
        full: list = []
        import json as _json2
        async for raw in gemini_service.stream_response_async(
            hist_slice, ai_content, rag_chunks=rag_chunks,
            system_prompt_override=system_prompt,
            tool_context=chat_tool_ctx, tool_set="chat",  # ← /chat subset only
            image_data=image_b64, image_mime=image_mime,
        ):
            token = _sa._coerce_str(raw)
            stripped = token.strip()
            # Brief reasoning summary → thinking strip (never shown as answer text).
            if stripped.startswith("[THINK:") and stripped.endswith("]"):
                await _sa._emit_thinking(send, thinking_steps, stripped[len("[THINK:"):-1])
                continue
            # Tool-result tokens → structured `tool` events; never spoken/shown.
            if stripped.startswith("[TOOL_RESULT:") and stripped.endswith("]"):
                try:
                    tr = _json2.loads(stripped[len("[TOOL_RESULT:"):-1])
                    _tool = tr.get("tool", "")
                    await send({"type": "tool", "tool": _tool, "data": tr.get("data", {})})
                    _label = _sa._THINKING_LABELS.get(_tool)
                    if _label:
                        await _sa._emit_thinking(send, thinking_steps, _label)
                except Exception:
                    pass
                continue
            full.append(token)
            for sentence in segmenter.feed(token):
                await _sa.stream_segment(send, seq, sentence, tts=tts, turn_id=turn_id)
                seq += 1
        remainder = segmenter.flush()
        if remainder:
            await _sa.stream_segment(send, seq, remainder, tts=tts, turn_id=turn_id)
            seq += 1

        complete = "".join(full)
        clean = _sa.strip_display_markers(complete).strip()
        if not clean or "[Error:" in complete:
            await send({"type": "error", "message": "Couldn't generate a reply — please try again.", "recoverable": True})
            await send({"type": "turn_end", "message_id": None, "full_text": ""})
            return

        if thinking_steps:
            await add_message(db, chat_id, "thinking", "\n".join(thinking_steps))

        msg = await add_message(db, chat_id, "assistant", clean)
        message_id = msg.id
        try:
            from app.services.user_service import get_user_by_id
            from app.services import platform_service
            fresh = await get_user_by_id(db, user_id)
            if fresh:
                await platform_service.check_and_deduct_credit(db, fresh)
                await send({"type": "credits", "value": float(fresh.credits)})
                try:
                    await platform_service.award_xp(db, user_id, 5, "chat_message")
                    await platform_service.check_and_update_streak(db, user_id)
                except Exception:
                    pass
            if chat_title == "New Chat" and saved_user_text:
                title = gemini_service.generate_chat_title(saved_user_text)
                fresh_chat = await get_chat_by_session(db, chat_session_id, user_id)
                if fresh_chat:
                    await update_chat_title(db, fresh_chat, title)
                    await send({"type": "title", "value": title})
        except Exception:
            logger.warning("Chat credit/XP/title update failed for user %s", user_id)
        await db.commit()

    await send({"type": "turn_end", "message_id": message_id, "full_text": clean})


async def _handle_chat_message(send, chat_id, user_id, data):
    text = (data.get("text") or "").strip()
    image_b64 = data.get("image_b64")
    if not text and not image_b64:
        return
    saved = text if text else "(shared an image)"
    ai = text or "Please look at the attached image and help me understand it."
    # Simple-chat TEXT mode → reply is text only (no TTS).
    await _run_chat_turn(send, chat_id, user_id, saved_user_text=saved, ai_content=ai,
                         image_b64=image_b64, image_mime=data.get("image_mime") or "image/jpeg",
                         research=bool(data.get("research")), tts=False)


async def _handle_chat_audio(send, chat_id, user_id, data):
    audio_b64 = data.get("audio_b64")
    if not audio_b64:
        return
    if not bool(data.get("stt", True)):
        await send({"type": "error", "message": "Voice needs speech-to-text enabled.", "recoverable": True})
        await send({"type": "turn_end", "message_id": None, "full_text": ""})
        return
    mime = data.get("mime") or "audio/webm"
    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        await send({"type": "error", "message": "Bad audio data.", "recoverable": True})
        await send({"type": "turn_end", "message_id": None, "full_text": ""})
        return
    from app.services.agent.session.voice import speech_to_text
    ext = (mime.split("/")[-1] or "webm").split(";")[0]
    transcript = await asyncio.to_thread(speech_to_text, audio_bytes, f"audio.{ext}")
    if not transcript:
        await send({"type": "error", "message": "Sorry, I couldn't hear that — please try again.", "recoverable": True})
        await send({"type": "turn_end", "message_id": None, "full_text": ""})
        return
    await send({"type": "user_transcript", "text": transcript})
    # Simple-chat VOICE mode → spoken reply (STT in, TTS out), same as the session loop.
    await _run_chat_turn(send, chat_id, user_id, saved_user_text=transcript, ai_content=transcript,
                         tts=True)


async def run_chat_ws(websocket: WebSocket) -> None:
    """Simple-chat WebSocket (text + voice). Thin router delegates here."""
    await websocket.accept()

    token = websocket.query_params.get("token")
    session_id_q = websocket.query_params.get("session_id")
    if not token:
        await websocket.close(code=4001, reason="Missing auth token")
        return
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return
    user_id = int(payload.get("sub", 0))
    role = payload.get("role", "")
    if not user_id or role != ROLE_STUDENT:
        await websocket.close(code=4003, reason="Only students can use chat")
        return

    existing = _active_chat_ws.get(user_id)
    if existing is not None and existing is not websocket:
        try:
            await existing.close(code=4000, reason="Replaced by new chat")
        except Exception:
            pass
    _active_chat_ws[user_id] = websocket
    current_turn: Optional[asyncio.Task] = None

    async def send(d: dict) -> None:
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_json(d)
        except Exception:
            pass

    try:
        async with async_session_factory() as db:
            chat = None
            if session_id_q:
                chat = await get_chat_by_session(db, session_id_q, user_id)
            if not chat:
                chat = await create_chat(db, user_id)
                await db.commit()
            chat_id = chat.id
            chat_session_id = chat.session_id

        await send({"type": "ready", "session_id": chat_session_id})
        logger.info("Chat WS ready: user=%s chat=%s", user_id, chat_id)

        from app.services.agent.session.core import _guard_turn  # shared timeout/cancel guard
        _handlers = {"user_message": _handle_chat_message, "user_audio": _handle_chat_audio}
        while True:
            try:
                data = await websocket.receive_json()
            except (WebSocketDisconnect, RuntimeError):
                break
            except Exception:
                break
            mtype = data.get("type")
            if mtype == "ping":
                await send({"type": "pong"})
            elif mtype == "stop":
                if current_turn and not current_turn.done():
                    current_turn.cancel()
            elif mtype == "speak":
                # One-shot TTS over the socket ("Read aloud" in chat). All TTS goes through
                # the WS now — /voice/speak is gone. Own task so it never blocks a turn.
                _sp_text = data.get("text") or ""
                _sp_id = data.get("id") or ""

                async def _speak_task(_t=_sp_text, _i=_sp_id):
                    try:
                        from app.services.agent.session.voice import synth_speak_frame
                        await send(await synth_speak_frame(_t, _i))
                    except Exception:  # noqa: BLE001
                        pass
                asyncio.create_task(_speak_task())
            elif mtype in _handlers:
                if current_turn and not current_turn.done():
                    continue
                current_turn = asyncio.create_task(
                    _guard_turn(send, _handlers[mtype](send, chat_id, user_id, data))
                )
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.error("Chat WS error: %s", e, exc_info=True)
    finally:
        if current_turn and not current_turn.done():
            current_turn.cancel()
        if _active_chat_ws.get(user_id) is websocket:
            del _active_chat_ws[user_id]
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close()
        except Exception:
            pass
        logger.info("Chat WS closed: user=%s", user_id)
