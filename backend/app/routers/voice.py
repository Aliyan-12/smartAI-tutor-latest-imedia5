import asyncio
import base64
import json
import logging

from fastapi import APIRouter, HTTPException, Depends, status, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketState

from app.core.security import decode_access_token
from app.core.config import settings
from app.middleware.auth import get_current_user
from app.models.user import User, ROLE_STUDENT
from app.services.voice_service import text_to_speech
from app.services import chat_service, credit_service
from app.services.gemini_service import SYSTEM_PROMPT
from app.db.session import async_session_factory

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])

LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    lang: str = Field(default="en", max_length=10)


@router.post("/speak")
async def speak(
    payload: TTSRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        audio_data = text_to_speech(payload.text, payload.lang)
        return Response(content=audio_data, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TTS failed")


async def _send_safe(ws: WebSocket, data: dict):
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.send_json(data)
    except Exception:
        pass


@router.websocket("/ws")
async def voice_websocket(websocket: WebSocket):
    await websocket.accept()

    token = websocket.query_params.get("token")
    session_id = websocket.query_params.get("session_id")

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
        await websocket.close(code=4003, reason="Only students can use voice")
        return

    chat_id_local = None
    async with async_session_factory() as db:
        from app.services.user_service import get_user_by_id
        user = await get_user_by_id(db, user_id)
        if not user or not user.has_credits:
            await _send_safe(websocket, {"type": "error", "content": "Insufficient credits"})
            await websocket.close(code=4002)
            return

        if session_id:
            chat = await chat_service.get_chat_by_session(db, session_id, user_id)
        else:
            chat = None

        if not chat:
            chat = await chat_service.create_chat(db, user_id)
            session_id = chat.session_id
            await db.commit()
            await _send_safe(websocket, {"type": "session", "content": session_id})

        chat_id_local = chat.id
        session_id = chat.session_id  # ensure we have the actual session_id
        history, _ = await chat_service.build_context(db, chat.id)

    system_text = SYSTEM_PROMPT
    if history:
        lines = []
        for msg in history[-10:]:
            label = "Student" if msg["role"] == "user" else "Tutor"
            lines.append(f"{label}: {msg['content']}")
        if lines:
            system_text += "\n\nPrevious conversation:\n" + "\n".join(lines)

    live_config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")
            ),
        ),
        system_instruction=types.Content(parts=[types.Part(text=system_text)]),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    client = genai.Client(api_key=settings.gemini_api_key)
    stop_event = asyncio.Event()

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=live_config) as gemini_session:
            await _send_safe(websocket, {"type": "status", "content": "connected"})
            logger.info(f"Voice live session started for user {user_id}")

            user_transcript_accum = ""
            ai_transcript_accum = ""

            async def browser_to_gemini():
                nonlocal user_transcript_accum, ai_transcript_accum
                try:
                    while not stop_event.is_set():
                        msg = await websocket.receive()

                        if msg.get("type") == "websocket.disconnect":
                            stop_event.set()
                            return

                        raw_bytes = msg.get("bytes")
                        raw_text = msg.get("text")

                        if raw_bytes:
                            await gemini_session.send_realtime_input(
                                audio=types.Blob(data=raw_bytes, mime_type="audio/pcm;rate=16000")
                            )
                        elif raw_text:
                            try:
                                data = json.loads(raw_text)
                                if data.get("type") == "stop":
                                    stop_event.set()
                                    return
                            except json.JSONDecodeError:
                                pass
                except WebSocketDisconnect:
                    stop_event.set()
                except Exception as e:
                    if not stop_event.is_set():
                        logger.error(f"browser_to_gemini error: {e}")
                    stop_event.set()

            async def gemini_to_browser():
                nonlocal user_transcript_accum, ai_transcript_accum, chat_id_local, session_id
                try:
                    while not stop_event.is_set():
                        try:
                            response = await asyncio.wait_for(
                                gemini_session.receive().__anext__(), timeout=120
                            )
                        except StopAsyncIteration:
                            continue
                        except asyncio.TimeoutError:
                            continue

                        sc = response.server_content
                        if not sc:
                            continue

                        if sc.model_turn and sc.model_turn.parts:
                            for part in sc.model_turn.parts:
                                if part.inline_data and isinstance(part.inline_data.data, bytes):
                                    b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                                    await _send_safe(websocket, {"type": "audio", "content": b64})

                        if sc.input_transcription and sc.input_transcription.text:
                            chunk = sc.input_transcription.text
                            user_transcript_accum += chunk
                            await _send_safe(websocket, {"type": "user_transcript", "content": chunk})

                        if sc.output_transcription and sc.output_transcription.text:
                            chunk = sc.output_transcription.text
                            ai_transcript_accum += chunk
                            await _send_safe(websocket, {"type": "ai_transcript", "content": chunk})

                        if sc.turn_complete:
                            await _send_safe(websocket, {"type": "turn_complete"})

                            user_text = user_transcript_accum.strip()
                            ai_text = ai_transcript_accum.strip()
                            user_transcript_accum = ""
                            ai_transcript_accum = ""

                            if user_text or ai_text:
                                try:
                                    async with async_session_factory() as db:
                                        chat = await chat_service.get_chat_by_session(db, session_id, user_id)
                                        if not chat:
                                            chat = await chat_service.create_chat(db, user_id)
                                            chat_id_local = chat.id
                                            session_id = chat.session_id
                                            await _send_safe(websocket, {"type": "session", "content": chat.session_id})

                                        if user_text:
                                            await chat_service.add_message(db, chat.id, "user", user_text)
                                        if ai_text:
                                            await chat_service.add_message(db, chat.id, "assistant", ai_text)

                                        from app.services.user_service import get_user_by_id
                                        fresh_user = await get_user_by_id(db, user_id)
                                        if fresh_user:
                                            await credit_service.check_and_deduct_credit(db, fresh_user)
                                            await _send_safe(websocket, {"type": "credits", "content": str(float(fresh_user.credits))})

                                        if chat.title == "New Chat" and user_text:
                                            from app.services.gemini_service import generate_chat_title
                                            title = generate_chat_title(user_text)
                                            await chat_service.update_chat_title(db, chat, title)
                                            await _send_safe(websocket, {"type": "title", "content": title})

                                        await db.commit()
                                except Exception as db_err:
                                    logger.error(f"DB save error: {db_err}")

                        if sc.interrupted:
                            await _send_safe(websocket, {"type": "interrupted"})
                            ai_transcript_accum = ""

                except Exception as e:
                    if not stop_event.is_set():
                        logger.error(f"gemini_to_browser error: {e}")
                        await _send_safe(websocket, {"type": "error", "content": "Voice AI session ended"})
                    stop_event.set()

            tasks = [
                asyncio.create_task(browser_to_gemini()),
                asyncio.create_task(gemini_to_browser()),
            ]

            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            stop_event.set()

            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    except WebSocketDisconnect:
        logger.info(f"Voice WS disconnected for user {user_id}")
    except Exception as e:
        logger.error(f"Voice WS error: {e}")
        await _send_safe(websocket, {"type": "error", "content": f"Connection error: {str(e)[:100]}"})

    try:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close()
    except Exception:
        pass

    logger.info(f"Voice session ended for user {user_id}")
