"""
puzzle_tools.py — GENERATIVE puzzle tools bound to Gemini during AI lessons.

The AI supplies the pedagogy (image prompts, labels, the correct answer, a graph spec);
these tools generate the media LIVE (Nano Banana images / matplotlib graphs), persist the
solution server-side, and return a render payload the frontend draws — same
`{type:"tool", tool:"show_puzzle"}` pipeline as before. After the student submits, the
matching `*_evaluator` tool marks their answer semantically.

Puzzle types: explanatory (display) · labelling · matching · math · graph.
"""
import json
import logging
from typing import Any, List, Optional, Union

from langchain_core.tools import tool

from app.services import image_gen_service, graph_service, puzzle_service
from app.tools.session_tools import ToolContext

logger = logging.getLogger(__name__)


def _coerce_list(v: Any) -> List[dict]:
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            return []
    if isinstance(v, dict):
        v = [v]
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _coerce_dict(v: Any) -> dict:
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            return {}
    return v if isinstance(v, dict) else {}


# XP earned for a fully-correct puzzle, by key-stage difficulty (harder stage → more XP).
# A wrong answer earns nothing; a partially-correct answer earns a proportional share.
_PUZZLE_XP_BY_KS = {"KS1": 10, "KS2": 12, "KS3": 15, "KS4": 18, "KS5": 20}


async def _award_puzzle_xp(ctx: ToolContext, verdict: dict) -> int:
    """Award XP for a graded puzzle attempt: nothing for a wrong answer, otherwise XP scaled
    by the puzzle's key-stage difficulty and how well they did (score 0-10). Called exactly
    once per puzzle (the evaluator flips status→'evaluated' right after), so it never
    double-counts. Returns the XP granted (0 if none)."""
    from app.services import platform_service
    score = float(verdict.get("score") or 0)
    correct = bool(verdict.get("correct"))
    # Wrong answer (and not close) → no XP, so XP reflects real understanding.
    if not correct and score < 7:
        return 0
    ks = (ctx.key_stage or "").upper().replace(" ", "")
    base = _PUZZLE_XP_BY_KS.get(ks, 12)
    xp = max(1, round(base * min(score, 10.0) / 10.0))
    await platform_service.award_xp(ctx.db, ctx.student_id, xp, "puzzle_correct")
    return xp


def puzzle_tool_groups(ctx: ToolContext) -> dict:
    """Generative puzzle tools (generators + clear + evaluators) for the registry."""

    async def _persist_and_return(full: dict) -> dict:
        """Store the full payload (with server-only solution) and return the client
        payload (no solution) with a fresh instance_id."""
        try:
            instance_id = await puzzle_service.set_puzzle_shown(ctx.db, ctx.appointment_id, full)
        except Exception as e:  # noqa: BLE001
            logger.warning("set_puzzle_shown failed: %s", e)
            instance_id = ""
        client = puzzle_service._client_payload(full)
        client["instance_id"] = instance_id
        client["rendered"] = True
        logger.info("PUZZLE built render=%s type=%s instance=%s",
                    client.get("render"), client.get("puzzle_type"), instance_id)
        return client

    @tool
    async def explanatory_puzzle(image_prompt: str, caption: str = "", title: str = "") -> dict:
        """
        Show a clear, generated diagram/illustration that EXPLAINS the concept you are
        teaching right now (e.g. "a labelled diagram comparing a plant cell and an animal
        cell", "the water cycle with arrows"). This is your GO-TO visual for teaching and
        for helping students who find a Science/Maths/Physics/Chemistry/Biology idea hard —
        show it instead of a wall of text. Display-only: the student just looks at it, so
        after showing it, keep teaching from it (no answer to wait for). image_prompt is a
        vivid description of the picture to draw; caption is one short line shown under it.
        Call SILENTLY.
        """
        key = f"{ctx.subject}|{ctx.key_stage}|{ctx.topic_title or ''}"
        url = await image_gen_service.generate_image(image_prompt, cache_key=key)
        if not url:
            return {"action": "show_puzzle", "error": "image_gen_failed",
                    "message": "The image couldn't be generated — keep teaching in words instead."}
        return await _persist_and_return(puzzle_service.build_explanatory(url, caption, title))

    @tool
    async def labelling_puzzle(items: str, prompt: str = "") -> dict:
        """
        Practice: show 3–4 SEPARATE generated pictures, one at a time, and the student
        types what each one is. Use for recognition/vocabulary (organs, shapes, animals,
        apparatus, materials…). items is a JSON array STRING of
        [{"label": "<correct name>", "image_prompt": "<a clear picture of ONE such thing on
        a white background>"}] — give 3–4 objects. Keep each image_prompt to a single,
        unambiguous subject so the picture clearly shows that thing. After showing it,
        invite the student to name each, then WAIT — on submit call labelling_evaluator.
        Call SILENTLY.
        """
        its = _coerce_list(items)
        urls = await image_gen_service.generate_images([it.get("image_prompt", "") for it in its])
        merged = [{"label": it.get("label", ""), "image_url": u} for it, u in zip(its, urls)]
        full = puzzle_service.build_labelling(merged, prompt)
        if full.get("error"):
            return {"action": "show_puzzle", "error": full["error"],
                    "message": "Couldn't generate enough images — ask a quick spoken question instead."}
        return await _persist_and_return(full)

    @tool
    async def matching_puzzle(items: str, prompt: str = "") -> dict:
        """
        Practice: show several generated pictures AND their names jumbled; the student
        matches each picture to its name. Same items shape as labelling_puzzle — a JSON
        array STRING of [{"label": ..., "image_prompt": ...}] — but give 3–6 objects. Good
        for pairing terms to visuals. After showing it, WAIT — on submit call
        matching_evaluator. Call SILENTLY.
        """
        its = _coerce_list(items)
        urls = await image_gen_service.generate_images([it.get("image_prompt", "") for it in its])
        merged = [{"label": it.get("label", ""), "image_url": u} for it, u in zip(its, urls)]
        full = puzzle_service.build_matching(merged, prompt)
        if full.get("error"):
            return {"action": "show_puzzle", "error": full["error"],
                    "message": "Couldn't generate enough images — ask a quick spoken question instead."}
        return await _persist_and_return(full)

    @tool
    async def math_puzzle(question: str, answer: str, mode: str = "latex",
                          latex: str = "", image_prompt: str = "") -> dict:
        """
        Practice: pose a MATHS problem visually (never as plain chat text). Best for
        equations/arithmetic/algebra: mode="latex", give the problem in `latex`
        (e.g. "\\frac{3}{4}+\\frac{1}{4}=\\;?"). mode="image" (give `image_prompt`) is ONLY
        for a loose real-world illustration where the exact picture doesn't decide the
        answer — do NOT use it for "what fraction is shaded" or clocks (the image won't
        match your answer; use diagram_math_puzzle for those). `question` is the short
        instruction; `answer` is the correct answer (kept private, used to mark). After
        showing it, WAIT — on submit call math_evaluator. Not for graphs (use graph_puzzle).
        Call SILENTLY.
        """
        image_url = ""
        if mode == "image" and image_prompt:
            image_url = await image_gen_service.generate_image(image_prompt) or ""
        return await _persist_and_return(
            puzzle_service.build_math(question, answer, mode=mode, latex=latex, image_url=image_url)
        )

    @tool
    async def diagram_math_puzzle(concept: str, params: Union[dict, str] = "",
                                  question: str = "") -> dict:
        """
        Practice: a DETERMINISTIC maths diagram where the answer must EXACTLY match the
        picture — the server draws it precisely AND computes the answer, so it's ALWAYS
        right (unlike a generated image, which can't render exact counts/positions).
        USE THIS (not math_puzzle/image) for:
          • concept="fraction", params {"total": 8, "shaded": 1}  → a circle with that many
            equal parts, that many shaded; answer is derived (e.g. "1/8").
          • concept="clock", params {"hour": 3, "minute": 0}      → an analogue clock;
            answer derived (e.g. "3 o'clock", or "half past 3" for minute 30).
          • concept="ruler", params {"length_cm": 8, "object": "pencil"} → an object drawn
            against a cm ruler; answer derived (e.g. "8 cm"). Use for measuring length.
        Do NOT pass your own answer — the server owns it. After showing it, invite a go and
        WAIT; on submit call math_evaluator. Call SILENTLY.
        """
        p = _coerce_dict(params)
        clean, answer, default_q = puzzle_service.diagram_math_spec(concept, p)
        if not answer:
            return {"action": "show_puzzle", "error": "bad_concept",
                    "message": "Use concept 'fraction' or 'clock' for a diagram maths puzzle."}
        url = await graph_service.generate_math_diagram(concept, clean)
        if not url:
            return {"action": "show_puzzle", "error": "render_failed",
                    "message": "Couldn't draw that — ask the question another way."}
        return await _persist_and_return(
            puzzle_service.build_math(question or default_q, answer, mode="image", image_url=url)
        )

    @tool
    async def graph_puzzle(question: str, answer: str, spec: Union[dict, str]) -> dict:
        """
        Practice: draw a real graph (matplotlib) and ask a question about it — for graph /
        coordinate / trig topics (mostly KS4/KS5). spec describes the graph:
        {"kind":"line"|"bar"|"scatter"|"function", "title","xlabel","ylabel", and one of:
        "series":[{"points":[[x,y],…],"label"?}], "points":[[x,y],…],
        "labels"+"values" (bar), or for "function": "xmin","xmax" plus EITHER
        "expr":"x**2"  (one curve)  OR  "functions":[{"expr":"2*x-1","label":"y = 2x - 1"},
        {"expr":"-x+5","label":"y = -x + 5"}]  (SEVERAL curves, drawn in different colours
        with a legend).

        EVERY line your question refers to must be in the spec. If you ask where two lines
        intersect, you MUST pass BOTH of them in "functions" — passing one and describing two
        is rejected, because the student would be asked about a line that isn't on screen.
        Pick xmin/xmax so the point you're asking about is actually visible.

        `question` is shown to the student; `answer` is the correct answer (private). After
        showing it, WAIT — on submit call graph_evaluator. Call SILENTLY.
        """
        spec_d = _coerce_dict(spec)
        n_curves = graph_service.curve_count(spec_d)

        # Guard the exact failure that shipped: the model asked "where do these two lines
        # intersect?" while the spec held ONE expression, so one line was drawn and the puzzle
        # was unanswerable. It then "apologised and fixed it" — and drew one line again,
        # because nothing ever told it the graph couldn't match the question. Now it does.
        q = (question or "").lower()
        implies_multi = any(w in q for w in (
            "intersect", "cross", "both lines", "two lines", "each other",
            "simultaneous", "meet",
        ))
        if implies_multi and n_curves < 2:
            return {
                "action": "show_puzzle", "error": "needs_two_curves",
                "message": (
                    "Your question refers to two or more lines but the spec only draws "
                    f"{n_curves}. Re-call graph_puzzle with kind='function' and "
                    "\"functions\":[{\"expr\":\"…\",\"label\":\"…\"},{\"expr\":\"…\",\"label\":\"…\"}] "
                    "so every line you ask about is actually drawn."
                ),
            }

        url = await graph_service.generate_graph(spec_d)
        if not url:
            return {"action": "show_puzzle", "error": "graph_failed",
                    "message": "Couldn't draw that graph — ask the question another way."}
        logger.info("PUZZLE graph curves=%s q=%r", n_curves, (question or "")[:60])
        return await _persist_and_return(puzzle_service.build_graph(question, answer, url))

    @tool
    async def clear_puzzle() -> dict:
        """
        Remove the current puzzle/diagram from the student's screen (e.g. once they've
        finished it and you're moving on to teach the next thing, or back to slides). Call
        SILENTLY — never just say you're clearing it.
        """
        try:
            await puzzle_service.clear_puzzle_state(ctx.db, ctx.appointment_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("clear puzzle_state failed: %s", e)
        return {"action": "clear_puzzle"}

    # ── Evaluators — read the on-screen puzzle's (server-only) solution + the student's
    #    submitted answer, and mark it semantically. Return the verdict for you to NARRATE.
    async def _evaluate(expected_type: str) -> dict:
        try:
            ps = await puzzle_service.get_puzzle_state(ctx.db, ctx.appointment_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("get_puzzle_state failed: %s", e)
            ps = None
        if not ps:
            return {"action": "evaluate", "error": "no_puzzle",
                    "message": "There's no puzzle on screen to mark."}
        status = ps.get("status")
        if status == "evaluated":
            # Already graded once — never re-check a solved puzzle (this is what made the AI
            # re-mark a puzzle from many messages ago). Move on instead.
            return {"action": "evaluate", "error": "already_evaluated",
                    "message": "You have already marked this puzzle — do NOT check it again. "
                               "Move on: teach the next thing, set a NEW puzzle, or clear it."}
        if status != "submitted":
            return {"action": "evaluate", "error": "no_submission",
                    "message": "The student hasn't submitted an answer yet — invite them to have a go, then wait."}
        verdict = await puzzle_service.evaluate(
            ps.get("puzzle_type"), ps.get("solution"), ps.get("last_answer"), ps.get("prompt", "")
        )
        # Grade exactly once: flip to 'evaluated' so it can't be re-marked later.
        try:
            await puzzle_service.mark_puzzle_evaluated(ctx.db, ctx.appointment_id, verdict)
        except Exception as e:  # noqa: BLE001
            logger.warning("mark_puzzle_evaluated failed: %s", e)
        # Award XP for the attempt (correct → XP by difficulty; wrong → none). Once only.
        xp_awarded = 0
        try:
            xp_awarded = await _award_puzzle_xp(ctx, verdict)
        except Exception as e:  # noqa: BLE001
            logger.warning("puzzle XP award failed: %s", e)
        logger.info("PUZZLE evaluated type=%s score=%s correct=%s xp=%s",
                    ps.get("puzzle_type"), verdict.get("score"), verdict.get("correct"), xp_awarded)
        return {"action": "evaluate", "puzzle_type": ps.get("puzzle_type"),
                "xp_awarded": xp_awarded, **verdict}

    @tool
    async def labelling_evaluator() -> dict:
        """Mark the student's LABELLING answer (their typed names for each picture).
        Returns {score 0-10, correct, per_item, feedback}. Then tell them how they did —
        praise what's right; for anything wrong, give a gentle hint (don't reveal it)."""
        return await _evaluate("labelling")

    @tool
    async def matching_evaluator() -> dict:
        """Mark the student's MATCHING answer (their picture↔name pairs). Returns
        {score, correct, per_item, feedback}. Then give warm, specific feedback."""
        return await _evaluate("matching")

    @tool
    async def math_evaluator() -> dict:
        """Mark the student's MATHS answer (accepts equivalent forms: 1/2 = 0.5 = a half).
        Returns {score, correct, feedback}. Then respond: praise if right, or a hint if not."""
        return await _evaluate("math")

    @tool
    async def graph_evaluator() -> dict:
        """Mark the student's GRAPH answer. Returns {score, correct, feedback}. Then respond
        warmly with the verdict and a hint if they were off."""
        return await _evaluate("graph")

    return {
        "puzzles": [
            explanatory_puzzle, labelling_puzzle, matching_puzzle, math_puzzle,
            diagram_math_puzzle, graph_puzzle, clear_puzzle,
            labelling_evaluator, matching_evaluator, math_evaluator, graph_evaluator,
        ],
    }
