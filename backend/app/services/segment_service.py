"""
segment_service.py — streaming sentence segmenter + per-segment TTS bundling.

The session chat pipeline streams the LLM response as ordered *segments*
(roughly one sentence each). For each segment we optionally generate its Kokoro
TTS audio and measure its duration, so the frontend can reveal the segment's
text in exact lockstep with its audio. The segment is the unit of synchronisation
for the whole session pipeline (replaces the old client-side paragraph buffering).
"""
import asyncio
import base64
import io
import logging
import os
import re

import soundfile as sf

from app.services.voice_service import text_to_speech

logger = logging.getLogger(__name__)

# Bound concurrent Kokoro inferences across all sessions (avoid CPU oversubscription).
_TTS_MAX_CONCURRENCY = int(os.getenv("TTS_MAX_CONCURRENCY", "4"))
_tts_semaphore = asyncio.Semaphore(_TTS_MAX_CONCURRENCY)

# Segment sizing: aim for ~one sentence; never exceed this many chars before a forced cut.
_MAX_SEGMENT_CHARS = 240
_MIN_TTS_CHARS = 3

_SENT_END = re.compile(r"[.!?]")
_DISPLAY_MARKER = re.compile(r"\[(QUIZ_OFFER|SLIDE_TRIGGER|TOOL_RESULT)[^\]]*\]")


def strip_display_markers(text: str) -> str:
    """Remove internal bracket markers so they never appear in the chat bubble."""
    return _DISPLAY_MARKER.sub("", text)


class SentenceSegmenter:
    """Accumulates streamed text and emits complete segments (~sentences)."""

    def __init__(self, max_chars: int = _MAX_SEGMENT_CHARS):
        self._buf = ""
        self._max = max_chars

    def feed(self, text: str) -> list[str]:
        """Add streamed text; return any complete segments now available."""
        self._buf += text
        out: list[str] = []
        while True:
            seg = self._take()
            if seg is None:
                break
            if seg:
                out.append(seg)
        return out

    def flush(self) -> str | None:
        """Return whatever remains (call once at stream end)."""
        seg = self._buf.strip()
        self._buf = ""
        return seg or None

    def _take(self) -> str | None:
        buf = self._buf

        # Priority 1: paragraph break.
        para = buf.find("\n\n")
        if para != -1:
            seg = buf[:para].strip()
            self._buf = buf[para + 2:].lstrip()
            return seg

        # Priority 2: sentence end followed by whitespace/end-of-buffer.
        for m in _SENT_END.finditer(buf):
            i = m.end()
            if i >= len(buf):
                break  # punctuation at the very end — wait for more (could be mid-number)
            if buf[i] in " \n\t":
                seg = buf[:i].strip()
                self._buf = buf[i:].lstrip()
                return seg

        # Priority 3: overflow — cut at the last space before the limit.
        if len(buf) >= self._max:
            cut = buf.rfind(" ", 0, self._max)
            if cut <= 0:
                cut = self._max
            seg = buf[:cut].strip()
            self._buf = buf[cut:].lstrip()
            return seg

        return None


def _wav_duration_ms(wav: bytes) -> int:
    try:
        with sf.SoundFile(io.BytesIO(wav)) as f:
            return int(round(len(f) / float(f.samplerate) * 1000))
    except Exception:
        return 0


async def build_segment(text: str, seq: int, tts: bool) -> dict:
    """
    Build a {type:"segment"} payload: cleaned display text + optional bundled audio.
    TTS runs off the event loop and is bounded by the global semaphore.
    """
    display = strip_display_markers(text).strip()
    audio_b64 = None
    duration_ms = None

    if tts and len(display) >= _MIN_TTS_CHARS:
        try:
            async with _tts_semaphore:
                wav, _mime = await asyncio.to_thread(text_to_speech, display)
            audio_b64 = base64.b64encode(wav).decode("ascii")
            duration_ms = _wav_duration_ms(wav)
        except Exception as e:  # noqa: BLE001 - a failed clip must not break the turn
            logger.warning("Segment TTS failed (seq=%s): %s", seq, e)

    return {
        "type": "segment",
        "seq": seq,
        "text": display,
        "audio_b64": audio_b64,
        "duration_ms": duration_ms,
    }
