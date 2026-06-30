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
        return await slide_action(
            ctx.db, ctx.appointment_id, mode="show",
            resource_hub_id=resource_hub_id, slide_index=slide_index,
        )

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
            payload = await slide_action(ctx.db, ctx.appointment_id, mode="show")
            payload["note"] = (
                "You've already moved a slide this turn. Teaching goes ONE slide per "
                "reply — teach the current slide now and advance on the next turn."
            )
            return payload
        ctx.slide_moved = True
        return await slide_action(ctx.db, ctx.appointment_id, mode="advance")

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
            payload = await slide_action(ctx.db, ctx.appointment_id, mode="show")
            payload["note"] = (
                "You've already moved a slide this turn. Teach the current slide now; "
                "move again on the next turn."
            )
            return payload
        ctx.slide_moved = True
        return await slide_action(ctx.db, ctx.appointment_id, mode="retreat")

    @tool
    async def list_available_puzzles() -> dict:
        """
        List the interactive visual puzzles available for THIS lesson's subject and
        key stage, each tagged with a CATEGORY (labelling, matching, recognition,
        sorting, sequencing, counting, fractions, number, geometry, data, algebra).
        Includes image puzzles that show REAL topic images: 'identify_image' (show an
        image, name it) and 'match_image' (match images to names) — prefer these for
        recognition/vocabulary practice on the lesson's topic. Call this before
        show_puzzle so you choose a real puzzle_id with valid params — never invent a
        puzzle_id. Returns each puzzle's id, category, what it shows, and its params,
        plus the student's key_stage + year_group so you scale the numbers to their age.
        """
        from app.services import puzzle_service
        return {
            "subject": ctx.subject,
            "key_stage": ctx.key_stage,
            "year_group": ctx.year_group,
            "puzzles": puzzle_service.list_available(ctx.subject, ctx.key_stage),
        }

    @tool
    async def show_puzzle(puzzle_id: str, params: Optional[Union[dict, str]] = None) -> dict:
        """
        Display an interactive visual puzzle on the student's screen to teach or check
        a concept (Synthesis-style). Use for hands-on Maths/Science moments — e.g. naming
        a fraction on a bar, reading a number line, labelling a diagram. Pick puzzle_id
        from list_available_puzzles and pass its params (see each puzzle's `params`),
        using the EXACT param names shown there (e.g. total_parts, shaded_parts).
        After showing it, ask the student to solve it and WAIT — their answer arrives as a
        [PUZZLE RESULT] message; then praise + advance, or give a hint and try again.
        Call this SILENTLY (never write the call as text).
        """
        from app.services import puzzle_service
        # Gemini sometimes serializes the params object as a JSON string — coerce it.
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except Exception:
                params = {}
        if not isinstance(params, dict):
            params = {}

        # Map the id the model gave to a REAL available template (it sometimes
        # invents ids or uses a render name). If nothing fits, tell the model
        # plainly so it doesn't pretend a puzzle is on screen.
        resolved = puzzle_service.resolve_id(puzzle_id, ctx.subject, ctx.key_stage)
        avail = [p["puzzle_id"] for p in puzzle_service.list_available(ctx.subject, ctx.key_stage)]
        if not resolved:
            logger.warning(
                "show_puzzle: NO match for id=%r (subject=%s, key_stage=%s). Available=%s",
                puzzle_id, ctx.subject, ctx.key_stage, avail,
            )
            return {
                "action": "show_puzzle",
                "error": "no_matching_puzzle",
                "message": (
                    f"There is no puzzle '{puzzle_id}' for {ctx.subject} {ctx.key_stage}. "
                    "Do NOT tell the student to look at a puzzle. "
                    f"Available puzzle_ids: {avail}. Either call show_puzzle again with one of "
                    "these, or just ask a normal typed practice question instead."
                ),
                "available": avail,
            }

        # Image puzzles (match/identify) pull REAL topic images from the cached catalog,
        # scoped to this lesson's subject/key stage/topic. Inject them as params.
        if resolved in ("identify_image", "match_image"):
            try:
                from app.services import topic_image_service
                catalog = await topic_image_service.get_for(
                    ctx.db, subject=ctx.subject, key_stage=ctx.key_stage,
                    year_group=ctx.year_group, topic_title=ctx.topic_title, limit=12,
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("topic-image catalog lookup failed: %s", e)
                catalog = []
            params = {**(params or {}), "_catalog": catalog}

        payload = puzzle_service.build(resolved, params)
        if payload.get("error"):
            logger.warning("show_puzzle: build error for id=%s: %s", resolved, payload.get("error"))
            _msg = (
                "There aren't enough topic images for an image puzzle here — ask a typed "
                "question or pick a different puzzle_id instead."
                if payload.get("error") == "no_catalog_images"
                else "Could not build that puzzle — ask a typed question instead."
            )
            return {"action": "show_puzzle", "error": payload.get("error"),
                    "available": avail, "message": _msg}

        # Persist as the authoritative on-screen puzzle and stamp a fresh instance_id
        # so the frontend remounts a clean puzzle (no leftover solved/locked state from
        # the previous one). The model only treats the puzzle as "shown" when this
        # succeeds — confirmed back to it next turn via the LESSON INTERACTIVE STATE anchor.
        try:
            instance_id = await puzzle_service.set_puzzle_shown(ctx.db, ctx.appointment_id, payload)
            payload["instance_id"] = instance_id
        except Exception as e:  # noqa: BLE001
            logger.warning("set_puzzle_shown failed: %s", e)
        payload["rendered"] = True
        logger.info(
            "show_puzzle: rendering id=%s render=%s instance=%s (asked=%r) prompt=%r",
            payload.get("puzzle_id"), payload.get("render"), payload.get("instance_id"),
            puzzle_id, payload.get("prompt"),
        )
        return payload

    @tool
    async def clear_puzzle() -> dict:
        """
        Remove the current puzzle from the student's screen (e.g. once they've mastered
        it and you're moving on to teaching/slides). Call silently.
        """
        from app.services import puzzle_service
        try:
            await puzzle_service.clear_puzzle_state(ctx.db, ctx.appointment_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("clear puzzle_state failed: %s", e)
        return {"action": "clear_puzzle"}

    return {
        "teaching": [show_resource, advance_lesson_slide, retreat_lesson_slide],
        "puzzles": [list_available_puzzles, show_puzzle, clear_puzzle],
    }


def make_session_tools(ctx: ToolContext) -> list:
    """Back-compat: the in-lesson view tools (teaching + puzzles) as a flat list."""
    g = session_tool_groups(ctx)
    return g["teaching"] + g["puzzles"]
