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

from app.services import image_gen_service, graph_service, puzzle_service, manipulative_service
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


def _coerce_list_of_str(v: Any) -> List[str]:
    """Distractors may arrive as a real list, a JSON array string '["10","14"]', or a plain
    comma-separated string '10, 14, 21'. Normalise any of them to a list of strings."""
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if str(x).strip()]
        except Exception:
            pass
        return [part.strip() for part in s.split(",") if part.strip()]
    return []


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
        ptype = full.get("puzzle_type")
        # Count it against the hands-on quota (KS1/2 100% · KS3 60% · KS4 30% · KS5 0%), which
        # is what the LESSON STATE anchor reads to tell the model which style to use next.
        # `explanatory` is a teaching diagram, not practice, so it doesn't count either way.
        if ptype != "explanatory":
            try:
                await manipulative_service.bump_mix(
                    ctx.db, ctx.appointment_id,
                    "manipulative" if ptype == "manipulative" else "classic",
                    # For a manipulative, `render` IS the kind — recorded so the next
                    # suggestion can avoid repeating it.
                    kind=full.get("render") if ptype == "manipulative" else None,
                )
            except Exception as e:  # noqa: BLE001
                logger.warning("bump_mix failed: %s", e)
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
                          latex: str = "", image_prompt: str = "",
                          distractors: str = "") -> dict:
        """
        Practice: pose a MATHS problem visually (never as plain chat text). Best for
        equations/arithmetic/algebra: mode="latex", give the problem in `latex`
        (e.g. "\\frac{3}{4}+\\frac{1}{4}=\\;?"). mode="image" (give `image_prompt`) is ONLY
        for a loose real-world illustration where the exact picture doesn't decide the
        answer — do NOT use it for "what fraction is shaded" or clocks (the image won't
        match your answer; use diagram_math_puzzle for those). `question` is the short
        instruction; `answer` is the correct answer (kept private, used to mark).

        MULTIPLE CHOICE — prefer this for younger students (KS1-KS3): pass `distractors` as a
        short COMMA-SEPARATED STRING of 2-3 PLAUSIBLE WRONG answers
        (e.g. answer="12", distractors="10, 14, 21"). The student then TAPS one of four
        colourful bubbles instead of typing — far friendlier for small children. Make the
        wrong answers tempting (common mistakes), not silly. You supply only the wrong ones;
        the server adds the correct answer and shuffles them, so never put the correct answer
        in `distractors`. Omit `distractors` to keep it typed (fine for older students /
        open-ended answers); for a plain numeric answer the server still adds tappable options
        automatically.

        After showing it, WAIT — on submit call math_evaluator. Not for graphs (use
        graph_puzzle). Call SILENTLY.
        """
        image_url = ""
        if mode == "image" and image_prompt:
            image_url = await image_gen_service.generate_image(image_prompt) or ""
        opts = distractors if isinstance(distractors, list) else _coerce_list_of_str(distractors)
        return await _persist_and_return(
            puzzle_service.build_math(question, answer, mode=mode, latex=latex,
                                      image_url=image_url, options=opts)
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
    async def manipulative_puzzle(kind: str, params: Union[dict, str] = "") -> dict:
        """
        Practice: a HANDS-ON maths activity the student physically plays with — tapping,
        dragging, colouring — instead of typing an answer into a box. This is the BEST
        practice tool for younger students (KS1/KS2), and the one to reach for whenever the
        LESSON STATE anchor says the next puzzle should be an interactive manipulative.

        You pass ONLY `kind` and its params. Do NOT pass a question and do NOT pass an
        answer — the server writes the question and works out the answer itself from your
        params, so the activity can never disagree with the marking.

        SIZE THE NUMBERS TO THIS LESSON. Every param is REQUIRED and there are NO defaults:
        if you leave one out the call is rejected, because a made-up number is worse than no
        puzzle. Read the lesson's topic and the student's year group, and match them exactly —
        a Year 1 "Place Value (within 10)" lesson means target 1-9, NOT 3,471. "Within 100"
        means up to 99; "within 1000" up to 999. The NUMBER you pass is the difficulty.

          • kind="place_value_counters", params {"target": 6}   ← "within 10" lesson
              Counters in 1000s/100s/10s/1s columns with +/- buttons, an expanded-form line and
              a running total. All four columns are ALWAYS shown, whatever the target — working
              out that 6 has zero thousands, zero hundreds and zero tens IS the place-value
              skill. For place value and expanded form.
          • kind="column_addition", params {"addends": [24, 38]}
              A column sum with per-digit answer boxes. 2-4 numbers, sized for the year group.
              For column addition and carrying.
          • kind="number_grid_sums", params {"size": 3, "values": [[7,8,3],[8,7,8],[3,2,1]]}
              A grid with row and column totals; some cells are blank and the missing tiles sit
              in a tray. size 2-4, values 1-9. For number bonds / mental maths.
          • kind="times_table_dash", params {"table": 8, "count": 10, "seconds": 60}
              Flashcards + a phone numpad + a countdown bar + a streak counter. A race — great
              for fluency and motivation. table 2-12.
          • kind="fraction_canvas", params {"denominator": 4, "shaded": 3}
              A shape the student splits into equal parts and colours in. For naming and
              building fractions. Halves and quarters for the youngest.
          • kind="dot_array", params {"rows": 4, "cols": 4}
              Tap to build an array of dots, then give the product. For times tables, arrays
              and square numbers.
          • kind="counting_bubbles", params {"count": 7, "item": "apples"}
              Tap each object and count them. KS1 counting. count 1-20.
          • kind="compare_numbers", params {"left": 29, "right": 92}
              Two number cards; the student TAPS the bigger (or smaller) number and submits.
              USE THIS instead of ever typing "which number is bigger, 29 or 92?" into the chat.
              For COMPARING two numbers. (At KS1/KS2 it's tap-the-number only; the <, =, > sign
              version is added automatically for KS3+ — the server chooses. Pass two DIFFERENT
              numbers for KS1/KS2.)
          • kind="order_numbers", params {"numbers": [45, 12, 51]}
              Scrambled number cards the student taps into order. USE THIS instead of ever typing
              "put these in order: 45, 12, 51" into the chat. For ORDERING/sequencing numbers.
              Pass 3-5 DIFFERENT numbers.

        After showing it, invite them to have a go and WAIT — on submit call
        manipulative_evaluator. Call SILENTLY.
        """
        k = (kind or "").strip().lower()
        if not manipulative_service.manipulatives_enabled(ctx.key_stage):
            return {"action": "show_puzzle", "error": "not_for_key_stage",
                    "message": "Manipulatives aren't used at this key stage — set a "
                               "math_puzzle or graph_puzzle instead."}
        if k not in manipulative_service.MANIPULATIVES:
            return {"action": "show_puzzle", "error": "bad_kind",
                    "message": f"Unknown kind {kind!r}. Choose one of: "
                               f"{', '.join(manipulative_service.KINDS)}."}

        try:
            clean, solution, prompt, title = manipulative_service.build_spec(
                k, _coerce_dict(params), ctx.key_stage,
            )
        except manipulative_service.ParamError as e:
            # Hand the reason straight back to the model instead of quietly substituting a
            # default. A silent default is how a Year 1 "make 6" became "Build 3,471": the
            # tutor said one number and the screen showed another.
            topic = f" This lesson's topic is {ctx.topic_title!r}." if ctx.topic_title else ""
            logger.info("MANIPULATIVE bad params kind=%s: %s", k, e)
            return {"action": "show_puzzle", "error": "bad_params",
                    "message": f"{e}{topic} Fix the params and call manipulative_puzzle again."}
        if solution is None:
            return {"action": "show_puzzle", "error": "bad_kind",
                    "message": f"Unknown kind {kind!r}. Choose one of: "
                               f"{', '.join(manipulative_service.KINDS)}."}
        full = puzzle_service.build_manipulative(k, clean, solution, prompt, title)
        return await _persist_and_return(full)

    @tool
    async def manipulative_evaluator() -> dict:
        """Mark the student's answer to the hands-on activity on screen. Marked exactly
        (no guessing — the server knows the answer it set), and returns
        {score, correct, per_item, feedback}. Then narrate it warmly: praise what they got
        right, and for anything wrong use the feedback's hint WITHOUT giving the answer away."""
        return await _evaluate("manipulative")

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
        # `render` carries the manipulative KIND (place_value_counters, …) — evaluate() needs
        # it to pick the right deterministic marker. For the generative puzzles it's ignored.
        verdict = await puzzle_service.evaluate(
            ps.get("puzzle_type"), ps.get("solution"), ps.get("last_answer"),
            ps.get("prompt", ""), render=ps.get("render", ""),
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
        return {
            "action": "evaluate", "puzzle_type": ps.get("puzzle_type"),
            "xp_awarded": xp_awarded,
            # STRICT — read before you narrate. This puzzle is now spent; the one on screen is
            # the OLD one. If you are about to say "let's try one more / can you build 47 / what
            # about this one?", you MUST call a puzzle generator (manipulative_puzzle /
            # math_puzzle / diagram_math_puzzle / …) in THIS SAME reply FIRST — that call
            # clears the old puzzle and shows the new one. NEVER ask the student to build or
            # solve a new problem without generating its puzzle in the same turn, or they'll be
            # looking at the finished puzzle and see nothing new (they told us "I don't see it").
            # Only-praising-and-stopping is fine; asking-for-a-new-answer-without-generating is not.
            "next_step": ("Puzzle marked and spent. To give another go, CALL a generator this "
                          "turn BEFORE inviting an answer — generating clears the old puzzle and "
                          "shows the new one. Do NOT ask for a new answer without a new puzzle."),
            **verdict,
        }

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

    puzzles = [
        explanatory_puzzle, labelling_puzzle, matching_puzzle, math_puzzle,
        diagram_math_puzzle, graph_puzzle, clear_puzzle,
        labelling_evaluator, matching_evaluator, math_evaluator, graph_evaluator,
    ]
    # KS5 never gets manipulatives — an A-Level student does not want counters, and an
    # unbound tool is a harder guarantee than an instruction the model can talk itself out of.
    if manipulative_service.manipulatives_enabled(ctx.key_stage):
        puzzles += [manipulative_puzzle, manipulative_evaluator]
    return {"puzzles": puzzles}
