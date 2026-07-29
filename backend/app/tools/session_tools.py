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
    # Lesson phase this turn (recap|teach|practice|quiz|review), from the state machine. Every
    # visual is recorded against it so each phase's target mix can be held independently.
    phase: str = "teach"
    # Turn-scoped: has something already been put on the Learn panel this reply? The panel shows
    # ONE thing, so a second visual in the same reply silently replaces the first — see
    # `persist_and_return`. Reset every turn because a fresh ToolContext is built per turn.
    visual_shown: str = ""
    # Turn-scoped guard: at most ONE slide move (advance/retreat/show) per reply,
    # so the AI can't race several slides ahead in a single turn. Reset each turn
    # because a fresh ToolContext is built per turn in _run_turn.
    slide_moved: bool = False


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
        # The deck now owns the Learn panel this reply — see persist_and_return. Teaching the
        # slide comes BEFORE anything overlays it.
        ctx.visual_shown = "slide"
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
        step — call it once you've finished teaching the current slide. The returned
        slide_content is the next slide's text — teach from it. (To jump straight to a
        specific slide number, use jump_to_slide.)

        Careful with question/answer slides: if the deck map shows the NEXT slide reveals
        the answer, ask the student for their answer to the on-screen question FIRST and
        only advance once they've had a go — you decide this, no one blocks you.
        """
        from app.services.session_resource_service import slide_action
        ctx.slide_moved = True
        ctx.visual_shown = "slide"
        result = await slide_action(ctx.db, ctx.appointment_id, mode="advance")
        await _clear_puzzle_on_slide(ctx)
        return result

    @tool
    async def retreat_lesson_slide() -> dict:
        """
        Move the on-screen resource BACK by exactly ONE slide/page. Call when the student
        did not understand the current slide or answered its question incorrectly, so you
        can re-teach the earlier slide. The returned slide_content is that slide's text —
        re-teach from it.
        """
        from app.services.session_resource_service import slide_action
        ctx.slide_moved = True
        ctx.visual_shown = "slide"
        result = await slide_action(ctx.db, ctx.appointment_id, mode="retreat")
        await _clear_puzzle_on_slide(ctx)
        return result

    @tool
    async def jump_to_slide(slide_index: int) -> dict:
        """
        Jump DIRECTLY to slide number `slide_index` (1-based) in the CURRENT deck. Use this
        when the slide that best explains the concept you're teaching now is elsewhere in the
        deck, or when the student asks to see a particular slide ("go to the fractions one",
        "back to slide 3"). Read the DECK MAP in the lesson state to choose the right number.
        The returned slide_content is that slide's text — teach from it. (For step-by-step
        teaching use advance_lesson_slide; to open a DIFFERENT resource use show_resource.)
        """
        from app.services.session_resource_service import slide_action, get_current_slide
        cur = await get_current_slide(ctx.db, ctx.appointment_id)
        rid = cur.get("resource_hub_id") if cur else None
        ctx.slide_moved = True
        ctx.visual_shown = "slide"
        result = await slide_action(
            ctx.db, ctx.appointment_id, mode="show",
            resource_hub_id=rid, slide_index=max(1, int(slide_index)),
        )
        await _clear_puzzle_on_slide(ctx)
        return result

    return {
        "teaching": [show_resource, advance_lesson_slide, retreat_lesson_slide, jump_to_slide],
    }


def make_session_tools(ctx: ToolContext) -> list:
    """Back-compat: the slide tools + the generative puzzle tools as a flat list."""
    from app.tools.puzzle_tools import puzzle_tool_groups
    g = session_tool_groups(ctx)
    return g["teaching"] + puzzle_tool_groups(ctx)["puzzles"]
