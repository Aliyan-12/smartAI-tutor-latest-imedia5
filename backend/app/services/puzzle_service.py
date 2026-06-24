"""
Puzzle build + evaluation + per-session persistence.

`build()` turns an AI-selected template id + a few params into a render payload
the frontend draws (and the `solution` it checks against for instant feedback).
The current puzzle is persisted in LessonPlan.session_state["puzzle_state"], the
same way slide_state is, so it survives across turns.
"""
import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.puzzle_templates import (
    TEMPLATES_BY_ID, templates_for, DIAGRAMS, SORTING_SETS, FOOD_CHAINS,
)

logger = logging.getLogger(__name__)


def _clamp(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def _get(p: dict, *keys: str, default: Any = None) -> Any:
    """First present (non-None) value among the given key aliases — the model
    doesn't always use the documented param name (e.g. 'parts' vs 'total_parts')."""
    for k in keys:
        if isinstance(p, dict) and p.get(k) is not None:
            return p[k]
    return default


def resolve_id(puzzle_id: str, subject: str, key_stage: str) -> Optional[str]:
    """Map a (possibly imperfect) puzzle_id the AI gave to a real, available
    template id for this subject/key stage. Returns None if nothing reasonable
    matches (so the caller can fall back to a typed question)."""
    pid = (puzzle_id or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not pid:
        return None
    avail = [t["id"] for t in templates_for(subject, key_stage)]
    if pid in avail:
        return pid
    # render-key match (e.g. AI passed the render name)
    for t in TEMPLATES_BY_ID.values():
        if t["render"] == pid and t["id"] in avail:
            return t["id"]
    # substring either way
    for tid in avail:
        if pid in tid or tid in pid:
            return tid
    # token overlap (e.g. "fractions_pie" → "pie_fraction")
    toks = set(pid.split("_"))
    best, best_score = None, 0
    for tid in avail:
        score = len(toks & set(tid.split("_")))
        if score > best_score:
            best, best_score = tid, score
    return best if best_score > 0 else None


def list_available(subject: str, key_stage: str) -> List[dict]:
    """Template metadata the AI may choose from for this lesson."""
    return [
        {
            "puzzle_id": t["id"], "title": t["title"], "render": t["render"],
            "description": t["description"], "params": t["params_doc"],
            "key_stages": t["key_stages"],
        }
        for t in templates_for(subject, key_stage)
    ]


def build(puzzle_id: str, params: Optional[dict] = None) -> Dict[str, Any]:
    """Validate params, compute the solution, return the render payload."""
    t = TEMPLATES_BY_ID.get(puzzle_id)
    if not t:
        return {"error": "unknown_puzzle", "puzzle_id": puzzle_id, "action": "show_puzzle"}
    p = params or {}
    builder = _BUILDERS[t["render"]]
    payload = builder(p)
    payload.update({
        "puzzle_id": puzzle_id,
        "render": t["render"],
        "title": t["title"],
        "answer_type": t["answer_type"],
        "action": "show_puzzle",
    })
    return payload


# ── Per-type builders ───────────────────────────────────────────────────────────
def _b_fraction_bar(p: dict) -> dict:
    total = _clamp(_get(p, "total_parts", "parts", "denominator", "total"), 2, 12, 4)
    shaded = _clamp(_get(p, "shaded_parts", "shaded", "numerator", "shaded_count"), 0, total, 1)
    return {
        "prompt": "What fraction of the bar is shaded? Write it as a fraction (e.g. 3/4).",
        "params": {"total": total, "shaded": shaded},
        "solution": {"numerator": shaded, "denominator": total},
    }


def _b_number_line(p: dict) -> dict:
    mn = _clamp(_get(p, "min", "start", "from"), -100, 1000, 0)
    mx = _clamp(_get(p, "max", "end", "to"), mn + 1, 1000, max(mn + 10, 10))
    step = _clamp(_get(p, "step", "interval"), 1, max(1, mx - mn), 1)
    marker = _clamp(_get(p, "marker", "value", "position", "point", "target"), mn, mx, mn + step)
    return {
        "prompt": "What number is the arrow pointing to?",
        "params": {"min": mn, "max": mx, "step": step, "marker": marker},
        "solution": marker,
    }


def _b_shape_count(p: dict) -> dict:
    tri = _clamp(_get(p, "triangles", "triangle"), 0, 8, 3)
    cir = _clamp(_get(p, "circles", "circle"), 0, 8, 2)
    sq = _clamp(_get(p, "squares", "square"), 0, 8, 2)
    target = str(_get(p, "target_shape", "target", "shape") or "triangle").lower()
    if target not in ("triangle", "circle", "square"):
        target = "triangle"
    counts = {"triangle": tri, "circle": cir, "square": sq}
    shapes: List[str] = (["triangle"] * tri) + (["circle"] * cir) + (["square"] * sq)
    random.shuffle(shapes)
    return {
        "prompt": f"How many {target}s can you count?",
        "params": {"shapes": shapes, "target": target},
        "solution": counts[target],
    }


def _b_area_grid(p: dict) -> dict:
    w = _clamp(_get(p, "width", "w", "columns", "cols"), 1, 12, 4)
    h = _clamp(_get(p, "height", "h", "rows"), 1, 12, 3)
    return {
        "prompt": f"This rectangle is {w} squares wide and {h} squares tall. What is its area?",
        "params": {"width": w, "height": h},
        "solution": w * h,
    }


def _b_build_fraction(p: dict) -> dict:
    total = _clamp(_get(p, "total_parts", "parts", "denominator", "total"), 2, 12, 4)
    target = _clamp(_get(p, "target_num", "target", "numerator", "shaded_parts", "shaded"), 0, total, 1)
    return {
        "prompt": f"Shade the bar to show the fraction {target}/{total}.",
        "params": {"total": total, "target_num": target},
        "solution": {"numerator": target, "denominator": total},
    }


def _b_label_diagram(p: dict) -> dict:
    key = str(_get(p, "diagram", "type", "image", "id") or "plant").lower()
    spec = DIAGRAMS.get(key) or next(iter(DIAGRAMS.values()))
    labels = [s["label"] for s in spec["slots"]]
    random.shuffle(labels)
    return {
        "prompt": spec["title"] + " — drag each label onto the right part.",
        "params": {
            "diagram": key, "width": spec["width"], "height": spec["height"],
            "slots": [{"id": s["id"], "x": s["x"], "y": s["y"]} for s in spec["slots"]],
            "labels": labels,
        },
        "solution": {s["id"]: s["label"] for s in spec["slots"]},
    }


def _b_states_of_matter(p: dict) -> dict:
    key = str(_get(p, "set", "set_id", "id", "items") or "everyday").lower()
    spec = SORTING_SETS.get(key) or next(iter(SORTING_SETS.values()))
    items = [{"name": it["name"]} for it in spec["items"]]
    random.shuffle(items)
    return {
        "prompt": spec["title"] + ".",
        "params": {"bins": spec["bins"], "items": items},
        "solution": {it["name"]: it["bin"] for it in spec["items"]},
    }


def _b_food_chain_order(p: dict) -> dict:
    key = str(_get(p, "chain", "seq", "sequence", "set", "id", "habitat") or "grassland").lower()
    spec = FOOD_CHAINS.get(key) or next(iter(FOOD_CHAINS.values()))
    shuffled = list(spec["order"])
    random.shuffle(shuffled)
    is_chain = key in ("grassland", "pond", "ocean")
    hint = " — start with the producer." if is_chain else " — start with the first stage."
    return {
        "prompt": spec["title"] + hint,
        "params": {"items": shuffled},
        "solution": {"order": spec["order"]},
    }


def _b_pie_fraction(p: dict) -> dict:
    total = _clamp(_get(p, "total_parts", "parts", "slices", "denominator", "total"), 2, 12, 4)
    shaded = _clamp(_get(p, "shaded_parts", "shaded", "numerator"), 0, total, 1)
    return {
        "prompt": "What fraction of the circle is shaded? Write it as a fraction (e.g. 3/4).",
        "params": {"total": total, "shaded": shaded},
        "solution": {"numerator": shaded, "denominator": total},
    }


def _b_place_value(p: dict) -> dict:
    h = _clamp(_get(p, "hundreds", "h"), 0, 9, 1)
    t = _clamp(_get(p, "tens", "t"), 0, 9, 3)
    o = _clamp(_get(p, "ones", "o", "units"), 0, 9, 4)
    value = h * 100 + t * 10 + o
    return {
        "prompt": "What number do these base-ten blocks show?",
        "params": {"hundreds": h, "tens": t, "ones": o},
        "solution": value,
    }


def _b_array_grid(p: dict) -> dict:
    rows = _clamp(_get(p, "rows", "r"), 1, 10, 3)
    cols = _clamp(_get(p, "cols", "columns", "c"), 1, 10, 4)
    return {
        "prompt": f"How many dots are there altogether? ({rows} rows of {cols})",
        "params": {"rows": rows, "cols": cols},
        "solution": rows * cols,
    }


def _b_clock(p: dict) -> dict:
    hour = _clamp(_get(p, "hour", "hours", "h"), 1, 12, 3)
    minute = _clamp(_get(p, "minute", "minutes", "m"), 0, 59, 30)
    return {
        "prompt": "What time is shown on the clock? Write it as h:mm (e.g. 3:30).",
        "params": {"hour": hour, "minute": minute},
        "solution": f"{hour}:{minute:02d}",
    }


def _b_angle(p: dict) -> dict:
    deg = _clamp(_get(p, "degrees", "angle", "deg"), 10, 330, 45)
    if deg < 90:
        kind = "acute"
    elif deg == 90:
        kind = "right"
    elif deg < 180:
        kind = "obtuse"
    elif deg == 180:
        kind = "straight"
    else:
        kind = "reflex"
    return {
        "prompt": "What type of angle is this?",
        "params": {"degrees": deg, "options": ["acute", "right", "obtuse", "reflex"]},
        "solution": kind,
    }


def _b_coordinate_grid(p: dict) -> dict:
    size = _clamp(_get(p, "size", "max", "grid"), 5, 10, 6)
    x = _clamp(_get(p, "x", "x_coord"), 0, size, 3)
    y = _clamp(_get(p, "y", "y_coord"), 0, size, 2)
    return {
        "prompt": "What are the coordinates of the plotted point? Write them as x,y.",
        "params": {"x": x, "y": y, "size": size},
        "solution": f"{x},{y}",
    }


def _b_bar_chart(p: dict) -> dict:
    raw = _get(p, "bars", "data", "values")
    bars: list = []
    if isinstance(raw, list):
        for b in raw:
            if isinstance(b, dict) and "label" in b:
                bars.append({"label": str(b["label"]), "value": _clamp(b.get("value"), 0, 100, 0)})
    if not bars:
        bars = [{"label": "Mon", "value": 4}, {"label": "Tue", "value": 7},
                {"label": "Wed", "value": 3}, {"label": "Thu", "value": 6}]
    ask = str(_get(p, "ask", "read", "label") or bars[0]["label"])
    match = next((b for b in bars if b["label"].lower() == ask.lower()), bars[0])
    return {
        "prompt": f"Read the bar chart: what is the value for '{match['label']}'?",
        "params": {"bars": bars, "ask": match["label"]},
        "solution": match["value"],
    }


def _b_balance_scales(p: dict) -> dict:
    op = str(_get(p, "op", "operation") or "add").lower()
    a = _clamp(_get(p, "a", "coefficient", "addend"), 1, 20, 3)
    if op in ("mul", "multiply", "times", "*"):
        x = _clamp(_get(p, "x", "solution"), 1, 12, 4)
        b = a * x
        prompt = f"The scales balance. If {a} × x = {b}, what is x?"
        left = f"{a}·x"
    else:
        op = "add"
        x = _clamp(_get(p, "x", "solution"), 0, 20, 5)
        b = x + a
        prompt = f"The scales balance. If x + {a} = {b}, what is x?"
        left = f"x + {a}"
    return {
        "prompt": prompt,
        "params": {"op": op, "a": a, "b": b, "left": left},
        "solution": x,
    }


def _b_particle_state(p: dict) -> dict:
    state = str(_get(p, "state", "answer", "type") or "solid").lower()
    if state not in ("solid", "liquid", "gas"):
        state = "solid"
    return {
        "prompt": "Which state of matter do these particles show?",
        "params": {"state": state, "options": ["solid", "liquid", "gas"]},
        "solution": state,
    }


def _b_formula_triangle(p: dict) -> dict:
    def node(key: str, dlabel: str) -> dict:
        n = _get(p, key)
        if not isinstance(n, dict):
            n = {}
        label = str(n.get("label") or dlabel)
        v = n.get("value")
        try:
            v = int(v) if v is not None and v != "" else None
        except (TypeError, ValueError):
            v = None
        return {"label": label, "value": v}

    top, left, right = node("top", "distance"), node("left", "speed"), node("right", "time")
    if top["value"] is None and left["value"] is not None and right["value"] is not None:
        unknown, sol = "top", left["value"] * right["value"]
    elif left["value"] is None and top["value"] is not None and right["value"] not in (None, 0):
        unknown, sol = "left", top["value"] // right["value"]
    elif right["value"] is None and top["value"] is not None and left["value"] not in (None, 0):
        unknown, sol = "right", top["value"] // left["value"]
    else:
        # fallback to a clean worked example: distance = speed(4) × time(3)
        left["value"], right["value"], top["value"] = 4, 3, None
        unknown, sol = "top", 12
    return {
        "prompt": f"Use the triangle: {top['label']} = {left['label']} × {right['label']}. What is the missing value?",
        "params": {"top": top, "left": left, "right": right, "unknown": unknown},
        "solution": sol,
    }


_BUILDERS = {
    "fraction_bar": _b_fraction_bar,
    "pie_fraction": _b_pie_fraction,
    "particle_state": _b_particle_state,
    "formula_triangle": _b_formula_triangle,
    "number_line": _b_number_line,
    "place_value": _b_place_value,
    "array_grid": _b_array_grid,
    "shape_count": _b_shape_count,
    "area_grid": _b_area_grid,
    "clock": _b_clock,
    "angle": _b_angle,
    "coordinate_grid": _b_coordinate_grid,
    "bar_chart": _b_bar_chart,
    "balance_scales": _b_balance_scales,
    "build_fraction": _b_build_fraction,
    "label_diagram": _b_label_diagram,
    "states_of_matter": _b_states_of_matter,
    "food_chain_order": _b_food_chain_order,
}


# ── Authoritative interactive state (LessonPlan.session_state["puzzle_state"]) ────
# This is the single source of truth for "what puzzle is on the student's screen
# and what has happened to it". It is injected into the model's input every turn
# (see session_agent_service._puzzle_state_anchor) so the model never has to guess
# from chat history whether a puzzle is showing / solved — which is what made it
# hallucinate ("label the puzzle" when none existed) or skip calling show_puzzle.

async def _load_plan(db: AsyncSession, appointment_id: int):
    from app.models.lesson_plan import LessonPlan
    return (await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )).scalar_one_or_none()


async def set_puzzle_shown(db: AsyncSession, appointment_id: int, payload: dict) -> str:
    """Record that a NEW puzzle is now on screen. Returns an instance_id (nonce) the
    frontend keys on so each fresh puzzle fully remounts (no stale solved/locked state)."""
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return ""
    state = dict(plan.session_state) if plan.session_state else {}
    instance_id = uuid.uuid4().hex[:12]
    # Solution stays client-side only (returned in the tool payload); we keep just
    # enough here to describe the on-screen puzzle to the model each turn.
    state["puzzle_state"] = {
        "puzzle_id": payload.get("puzzle_id"),
        "render": payload.get("render"),
        "prompt": payload.get("prompt"),
        "instance_id": instance_id,
        "status": "showing",
        "attempts": 0,
        "last_answer": None,
        "last_correct": None,
        "shown_at": datetime.now(timezone.utc).isoformat(),
    }
    plan.session_state = state
    await db.flush()
    return instance_id


async def record_puzzle_attempt(
    db: AsyncSession, appointment_id: int, answer: Any, correct: bool
) -> None:
    """Record the student's attempt against the on-screen puzzle so the next turn's
    anchor reflects it (solved / still-wrong). No-op if nothing is on screen."""
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}
    ps = dict(state.get("puzzle_state") or {})
    if not ps:
        return
    ps["attempts"] = int(ps.get("attempts", 0)) + 1
    ps["status"] = "solved" if correct else "attempted_wrong"
    ps["last_answer"] = str(answer)
    ps["last_correct"] = bool(correct)
    ps["answered_at"] = datetime.now(timezone.utc).isoformat()
    state["puzzle_state"] = ps
    plan.session_state = state
    await db.flush()


async def clear_puzzle_state(db: AsyncSession, appointment_id: int) -> None:
    """Remove the on-screen puzzle from authoritative state."""
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}
    state.pop("puzzle_state", None)
    plan.session_state = state
    await db.flush()


async def get_puzzle_state(db: AsyncSession, appointment_id: int) -> Optional[dict]:
    """Current on-screen puzzle record, or None if nothing is showing."""
    plan = await _load_plan(db, appointment_id)
    if plan is None or not plan.session_state:
        return None
    return plan.session_state.get("puzzle_state")


async def save_puzzle_state(db: AsyncSession, appointment_id: int, payload: Optional[dict]) -> None:
    """Back-compat shim: payload=None clears, a payload records a fresh show."""
    if payload is None:
        await clear_puzzle_state(db, appointment_id)
    else:
        await set_puzzle_shown(db, appointment_id, payload)
