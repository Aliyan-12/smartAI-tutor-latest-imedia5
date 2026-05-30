import io as _io
import logging
import struct
import tempfile
import os
from typing import Optional

import numpy as np
import soundfile as sf
from kokoro import KPipeline

from google import genai
from google.genai import types

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Gemini client — still used by speech_to_text() and voice_converse()
# ---------------------------------------------------------------------------

_client = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


# ---------------------------------------------------------------------------
# Kokoro TTS — replaces Gemini TTS
# ---------------------------------------------------------------------------

_kokoro: Optional[KPipeline] = None

# Voice: af_sky — energetic, bright, expressive American English
# lang_code MUST match voice prefix: "a" for af_*/am_*, "b" for bf_*/bm_*
TTS_VOICE = "af_sky"
TTS_SPEED = 1.05


def _get_kokoro() -> KPipeline:
    """Lazy-init the Kokoro pipeline (American English, af_sky voice — energetic and natural)."""
    global _kokoro
    if _kokoro is None:
        logger.info("Initialising Kokoro TTS pipeline (lang_code='a', voice=af_sky)...")
        _kokoro = KPipeline(lang_code="a")   # "a" = American English (af_sky is the most expressive)
        logger.info("Kokoro TTS pipeline ready.")
    return _kokoro


import re as _re

def _prep_tts_text(text: str) -> str:
    """
    Clean and prepare text for natural, energetic TTS delivery.
    - Strip markdown symbols Kokoro would pronounce literally
    - Normalise whitespace
    - Keep punctuation that drives prosody (! ? , .)
    """
    # Strip bold/italic markers
    text = _re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    # Strip headers
    text = _re.sub(r'^#{1,6}\s+', '', text, flags=_re.MULTILINE)
    # Strip inline code ticks
    text = _re.sub(r'`+([^`]+)`+', r'\1', text)
    # Strip bullet dashes/asterisks at line start
    text = _re.sub(r'^\s*[-*•]\s+', '', text, flags=_re.MULTILINE)
    # Collapse multiple newlines to a single pause (period)
    text = _re.sub(r'\n{2,}', '. ', text)
    text = _re.sub(r'\n', ' ', text)
    # Remove leftover bracket markers
    text = _re.sub(r'\[[A-Z_:][^\]]*\]', '', text)
    # Collapse multiple spaces
    text = _re.sub(r' {2,}', ' ', text)
    return text.strip()


def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 24000, num_channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """Convert raw PCM bytes to a WAV file (kept for speech_to_text / voice_converse callers)."""
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
    """
    Convert text to speech using Kokoro (af_sky — energetic, expressive, natural).
    Returns (wav_bytes, "audio/wav") — identical return type to the previous implementation.
    """
    clean = _prep_tts_text(text)
    if not clean or clean.startswith("[Error"):
        raise ValueError("Cannot generate speech for empty or error text")

    pipeline = _get_kokoro()
    # af_sky: young, bright, expressive — most energetic Kokoro voice
    # speed=1.05 adds natural energy without sounding rushed
    chunks = [audio for _, _, audio in pipeline(clean, voice=TTS_VOICE, speed=TTS_SPEED)]
    if not chunks:
        raise ValueError("Kokoro returned no audio for the provided text")

    buf = _io.BytesIO()
    sf.write(buf, np.concatenate(chunks).astype(np.float32), samplerate=24000, format="WAV")
    return buf.getvalue(), "audio/wav"


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
