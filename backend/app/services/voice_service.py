import io
import logging
import tempfile
import os
from typing import Optional

from google import genai
from google.genai import types
from gtts import gTTS

from app.core.config import settings

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def text_to_speech(text: str, lang: str = "en") -> bytes:
    clean_text = text.strip()
    if not clean_text or clean_text.startswith("[Error"):
        raise ValueError("Cannot generate speech for empty or error text")
    tts = gTTS(text=clean_text, lang=lang, slow=False)
    buffer = io.BytesIO()
    tts.write_to_fp(buffer)
    buffer.seek(0)
    return buffer.read()


def speech_to_text(audio_bytes: bytes, filename: str = "audio.webm") -> Optional[str]:
    try:
        client = _get_client()
        suffix = os.path.splitext(filename)[1] or ".webm"
        mime_map = {
            ".webm": "audio/webm",
            ".ogg": "audio/ogg",
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
            ".mp4": "audio/mp4",
        }
        mime_type = mime_map.get(suffix.lower(), "audio/webm")

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        uploaded = client.files.upload(file=tmp_path, config={"mime_type": mime_type})

        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_uri(file_uri=uploaded.uri, mime_type=mime_type),
                        types.Part(text="Transcribe this audio exactly as spoken. Return only the transcribed text, nothing else. If the audio is empty or unclear, return an empty string."),
                    ],
                )
            ],
        )

        os.unlink(tmp_path)

        transcribed = response.text.strip()
        if not transcribed:
            return None
        return transcribed

    except Exception as e:
        logger.error(f"Gemini STT error: {e}")
        return None


def voice_converse(audio_bytes: bytes, history: list, filename: str = "audio.webm") -> dict:
    transcribed = speech_to_text(audio_bytes, filename)
    if not transcribed:
        return {"error": "Could not understand the audio. Please try again or type your message."}

    try:
        from app.services.gemini_service import SYSTEM_PROMPT
        client = _get_client()

        contents = []
        for msg in history:
            role = "user" if msg["role"] == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part(text=msg["content"])]))
        contents.append(types.Content(role="user", parts=[types.Part(text=transcribed)]))

        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
        )

        ai_text = response.text

        try:
            tts_audio = text_to_speech(ai_text)
        except Exception as tts_err:
            logger.warning(f"TTS failed: {tts_err}")
            tts_audio = None

        return {
            "transcribed": transcribed,
            "response": ai_text,
            "audio": tts_audio,
        }

    except Exception as e:
        logger.error(f"Voice converse error: {e}")
        return {
            "transcribed": transcribed,
            "response": None,
            "error": "AI response failed. Your question was: " + transcribed,
        }
