import io
import logging
import struct
import tempfile
import os
from typing import Optional

from google import genai
from google.genai import types
from gtts import gTTS

from app.core.config import settings

logger = logging.getLogger(__name__)

_client = None

TTS_MODEL = "gemini-2.5-flash-preview-tts"


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 24000, num_channels: int = 1, bits_per_sample: int = 16) -> bytes:
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
    clean_text = text.strip()
    if not clean_text or clean_text.startswith("[Error"):
        raise ValueError("Cannot generate speech for empty or error text")
    try:
        client = _get_client()
        response = client.models.generate_content(
            model=TTS_MODEL,
            contents=types.Content(
                parts=[types.Part(text=clean_text)],
                role="user",
            ),
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")
                    )
                ),
            ),
        )
        pcm = response.candidates[0].content.parts[0].inline_data.data
        return _pcm_to_wav(pcm), "audio/wav"
    except Exception as e:
        logger.warning(f"Gemini TTS failed, falling back to gTTS: {e}")
        tts = gTTS(text=clean_text, lang=lang, slow=False)
        buf = io.BytesIO()
        tts.write_to_fp(buf)
        buf.seek(0)
        return buf.read(), "audio/mpeg"


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
