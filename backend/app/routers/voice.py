import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user
from app.models.user import User
from app.services.voice_service import text_to_speech, speech_to_text

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
