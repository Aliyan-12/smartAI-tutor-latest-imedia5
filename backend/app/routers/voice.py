import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, async_session_factory
from app.middleware.auth import get_current_user
from app.models.user import User, ROLE_STUDENT
from app.services.voice_service import text_to_speech, speech_to_text
from app.services import chat_service, gemini_service, credit_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    lang: str = Field(default="en", max_length=10)


class VoiceMessageRequest(BaseModel):
    session_id: Optional[str] = None


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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate speech audio",
        )


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Audio file too large (max 10MB)",
        )

    audio_bytes = await file.read()
    text = speech_to_text(audio_bytes, file.filename or "audio.webm")

    if text is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not transcribe audio. Ensure Whisper is installed or try again.",
        )

    return {"text": text}


@router.post("/{session_id}/send")
async def voice_send(
    session_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Transcribe audio, send to AI within the given chat session, return streamed text + TTS audio."""
    if current_user.role != ROLE_STUDENT:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Students only")
    if not current_user.has_credits:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Insufficient credits")

    audio_bytes = await file.read()
    transcribed = speech_to_text(audio_bytes, file.filename or "audio.webm")
    if not transcribed:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Could not transcribe audio")

    chat = await chat_service.get_chat_by_session(db, session_id, current_user.id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")

    await chat_service.add_message(db, chat.id, "user", transcribed)
    history = await chat_service.build_context(db, chat.id)

    ai_text = gemini_service.generate_response(history[:-1], transcribed)

    await chat_service.add_message(db, chat.id, "assistant", ai_text)
    await credit_service.check_and_deduct_credit(db, current_user)

    try:
        audio_data = text_to_speech(ai_text)
    except Exception:
        audio_data = None

    return {
        "transcribed_text": transcribed,
        "response_text": ai_text,
        "session_id": session_id,
        "credits": float(current_user.credits),
        "has_audio": audio_data is not None,
    }


@router.post("/{session_id}/speak-response")
async def speak_last_response(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get TTS audio for the last assistant message in a chat session."""
    chat = await chat_service.get_chat_by_session(db, session_id, current_user.id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")

    assistant_messages = [m for m in chat.messages if m.role == "assistant"]
    if not assistant_messages:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No assistant response found")

    last_msg = assistant_messages[-1]
    try:
        audio_data = text_to_speech(last_msg.content)
        return Response(content=audio_data, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TTS failed")
