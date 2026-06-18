"""
Puzzle build + evaluation + per-session persistence.

`build()` turns an AI-selected template id + a few params into a render payload
the frontend draws (and the `solution` it checks against for instant feedback).
The current puzzle is persisted in LessonPlan.session_state["puzzle_state"], the
same way slide_state is, so it survives across turns.
"""
import logging
import random
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
    key = str(_get(p, "chain", "set", "id", "habitat") or "grassland").lower()
    spec = FOOD_CHAINS.get(key) or next(iter(FOOD_CHAINS.values()))
    shuffled = list(spec["order"])
    random.shuffle(shuffled)
    return {
        "prompt": spec["title"] + " — start with the producer.",
        "params": {"items": shuffled},
        "solution": {"order": spec["order"]},
    }


_BUILDERS = {
    "fraction_bar": _b_fraction_bar,
    "number_line": _b_number_line,
    "shape_count": _b_shape_count,
    "area_grid": _b_area_grid,
    "build_fraction": _b_build_fraction,
    "label_diagram": _b_label_diagram,
    "states_of_matter": _b_states_of_matter,
    "food_chain_order": _b_food_chain_order,
}


# ── Persistence (LessonPlan.session_state["puzzle_state"]) ───────────────────────
async def save_puzzle_state(db: AsyncSession, appointment_id: int, payload: Optional[dict]) -> None:
    from app.models.lesson_plan import LessonPlan
    plan = (await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )).scalar_one_or_none()
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}
    if payload is None:
        state.pop("puzzle_state", None)
    else:
        # Don't persist the solution server-side beyond what the client needs.
        state["puzzle_state"] = {
            "puzzle_id": payload.get("puzzle_id"),
            "render": payload.get("render"),
            "prompt": payload.get("prompt"),
        }
    plan.session_state = state
    await db.flush()
