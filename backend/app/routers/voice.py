"""
Voice router — text-to-speech only.

The real-time Gemini Live socket and the thinking-filler endpoints have been
removed. Voice now runs through the unified chat/session WebSocket pipeline
(STT in → turn → segment-bundled Kokoro TTS out). This router only exposes the
one-shot `/speak` endpoint used by the "Read aloud" buttons.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user
from app.models.user import User
from app.services.voice_agent_service import text_to_speech

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
        audio_data, mime_type = text_to_speech(payload.text, payload.lang)
        return Response(content=audio_data, media_type=mime_type)
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TTS failed"
        )
