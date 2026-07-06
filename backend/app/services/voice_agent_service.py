"""
Voice audio service — Kokoro TTS + Gemini STT.

Low-level audio helpers shared by the chat/session WebSocket pipelines and the
`/api/voice/speak` endpoint. The real-time Gemini Live path (system-prompt
assembly, live config, history seeding, tool-call handling, per-turn RAG
injection) has been removed — voice now runs through the unified turn pipeline
(STT in → turn → segment-bundled Kokoro TTS out).
"""
import io as _io
import logging
import os
import re as _re
import struct
import tempfile
from typing import Optional

import numpy as np
import soundfile as sf
from kokoro import KPipeline
from google import genai
from google.genai import types

from app.core.config import settings
from app.services.gemini_service import SYSTEM_PROMPT

logger = logging.getLogger(__name__)


# ===========================================================================
# Low-level audio: Kokoro TTS + Gemini STT
# ===========================================================================

_client = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


_kokoro: Optional[KPipeline] = None

# Voice: af_heart — warm, soft, friendly American English (sounds more like a
# patient teacher than the brighter/peppier af_sky). A slightly slower speed gives
# a calmer, more deliberate teacherly pace. Kokoro has no style/SSML prompt, so the
# only warmth levers are the voice, the speed, and prosody-friendly text shaping
# (see _prep_tts_text, which keeps commas/dashes/ellipses as natural pauses).
# lang_code MUST match the voice prefix: "a" for af_*/am_*, "b" for bf_*/bm_*.
TTS_VOICE = "af_heart"
TTS_SPEED = 0.95


def _get_kokoro() -> KPipeline:
    """Lazy-init the Kokoro pipeline (American English; warm af_heart voice)."""
    global _kokoro
    if _kokoro is None:
        logger.info(
            "Initialising Kokoro TTS pipeline (lang_code='a', voice=%s, speed=%s)...",
            TTS_VOICE, TTS_SPEED,
        )
        _kokoro = KPipeline(lang_code="a")
        logger.info("Kokoro TTS pipeline ready.")
    return _kokoro


def _prep_tts_text(text: str) -> str:
    """Strip markdown Kokoro would read literally, but KEEP prosody punctuation
    (commas, em-dashes, ellipses) so phrasing sounds natural, and turn line/paragraph
    breaks into spoken pauses rather than a flat run-on — so the voice sounds like a
    teacher pausing between points, not reading a wall of text."""
    text = _re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)          # **bold** / *italic*
    text = _re.sub(r'^#{1,6}\s+', '', text, flags=_re.MULTILINE)    # # headings
    text = _re.sub(r'`+([^`]+)`+', r'\1', text)                     # `code`
    text = _re.sub(r'^\s*[-*•]\s+', '', text, flags=_re.MULTILINE)  # bullet markers
    text = _re.sub(r'\[[A-Z_:][^\]]*\]', '', text)                 # [MARKER] control tags
    # Breaks → pauses: a blank line is a full stop; a single line break is a short pause.
    text = _re.sub(r'\n{2,}', '. ', text)
    text = _re.sub(r'\n', ', ', text)
    # Collapse any punctuation pile-ups the joins created (". , ", ", . ", ". . ")
    # into the strongest single pause.
    text = _re.sub(r'(?:\s*[.,]\s*){2,}', lambda m: '. ' if '.' in m.group(0) else ', ', text)
    text = _re.sub(r' {2,}', ' ', text)
    return text.strip()


def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 24000, num_channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """Convert raw PCM bytes to a WAV file (kept for STT / voice_converse callers)."""
    data_size = len(pcm_data)
    header = struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF', 36 + data_size, b'WAVE',
        b'fmt ', 16, 1, num_channels, sample_rate,
        sample_rate * num_channels * bits_per_sample // 8,
        num_channels * bits_per_sample // 8, bits_per_sample,
        b'data', data_size,
    )
    return header + pcm_data


def text_to_speech(text: str, lang: str = "en") -> tuple[bytes, str]:
    """Kokoro TTS (af_sky). Returns (wav_bytes, "audio/wav")."""
    clean = _prep_tts_text(text)
    if not clean or clean.startswith("[Error"):
        raise ValueError("Cannot generate speech for empty or error text")

    pipeline = _get_kokoro()
    chunks = [audio for _, _, audio in pipeline(clean, voice=TTS_VOICE, speed=TTS_SPEED)]
    if not chunks:
        raise ValueError("Kokoro returned no audio for the provided text")

    buf = _io.BytesIO()
    sf.write(buf, np.concatenate(chunks).astype(np.float32), samplerate=24000, format="WAV")
    return buf.getvalue(), "audio/wav"


async def synth_speak_frame(text: str, req_id: str = "") -> dict:
    """One-shot TTS for a WS `speak` request → a `{type:"tts_audio"}` frame with the clip
    base64-encoded. ALL text-to-speech now goes through the WebSocket channel (the
    /api/voice/speak REST endpoint is gone); the client plays this frame directly. Never
    raises — on failure returns a null-audio frame so the caller's UI just stays silent."""
    import asyncio as _asyncio
    import base64 as _base64
    clean = (text or "").strip()
    if not clean:
        return {"type": "tts_audio", "id": req_id, "audio_b64": None}
    try:
        wav, mime = await _asyncio.to_thread(text_to_speech, clean)
        return {
            "type": "tts_audio", "id": req_id,
            "audio_b64": _base64.b64encode(wav).decode("ascii"), "mime": mime,
        }
    except Exception as e:  # noqa: BLE001
        logger.warning("WS speak TTS failed: %s", e)
        return {"type": "tts_audio", "id": req_id, "audio_b64": None, "error": "tts_failed"}


def speech_to_text(audio_bytes: bytes, filename: str = "audio.webm") -> Optional[str]:
    try:
        client = _get_client()
        suffix = os.path.splitext(filename)[1] or ".webm"
        mime_map = {
            ".webm": "audio/webm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
            ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp4": "audio/mp4",
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
        return transcribed or None
    except Exception as e:
        logger.error(f"Gemini STT error: {e}")
        return None


def voice_converse(audio_bytes: bytes, history: list, filename: str = "audio.webm") -> dict:
    transcribed = speech_to_text(audio_bytes, filename)
    if not transcribed:
        return {"error": "Could not understand the audio. Please try again or type your message."}

    try:
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

        return {"transcribed": transcribed, "response": ai_text, "audio": tts_audio}
    except Exception as e:
        logger.error(f"Voice converse error: {e}")
        return {"transcribed": transcribed, "response": None, "error": "AI response failed. Your question was: " + transcribed}
