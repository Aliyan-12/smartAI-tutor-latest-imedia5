"""
session_ws.py — the unified session chat WebSocket.

One structured-JSON socket per active lesson session. The backend is the single
source of truth: it saves each message exactly once, streams the model response
as ordered *segments* (sentence + its bundled Kokoro audio), and commits the
assistant turn with an authoritative DB id. This replaces the fragile, racing
SSE-text + N-TTS-HTTP + filler-audio client orchestration.

Protocol — Client -> Server:
  {type:"user_message", text, image_b64?, image_mime?, research?, tts:bool}
  {type:"user_audio",   audio_b64, mime, tts:bool}   # custom voice loop (STT -> turn)
  {type:"stop"} | {type:"ping"}

Protocol — Server -> Client:
  {type:"ready", session_id}
  {type:"user_transcript", text}                      # for user_audio turns
  {type:"turn_start", turn_id}
  {type:"segment", seq, text, audio_b64|null, duration_ms|null}
  {type:"tool", tool, data}
  {type:"credits", value} | {type:"title", value}
  {type:"turn_end", message_id, full_text}
  {type:"error", message, recoverable} | {type:"pong"}
"""
import asyncio
import base64
import json
import logging
import re
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.core.security import decode_access_token
from app.db.session import async_session_factory
from app.models.user import ROLE_STUDENT
from app.services import (
    chat_service,
    credit_service,
    filler_service,
    gemini_service,
    segment_service,
    session_agent_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/session", tags=["session"])

# A turn can never hang the socket: this bound guarantees a turn_end/error always fires.
_TURN_TIMEOUT_S = 150

# One active session socket per user — close the stale one when a new one arrives.
_active_ws: dict[int, WebSocket] = {}

_RESEARCH_PREFIX = (
    "[DEEP RESEARCH REQUEST] Please conduct a thorough, multi-faceted investigation "
    "into the following, covering key concepts, common misconceptions, real-world "
    "applications, and exam-relevant facts with clear sections:\n\n"
)


_DOC_TYPES = {
    "application/pdf": ("pdf", ".pdf"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("docx", ".docx"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ("pptx", ".pptx"),
}


def _extract_doc_text(b64: str, mime: str) -> str | None:
    """Extract text from an attached PDF/DOCX/PPTX (reuses document_service)."""
    entry = _DOC_TYPES.get(mime)
    if not entry:
        return None
    file_type, suffix = entry
    import os
    import tempfile

    path = None
    try:
        from app.services.document_service import extract_text

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(base64.b64decode(b64))
            path = tmp.name
        text = extract_text(path, file_type)
        return text.strip() or None
    except Exception as e:  # noqa: BLE001
        logger.warning("Attached-file text extraction failed: %s", e)
        return None
    finally:
        if path:
            try:
                os.unlink(path)
            except Exception:
                pass


def _coerce_str(token) -> str:
    """LangChain can yield str, list-of-parts, or other; normalise to text."""
    if isinstance(token, str):
        return token
    if isinstance(token, list):
        return "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in token
        )
    return str(token)


def _build_quiz_ctx(topic: str, score: float, strong: list, weak: list) -> str:
    """Quiz-result instruction injected to the model (mirrors chat.py /quiz-feedback)."""
    score_pct = round(score, 1)
    strong_str = ", ".join(strong) if strong else "none"
    weak_str = ", ".join(weak) if weak else "none"
    if score_pct >= 80:
        tone = "Praise them enthusiastically — this is a great score!"
    elif score_pct >= 60:
        tone = "Acknowledge the effort, highlight strengths, gently note the areas to review."
    else:
        tone = ("Be warm and encouraging — do not make them feel bad. Focus first on what they "
                "got right, then guide them through the weak areas clearly.")
    return (
        f"[QUIZ COMPLETED]\nTopic: {topic} | Score: {score_pct}%\n"
        f"Strong areas: {strong_str}\nWeak areas: {weak_str}\n"
        f"Tone guidance: {tone}\n"
        "Respond naturally — give brief, warm feedback on the quiz result, then continue teaching."
    )


async def _run_turn(
    send,
    chat_id: int,
    user_id: int,
    *,
    saved_user_text: str | None,
    ai_content: str,
    image_b64: str | None = None,
    image_mime: str = "image/jpeg",
    tts: bool = True,
) -> None:
    """
    Run one assistant turn: optionally persist a user message, stream + segment
    the reply (audio bundled per sentence), save the assistant message once, and
    emit turn_end with the authoritative DB id. `saved_user_text=None` means no
    visible user message is stored (used by quiz feedback).
    """
    await send({"type": "turn_start", "turn_id": uuid4().hex})

    # Neutral filler bridge: a short pre-recorded phrase played the instant the
    # student sends, covering the <1s before the model's first sentence (which
    # carries the real contextual reaction). Audio-only — skip when muted.
    if tts:
        nf = await asyncio.to_thread(filler_service.get_neutral_filler)
        if nf and nf.get("audio_b64"):
            await send({"type": "filler", "text": nf["text"], "audio_b64": nf["audio_b64"]})

    # Attached PDF/DOCX/PPTX → extract text and inject; never send a doc to vision.
    if image_b64 and image_mime and not image_mime.startswith("image/"):
        doc_text = await asyncio.to_thread(_extract_doc_text, image_b64, image_mime)
        image_b64 = None
        if doc_text:
            ai_content = f"[ATTACHED FILE CONTENT]\n{doc_text[:8000]}\n\n{ai_content}"

    message_id = None
    clean = ""
    async with async_session_factory() as db:
        chat = await chat_service.get_chat_by_id(db, chat_id)
        if not chat:
            await send({"type": "error", "message": "Session not found.", "recoverable": False})
            await send({"type": "turn_end", "message_id": None, "full_text": ""})
            return

        if saved_user_text is not None:
            await chat_service.add_message(db, chat_id, "user", saved_user_text)
        history, rag_chunks = await chat_service.build_context(
            db, chat_id, user_query=saved_user_text or ai_content
        )
        await db.commit()

        # Resolve appointment -> session system prompt + tool context (reuses chat.py logic)
        appt_id = getattr(chat, "appointment_id", None)
        if not appt_id and chat.title:
            m = re.match(r"\[session:(\d+)\]", chat.title)
            if m:
                appt_id = int(m.group(1))

        session_system_prompt = None
        tool_context = None
        if appt_id:
            try:
                session_system_prompt = await session_agent_service.build_session_system_prompt(
                    db, appt_id, user_id, history_len=max(0, len(history) - 1)
                )
            except Exception:
                logger.warning("Session prompt build failed for appt %s", appt_id)
            try:
                from app.services.appointment_service import get_appointment
                from app.tools.session_tools import ToolContext

                appt = await get_appointment(db, appt_id)
                if appt:
                    tool_context = ToolContext(
                        db=db,
                        student_id=user_id,
                        appointment_id=appt_id,
                        subject=appt.subject,
                        key_stage=appt.key_stage,
                        chat_session_id=chat.session_id,
                    )
            except Exception:
                logger.warning("ToolContext build failed for appt %s", appt_id)

        # When we persisted a user message it is the last history item — exclude it
        # (it is passed separately as ai_content). Quiz turns persist nothing.
        hist_slice = history[:-1] if saved_user_text is not None else history

        # Stream the reply, splitting into segments and bundling each one's audio.
        segmenter = segment_service.SentenceSegmenter()
        seq = 0
        full: list[str] = []

        async for raw in gemini_service.stream_response_async(
            hist_slice,
            ai_content,
            rag_chunks=rag_chunks,
            system_prompt_override=session_system_prompt,
            tool_context=tool_context,
            image_data=image_b64,
            image_mime=image_mime,
        ):
            token = _coerce_str(raw)
            stripped = token.strip()

            # Tool-result tokens become structured `tool` events — never spoken/shown.
            if stripped.startswith("[TOOL_RESULT:") and stripped.endswith("]"):
                try:
                    tr = json.loads(stripped[len("[TOOL_RESULT:"):-1])
                    await send({"type": "tool", "tool": tr.get("tool", ""), "data": tr.get("data", {})})
                except Exception:
                    pass
                continue

            full.append(token)
            for sentence in segmenter.feed(token):
                await send(await segment_service.build_segment(sentence, seq, tts))
                seq += 1

        remainder = segmenter.flush()
        if remainder:
            await send(await segment_service.build_segment(remainder, seq, tts))
            seq += 1

        complete = "".join(full)
        clean = segment_service.strip_display_markers(complete).replace("[SLIDE_TRIGGER]", "").strip()

        if not clean or "[Error:" in complete:
            await send({"type": "error", "message": "The tutor couldn't generate a reply — please try again.", "recoverable": True})
            await send({"type": "turn_end", "message_id": None, "full_text": ""})
            return

        msg = await chat_service.add_message(db, chat_id, "assistant", clean)
        message_id = msg.id

        try:
            from app.services.user_service import get_user_by_id
            from app.services import gamification_service

            fresh_user = await get_user_by_id(db, user_id)
            if fresh_user:
                await credit_service.check_and_deduct_credit(db, fresh_user)
                await send({"type": "credits", "value": float(fresh_user.credits)})
                try:
                    await gamification_service.award_xp(db, user_id, 5, "chat_message")
                    await gamification_service.check_and_update_streak(db, user_id)
                except Exception:
                    pass
        except Exception:
            logger.warning("Credit/XP update failed for user %s", user_id)

        await db.commit()

    await send({"type": "turn_end", "message_id": message_id, "full_text": clean})


# ── Typed message handlers ────────────────────────────────────────────────────

async def _handle_user_message(send, chat_id: int, user_id: int, data: dict) -> None:
    text = (data.get("text") or "").strip()
    image_b64 = data.get("image_b64")
    if not text and not image_b64:
        return
    research = bool(data.get("research"))
    saved = text if text else "(shared an image)"
    if research and text:
        ai = _RESEARCH_PREFIX + text
    else:
        ai = text or "Please look at the attached image and help me understand it."
    await _run_turn(
        send, chat_id, user_id,
        saved_user_text=saved,
        ai_content=ai,
        image_b64=image_b64,
        image_mime=data.get("image_mime") or "image/jpeg",
        tts=bool(data.get("tts", True)),
    )


async def _handle_quiz_result(send, chat_id: int, user_id: int, data: dict) -> None:
    quiz_ctx = _build_quiz_ctx(
        data.get("topic", "the quiz"),
        float(data.get("score", 0) or 0),
        data.get("strong", []) or [],
        data.get("weak", []) or [],
    )
    await _run_turn(
        send, chat_id, user_id,
        saved_user_text=None,        # quiz context is not a visible user message
        ai_content=quiz_ctx,
        tts=bool(data.get("tts", True)),
    )


async def _handle_user_audio(send, chat_id: int, user_id: int, data: dict) -> None:
    """Custom voice loop: transcribe the recorded utterance, then run a normal turn."""
    audio_b64 = data.get("audio_b64")
    if not audio_b64:
        return
    mime = data.get("mime") or "audio/webm"
    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        await send({"type": "error", "message": "Bad audio data.", "recoverable": True})
        await send({"type": "turn_end", "message_id": None, "full_text": ""})
        return

    from app.services.voice_service import speech_to_text

    ext = (mime.split("/")[-1] or "webm").split(";")[0]
    transcript = await asyncio.to_thread(speech_to_text, audio_bytes, f"audio.{ext}")
    if not transcript:
        await send({"type": "error", "message": "Sorry, I couldn't hear that — please try again.", "recoverable": True})
        await send({"type": "turn_end", "message_id": None, "full_text": ""})
        return

    await send({"type": "user_transcript", "text": transcript})
    await _run_turn(
        send, chat_id, user_id,
        saved_user_text=transcript,
        ai_content=transcript,
        tts=bool(data.get("tts", True)),
    )


async def _guard_turn(send, coro) -> None:
    """Run a turn under a hard timeout so the socket can never get stuck."""
    try:
        await asyncio.wait_for(coro, timeout=_TURN_TIMEOUT_S)
    except asyncio.TimeoutError:
        await send({"type": "error", "message": "The tutor took too long — please try again.", "recoverable": True})
        await send({"type": "turn_end", "message_id": None, "full_text": ""})
    except Exception as e:  # noqa: BLE001
        logger.error("Session turn failed: %s", e, exc_info=True)
        await send({"type": "error", "message": "Something went wrong — please try again.", "recoverable": True})
        await send({"type": "turn_end", "message_id": None, "full_text": ""})


@router.websocket("/ws")
async def session_ws(websocket: WebSocket):
    await websocket.accept()

    token = websocket.query_params.get("token")
    appt_str = websocket.query_params.get("appointment_id")
    session_id_q = websocket.query_params.get("session_id")
    appt_id = int(appt_str) if appt_str and appt_str.isdigit() else None

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
        await websocket.close(code=4003, reason="Only students can use the session")
        return

    # Dedup: close any stale socket for this user.
    existing = _active_ws.get(user_id)
    if existing is not None and existing is not websocket:
        try:
            await existing.close(code=4000, reason="Replaced by new session")
        except Exception:
            pass
    _active_ws[user_id] = websocket

    async def send(d: dict) -> None:
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_json(d)
        except Exception:
            pass

    try:
        # Resolve (or create) the session chat once at connect.
        async with async_session_factory() as db:
            chat = None
            if session_id_q:
                chat = await chat_service.get_chat_by_session(db, session_id_q, user_id)
            if not chat and appt_id:
                chat = await chat_service.get_or_create_session_chat(db, user_id, appt_id)
                await db.commit()
            if not chat:
                await send({"type": "error", "message": "Session not found.", "recoverable": False})
                await websocket.close(code=4004)
                return
            chat_id = chat.id
            chat_session_id = chat.session_id

        await send({"type": "ready", "session_id": chat_session_id})
        logger.info("Session WS ready: user=%s chat=%s appt=%s", user_id, chat_id, appt_id)

        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            except Exception:
                break

            mtype = data.get("type")
            if mtype == "ping":
                await send({"type": "pong"})
            elif mtype == "stop":
                continue  # inline turn model — input is disabled client-side during a turn
            elif mtype == "user_message":
                await _guard_turn(send, _handle_user_message(send, chat_id, user_id, data))
            elif mtype == "quiz_result":
                await _guard_turn(send, _handle_quiz_result(send, chat_id, user_id, data))
            elif mtype == "user_audio":
                await _guard_turn(send, _handle_user_audio(send, chat_id, user_id, data))

    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.error("Session WS error: %s", e, exc_info=True)
    finally:
        if _active_ws.get(user_id) is websocket:
            del _active_ws[user_id]
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close()
        except Exception:
            pass
        logger.info("Session WS closed: user=%s", user_id)
