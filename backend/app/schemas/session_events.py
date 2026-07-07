"""
session_events.py — typed protocol for the session WebSocket.

Inbound (client → server) frames are modelled as a Pydantic v2 **discriminated
union** on the existing `type` field. `parse_inbound()` validates a raw frame into
the right model, falling back to `UnknownEvent` (logged + ignored by the caller)
so a malformed or unknown frame can never crash the receive loop. Handlers still
read the original dict, so this layer is purely validation + a documented schema.

Outbound (server → client) frames stay plain dicts built by the helpers at the
bottom — including a single generic `event` frame for chat-rendered events plus
the `lesson_timeout` / `lesson_ended` lifecycle notices.
"""
import logging
from typing import Annotated, Any, List, Literal, Optional, Union

from pydantic import BaseModel, Field, TypeAdapter, ValidationError

logger = logging.getLogger(__name__)


# ── Inbound (client → server) ────────────────────────────────────────────────
class _Base(BaseModel):
    # Tolerate extra fields the client may attach (e.g. tts flags) without failing.
    model_config = {"extra": "allow"}


class UserMessageEvent(_Base):
    type: Literal["user_message"]
    text: str = ""
    image_b64: Optional[str] = None
    image_mime: Optional[str] = None
    research: bool = False
    tts: bool = True


class UserAudioEvent(_Base):
    type: Literal["user_audio"]
    audio_b64: Optional[str] = None
    mime: str = "audio/webm"
    stt: bool = True
    tts: bool = True


class PuzzleResultEvent(_Base):
    type: Literal["puzzle_result"]
    puzzle_type: str = "puzzle"          # labelling | matching | math | graph
    prompt: str = ""
    answer: Any = ""                      # structured submission (dict / str)
    tts: bool = True
    # Legacy field — correctness is now decided server-side by the *_evaluator tools.
    correct: bool = False


class QuizResultEvent(_Base):
    type: Literal["quiz_result"]
    topic: str = "the quiz"
    score: float = 0.0
    strong: List[Any] = Field(default_factory=list)
    weak: List[Any] = Field(default_factory=list)
    tts: bool = True


class LessonPauseEvent(_Base):
    type: Literal["lesson_pause"]


class LessonResumeEvent(_Base):
    type: Literal["lesson_resume"]


class LessonEndRequestEvent(_Base):
    type: Literal["lesson_end_request"]
    tts: bool = True


class StudentIdleEvent(_Base):
    type: Literal["student_idle"]
    seconds: int = 0
    tts: bool = True


class PingEvent(_Base):
    type: Literal["ping"]


class StopEvent(_Base):
    type: Literal["stop"]


class SpeakEvent(_Base):
    """One-shot TTS request over the socket (replaces the old /voice/speak REST call).
    All TTS now flows through the WS channel."""
    type: Literal["speak"]
    text: str = ""
    id: str = ""


class ActivityEvent(_Base):
    """A lightweight 'student is active' heartbeat (e.g. answering each quiz question) —
    resets the idle clock WITHOUT running an AI turn, so a student working through a quiz
    is never treated as idle."""
    type: Literal["activity"]


class UnknownEvent(_Base):
    """Anything we don't recognise — caller logs + ignores it (never crashes)."""
    type: str = "unknown"


InboundEvent = Annotated[
    Union[
        UserMessageEvent, UserAudioEvent, PuzzleResultEvent, QuizResultEvent,
        LessonPauseEvent, LessonResumeEvent, LessonEndRequestEvent, StudentIdleEvent,
        PingEvent, StopEvent, SpeakEvent, ActivityEvent,
    ],
    Field(discriminator="type"),
]

_inbound_adapter: TypeAdapter = TypeAdapter(InboundEvent)


def parse_inbound(raw: Any) -> BaseModel:
    """Validate a raw WS frame into a typed event; unknown/invalid → UnknownEvent.

    Never raises — the receive loop must keep running on a bad frame.
    """
    try:
        return _inbound_adapter.validate_python(raw)
    except ValidationError as e:
        t = raw.get("type") if isinstance(raw, dict) else None
        logger.warning("session_events: unparseable frame type=%r (%s)", t, e.errors()[:1])
        return UnknownEvent(type=str(t) if t else "unknown")


# ── Outbound (server → client) builders ──────────────────────────────────────
# Chat-rendered event kinds (drive the centered system pills in the chat window).
EVENT_PUZZLE_SOLVED = "puzzle.solved"
EVENT_PUZZLE_TRIED = "puzzle.tried"
EVENT_STUDENT_IDLE = "student.idle"
EVENT_LESSON_PAUSED = "lesson.paused"
EVENT_LESSON_RESUMED = "lesson.resumed"
EVENT_LESSON_TIMEOUT = "lesson.timeout"
EVENT_LESSON_END_REQUEST = "lesson.end_request"
EVENT_LESSON_ENDED = "lesson.ended"


def event_frame(kind: str, text: str = "", **data: Any) -> dict:
    """Generic chat-rendered event → a `role:"event"` bubble on the client."""
    return {"type": "event", "kind": kind, "text": text, "data": data}


def lesson_timeout_frame(text: str = "Time's up — let's wrap up.") -> dict:
    return {"type": "lesson_timeout", "text": text}


def lesson_ended_frame(**data: Any) -> dict:
    return {"type": "lesson_ended", "data": data}
