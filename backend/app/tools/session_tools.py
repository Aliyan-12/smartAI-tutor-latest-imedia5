"""
session_tools.py — IN-LESSON VIEW tools bound to Gemini during AI lessons.

These tools only manipulate what's on the student's screen THIS turn (slides +
puzzles); they don't change platform records. Platform/lifecycle/data tools
(quiz, mastery, report, assignments, pause/resume/end, load_resource) live in
`platform_tools.py`. The per-turn registry (`tools/registry.py`) assembles the
right groups for each turn.

All tools are created via `session_tool_groups(ctx)` / `make_session_tools(ctx)`,
which inject the session context via closures — Gemini never sees db, student_id, etc.
"""
import json
import logging
from dataclasses import dataclass
from typing import Optional, Union

from langchain_core.tools import tool
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


@dataclass
class ToolContext:
    db: AsyncSession
    student_id: int
    appointment_id: int
    subject: str
    key_stage: str
    year_group: Optional[str] = None
    chat_session_id: Optional[str] = None
    # Lesson unit/topic — used to scope catalog-image puzzles (match/identify) to the
    # actual topic being taught.
    unit_title: Optional[str] = None
    topic_title: Optional[str] = None
    # Turn-scoped guard: at most ONE slide move (advance/retreat/show) per reply,
    # so the AI can't race several slides ahead in a single turn. Reset each turn
    # because a fresh ToolContext is built per turn in _run_turn.
    slide_moved: bool = False


def _slide_move_refused(payload: dict, verb: str) -> dict:
    """Turn a blocked second slide-move into an UNMISTAKABLE refusal.

    It used to return a normal, success-shaped payload with a soft "note", so the model didn't
    realise it had been refused and simply called the tool again — four `advance_lesson_slide`
    calls in one turn, each costing a full model round-trip (~30s wasted) and each printing
    "Moving to the next slide" in the thinking strip, so it looked like the deck had jumped four
    slides when it had actually moved once.

    `error` makes the refusal legible to the model, and `suppressed` tells the turn loop not to
    emit a WS frame or a thinking step for a call that changed nothing on screen.
    """
    out = dict(payload or {})
    out["error"] = "already_moved"
    out["suppressed"] = True
    out["message"] = (
        f"REFUSED — you already moved a slide this turn, so nothing changed on screen. Teaching "
        f"is ONE slide per reply. Do NOT call {verb}_lesson_slide again in this reply: write your "
        f"explanation of the slide that is on screen NOW, and move again on your next reply."
    )
    return out


async def _clear_puzzle_on_slide(ctx: "ToolContext") -> None:
    """Slides and puzzles are mutually-exclusive views of the Learn panel — moving to a
    slide takes any on-screen puzzle off, so drop it from authoritative puzzle_state too.
    Keeps the per-turn LESSON STATE anchor honest (no 'puzzle still showing' after a slide
    move) and matches the frontend, which clears the puzzle overlay on any slide tool."""
    from app.services import puzzle_service
    try:
        await puzzle_service.clear_puzzle_state(ctx.db, ctx.appointment_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("clear puzzle_state on slide move failed: %s", e)


def session_tool_groups(ctx: ToolContext) -> dict:
    """Build the in-lesson view tools, grouped by capability for the registry."""

    @tool
    async def show_resource(resource_hub_id: int, slide_index: int = 1) -> dict:
        """
        Display a teaching resource (slide deck, worksheet, mark scheme, or link) on
        the student's screen and jump DIRECTLY to a specific slide/page. Use this ONLY
        when the student explicitly asks to see a particular slide/topic ("show me the
        touch slide", "go to that slide") — it may skip several slides at once to reach
        the one they asked for. For normal sequential teaching use advance_lesson_slide
        instead. slide_index is 1-based. The returned slide_content is the text on that
        slide — teach from it.
        """
        from app.services.session_resource_service import slide_action
        # An explicit, student-requested jump — allowed to span several slides in one
        # call. It still counts as this turn's slide move, so a stray sequential
        # advance/retreat afterwards is suppressed.
        ctx.slide_moved = True
        result = await slide_action(
            ctx.db, ctx.appointment_id, mode="show",
            resource_hub_id=resource_hub_id, slide_index=slide_index,
        )
        await _clear_puzzle_on_slide(ctx)
        return result

    @tool
    async def advance_lesson_slide() -> dict:
        """
        Move the on-screen resource FORWARD by exactly ONE slide/page (or to the next
        resource when the current deck ends). This is the normal sequential teaching
        step — call it ONCE per reply, only after the student has understood the current
        slide and answered its question. The returned slide_content is the next slide's
        text — teach from it. (To jump straight to a slide the student asked for by name,
        use show_resource instead.)
        """
        from app.services.session_resource_service import slide_action
        if ctx.slide_moved:
            # Teaching advances one slide per turn — don't race ahead.
            return _slide_move_refused(
                await slide_action(ctx.db, ctx.appointment_id, mode="show"),
                "advance",
            )
        ctx.slide_moved = True
        result = await slide_action(ctx.db, ctx.appointment_id, mode="advance")
        await _clear_puzzle_on_slide(ctx)
        return result

    @tool
    async def retreat_lesson_slide() -> dict:
        """
        Move the on-screen resource BACK by exactly ONE slide/page. Call ONCE when the
        student did not understand the current slide or answered its question
        incorrectly, so you can re-teach the earlier slide. The returned slide_content
        is that slide's text — re-teach from it.
        """
        from app.services.session_resource_service import slide_action
        if ctx.slide_moved:
            return _slide_move_refused(
                await slide_action(ctx.db, ctx.appointment_id, mode="show"),
                "retreat",
            )
        ctx.slide_moved = True
        result = await slide_action(ctx.db, ctx.appointment_id, mode="retreat")
        await _clear_puzzle_on_slide(ctx)
        return result

    return {
        "teaching": [show_resource, advance_lesson_slide, retreat_lesson_slide],
    }


def make_session_tools(ctx: ToolContext) -> list:
    """Back-compat: the slide tools + the generative puzzle tools as a flat list."""
    from app.tools.puzzle_tools import puzzle_tool_groups
    g = session_tool_groups(ctx)
    return g["teaching"] + puzzle_tool_groups(ctx)["puzzles"]
