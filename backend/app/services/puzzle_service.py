"""
puzzle_service.py — build + persist + semantically evaluate GENERATED puzzles.

The AI supplies the pedagogy (labels, image prompts, the correct answer, a graph spec);
this module turns that into a render payload (generating media via image_gen_service /
graph_service) and persists the SOLUTION server-side in
`LessonPlan.session_state["puzzle_state"]` (never sent to the client). After the student
submits, `evaluate()` judges their answer SEMANTICALLY with a fast model
("mitochondrion" ≈ "mitochondria", "a half" ≈ "1/2").

Puzzle types (render key):
  explanatory_image · labelling · matching · math · graph
  + the DETERMINISTIC manipulatives (place_value_counters, fraction_canvas, …) — see
    manipulative_service. Those invert the contract: the AI passes params only, the server
    derives the question AND the answer from them, and marking is an exact comparison
    rather than an LLM judge, so the puzzle can't contradict itself.
"""
import json
import logging
import random
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services import image_gen_service, graph_service

logger = logging.getLogger(__name__)


# ── Backdrops ────────────────────────────────────────────────────────────────────
# Every puzzle box gets one of these behind it, chosen at random per puzzle so it never looks
# the same twice (frontend renders them from components/puzzles/backgrounds). Split by theme:
# the LIGHT ones sit behind the light-themed manipulatives; the DARK ones are for the math
# puzzle, which is drawn light-on-dark like the Synthesis screens.
_LIGHT_BACKGROUNDS = ["aurora", "blueprint", "paper"]
_DARK_BACKGROUNDS = ["mesh", "bubbles"]


def pick_background(dark: bool = False) -> str:
    return random.choice(_DARK_BACKGROUNDS if dark else _LIGHT_BACKGROUNDS)


# ── Builders ─────────────────────────────────────────────────────────────────────
# Each returns a full payload INCLUDING `solution` + `puzzle_type`. The tool persists
# the whole thing, then strips `solution` before handing the client payload to the model.

def build_explanatory(image_url: str, caption: str = "", title: str = "") -> Dict[str, Any]:
    return {
        "render": "explanatory_image",
        "puzzle_type": "explanatory",
        "title": title or "Let's look at this",
        "prompt": caption or "",
        "params": {"image": image_url, "caption": caption or ""},
        "solution": None,            # display-only, nothing to grade
        "answer_type": "none",
    }


# Mermaid diagram types the client can render. Used only to sanity-check that the model actually
# sent a diagram (not prose), so a broken spec is bounced back to it rather than shown as an error.
_MERMAID_STARTS = (
    "graph", "flowchart", "sequencediagram", "classdiagram", "statediagram", "erdiagram",
    "gantt", "pie", "mindmap", "timeline", "journey", "gitgraph", "quadrantchart",
    "xychart", "sankey", "requirementdiagram", "block-beta", "c4context",
)


def clean_mermaid(spec: str) -> str:
    """Strip ```mermaid fences / stray backticks the model wraps around the spec."""
    s = (spec or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s).strip()
    return s


def is_valid_mermaid(spec: str) -> bool:
    first = (spec or "").lstrip().lower()
    return any(first.startswith(k) for k in _MERMAID_STARTS)


def build_mermaid(spec: str, caption: str = "", title: str = "") -> Dict[str, Any]:
    """A MERMAID diagram rendered LIVE in the browser (flowchart / cycle / sequence / timeline /
    state / mind-map …). Display-only — accurate and instant, no image generation, no GPU, and it
    can't misrender counts the way a generated picture can. Same show_puzzle pipeline as the rest."""
    return {
        "render": "mermaid",
        "puzzle_type": "explanatory",
        "title": title or "Diagram",
        "prompt": caption or "",
        "params": {"mermaid": clean_mermaid(spec), "caption": caption or ""},
        "solution": None,
        "answer_type": "none",
    }


def build_svg_diagram(svg: str, caption: str = "", title: str = "") -> Dict[str, Any]:
    """A deterministic, server-drawn SVG teaching diagram (cell, circuit, wave, solar system…).
    Display-only. Drawn by code from validated params, so the picture always matches what the
    tutor says — unlike a generated image, which can misdraw structures and labels."""
    return {
        "render": "svg_diagram",
        "puzzle_type": "explanatory",
        "title": title or "Diagram",
        "prompt": caption or "",
        "params": {"svg": svg, "caption": caption or ""},
        "solution": None,
        "answer_type": "none",
    }


def build_animation(video_url: str, caption: str = "", title: str = "",
                    poster_url: str = "") -> Dict[str, Any]:
    """A pre-rendered Manim animation (MP4). Display-only. `video_url` is served from the animation
    cache; `poster_url` is an optional first-frame image shown while it loads."""
    return {
        "render": "animation",
        "puzzle_type": "explanatory",
        "title": title or "Animation",
        "prompt": caption or "",
        "params": {"video": video_url, "poster": poster_url or "", "caption": caption or ""},
        "solution": None,
        "answer_type": "none",
    }


def build_labelling(items: List[Dict[str, str]], prompt: str = "") -> Dict[str, Any]:
    """items: [{label, image_url}] — student names each image in turn."""
    good = [it for it in items if it.get("image_url")]
    if len(good) < 2:
        return {"error": "image_gen_failed"}
    imgs = [{"id": str(i), "image": it["image_url"]} for i, it in enumerate(good)]
    solution = {str(i): (it.get("label") or "").strip() for i, it in enumerate(good)}
    return {
        "render": "labelling",
        "puzzle_type": "labelling",
        "title": "Name each picture",
        "prompt": prompt or "Look at each picture and type what it is.",
        "params": {"images": imgs},                 # no labels sent to the client
        "solution": solution,
        "answer_type": "labels",
    }


def build_matching(items: List[Dict[str, str]], prompt: str = "") -> Dict[str, Any]:
    """items: [{label, image_url}] — student matches each image to its name."""
    good = [it for it in items if it.get("image_url")]
    if len(good) < 3:
        return {"error": "image_gen_failed"}
    imgs = [{"id": str(i), "image": it["image_url"]} for i, it in enumerate(good)]
    solution = {str(i): (it.get("label") or "").strip() for i, it in enumerate(good)}
    labels = [it["label"] for it in good]
    random.shuffle(imgs)
    random.shuffle(labels)
    return {
        "render": "matching",
        "puzzle_type": "matching",
        "title": "Match the pictures",
        "prompt": prompt or "Match each picture to its name.",
        "params": {"images": imgs, "labels": labels},
        "solution": solution,
        "answer_type": "match",
    }


def _auto_numeric_distractors(ans: str) -> List[str]:
    """When the AI forgets to supply wrong answers, synthesise plausible near-misses for a
    plain WHOLE-NUMBER answer so the puzzle still shows tappable bubbles (options) rather than
    a bare text box. Only fires for integers — algebraic / worded answers stay typed."""
    raw = ans.strip()
    try:
        n = int(raw.replace(",", ""))
    except ValueError:
        return []
    use_commas = "," in raw
    fmt = (lambda v: f"{v:,}") if use_commas else str
    out: List[str] = []
    seen = {n}
    for d in (1, -1, 2, -2, 10, -10, 3, -3, 5, -5):
        c = n + d
        if c >= 0 and c not in seen:
            seen.add(c)
            out.append(fmt(c))
        if len(out) >= 3:
            break
    return out


# LaTeX commands the model routinely emits with the leading backslash lost — the classic
# failure is "\frac34" arriving as "frac34", which KaTeX then renders as the literal word.
_LATEX_CMDS = ("dfrac", "tfrac", "frac", "sqrt", "times", "div", "cdot", "pm", "mp",
               "leq", "geq", "neq", "approx", "ldots", "cdots", "angle", "overline", "text")

# Things that must never reach KaTeX. A student saw a maths card render as
# "textFindthelengthofsidex … dth = 200px]https://storage.googleapis.com/…" because the model
# put prose AND a markdown image into `latex`; KaTeX has no idea what either is, so it set the
# URL as maths, letter by letter.
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK = re.compile(r"(?<!!)\[[^\]]*\]\([^)]*\)")
_URL_RE = re.compile(r"(https?://|www\.)\S+", re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]+>")
# Does what's left actually contain maths? A digit, an operator, or a LaTeX command.
_HAS_MATH = re.compile(r"[0-9]|[+\-=<>^_/×÷≤≥≠±]|\\(?!text\b)[A-Za-z]+")


def clean_math_latex(s: str) -> tuple:
    """(latex, problem) for the KaTeX equation card.

    `problem` is "" when the latex is usable, otherwise a short reason:
      "figure" — it carried an image/URL, i.e. the model tried to SHOW something. That must be
                 surfaced as a tool error, because silently dropping it leaves the student a
                 question about a diagram that isn't on screen ("find the length of side x" with
                 no triangle anywhere).
      "prose"  — it was only words, which the prompt line already says. Safe to drop silently.
    """
    if not s or not str(s).strip():
        return "", ""
    t = str(s)
    had_figure = bool(_MD_IMAGE.search(t) or _URL_RE.search(t))
    t = _MD_IMAGE.sub(" ", t)
    t = _MD_LINK.sub(" ", t)
    t = _URL_RE.sub(" ", t)
    t = _HTML_TAG.sub(" ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    if had_figure:
        return "", "figure"
    t = _repair_latex(t)
    if not t or not _HAS_MATH.search(t):
        return "", "prose"
    return t, ""


def _latexish_to_plain(s: str) -> str:
    """Turn simple LaTeX into plain reading text for places that are NOT rendered by KaTeX — the
    question line and the tappable answer bubbles. The model sometimes writes options/answers as
    "\\frac{3}{5}" or wraps the question in "\\(…\\)"; those show up as the raw string on a plain
    button. Fractions become "3/5", common operators become their symbols, math delimiters are
    dropped. (The main equation card still gets real LaTeX via _repair_latex.)"""
    if not s:
        return s
    t = str(s)
    t = re.sub(r"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"\1/\2", t)   # \frac{3}{5} → 3/5
    t = re.sub(r"\\[dt]?frac\s*(\d)\s*(\d)", r"\1/\2", t)                    # \frac35 → 3/5
    for a, b in (("\\times", "×"), ("\\div", "÷"), ("\\cdot", "·"),
                 ("\\leq", "≤"), ("\\geq", "≥"), ("\\neq", "≠"),
                 ("\\pm", "±"), ("\\degree", "°"), ("\\circ", "°")):
        t = t.replace(a, b)
    for d in ("\\(", "\\)", "\\[", "\\]"):
        t = t.replace(d, "")
    t = re.sub(r"\$+", "", t)
    return re.sub(r"\s+", " ", t).strip()


def _repair_latex(s: str) -> str:
    """Best-effort repair of LaTeX the model mangled, so the student never sees raw "frac34".
    Strips stray math delimiters ($…$, \\(…\\)) that BlockMath doesn't want, and re-adds the
    backslash on known commands where it was dropped (only when it isn't already there and the
    command isn't part of a plain word like 'fractions')."""
    if not s:
        return s
    t = s.strip()
    for a, b in (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$")):
        if t.startswith(a) and t.endswith(b) and len(t) > len(a) + len(b):
            t = t[len(a):len(t) - len(b)].strip()
            break
    for cmd in _LATEX_CMDS:
        # add a backslash before the command when it's not already backslashed and not glued to
        # surrounding letters (so 'frac34'/'frac{3}{4}' are fixed but 'fractions' is left alone).
        t = re.sub(rf"(?<!\\)(?<![A-Za-z]){cmd}(?![A-Za-z])", "\\\\" + cmd, t)
    return t


def build_math(question: str, answer: str, *, mode: str = "latex",
               latex: str = "", image_url: str = "",
               options: Optional[List[str]] = None) -> Dict[str, Any]:
    mode = mode if mode in ("latex", "image") else "latex"
    if mode == "image" and not image_url:
        mode = "latex"
    # Defence in depth: the tool already refuses a `latex` carrying a figure, so anything left
    # here is either a real equation or prose worth dropping. Never hand raw model text to KaTeX.
    latex, _latex_problem = clean_math_latex(latex)
    # The question line and the answer bubbles are plain text (not KaTeX), so any LaTeX the model
    # slipped into them ("\frac{3}{5}", "\(\frac{2}{3}\)") must be turned into readable text or it
    # shows up raw on the button / in the prompt.
    question = _latexish_to_plain(question)

    # Multiple-choice: the AI gives wrong answers, the server builds the option set. Building it
    # HERE (not trusting the AI's list) guarantees the correct answer is always present exactly
    # once and its position is shuffled — so a student can't learn "it's always the 2nd bubble".
    opts: List[str] = []
    ans = _latexish_to_plain(str(answer).strip())
    for o in (options or []):
        s = _latexish_to_plain(str(o).strip())
        if s and s.lower() != ans.lower() and s.lower() not in {x.lower() for x in opts}:
            opts.append(s)
    # No usable distractors from the AI → try to build them ourselves so a numeric maths
    # problem is STILL multiple-choice (the friendlier path for young students).
    if not opts:
        opts = _auto_numeric_distractors(ans)
    if opts:
        opts = opts[:3] + [ans]
        random.shuffle(opts)

    return {
        "render": "math",
        "puzzle_type": "math",
        "title": "Have a go",
        "prompt": question or "Solve it.",
        "params": {
            "mode": mode, "latex": latex or "", "image": image_url or "",
            "options": opts,                       # non-empty → the client shows tappable bubbles
            "background": pick_background(dark=True),
        },
        "solution": ans,
        # "choice" is only a hint to the UI (bubbles vs typing); marking is the same either way.
        "answer_type": "choice" if opts else "text",
    }


def build_graph(question: str, answer: str, image_url: str) -> Dict[str, Any]:
    return {
        "render": "graph",
        "puzzle_type": "graph",
        "title": "Read the graph",
        "prompt": question or "Answer from the graph.",
        "params": {"image": image_url, "background": pick_background(dark=False)},
        "solution": str(answer),
        "answer_type": "text",
    }


def build_manipulative(kind: str, clean_params: Dict[str, Any], solution: Any,
                       prompt: str, title: str) -> Dict[str, Any]:
    """A deterministic interactive manipulative (place-value counters, fraction canvas,
    times-table dash…). `render` IS the kind, so the frontend switches straight to the right
    component. `puzzle_type` is always "manipulative" — that's what routes marking away from
    the LLM judge and into manipulative_service.mark (see evaluate()).

    prompt and solution are BOTH derived from clean_params by manipulative_service.build_spec,
    so they cannot disagree with each other or with the picture. The AI supplies neither.
    """
    return {
        "render": kind,
        "puzzle_type": "manipulative",
        "title": title or "Have a go",
        "prompt": prompt or "",
        "params": {"kind": kind, "background": pick_background(dark=False),
                   **(clean_params or {})},
        "solution": solution,
        "answer_type": "manipulative",
    }


def _clampi(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def diagram_math_spec(concept: str, params: Optional[dict]) -> tuple:
    """For a DETERMINISTIC maths diagram (fraction | clock): validate/clamp the params,
    then compute the EXACT answer server-side (so the AI's/evaluator's answer can never be
    wrong or disagree with the picture) and give a default question. Returns
    (clean_params, answer, default_question); answer='' if the concept is unknown."""
    concept = (concept or "").strip().lower()
    p = params or {}
    if concept == "fraction":
        total = _clampi(p.get("total", p.get("denominator", p.get("parts"))), 2, 12, 4)
        shaded = _clampi(p.get("shaded", p.get("numerator", p.get("filled"))), 0, total, 1)
        return ({"total": total, "shaded": shaded}, f"{shaded}/{total}",
                "What fraction of the shape is shaded? Write it like 1/4.")
    if concept == "clock":
        hour = _clampi(p.get("hour", p.get("hours")), 1, 12, 3)
        minute = _clampi(p.get("minute", p.get("minutes")), 0, 59, 0)
        if minute == 0:
            ans = f"{hour} o'clock"
        elif minute == 30:
            ans = f"half past {hour}"
        else:
            ans = f"{hour}:{minute:02d}"
        return ({"hour": hour, "minute": minute}, ans, "What time does the clock show?")
    if concept == "ruler":
        length = _clampi(p.get("length_cm", p.get("length", p.get("cm"))), 1, 30, 8)
        start = _clampi(p.get("start", 0), 0, 29, 0)
        obj = str(p.get("object", p.get("name", "object")) or "object").strip() or "object"
        return ({"length_cm": length, "start": start, "object": obj}, f"{length} cm",
                f"How long is the {obj}? Give your answer in centimetres (cm).")
    return ({}, "", "")


def diagram_example_caption(concept: str, clean: dict, answer: str) -> str:
    """A short caption for a DISPLAY-ONLY worked-example diagram, written from the SAME clamped
    params the picture was drawn from — so the words under the diagram always match the drawing
    (this is what a free-typed AI caption failed to guarantee, e.g. '2/6' over a 1/5 bar)."""
    c = (concept or "").strip().lower()
    if c == "fraction":
        total = clean.get("total")
        shaded = clean.get("shaded")
        return f"{shaded} out of {total} equal parts are shaded — that is {answer}."
    if c == "clock":
        return f"The clock shows {answer}."
    if c == "ruler":
        obj = clean.get("object", "object")
        return f"The {obj} measures {answer}."
    return f"This shows {answer}."


def _client_payload(full: Dict[str, Any]) -> Dict[str, Any]:
    """Strip the server-only solution before the payload goes to the model / frontend."""
    out = {k: v for k, v in full.items() if k != "solution"}
    out["action"] = "show_puzzle"
    return out


# ── Semantic evaluation (fast model) ──────────────────────────────────────────────
_JUDGE_SYS = (
    "You are marking a young student's answer to a puzzle. Be encouraging but accurate. "
    "Accept correct meaning regardless of spelling, case, synonyms, or equivalent form "
    "(e.g. 'mitochondrion'='mitochondria', 'a half'='1/2'='0.5'). Reply ONLY as JSON."
)


def _judge_sync(puzzle_type: str, question: str, solution: Any, answer: Any) -> Dict[str, Any]:
    from google import genai
    client = genai.Client(api_key=settings.gemini_api_key)
    payload = {
        "puzzle_type": puzzle_type,
        "question": question,
        "correct_answer": solution,
        "student_answer": answer,
    }
    instruction = (
        _JUDGE_SYS
        + "\nGiven this puzzle, mark the student's answer. For labelling/matching, "
        "correct_answer and student_answer are {id: name} maps — mark each id. "
        "Return JSON: {\"score\": <int 0-10>, \"correct\": <true|false>, "
        "\"per_item\": {<id>: <true|false>}, \"feedback\": \"<one short, warm sentence: "
        "praise if right; if wrong, a gentle hint toward the right idea WITHOUT stating "
        "the full answer>\"}. per_item may be {} for single-answer puzzles.\n\nPUZZLE:\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    resp = client.models.generate_content(
        model=settings.gemini_chat_model,
        contents=instruction,
        config={"response_mime_type": "application/json"},
    )
    txt = (getattr(resp, "text", "") or "").strip()
    data = json.loads(txt)
    score = int(data.get("score", 0))
    return {
        "score": max(0, min(10, score)),
        "correct": bool(data.get("correct", score >= 7)),
        "per_item": data.get("per_item") or {},
        "feedback": str(data.get("feedback", "")).strip(),
    }


async def evaluate(puzzle_type: str, solution: Any, student_answer: Any,
                   question: str = "", render: str = "") -> Dict[str, Any]:
    """Mark the student's answer. Never raises — falls back to a neutral 'try again' verdict
    so the tutor can still respond.

    Manipulatives are marked DETERMINISTICALLY (exact comparison against a solution the
    server derived from the same params it drew the puzzle from) — no model call, instant,
    and it cannot disagree with what's on screen. Everything else is judged semantically by
    the fast model, because "mitochondrion" ≈ "mitochondria" needs a language model.
    """
    if puzzle_type == "manipulative":
        from app.services import manipulative_service
        return manipulative_service.mark(render, solution, student_answer)

    import asyncio
    try:
        return await asyncio.to_thread(
            _judge_sync, puzzle_type, question, solution, student_answer
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("puzzle evaluate failed: %s: %s", type(e).__name__, e)
        return {"score": 0, "correct": False, "per_item": {},
                "feedback": "I couldn't quite mark that — let's talk it through together."}


# ── Authoritative interactive state (LessonPlan.session_state["puzzle_state"]) ─────
# Single source of truth for what puzzle is on screen, its SOLUTION (server-only), and
# what the student has submitted. Injected into the model each turn via the anchor.

async def _load_plan(db: AsyncSession, appointment_id: int):
    from app.models.lesson_plan import LessonPlan
    return (await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )).scalar_one_or_none()


async def set_puzzle_shown(db: AsyncSession, appointment_id: int, full_payload: dict) -> str:
    """Record a NEW puzzle on screen (incl. its server-only solution). Returns an
    instance_id the frontend keys on so each fresh puzzle fully remounts."""
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return ""
    state = dict(plan.session_state) if plan.session_state else {}
    instance_id = uuid.uuid4().hex[:12]
    state["puzzle_state"] = {
        "puzzle_type": full_payload.get("puzzle_type"),
        "render": full_payload.get("render"),
        "prompt": full_payload.get("prompt"),
        "solution": full_payload.get("solution"),   # server-only
        "instance_id": instance_id,
        "status": "showing",
        "attempts": 0,
        "last_answer": None,
        "shown_at": datetime.now(timezone.utc).isoformat(),
    }
    plan.session_state = state
    await db.flush()
    return instance_id


async def record_puzzle_attempt(db: AsyncSession, appointment_id: int, answer: Any) -> None:
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}
    ps = dict(state.get("puzzle_state") or {})
    if not ps:
        return
    ps["attempts"] = int(ps.get("attempts", 0)) + 1
    ps["status"] = "submitted"
    ps["last_answer"] = answer
    ps["answered_at"] = datetime.now(timezone.utc).isoformat()
    state["puzzle_state"] = ps
    plan.session_state = state
    await db.flush()


async def mark_puzzle_evaluated(db: AsyncSession, appointment_id: int,
                                verdict: Optional[dict] = None) -> None:
    """Flip the on-screen puzzle to 'evaluated' once it's been marked, so it is graded
    EXACTLY ONCE. The lesson-state anchor then stops telling the AI to 'call the evaluator',
    and a second evaluator call is refused — otherwise the AI re-checks an already-solved
    puzzle turns later."""
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}
    ps = dict(state.get("puzzle_state") or {})
    if not ps:
        return
    ps["status"] = "evaluated"
    if verdict is not None:
        ps["verdict"] = {"score": verdict.get("score"), "correct": verdict.get("correct")}
    state["puzzle_state"] = ps
    plan.session_state = state
    await db.flush()


async def clear_puzzle_state(db: AsyncSession, appointment_id: int) -> None:
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}
    state.pop("puzzle_state", None)
    plan.session_state = state
    await db.flush()


# ── Visual-family rotation (puzzle · animation · svg · mermaid, evenly) ───────────
# The tutor left to itself reaches for the same kind of visual all lesson. The target is an even
# 25/25/25/25 split across the four families, so we record what has actually been shown and the
# LESSON STATE anchor names the family that is furthest behind — the same running-quota approach
# that made the manipulative/classic mix hold, rather than hoping a prompt line is obeyed.
VISUAL_FAMILIES = ("puzzle", "animation", "svg", "mermaid")


def visual_family_for(render: Optional[str]) -> str:
    """Which family a shown visual belongs to, from its render key."""
    r = (render or "").strip().lower()
    if r == "mermaid":
        return "mermaid"
    if r == "animation":
        return "animation"
    if r == "svg_diagram":
        return "svg"
    return "puzzle"          # math/graph/labelling/matching/manipulatives/explanatory image


# The three EXPLANATORY families — things the student LOOKS AT while the tutor teaches — as
# opposed to "puzzle", which is something they DO.
EXPLANATORY_FAMILIES = ("mermaid", "svg", "animation")

# What the mix should be in each phase of the lesson. A lesson that opens with puzzles makes the
# student solve before they have been taught anything; a practice phase full of diagrams never
# lets them try it themselves. So the phase — not the tutor's mood — decides the balance, and
# EVERY tool stays bound in every phase (this is priority, not a gate: a practice phase can still
# draw a diagram when one genuinely helps, it just won't lead with one).
VISUAL_PHASE_WEIGHTS: Dict[str, Dict[str, float]] = {
    "recap":    {"puzzle": 0.30, "explanatory": 0.70},   # remind them how it works
    "teach":    {"puzzle": 0.30, "explanatory": 0.70},   # explain first, practise second
    "practice": {"puzzle": 0.70, "explanatory": 0.30},   # now they do it
    "quiz":     {"puzzle": 0.70, "explanatory": 0.30},
    "review":   {"puzzle": 0.40, "explanatory": 0.60},   # summarise, with a little recall
}
_DEFAULT_PHASE = "teach"


def _split_entry(entry: str) -> tuple:
    """A visual_seq entry is "phase:family" ("teach:mermaid"). Entries written before the mix
    became phase-aware are bare family names — they carry no phase, so they are counted toward
    no phase's target (they still age out of the capped window)."""
    s = str(entry or "")
    if ":" in s:
        ph, _, fam = s.partition(":")
        return ph.strip().lower(), fam.strip()
    return None, s.strip()


def family_weights(phase: Optional[str], available: Optional[List[str]] = None) -> Dict[str, float]:
    """Per-family target shares for this phase, normalised over what's actually available.

    The phase split is puzzle-vs-explanatory; the explanatory share is then divided evenly among
    whichever of mermaid/svg/animation can be offered, so losing manim re-splits its share
    between the other two instead of quietly handing it to puzzles.
    """
    avail = [f for f in (available or VISUAL_FAMILIES) if f in VISUAL_FAMILIES]
    if not avail:
        return {}
    split = VISUAL_PHASE_WEIGHTS.get((phase or "").strip().lower()) \
        or VISUAL_PHASE_WEIGHTS[_DEFAULT_PHASE]
    expl = [f for f in avail if f in EXPLANATORY_FAMILIES]
    out: Dict[str, float] = {}
    if "puzzle" in avail:
        out["puzzle"] = split["puzzle"] if expl else 1.0
    for f in expl:
        out[f] = (split["explanatory"] if "puzzle" in avail else 1.0) / len(expl)
    total = sum(out.values()) or 1.0
    return {f: w / total for f, w in out.items()}


def pick_visual_family(seq: Optional[List[str]], available: Optional[List[str]] = None,
                       phase: Optional[str] = None) -> str:
    """The family to use next, so the running mix converges on this PHASE's target ratio.

    Largest-deficit selection: pick whichever family is furthest below the share it should have
    had by now (`weight × turns_so_far − times_used`). That converges on the target exactly AND
    stays smooth — a 70% family comes up roughly two turns in three rather than in one long burst,
    which a per-turn dice roll or a naive virtual-time scheduler would both get wrong.

    A repeat is only broken on a TIE, never forbidden outright: an earlier version excluded the
    previous family whenever any alternative existed, which silently capped every weight at 50%
    and made a 70% practice phase impossible.

    THE DEFICIT IS COUNTED WITHIN THE CURRENT PHASE ONLY. Counting it across the whole lesson
    while applying a per-phase target is incoherent, and measurably broke the mix: a practice
    phase (70% puzzle) drove the lesson-wide puzzle count so high that the following review phase
    (40%) could never pick a puzzle again. Audited over 7,072 real lessons it produced
    practice 97% / review 0% / recap 50% against targets of 70 / 40 / 30.

    `available` limits it to what can actually be offered; `phase` comes from the lesson state
    machine (plan_blocks step type). With no phase this falls back to the teaching mix.
    """
    avail = [f for f in (available or VISUAL_FAMILIES) if f in VISUAL_FAMILIES]
    if not avail:
        return "puzzle"
    entries = [_split_entry(s) for s in (seq or [])]
    entries = [(p, f) for p, f in entries if f in VISUAL_FAMILIES]
    weights = family_weights(phase, avail)
    ph = (phase or _DEFAULT_PHASE).strip().lower()
    # Only this phase's history counts toward this phase's target. `last` deliberately ignores
    # the phase, so we still avoid showing the same family twice in a row across a boundary.
    hist = [f for p, f in entries if p == ph]
    last = entries[-1][1] if entries else None
    turn = len(hist) + 1

    # FIRST pick of a phase: sample from the target distribution instead of handing it to
    # whichever family has the largest single weight. Deterministically awarding it cost a
    # minority family a slot it could not win back in a short phase — audited at teach 33%
    # against an achievable 22%. Every later pick is deterministic largest-deficit, so this
    # only removes the head start; it does not add ongoing randomness.
    if not hist:
        pool = [f for f in avail if f != last] or avail
        ws = [weights.get(f, 0.0) for f in pool]
        if sum(ws) > 0:
            return random.choices(pool, weights=ws, k=1)[0]

    best, best_score = [], None
    for f in avail:
        w = weights.get(f, 0.0)
        if w <= 0:
            continue
        deficit = w * turn - hist.count(f)
        if best_score is None or deficit > best_score + 1e-9:
            best, best_score = [f], deficit
        elif abs(deficit - best_score) <= 1e-9:
            best.append(f)
    if not best:
        return random.choice(avail)
    # Only when the leaders are tied do we steer away from repeating the last family.
    alternatives = [f for f in best if f != last]
    return random.choice(alternatives or best)


async def get_visual_seq(db: AsyncSession, appointment_id: int) -> List[str]:
    plan = await _load_plan(db, appointment_id)
    if plan is None or not plan.session_state:
        return []
    return list(plan.session_state.get("visual_seq") or [])


async def bump_visual_family(db: AsyncSession, appointment_id: int, family: str,
                             phase: Optional[str] = None) -> None:
    """Record that a visual of this family reached the screen, TAGGED WITH THE LESSON PHASE.

    The phase has to be stored, not just used at pick time: each phase has its own target mix, so
    the running count must be attributable to a phase or the targets cannot be held (see
    pick_visual_family). Read-modify-write the whole session_state dict (JSONB) — mutating a
    nested key in place isn't seen as dirty and would silently not save, the same trap as
    puzzle_state/puzzle_mix.
    """
    if family not in VISUAL_FAMILIES:
        return
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}
    seq = list(state.get("visual_seq") or [])
    seq.append(f"{(phase or _DEFAULT_PHASE).strip().lower()}:{family}")
    # Window is per-lesson but the counts are read per-PHASE, so it has to be long enough that a
    # single phase still has a usable history inside it.
    state["visual_seq"] = seq[-40:]
    plan.session_state = state
    await db.flush()


async def get_puzzle_state(db: AsyncSession, appointment_id: int) -> Optional[dict]:
    plan = await _load_plan(db, appointment_id)
    if plan is None or not plan.session_state:
        return None
    return plan.session_state.get("puzzle_state")
