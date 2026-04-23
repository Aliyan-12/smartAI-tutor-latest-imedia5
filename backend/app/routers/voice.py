"""
Voice router — WebSocket transport for Gemini Live voice sessions and TTS.

This file contains only I/O orchestration: auth, WebSocket lifecycle,
audio forwarding, and transcript routing. All business logic lives in
app.services.voice_agent_service.
"""
import asyncio
import base64
import json
import logging
import traceback as _traceback

from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketState

from google import genai
from google.genai import types

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.session import async_session_factory
from app.middleware.auth import get_current_user
from app.models.user import User, ROLE_STUDENT
from app.services import chat_service, voice_agent_service
from app.services.voice_service import text_to_speech

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TTS failed"
        )


async def _send_safe(ws: WebSocket, data: dict) -> None:
    """Send JSON to browser, silently dropping errors if the WS is already closed."""
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
    appointment_id_str = websocket.query_params.get("appointment_id")
    appointment_id = (
        int(appointment_id_str)
        if appointment_id_str and appointment_id_str.isdigit()
        else None
    )

    # ── Auth ──────────────────────────────────────────────────────────────────
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

    async def send(data: dict) -> None:
        await _send_safe(websocket, data)

    print(f"[VOICE DEBUG] connection: user={user_id} appointment={appointment_id}")

    try:
        # ── Load chat session + full history for context sync ────────────────
        async with async_session_factory() as db:
            from app.services.user_service import get_user_by_id

            user = await get_user_by_id(db, user_id)
            if not user:
                await send({"type": "error", "content": "User not found"})
                await websocket.close(code=4002)
                return
            # Credits check disabled — voice follows the same policy as text chat
            # if not user.has_credits:
            #     await send({"type": "error", "content": "Insufficient credits"})
            #     await websocket.close(code=4002)
            #     return

            chat = (
                await chat_service.get_chat_by_session(db, session_id, user_id)
                if session_id
                else None
            )
            if not chat:
                chat = await chat_service.create_chat(db, user_id)
                session_id = chat.session_id
                await db.commit()
                await send({"type": "session", "content": session_id})

            session_id = chat.session_id
            history, _ = await chat_service.build_context(db, chat.id)

        # ── Build system prompt + Gemini Live config (via service) ──────────
        system_text, appt_subject, appt_key_stage = (
            await voice_agent_service.build_voice_system_prompt(appointment_id, user_id)
        )
        live_config = voice_agent_service.make_live_config(system_text)

        client = genai.Client(api_key=settings.gemini_api_key)
        stop_event = asyncio.Event()

        async with client.aio.live.connect(
            model=voice_agent_service.LIVE_MODEL, config=live_config
        ) as gemini_session:
            await send({"type": "status", "content": "connected"})
            logger.info(
                f"Voice live session started: user={user_id}, "
                f"appointment={appointment_id}, history={len(history)} msgs"
            )

            await voice_agent_service.seed_chat_history(gemini_session, history)

            user_transcript_accum = ""
            ai_transcript_accum = ""

            # ── browser → Gemini Live (audio forwarding) ──────────────────────
            async def browser_to_gemini():
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
                                audio=types.Blob(
                                    data=raw_bytes, mime_type="audio/pcm;rate=16000"
                                )
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

            # ── Gemini Live → browser (response routing) ──────────────────────
            async def gemini_to_browser():
                nonlocal user_transcript_accum, ai_transcript_accum, session_id
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

                        # Tool calls → service handles offer_quiz
                        if hasattr(response, "tool_call") and response.tool_call:
                            fn_responses = await voice_agent_service.handle_tool_calls(
                                response.tool_call, send
                            )
                            if fn_responses:
                                try:
                                    await gemini_session.send_tool_response(
                                        function_responses=fn_responses
                                    )
                                except Exception as te:
                                    logger.warning(f"Tool response send error: {te}")
                            continue

                        sc = response.server_content
                        if not sc:
                            continue

                        # Audio chunks
                        if sc.model_turn and sc.model_turn.parts:
                            for part in sc.model_turn.parts:
                                if part.inline_data and isinstance(
                                    part.inline_data.data, bytes
                                ):
                                    b64 = base64.b64encode(part.inline_data.data).decode()
                                    await send({"type": "audio", "content": b64})

                        # Transcriptions
                        if sc.input_transcription and sc.input_transcription.text:
                            chunk = sc.input_transcription.text
                            user_transcript_accum += chunk
                            await send({"type": "user_transcript", "content": chunk})

                        if sc.output_transcription and sc.output_transcription.text:
                            chunk = sc.output_transcription.text
                            ai_transcript_accum += chunk
                            await send({"type": "ai_transcript", "content": chunk})

                        # Turn complete → persist, then signal frontend to reload
                        if sc.turn_complete:
                            await send({"type": "turn_complete"})

                            user_text = user_transcript_accum.strip()
                            ai_text = ai_transcript_accum.strip()
                            user_transcript_accum = ""
                            ai_transcript_accum = ""

                            if user_text or ai_text:
                                session_id, _ = await voice_agent_service.save_voice_turn(
                                    session_id, user_id, user_text, ai_text, send
                                )
                                # Signal frontend: DB committed, safe to reload messages
                                await send({"type": "turn_saved"})

                            if user_text:
                                await voice_agent_service.inject_per_turn_rag(
                                    gemini_session, user_text, appt_subject, appt_key_stage
                                )

                        if sc.interrupted:
                            await send({"type": "interrupted"})
                            ai_transcript_accum = ""

                except Exception as e:
                    if not stop_event.is_set():
                        logger.error(f"gemini_to_browser error: {e}")
                        await send({"type": "error", "content": "Voice AI session ended"})
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
        print(f"[VOICE ERROR] user={user_id} appointment={appointment_id}: {type(e).__name__}: {e}")
        _traceback.print_exc()
        logger.error(f"Voice WS error: {type(e).__name__}: {e}", exc_info=True)
        await send({"type": "error", "content": f"Voice error: {type(e).__name__}: {str(e)[:300]}"})

    try:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close()
    except Exception:
        pass

    logger.info(f"Voice session ended for user {user_id}")
