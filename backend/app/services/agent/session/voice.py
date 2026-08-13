"""
Voice audio service — Kokoro TTS + Gemini STT.

Low-level audio helpers used exclusively by the chat/session WebSocket pipelines.
ALL voice now flows through the WS channel: STT in (`user_audio`), turn-segment
Kokoro TTS out, and one-shot TTS out (`speak` → `tts_audio`, see synth_speak_frame).
The old `/api/voice/speak` REST endpoint and the real-time Gemini Live path have both
been removed.
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


# ── Tutors (named voice personas) ────────────────────────────────────────────
# The AI tutor the student hears. Each is a Kokoro voice given a friendly NAME so the booker
# picks a "tutor", not a raw voice id. All are lang_code "a" (American English) voices so they
# share the ONE Kokoro pipeline — the voice is chosen per synthesis call. Add more here (any
# af_*/am_* id) and they're instantly selectable everywhere; no pipeline change needed.
TUTORS: dict = {
    "aria": {"id": "aria", "name": "Aria", "gender": "female", "voice": "af_heart",
             "emoji": "👩‍🏫", "blurb": "Warm, patient — the default voice."},
    "leo":  {"id": "leo",  "name": "Leo",  "gender": "male",   "voice": "am_michael",
             "emoji": "👨‍🏫", "blurb": "Clear, friendly male voice."},
}
DEFAULT_TUTOR = "aria"


def normalise_tutor_id(tutor_id: Optional[str]) -> str:
    tid = (tutor_id or "").strip().lower()
    return tid if tid in TUTORS else DEFAULT_TUTOR


def tutor_voice(tutor_id: Optional[str]) -> str:
    """Kokoro voice id for a tutor id (falls back to the default tutor's voice)."""
    return TUTORS[normalise_tutor_id(tutor_id)]["voice"]


def tutor_id_from_description(description: Optional[str]) -> str:
    """The tutor chosen at booking, stored as a `Tutor: <id>` line in the appointment
    description (same mechanism as Notes/Topics). Missing/unknown → the default tutor."""
    m = _re.search(r"Tutor:\s*([A-Za-z0-9_-]+)", description or "", _re.IGNORECASE)
    return normalise_tutor_id(m.group(1) if m else None)


def list_tutors() -> list:
    """Public tutor catalogue for the picker (no raw voice ids leaked to the client)."""
    return [{"id": t["id"], "name": t["name"], "gender": t["gender"],
             "emoji": t["emoji"], "blurb": t["blurb"]} for t in TUTORS.values()]


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


def prewarm_voices() -> None:
    """Force Kokoro to DOWNLOAD + load every TUTOR voice pack now (on startup), so the first
    lesson using a given tutor isn't stalled by an on-demand weight download. Kokoro fetches a
    voice pack the first time that voice id is synthesised, so we synthesise a tiny clip per
    voice. Idempotent + non-fatal — a failed pre-warm just means that voice downloads on first use."""
    pipeline = _get_kokoro()
    for tid, t in TUTORS.items():
        v = t["voice"]
        try:
            # Consume the generator so the voice pack is actually fetched + loaded.
            for _ in pipeline("Hello.", voice=v, speed=TTS_SPEED):
                pass
            logger.info("Kokoro voice pre-warmed: tutor=%s voice=%s", tid, v)
        except Exception as e:  # noqa: BLE001
            logger.warning("Kokoro voice pre-warm failed for tutor=%s voice=%s: %s", tid, v, e)


def _say_math(text: str) -> str:
    """Turn written maths into words a voice can actually say.

    This tutor teaches maths, so the model emits LaTeX and maths symbols constantly (that is why
    `puzzle_service._repair_latex` exists). Kokoro has no idea what any of it means: without this,
    "$\\frac{3}{4}$" is spoken as "dollar backslash frac open brace three close brace…". Order
    matters — fractions and roots are expanded BEFORE the delimiters and backslashes are stripped.
    """
    # \frac{3}{4} → "3 over 4"  (twice, so a nested numerator still resolves)
    for _ in range(2):
        text = _re.sub(r'\\[dt]?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}', r'\1 over \2', text)
    text = _re.sub(r'\\sqrt\s*\{([^{}]+)\}', r'the square root of \1', text)
    text = _re.sub(r'\\sqrt\s+(\w+)', r'the square root of \1', text)

    # Powers and indices: x^2 / x^{2} / 10^-3. The negative lookahead rejects a DECIMAL
    # exponent (^2.5) but must still allow a sentence-ending full stop ("area in cm^2.").
    text = _re.sub(r'\^\s*\{?\s*2\s*\}?(?!\.?\d)(?!\w)', ' squared ', text)
    text = _re.sub(r'\^\s*\{?\s*3\s*\}?(?!\.?\d)(?!\w)', ' cubed ', text)
    text = _re.sub(r'\^\s*\{?\s*(-?\d+(?:\.\d+)?|\w)\s*\}?', r' to the power of \1 ', text)
    text = _re.sub(r'(?<=\w)_\s*\{?\s*(\w+)\s*\}?', r' sub \1 ', text)

    symbols = [
        (r'\\times', ' times '), (r'\\div', ' divided by '), (r'\\cdot', ' times '),
        (r'\\pm', ' plus or minus '), (r'\\approx', ' is about '),
        (r'\\neq', ' is not equal to '), (r'\\leq?\b', ' is less than or equal to '),
        (r'\\geq?\b', ' is greater than or equal to '),
        (r'\\rightarrow|\\to\b|-->|->|→', ' gives '), (r'\\degree|°', ' degrees '),
        (r'\\pi\b|π', ' pi '), (r'\\theta\b|θ', ' theta '), (r'\\alpha\b|α', ' alpha '),
        (r'\\beta\b|β', ' beta '), (r'\\Delta\b|\\delta\b|Δ', ' delta '),
        (r'\\infty|∞', ' infinity '), (r'\\%|%', ' percent '), (r'×', ' times '),
        (r'÷', ' divided by '), (r'≈', ' is about '), (r'≠', ' is not equal to '),
        (r'≤', ' is less than or equal to '), (r'≥', ' is greater than or equal to '),
        (r'√', ' the square root of '), (r'²', ' squared '), (r'³', ' cubed '),
    ]
    for pat, rep in symbols:
        text = _re.sub(pat, rep, text)

    # Bare comparisons, but NOT inside a stray HTML-ish tag or an arrow already handled.
    text = _re.sub(r'\s>\s', ' is greater than ', text)
    text = _re.sub(r'\s<\s', ' is less than ', text)

    # Now the delimiters and any leftover TeX scaffolding can go.
    text = _re.sub(r'\$\$?', '', text)
    text = _re.sub(r'\\(?:left|right|displaystyle|text|mathrm|mbox)\b', '', text)
    text = _re.sub(r'\\[a-zA-Z]+', '', text)      # any remaining \command
    text = text.replace('{', '').replace('}', '')
    # "=" is silent in most TTS voices, which turns "A = pi r squared" into a list of nouns.
    text = _re.sub(r'\s*=\s*', ' equals ', text)
    # Tidy the spacing the substitutions above introduce, so nothing runs together
    # ("x squared+ 3x") and no space is left stranded before punctuation ("degrees .").
    text = _re.sub(r'\s{2,}', ' ', text)
    text = _re.sub(r'\s+([.,!?;:])', r'\1', text)
    return text


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
    text = _say_math(text)                                          # LaTeX/symbols → words
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


def text_to_speech(text: str, lang: str = "en", voice: Optional[str] = None) -> tuple[bytes, str]:
    """Kokoro TTS. `voice` is a Kokoro voice id (e.g. af_heart / am_michael) chosen by the
    lesson's selected TUTOR; defaults to the platform voice. Returns (wav_bytes, "audio/wav")."""
    clean = _prep_tts_text(text)
    if not clean or clean.startswith("[Error"):
        raise ValueError("Cannot generate speech for empty or error text")

    pipeline = _get_kokoro()
    _voice = voice or TTS_VOICE
    chunks = [audio for _, _, audio in pipeline(clean, voice=_voice, speed=TTS_SPEED)]
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


_FILLER_RE = _re.compile(r"\b(h+m+|m+h+|hmm+|u+h+|u+m+|erm?|a+h+|ahem|huh|mhm+|mm+)\b", _re.IGNORECASE)


def _is_non_speech_transcript(text: str) -> bool:
    """True when a transcript is almost certainly NOT real speech — Gemini's audio model
    hallucinates timecodes ("00:04", "00:00:00-00:02:44"), sound tags ("[throat clearing]")
    and repeated tokens when it's fed silence, breathing or background noise (or the tutor's
    own TTS bleeding into the mic). We drop these so the AI never answers a phantom turn.
    A short bare number ("7", "42") is a VALID spoken answer and must pass through."""
    s = (text or "").strip()
    if not s:
        return True
    # Strip bracketed/parenthetical sound descriptions + standalone filler tokens first.
    core = _re.sub(r"[\[(][^\])]*[\])]", " ", s)
    core = _FILLER_RE.sub(" ", core).strip()
    if not core:
        return True
    # Timecode: digits/separators AND (contains a colon OR is a long digit run). A short
    # bare number like "7" has no colon and few digits, so it is NOT flagged here.
    digits = _re.sub(r"\D", "", core)
    if _re.fullmatch(r"[\d\s:.,\-–—]+", core) and (":" in core or len(digits) >= 5):
        return True
    letters = _re.sub(r"[^A-Za-zÀ-￿]", "", core)
    has_digit = bool(_re.search(r"\d", core))
    if not letters and not has_digit:
        return True  # nothing but punctuation/symbols left
    if not letters and has_digit:
        return False  # a plain number answer ("7", "42") — valid
    if len(letters) < 2:
        return True  # a single stray letter with no number
    # A single token dominating (noise heard as one word repeated, e.g. "la la la la") is a
    # hallucination, not speech.
    words = [w for w in _re.sub(r"[^\w\s]", " ", core).split() if w]
    if len(words) >= 4:
        from collections import Counter
        top = Counter(w.lower() for w in words).most_common(1)[0][1]
        if top / len(words) >= 0.6:
            return True
    return False


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

        try:
            uploaded = client.files.upload(file=tmp_path, config={"mime_type": mime_type})
            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=[
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_uri(file_uri=uploaded.uri, mime_type=mime_type),
                            types.Part(text=(
                                "Transcribe ONLY the actual words a person clearly speaks, as plain "
                                "text. If there is no clear human speech — silence, background noise, "
                                "breathing, coughing, throat-clearing, or music — return an EMPTY "
                                "string. Never output timestamps or timecodes (like 00:00 or "
                                "00:00:00-00:02:44), and never output bracketed descriptions of "
                                "sounds (like [music] or [throat clearing]). Output the spoken words "
                                "only, or nothing."
                            )),
                        ],
                    )
                ],
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        # response.text is None when the model returns no text (silent/unclear audio, or a
        # safety-blocked / non-text response) — guard it so a quiet utterance degrades to
        # "couldn't hear that" instead of crashing on None.strip().
        transcribed = (getattr(response, "text", None) or "").strip()
        if not transcribed:
            logger.info("STT: empty transcript (bytes=%s, mime=%s)", len(audio_bytes or b""), mime_type)
            return None
        if _is_non_speech_transcript(transcribed):
            logger.info("STT: dropped non-speech transcript %r (bytes=%s)", transcribed[:60], len(audio_bytes or b""))
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
