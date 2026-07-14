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
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services import image_gen_service, graph_service

logger = logging.getLogger(__name__)


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


def build_math(question: str, answer: str, *, mode: str = "latex",
               latex: str = "", image_url: str = "") -> Dict[str, Any]:
    mode = mode if mode in ("latex", "image") else "latex"
    if mode == "image" and not image_url:
        mode = "latex"
    return {
        "render": "math",
        "puzzle_type": "math",
        "title": "Have a go",
        "prompt": question or "Solve it.",
        "params": {"mode": mode, "latex": latex or "", "image": image_url or ""},
        "solution": str(answer),
        "answer_type": "text",
    }


def build_graph(question: str, answer: str, image_url: str) -> Dict[str, Any]:
    return {
        "render": "graph",
        "puzzle_type": "graph",
        "title": "Read the graph",
        "prompt": question or "Answer from the graph.",
        "params": {"image": image_url},
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
        "params": {"kind": kind, **(clean_params or {})},
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


async def get_puzzle_state(db: AsyncSession, appointment_id: int) -> Optional[dict]:
    plan = await _load_plan(db, appointment_id)
    if plan is None or not plan.session_state:
        return None
    return plan.session_state.get("puzzle_state")
