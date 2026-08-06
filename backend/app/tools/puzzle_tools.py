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

from app.services import image_gen_service
from app.services.agent import teacher_service
from app.services.agent import practice_service as puzzle_service
from app.services.agent import practice_service as graph_service
from app.services.agent import practice_service as manipulative_service
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


def _parse_quick_options(v: Any) -> List[str]:
    """Parse quick-reply button labels. Prefer a JSON array or a PIPE-separated string so a
    label may itself contain a comma ("Yes, let's go!"); fall back to comma-splitting only
    when there's no pipe."""
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if not isinstance(v, str):
        return []
    s = v.strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                return [str(x).strip() for x in arr if str(x).strip()]
        except Exception:
            pass
    sep = "|" if "|" in s else ","
    return [p.strip() for p in s.split(sep) if p.strip()]


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


async def persist_and_return(ctx: ToolContext, full: dict) -> dict:
    """Store the full payload (with server-only solution) and return the client payload
    (no solution) with a fresh instance_id.

    Module-level rather than a closure because `visual_tools` shares it: every visual —
    puzzle, diagram, animation — must land on screen through the SAME path, or the puzzle
    state, the hands-on quota and the visual-family counts drift apart.

    The Learn panel shows ONE thing at a time, so whatever the agent shows LAST in a reply is
    what the student sees. We no longer REFUSE a second visual (that server guard caused the
    "I've put a puzzle" / nothing-on-screen mismatch); the agent is aligned to show one thing and
    talk about that one thing. `visual_shown` is still tracked so the runner knows a visual
    reached the screen this turn.
    """
    kind = full.get("render") or "visual"
    try:
        ctx.visual_shown = kind
    except Exception:  # noqa: BLE001 — frozen/duck-typed ctx must never break a lesson
        pass
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
    # Record which VISUAL FAMILY reached the screen (puzzle · animation · svg · mermaid) so the
    # anchor can hold the PHASE's target mix instead of the tutor reusing one family all lesson.
    try:
        await puzzle_service.bump_visual_family(
            ctx.db, ctx.appointment_id,
            puzzle_service.visual_family_for(full.get("render")),
            phase=getattr(ctx, "phase", None),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("bump_visual_family failed: %s", e)
    # Coverage ledger — record the QUESTION asked and the activity played, so the tutor doesn't
    # re-ask an identical question or replay the same puzzle (the exact KS1 repetition bug).
    # Explanatory diagrams are teaching visuals, not questions, so they're not logged here.
    if ptype != "explanatory":
        try:
            from app.services import coverage_ledger
            _q = full.get("question") or full.get("prompt")
            if _q:
                await coverage_ledger.add_question_asked(ctx.db, ctx.appointment_id, str(_q))
            _rk = full.get("render") or ptype or "puzzle"
            _disc = full.get("target")
            _pid = f"{_rk}:{_disc}" if _disc is not None else str(_rk)
            await coverage_ledger.add_puzzle_done(ctx.db, ctx.appointment_id, _pid)
        except Exception:  # noqa: BLE001 — ledger must never break puzzle display
            logger.warning("ledger puzzle-record failed appt=%s", ctx.appointment_id, exc_info=True)
    client = puzzle_service._client_payload(full)
    client["instance_id"] = instance_id
    client["rendered"] = True
    logger.info("PUZZLE built render=%s type=%s instance=%s",
                client.get("render"), client.get("puzzle_type"), instance_id)
    return client


def puzzle_tool_groups(ctx: ToolContext) -> dict:
    """Generative puzzle tools (generators + clear + evaluators) for the registry.

    Display-only teaching visuals (mermaid / svg / manim) live in `visual_tools.py` — they are
    what the tutor EXPLAINS with, while these are what the student DOES.
    """

    async def _persist_and_return(full: dict) -> dict:
        return await persist_and_return(ctx, full)

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
                    "message": ("The picture puzzle could NOT be built (image generation failed), so "
                                "NOTHING is on the student's screen. Do NOT tell the student and do "
                                "NOT say 'here's a puzzle' / 'tap the option' / 'it's on your screen'. "
                                "Set a DIFFERENT puzzle that needs NO pictures: math_puzzle (tappable "
                                "answer buttons), manipulative_puzzle, or diagram_math_puzzle — or ask "
                                "ONE quick question with quick_replies tap options.")}
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
                    "message": ("The picture puzzle could NOT be built (image generation failed), so "
                                "NOTHING is on the student's screen. Do NOT tell the student and do "
                                "NOT say 'here's a puzzle' / 'tap the option' / 'it's on your screen'. "
                                "Set a DIFFERENT puzzle that needs NO pictures: math_puzzle (tappable "
                                "answer buttons), manipulative_puzzle, or diagram_math_puzzle — or ask "
                                "ONE quick question with quick_replies tap options.")}
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

        ⚠️ WHERE MATHS GOES — FOLLOW THIS EVERY TIME:
          • The EQUATION goes in `latex` (typeset by KaTeX) — the ONLY place LaTeX commands belong.
          • `question` is PLAIN spoken text — write fractions as "3/7", "one half", "x squared".
            NEVER put a LaTeX command (\frac, \times, ^, _, curly braces) in `question`: it is NOT
            typeset there, so `\frac{1}{2}` shows to the student as raw gibberish like "rac{1}{2}".
          Example — "add 3/7 and 2/7":  question="What is 3/7 + 2/7?",
                    latex="\\frac{3}{7}+\\frac{2}{7}=\\;?",  answer="5/7".

        MULTIPLE CHOICE — prefer this for younger students (KS1-KS3): pass `distractors` as a
        short COMMA-SEPARATED STRING of 2-3 PLAUSIBLE WRONG answers
        (e.g. answer="12", distractors="10, 14, 21"). The student then TAPS one of four
        colourful bubbles instead of typing — far friendlier for small children. Make the
        wrong answers tempting (common mistakes), not silly. You supply only the wrong ones;
        the server adds the correct answer and shuffles them, so never put the correct answer
        in `distractors`. Omit `distractors` to keep it typed (fine for older students /
        open-ended answers); for a plain numeric answer the server still adds tappable options
        automatically.

        `latex` IS AN EQUATION ONLY — it is typeset by KaTeX. Never put prose, a markdown image,
        an HTML tag or a URL in it (they render as gibberish, letter by letter). If the question
        needs a FIGURE the student must look at (a labelled triangle, a shape with dimensions), do
        NOT try to embed it here — put the figure on screen FIRST with draw_svg (or use
        diagram_math_puzzle), then ask about it. If the words alone are enough, leave `latex`
        empty and put everything in `question`.

        WRITE VALID KaTeX (the server does NOT repair it — invalid LaTeX bounces back to you to
        fix, so get it right first time):
          • Backslash EVERY command: \\frac \\times \\div \\cdot \\sqrt \\pi \\theta \\sin \\cos
            \\tan \\le \\ge \\neq \\pm \\approx \\infty  (never bare "frac", "times", "sin", "pi").
          • Fractions need braces: \\frac{3}{4}  (NOT \\frac34 or frac34). Nested too: \\frac{x+1}{2}.
          • Powers/indices: single char x^2 is fine; MULTI-char needs braces: x^{10}, 10^{-3}, x_{1}.
          • Multiply with \\times or \\cdot — never "x" or "*". Roots: \\sqrt{2}, \\sqrt[3]{8}.
          • Units go in \\text with a thin space: 6\\,\\text{cm}, 9.8\\,\\text{m/s}^2 (never a bare "6 cm").
          • Escape percent: 20\\% of 50  (a bare % is a COMMENT and eats the rest of the line).
          • NO $…$ or \\(…\\) delimiters, NO prose words inside — just the raw equation.
          • Tables/value-grids: \\begin{array}{cc} x & y \\\\ 1 & 3 \\end{array} (never \\array|c|c|).
          Example: "3/4 of 20" → latex="\\frac{3}{4}\\times 20 = \\;?", answer="15".

        After showing it, WAIT — on submit call math_evaluator. Not for graphs (use
        graph_puzzle). Call SILENTLY.
        """
        # A `latex` carrying an image/URL means the model meant to SHOW a figure. Refusing loudly
        # is the only safe answer: dropping it silently ships a question about a diagram that was
        # never drawn ("find the length of side x" with no triangle on screen).
        _clean_latex, _latex_problem = puzzle_service.clean_math_latex(latex)
        if _latex_problem == "figure":
            return {"action": "show_puzzle", "error": "latex_not_an_equation",
                    "message": "`latex` is typeset by KaTeX, so it can only hold an EQUATION — "
                               "the image/URL you put there would render as gibberish and the "
                               "figure would never appear. Draw the figure FIRST with draw_svg "
                               "(or use diagram_math_puzzle), then call math_puzzle again asking "
                               "about what is now on screen — or drop `latex` and put the whole "
                               "problem in `question`."}
        latex = _clean_latex
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
                                  question: str = "", display_only: bool = False) -> dict:
        """
        A DETERMINISTIC maths diagram where the picture and the answer are computed by the
        server from the SAME params, so they can NEVER disagree (unlike a generated image,
        which can't render exact counts/positions — that is why a generated "2/6" bar can come
        out looking like 1/5).
        USE THIS (not explanatory_puzzle, not math_puzzle/image) for ANYTHING showing an exact
        fraction, count, clock time or measured length — both when TEACHING and when practising:
          • concept="fraction", params {"total": 8, "shaded": 1}  → a circle with that many
            equal parts, that many shaded; answer is derived (e.g. "1/8").
          • concept="clock", params {"hour": 3, "minute": 0}      → an analogue clock;
            answer derived (e.g. "3 o'clock", or "half past 3" for minute 30).
          • concept="ruler", params {"length_cm": 8, "object": "pencil"} → an object drawn
            against a cm ruler; answer derived (e.g. "8 cm"). Use for measuring length.

        display_only=True → a WORKED-EXAMPLE picture for TEACHING: the diagram is shown with a
        server-written caption that states the answer, and there is NOTHING for the student to
        submit (do not wait for an answer, just keep teaching from it). Use this for "here is a
        worked example, look at the shape" moments — NEVER explanatory_puzzle for an exact
        fraction/clock/count, because its AI-drawn image gets the counts wrong.
        display_only=False (default) → PRACTICE: invite a go and WAIT; on submit call
        math_evaluator.

        Do NOT pass your own answer — the server owns it. Call SILENTLY.
        """
        p = _coerce_dict(params)
        clean, answer, default_q = puzzle_service.diagram_math_spec(concept, p)
        if not answer:
            return {"action": "show_puzzle", "error": "bad_concept",
                    "message": "Use concept 'fraction', 'clock' or 'ruler' for a diagram maths puzzle."}
        url = await graph_service.generate_math_diagram(concept, clean)
        if not url:
            return {"action": "show_puzzle", "error": "render_failed",
                    "message": "Couldn't draw that — ask the question another way."}
        if display_only:
            # A teaching diagram (no answer to submit). Caption is derived from the SAME params
            # as the picture, so what's written under it always matches what's drawn.
            caption = question.strip() or puzzle_service.diagram_example_caption(concept, clean, answer)
            return await _persist_and_return(
                teacher_service.build_explanatory(url, caption, title="")
            )
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
          • kind="clock_hands", params {"hour": 3, "minute": 30}
              An analogue clock whose hands the student DRAGS to show a time. USE THIS for the
              Time topic instead of ever typing "what time is it?" into the chat. KS1: minutes
              must be 0/15/30/45. KS2: any multiple of 5.
          • kind="money_coins", params {"amount_p": 47}
              Real UK coins the student taps to make an amount. amount_p is IN PENCE. Marked on
              the TOTAL, so any correct combination counts. For money/change/shopping.
          • kind="number_line_jump", params {"start": 3, "step": 2, "jumps": 4,
              "direction": "forward"|"back"}
              Hops along a number line; the student taps where they land. For counting on/back,
              skip counting, and adding/subtracting on a line.
          • kind="coordinate_plot", params {"x": 3, "y": 4}
              The student taps a point on a grid. KS2 gets 0-10; KS3+ gets four quadrants (-6..6).

        ── ADVANCED MATHS (KS3-KS5 — hands-on at THEIR level, never counters) ──
          • kind="equation_balance", params {"a": 3, "b": 2, "c": 11}   → solves ax + b = c
              A balance beam that tips in real time as the student slides x. (c − b) MUST divide
              exactly by a. For solving linear equations / inverse operations.
          • kind="algebra_tiles", params {"b": 5, "c": 6}               → x² + bx + c
              An area model the student sizes to factorise the quadratic. b and c must factorise
              into two POSITIVE whole numbers. For factorising/expanding brackets.

        ── SCIENCE (KS1-KS5) ──
        These take a `set`/named subject value, NOT items you invent: the SERVER owns the
        science content and the answers, so you cannot get the science wrong. If you pass a set
        that doesn't exist or doesn't suit the key stage, the error lists the valid ones.
          • kind="sorting_bins", params {"set": "living_nonliving"}
              Items the student sorts into labelled groups. THE most reusable science activity.
              Sets: living_nonliving · materials · solid_liquid_gas · magnetic_nonmagnetic ·
              conductors_insulators · herbivore_carnivore_omnivore · vertebrates_invertebrates ·
              renewable_nonrenewable · acids_alkalis · metals_nonmetals ·
              elements_compounds_mixtures · prokaryote_eukaryote · plant_animal_cell
          • kind="sequence_order", params {"set": "water_cycle"}
              Stages the student taps into the right order.
              Sets: butterfly_life_cycle · frog_life_cycle · plant_life_cycle · food_chain ·
              water_cycle · planets · scientific_method · digestion · blood_circulation ·
              mitosis · rock_cycle
          • kind="atom_builder", params {"element": "carbon"}     (first 20 elements)
              The student adds protons/neutrons/electrons and the shells fill live. The server
              varies the ask between a neutral atom, an isotope and (KS4/KS5) an ion.
          • kind="balance_equation", params {"equation": "CH4 + O2 -> CO2 + H2O"}
              The student sets the coefficients while a live atom tally shows each side. Write
              formulae ONLY (no coefficients) — the server works out the balance itself, so any
              sensible equation works, not a fixed list.
          • kind="ph_scale", params {"substance": "lemon_juice"}
              The student slides a marker to the substance's pH.
          • kind="force_arrows", params {"a": 30, "a_dir": "right", "b": 50, "b_dir": "left"}
              Two force arrows on a box, EACH drawn in its own direction; the student gives the
              resultant's size and direction. VARY IT: point them the SAME way (they ADD, e.g.
              a_dir=right + b_dir=right) OR OPPOSITE ways (they subtract), and let the bigger force
              be on either side. Equal + opposite → balanced. This is a deterministic diagram, so
              use it for the WORKED EXAMPLE too (do NOT use explanatory_puzzle for a forces
              diagram — its AI-drawn arrows won't match your numbers).
          • kind="punnett_square", params {"parent1": "Bb", "parent2": "Bb", "trait": "brown eyes"}
              A genetic cross the student fills in. Both parents must use the SAME letter.

        After showing it, invite them to have a go and WAIT — on submit call
        manipulative_evaluator. Call SILENTLY.
        """
        k = (kind or "").strip().lower()
        available = manipulative_service.allowed_kinds(ctx.key_stage, ctx.subject)
        if not available:
            return {"action": "show_puzzle", "error": "not_for_key_stage",
                    "message": (f"NOTHING is on the student's screen — there's no hands-on activity "
                                f"for {ctx.subject} at {ctx.key_stage}. Do NOT tell the student and "
                                f"do NOT say a puzzle is on screen. Set a math_puzzle, matching_puzzle, "
                                f"labelling_puzzle or quick_replies instead.")}
        if k not in manipulative_service.MANIPULATIVES:
            return {"action": "show_puzzle", "error": "bad_kind",
                    "message": (f"NOTHING is on the student's screen — {kind!r} isn't a real activity. "
                                f"Do NOT tell the student and do NOT say a puzzle is on screen. "
                                f"For {ctx.subject} at {ctx.key_stage} either call manipulative_puzzle "
                                f"again with one of: {', '.join(available)} — or set a different "
                                f"puzzle (matching_puzzle, labelling_puzzle, math_puzzle, quick_replies).")}
        # Right kind, wrong audience — e.g. counting_bubbles in a KS4 lesson, or an atom builder
        # in a Maths lesson. Say so plainly so the model re-picks instead of guessing again.
        if k not in available:
            return {"action": "show_puzzle", "error": "not_for_key_stage",
                    "message": (f"NOTHING is on the student's screen — {k!r} isn't suitable for "
                                f"{ctx.subject} at {ctx.key_stage}. Do NOT tell the student and do NOT "
                                f"say a puzzle is on screen. Call manipulative_puzzle again with one of: "
                                f"{', '.join(available)} — or set a different puzzle "
                                f"(matching_puzzle, labelling_puzzle, math_puzzle, quick_replies).")}

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
                    "message": (f"The activity could NOT be built, so NOTHING is on the student's "
                                f"screen. Do NOT tell the student and do NOT say 'here's a puzzle' / "
                                f"'have a go' / 'it's on your screen'. Reason: {e}{topic} "
                                f"Either call manipulative_puzzle again with a VALID choice from that "
                                f"list, OR — if none of them fit this topic — set a DIFFERENT puzzle "
                                f"instead: matching_puzzle, labelling_puzzle, math_puzzle or "
                                f"quick_replies.")}
        if solution is None:
            return {"action": "show_puzzle", "error": "bad_kind",
                    "message": (f"NOTHING is on the student's screen — {kind!r} couldn't be built. "
                                f"Do NOT tell the student a puzzle is up. Choose one of: "
                                f"{', '.join(available)} — or set a different puzzle "
                                f"(matching_puzzle, labelling_puzzle, math_puzzle, quick_replies).")}
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

    @tool
    async def quick_replies(options: str) -> dict:
        """
        Attach 2-4 TAPPABLE quick-reply buttons under your message, so the student can ANSWER
        or ACKNOWLEDGE with ONE TAP instead of typing. Use this EVERY time you ask a short
        question or want a go-ahead and there is NO puzzle/quiz on screen — especially for
        younger students (KS1-KS3), who should almost never have to type. It is NOT a puzzle
        (no XP, no marking): it's just a friendlier way to collect a short reply.

        `options` is a short string of the button labels SEPARATED BY A PIPE "|" (use a pipe,
        NOT a comma, so a label can itself contain a comma):
          • a recall/concept question → the CORRECT answer plus plausible wrong ones, e.g.
            "A clock | A ruler | A book"     (for "What do we use to tell the time?")
          • a yes/no or a go-ahead      → "Yes, let's go! | Not yet"
        Keep each button to a few words; the student's tap is sent back as their reply.
        Write your question as NORMAL text first, then call this SILENTLY — the buttons appear
        beneath your message. Do NOT read the buttons out loud. If the question is really a
        maths practice question, prefer a puzzle (manipulative_puzzle / math_puzzle) instead.
        """
        opts = _parse_quick_options(options)
        seen, clean = set(), []
        for o in opts:
            k = o.lower()
            if o and k not in seen:
                seen.add(k)
                clean.append(o)
        clean = clean[:5]
        if len(clean) < 2:
            return {"action": "quick_replies", "error": "need_options",
                    "message": "Pass at least 2 tap options separated by a pipe, e.g. "
                               "\"A clock | A ruler | A book\"."}
        return {"action": "quick_replies", "options": clean}

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
        labelling_puzzle, matching_puzzle,
        math_puzzle, diagram_math_puzzle, graph_puzzle, clear_puzzle,
        labelling_evaluator, matching_evaluator, math_evaluator, graph_evaluator,
    ]
    # Bind the hands-on tools only when this subject + key stage actually HAS activities (an
    # unbound tool is a harder guarantee than an instruction the model can talk itself out of).
    # This is no longer "KS5 gets none": an A-Level student still gets hands-on work, just at
    # their level — a Punnett square or algebra tiles, never counters, because level is enforced
    # per registry entry.
    if manipulative_service.manipulatives_enabled(ctx.key_stage, ctx.subject):
        puzzles += [manipulative_puzzle, manipulative_evaluator]
    # `quick_replies` (tap-to-answer chips) is its OWN group so EVERY agent can offer taps as part
    # of its one response — the Teacher/Intro check understanding, not just the Practitioner — and
    # it never double-binds with the drill puzzles.
    return {"puzzles": puzzles, "interact": [quick_replies]}
