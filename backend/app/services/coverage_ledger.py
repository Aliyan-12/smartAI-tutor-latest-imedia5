"""
coverage_ledger.py — the shared, structured record of what a lesson has already
covered. This is the STRUCTURAL cure for the tutor repeating itself.

The single-agent tutor repeats ("you've done an amazing job today…", re-asks the
same question, re-teaches a slide) because it has no memory of what it already did
beyond the raw chat transcript, which it overfits to. Fuzzy sentence-dedup was a
band-aid on that. The real fix is to give every agent a compact, authoritative list
of what has been TAUGHT / ASKED / DONE, and tell it plainly: do not repeat these.

The ledger lives in `LessonPlan.session_state["ledger"]` (same JSONB store as
`puzzle_state`/`end_allowed`), written DETERMINISTICALLY by the tools themselves
(a slide move appends a slide; showing a puzzle appends a puzzle; generating the
quiz flips quiz_done) — never self-reported by the model. It is rendered into the
LESSON STATE anchor every turn as an "ALREADY COVERED — do NOT repeat" block.

Framework-agnostic on purpose: it helps the current single-agent path AND the
crewai multi-agent path (where it is the hand-off memory from Teacher → Practitioner
→ Summarizer). No crewai import here.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Keep the ledger — and therefore the prompt block it renders — SMALL. Only the most
# recent items matter for "don't repeat", and session_state is reloaded/rewritten every
# turn, so unbounded lists would bloat both the row and the system prompt.
_CAP_SLIDES = 40      # slide numbers are tiny; a full deck is fine
_CAP_CONCEPTS = 24
_CAP_QUESTIONS = 16
_CAP_PUZZLES = 24

_LIST_KEYS = ("slides_taught", "concepts_taught", "questions_asked", "puzzles_done")
_FLAG_KEYS = ("recap_done", "quiz_done", "report_done")
_CAPS = {
    "slides_taught": _CAP_SLIDES,
    "concepts_taught": _CAP_CONCEPTS,
    "questions_asked": _CAP_QUESTIONS,
    "puzzles_done": _CAP_PUZZLES,
}


def empty_ledger() -> dict:
    return {
        "slides_taught": [],     # slide numbers / titles the Teacher has delivered
        "concepts_taught": [],   # short concept labels ("tens and ones")
        "questions_asked": [],   # short forms of questions already put to the student
        "puzzles_done": [],      # puzzle ids/kinds already played ("place_value:32")
        "recap_done": False,
        "quiz_done": False,
        "report_done": False,
    }


def _coerce(raw: Any) -> dict:
    """Normalise whatever is in session_state into the full ledger shape."""
    led = empty_ledger()
    if isinstance(raw, dict):
        for k in _LIST_KEYS:
            v = raw.get(k)
            if isinstance(v, list):
                led[k] = [str(x) for x in v if x is not None]
        for k in _FLAG_KEYS:
            led[k] = bool(raw.get(k, False))
    return led


async def _load_plan(db: AsyncSession, appointment_id: int):
    from app.models.lesson_plan import LessonPlan
    return (await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )).scalar_one_or_none()


async def load(db: AsyncSession, appointment_id: int) -> dict:
    """Return the ledger for an appointment (always the full shape, defaults filled)."""
    try:
        plan = await _load_plan(db, appointment_id)
    except Exception:
        logger.warning("ledger load failed appt=%s", appointment_id, exc_info=True)
        return empty_ledger()
    if plan is None or not plan.session_state:
        return empty_ledger()
    return _coerce(plan.session_state.get("ledger"))


async def _mutate(db: AsyncSession, appointment_id: int, fn) -> Optional[dict]:
    """Read-modify-write the ledger under the same pattern as session_state_service.

    `fn(ledger)` mutates the dict in place. We re-read inside so we never clobber a
    concurrent puzzle_state/end_allowed write on the SAME session_state row.
    """
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return None
    state = dict(plan.session_state) if plan.session_state else {}
    led = _coerce(state.get("ledger"))
    fn(led)
    # enforce caps (keep most-recent)
    for k, cap in _CAPS.items():
        if len(led[k]) > cap:
            led[k] = led[k][-cap:]
    state["ledger"] = led
    plan.session_state = state
    await db.flush()
    return led


def _append_unique(led: dict, key: str, value: Any) -> None:
    v = str(value).strip()
    if not v:
        return
    if v not in led[key]:
        led[key].append(v)


async def add_slide_taught(db: AsyncSession, appointment_id: int, slide: Any) -> None:
    await _mutate(db, appointment_id, lambda l: _append_unique(l, "slides_taught", slide))
    logger.info("ledger: slide taught=%s appt=%s", slide, appointment_id)


async def add_concept_taught(db: AsyncSession, appointment_id: int, concept: str) -> None:
    await _mutate(db, appointment_id, lambda l: _append_unique(l, "concepts_taught", concept))


async def add_question_asked(db: AsyncSession, appointment_id: int, question: str) -> None:
    # store a short form so the block stays compact
    q = (question or "").strip().replace("\n", " ")
    if len(q) > 90:
        q = q[:87] + "…"
    await _mutate(db, appointment_id, lambda l: _append_unique(l, "questions_asked", q))


async def add_puzzle_done(db: AsyncSession, appointment_id: int, puzzle: str) -> None:
    await _mutate(db, appointment_id, lambda l: _append_unique(l, "puzzles_done", puzzle))
    logger.info("ledger: puzzle done=%s appt=%s", puzzle, appointment_id)


async def set_flag(db: AsyncSession, appointment_id: int, flag: str, value: bool = True) -> None:
    if flag not in _FLAG_KEYS:
        return
    await _mutate(db, appointment_id, lambda l: l.__setitem__(flag, bool(value)))
    logger.info("ledger: %s=%s appt=%s", flag, bool(value), appointment_id)


def render_for_prompt(led: dict) -> str:
    """Render the 'ALREADY COVERED' block for the LESSON STATE anchor. Returns "" when
    nothing has been covered yet (so the anchor stays clean at the start)."""
    if not led:
        return ""
    parts: list[str] = []
    if led.get("slides_taught"):
        parts.append("• Slides already taught: " + ", ".join(str(s) for s in led["slides_taught"]))
    if led.get("concepts_taught"):
        parts.append("• Concepts already explained: " + "; ".join(led["concepts_taught"]))
    if led.get("questions_asked"):
        parts.append("• Questions already asked (do NOT re-ask these): " + " | ".join(led["questions_asked"]))
    if led.get("puzzles_done"):
        parts.append("• Activities already played: " + ", ".join(led["puzzles_done"]))
    flags = []
    if led.get("recap_done"):
        flags.append("recap done")
    if led.get("quiz_done"):
        flags.append("quiz done (never set another)")
    if led.get("report_done"):
        flags.append("report done")
    if flags:
        parts.append("• " + "; ".join(flags))
    if not parts:
        return ""
    return (
        "✅ ALREADY COVERED THIS LESSON — do NOT repeat, re-teach, or re-ask any of these; "
        "build on them and move forward:\n" + "\n".join(parts)
    )
