import io
import logging
import tempfile
import os
from typing import Optional

from gtts import gTTS

logger = logging.getLogger(__name__)


def text_to_speech(text: str, lang: str = "en") -> bytes:
    tts = gTTS(text=text, lang=lang, slow=False)
    buffer = io.BytesIO()
    tts.write_to_fp(buffer)
    buffer.seek(0)
    return buffer.read()


def speech_to_text(audio_bytes: bytes, filename: str = "audio.webm") -> Optional[str]:
    try:
        import whisper

        model = whisper.load_model("base")
        suffix = os.path.splitext(filename)[1] or ".webm"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        result = model.transcribe(tmp_path)
        os.unlink(tmp_path)
        return result.get("text", "").strip()

    except ImportError:
        logger.warning("Whisper not installed, using fallback STT stub")
        return _fallback_stt(audio_bytes, filename)
    except Exception as e:
        logger.error(f"STT processing error: {e}")
        return None


def _fallback_stt(audio_bytes: bytes, filename: str) -> Optional[str]:
    logger.info(f"Received {len(audio_bytes)} bytes of audio ({filename}), STT unavailable")
    return None
