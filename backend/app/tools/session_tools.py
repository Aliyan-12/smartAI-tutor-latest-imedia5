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


async def _answer_slide_gate(ctx: "ToolContext"):
    """Stop the tutor advancing onto an ANSWER-REVEAL slide before the student has had a go.

    Real decks pair a question slide with an identical-looking `✅` answer slide. Advancing
    straight through hands the student the answer to a question they were never asked — the
    single most damaging thing the slide tools can do unsupervised.

    Deliberately gates ONCE per slide: the refusal makes the tutor ask the question, and if it
    advances again on a LATER turn (i.e. after the student has replied) the move goes through.
    A permanent block could deadlock the lesson when a student answers out loud, or refuses to
    answer at all — a one-turn pause achieves the teaching goal without that risk.
    """
    from app.services import session_resource_service as srs
    from app.models.resource_hub import RHResource
    from app.models.lesson_plan import LessonPlan
    from sqlalchemy import select
    try:
        cur = await srs.get_current_slide(ctx.db, ctx.appointment_id)
        if not cur:
            return None
        nxt = int(cur.get("slide_index") or 1) + 1
        res = (await ctx.db.execute(
            select(RHResource).where(RHResource.hub_id == cur.get("resource_hub_id"))
        )).scalar_one_or_none()
        if not res:
            return None
        dmap = await srs.get_deck_map(ctx.db, ctx.appointment_id, res)
        target = next((d for d in dmap if d["index"] == nxt), None)
        if not target or target["kind"] != "answer":
            return None

        plan = (await ctx.db.execute(
            select(LessonPlan).where(LessonPlan.appointment_id == ctx.appointment_id)
        )).scalar_one_or_none()
        state = dict(plan.session_state) if (plan is not None and plan.session_state) else {}
        gated = list(state.get("answer_gate") or [])
        if nxt in gated:
            return None                     # already paused once here — let it through
        if plan is not None:
            state["answer_gate"] = (gated + [nxt])[-20:]
            plan.session_state = state
            await ctx.db.flush()
        logger.info("ANSWER GATE held slide=%s appt=%s", nxt, ctx.appointment_id)

        payload = await slide_action_show(ctx)
        out = dict(payload or {})
        out["error"] = "answer_slide_ahead"
        out["suppressed"] = True
        out["message"] = (
            f"HELD — the next slide (#{nxt}) REVEALS THE ANSWERS to the question on screen. "
            "Nothing moved. Ask the student for their answer to the question they can see and "
            "WAIT for it. Once they have answered (or genuinely given up), call "
            "advance_lesson_slide again and it will go through, so you can mark it together."
        )
        return out
    except Exception:  # noqa: BLE001 — a guard must never break the lesson
        logger.warning("answer-slide gate failed for appt %s", ctx.appointment_id, exc_info=True)
        return None


async def slide_action_show(ctx: "ToolContext"):
    from app.services.session_resource_service import slide_action
    return await slide_action(ctx.db, ctx.appointment_id, mode="show")


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
        gate = await _answer_slide_gate(ctx)
        if gate:
            return gate
        ctx.slide_moved = True
        # The deck now owns the Learn panel this reply — see persist_and_return. Teaching the
        # slide comes BEFORE anything overlays it.
        ctx.visual_shown = "slide"
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
        # The deck now owns the Learn panel this reply — see persist_and_return. Teaching the
        # slide comes BEFORE anything overlays it.
        ctx.visual_shown = "slide"
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
