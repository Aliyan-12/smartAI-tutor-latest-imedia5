"""
manipulative_service.py — DETERMINISTIC interactive maths manipulatives.

The third puzzle family, and the only one that cannot contradict itself.

The other two families let the AI author the question AND hand us the answer
(`math_puzzle(question, answer)`, `graph_puzzle(question, answer, spec)`) while the picture
is drawn separately. Nothing binds the three together, which is how a puzzle asking "where
do these two lines intersect?" shipped over a graph with one line on it.

Here the contract is inverted:

    the AI passes SEMANTIC PARAMS ONLY      →  {"target": 3471}
    the server derives the QUESTION          →  "Build 3,471 with the counters."
    the server derives the SOLUTION          →  {"1000": 3, "100": 4, "10": 7, "1": 1}
    the server MARKS it deterministically    →  exact comparison, no LLM judge

Because the prompt and the solution are computed from the *same* clamped params, they
cannot disagree — with each other, or with what is rendered. The AI never sees an answer
and is never asked for one. This generalises `puzzle_service.diagram_math_spec`, which
already did exactly this for fraction/clock/ruler.

Every `build` returns (clean_params, solution, prompt, title).
Every `mark` returns the same verdict shape `puzzle_service.evaluate` returns, so the
evaluator/XP path downstream is untouched:
    {"score": 0-10, "correct": bool, "per_item": {id: bool}, "feedback": str}
"""
import json
import logging
import random
import re
from datetime import datetime, timezone   # used by set_puzzle_shown/record_puzzle_attempt timestamps
from math import gcd
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── param helpers ────────────────────────────────────────────────────────────────
# Deliberately NOT imported from puzzle_service: that module imports THIS one (for the
# deterministic marking branch in evaluate()), so importing back would be a cycle.

class ParamError(ValueError):
    """The AI's params can't make a valid activity. The message is fed straight back to the
    model so it can fix the call — never silently patched over with a default."""


def _clampi(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        n = default
    return max(lo, min(hi, n))


def _require_int(p: dict, names: tuple, lo: int, hi: int, what: str) -> int:
    """Read a REQUIRED integer param. Missing or out of range → ParamError.

    This used to be a `_clampi(..., default)`, and that was actively dangerous: a Year 1
    "place value within 10" lesson where the model forgot to pass `target` silently became
    "Build 3,471" — a number the child has never seen — while the tutor was saying "let's make
    6". A wrong activity is worse than no activity, so we refuse and tell the model why.
    """
    raw = next((p[n] for n in names if p.get(n) is not None), None)
    if raw is None:
        raise ParamError(
            f"Missing '{names[0]}'. {what} Pass it explicitly — there is no default."
        )
    try:
        n = int(raw)
    except (TypeError, ValueError):
        raise ParamError(f"'{names[0]}' must be a whole number, got {raw!r}. {what}")
    if not (lo <= n <= hi):
        raise ParamError(
            f"'{names[0]}' is {n}, which is outside {lo}-{hi}. {what}"
        )
    return n


# The biggest number each key stage should ever be asked to handle. A safety net for when the
# model ignores the lesson's own topic: a Year 1 child working "within 10" must never be handed
# a four-digit number, whatever the model thinks it wants.
_MAX_NUMBER_BY_KS = {"KS1": 100, "KS2": 10000, "KS3": 100000, "KS4": 1000000, "KS5": 1000000}


def _ks_ceiling(key_stage: Optional[str]) -> int:
    return _MAX_NUMBER_BY_KS.get((key_stage or "").upper().replace(" ", ""), 10000)


def _check_ceiling(value: int, key_stage: Optional[str], label: str) -> None:
    ceiling = _ks_ceiling(key_stage)
    if value >= ceiling:
        raise ParamError(
            f"{label} ({value:,}) is too big for {key_stage or 'this key stage'} — keep it under "
            f"{ceiling:,}. Match the number to the LESSON'S OWN TOPIC: a 'within 10' lesson means "
            f"1-9, 'within 100' means up to 99, 'within 1000' means up to 999."
        )


def _as_int(v: Any) -> Optional[int]:
    """Parse a student's answer into an int. Tolerant of "3,471", " 12 ", 12.0, "12"."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() else None
    if isinstance(v, str):
        s = v.strip().replace(",", "").replace(" ", "")
        if not s:
            return None
        try:
            return int(s)
        except ValueError:
            try:
                f = float(s)
                return int(f) if f.is_integer() else None
            except ValueError:
                return None
    return None


def _verdict(correct: bool, score: int, feedback: str,
             per_item: Optional[dict] = None) -> Dict[str, Any]:
    return {
        "score": max(0, min(10, int(score))),
        "correct": bool(correct),
        "per_item": per_item or {},
        "feedback": feedback,
    }


def _score_from_ratio(right: int, total: int) -> int:
    if total <= 0:
        return 0
    return max(0, min(10, round(10.0 * right / total)))


def _commaed(n: int) -> str:
    return f"{n:,}"


# ── Variation ────────────────────────────────────────────────────────────────────
# Every build draws from a FRESH, unseeded RNG. The first version of this file seeded each
# builder from its own params ("so the puzzle can't drift from its solution") — which was
# wrong twice over: the generated params AND the solution are both persisted in puzzle_state,
# so nothing needed to be reproducible, and the effect was that identical params produced a
# byte-identical puzzle every single time. The 8x table always asked the same ten questions in
# the same order. A child who saw it twice had memorised it.
#
# So: same params, different puzzle, every time — and a `variant` on each kind so the SHAPE of
# the activity changes too, not just the numbers.

def _rng() -> random.Random:
    return random.Random()


def _pick(seq: List[Any]) -> Any:
    return _rng().choice(seq)


COUNTER_SHAPES = ["circle", "square", "diamond", "star"]
DOT_THEMES = ["#60a5fa", "#f472b6", "#4ade80", "#fbbf24", "#c084fc", "#22d3ee"]
COUNT_ITEMS = [
    ("apples", "🍎"), ("stars", "⭐"), ("frogs", "🐸"), ("cars", "🚗"), ("cakes", "🧁"),
    ("fish", "🐠"), ("balloons", "🎈"), ("ducks", "🦆"), ("shells", "🐚"), ("bees", "🐝"),
]
COUNT_LAYOUTS = ["scatter", "rows", "ten_frame"]
FRACTION_SHAPES = ["rectangle", "circle"]


# ── 1. place_value_counters ──────────────────────────────────────────────────────
# Columns of draggable counters (1000s / 100s / 10s / 1s) with +/- controls, an expanded
# form line and a running total. Params: {"target": 3471}.

_PLACES = [1000, 100, 10, 1]
_PLACE_LABELS = {1000: "1000s", 100: "100s", 10: "10s", 1: "1s"}
_PLACE_COLOURS = {1000: "#ec4899", 100: "#f97316", 10: "#22c55e", 1: "#3b82f6"}


def _build_place_value(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    target = _require_int(
        p, ("target", "number", "value"), 1, 9999,
        "It's the number the student has to build, and it must match the LESSON'S topic — "
        "'within 10' means 1-9, 'within 100' means up to 99, 'within 1000' up to 999.",
    )
    _check_ceiling(target, key_stage, "target")

    # ALL FOUR columns, always — whatever the size of the number. Showing only the columns the
    # target needs would hand the student half the answer: a single ones tray tells them it's a
    # units number before they've thought about it. Leaving 1000s/100s/10s on the board means
    # building 9 requires deciding those places are ZERO, which is the actual place-value skill.
    # The difficulty lives in the target, not in how many trays are on screen.
    digits = {str(place): (target // place) % 10 for place in _PLACES}
    columns = [
        {"place": place, "label": _PLACE_LABELS[place], "colour": _PLACE_COLOURS[place]}
        for place in _PLACES
    ]
    expanded = " + ".join(
        _commaed(digits[str(pl)] * pl) for pl in _PLACES if digits[str(pl)] > 0
    )
    clean = {
        "target": target, "columns": columns, "expanded": expanded, "max_per_column": 9,
        "counter_shape": _pick(COUNTER_SHAPES),
    }
    prompt = f"Build {_commaed(target)} using the counters. Add or take away until the total is right."
    return clean, digits, prompt, f"Make {_commaed(target)}"


def _mark_place_value(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    ans = answer if isinstance(answer, dict) else {}
    per_item, right = {}, 0
    # Only the columns this puzzle actually SHOWED — a one-column "make 9" board must not be
    # marked against a 1000s column that was never on screen.
    for k in sol:
        ok = _as_int(ans.get(k)) == _as_int(sol.get(k))
        per_item[k] = ok
        right += 1 if ok else 0
    total = len(sol)
    if total and right == total:
        return _verdict(True, 10, "Spot on — every column is exactly right!", per_item)
    wrong = [_PLACE_LABELS[int(k)] for k in sol if not per_item.get(k)]
    hint = f"have another look at the {wrong[0]} column" if wrong else "have another go"
    return _verdict(False, _score_from_ratio(right, total), f"So close — {hint}.", per_item)


# ── 2. column_addition ───────────────────────────────────────────────────────────
# Big column sum with per-digit entry boxes. Params: {"addends": [998795, 712966, 718383]}.

def _build_column_addition(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    raw = p.get("addends") or p.get("numbers") or p.get("values") or []
    if isinstance(raw, (int, str)):
        raw = [raw]
    nums = [n for n in (_as_int(x) for x in raw) if n is not None and n > 0][:4]
    if len(nums) < 2:
        raise ParamError(
            "Missing 'addends'. Pass the 2-4 numbers to add, e.g. {\"addends\": [24, 38]} — "
            "sized for the lesson's topic and the student's year group. There is no default."
        )
    for n in nums:
        _check_ceiling(n, key_stage, "addend")
    total = sum(nums)
    clean = {"addends": nums, "width": len(str(total))}
    shown = " + ".join(str(n) for n in nums)
    prompt = f"Work out {shown}. Fill in the answer one digit at a time."
    return clean, str(total), prompt, "Column addition"


def _mark_column_addition(solution: Any, answer: Any) -> Dict[str, Any]:
    # The client may send "2430144", 2430144, or a per-box list ["2","4",...].
    if isinstance(answer, (list, tuple)):
        answer = "".join(str(d if d is not None else "") for d in answer)
    got = _as_int(answer)
    want = _as_int(solution)
    if got is not None and want is not None and got == want:
        return _verdict(True, 10, "Exactly right — every column carried correctly.")
    if got is None:
        return _verdict(False, 0, "I didn't catch a number there — have another go.")
    # Give a real hint without handing over the answer: which column went wrong first.
    gs, ws = str(got)[::-1], str(want)[::-1]
    col = next((i for i in range(len(ws)) if i >= len(gs) or gs[i] != ws[i]), 0)
    names = ["ones", "tens", "hundreds", "thousands", "ten thousands", "hundred thousands"]
    where = names[col] if col < len(names) else "left-hand"
    return _verdict(False, 0, f"Not quite — check the {where} column, and don't forget to carry.")


# ── 3. number_grid_sums ──────────────────────────────────────────────────────────
# A grid whose rows and columns must hit their totals; some cells are blank and the
# missing values sit in a tile tray. Params: {"size": 4, "values": [[7,8,3,1], …]}.

def _build_number_grid(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    size = _clampi(p.get("size", p.get("grid_size")), 2, 4, 3)
    raw = p.get("values") or p.get("grid") or []
    flat: List[int] = []
    if isinstance(raw, list):
        for row in raw:
            if isinstance(row, list):
                flat.extend(x for x in (_as_int(v) for v in row) if x is not None)
            else:
                v = _as_int(row)
                if v is not None:
                    flat.append(v)
    need = size * size
    rng = _rng()
    while len(flat) < need:
        flat.append(rng.randint(1, 9))
    grid = [[max(1, min(9, flat[r * size + c])) for c in range(size)] for r in range(size)]

    # Blank one cell per row, each in a DIFFERENT column (a random permutation, so no row or
    # column is ever left entirely blank — that would be unsolvable). This used to be
    # `(r + 1) % size`, so the holes appeared on the same diagonal every single time and a
    # student learned the shape of the puzzle instead of the maths.
    hole_cols = list(range(size))
    rng.shuffle(hole_cols)
    blanks = [[r, hole_cols[r]] for r in range(size)]
    solution = {f"{r},{c}": grid[r][c] for r, c in blanks}

    tiles = list(solution.values())
    # A spare tile that fits nowhere, so the tray can't be solved by elimination alone.
    if size >= 3:
        needed = sorted(tiles)
        for _ in range(12):
            decoy = rng.randint(1, 9)
            if decoy not in needed:
                tiles.append(decoy)
                break
    rng.shuffle(tiles)

    clean = {
        "size": size,
        "grid": [[(None if [r, c] in blanks else grid[r][c]) for c in range(size)]
                 for r in range(size)],
        "blanks": blanks,
        "row_targets": [sum(grid[r]) for r in range(size)],
        "col_targets": [sum(grid[r][c] for r in range(size)) for c in range(size)],
        "tiles": tiles,
    }
    prompt = "Drop the tiles into the empty squares so every row and every column adds up to its total."
    return clean, solution, prompt, "Make every total work"


def _mark_number_grid(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    ans = answer if isinstance(answer, dict) else {}
    per_item, right = {}, 0
    for key, want in sol.items():
        ok = _as_int(ans.get(key)) == _as_int(want)
        per_item[key] = ok
        right += 1 if ok else 0
    total = len(sol)
    if total and right == total:
        return _verdict(True, 10, "Brilliant — every row and column adds up!", per_item)
    return _verdict(False, _score_from_ratio(right, total),
                    "Not there yet — pick a row whose total is wrong and work out what's missing.",
                    per_item)


# ── 4. times_table_dash ──────────────────────────────────────────────────────────
# Flashcard + phone numpad + countdown bar + streak. Params: {"table": 8, "count": 10}.

def _build_times_table(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    table = _require_int(
        p, ("table", "times_table", "multiplier"), 2, 12,
        "It's the times table to drill (2-12) — pick the one this lesson is teaching.",
    )
    count = _clampi(p.get("count", p.get("questions")), 5, 20, 10)
    seconds = _clampi(p.get("seconds", p.get("time_limit")), 30, 180, 60)

    rng = _rng()
    # Draw WITHOUT replacement first, so a 10-question round covers ten different facts rather
    # than asking 8x7 three times. Only once all twelve are used do we start repeating.
    pool = list(range(1, 13))
    rng.shuffle(pool)
    others = [pool[i % 12] for i in range(count)]
    if count > 12:
        rng.shuffle(others)

    # Half the time, flip the card round (7 x 8 instead of 8 x 7). Commutativity is worth
    # meeting by surprise, and it stops the deck being recognisable at a glance.
    questions = [
        {"a": table, "b": b} if rng.random() < 0.5 else {"a": b, "b": table}
        for b in others
    ]
    solution = [q["a"] * q["b"] for q in questions]

    clean = {"table": table, "questions": questions, "seconds": seconds}
    prompt = (f"Answer as many {table}× questions as you can before the timer runs out. "
              f"Tap the numbers, then the green tick.")
    return clean, solution, prompt, f"{table}× dash"


def _mark_times_table(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = list(solution) if isinstance(solution, (list, tuple)) else []
    ans = list(answer) if isinstance(answer, (list, tuple)) else []
    per_item, right = {}, 0
    for i, want in enumerate(sol):
        got = _as_int(ans[i]) if i < len(ans) else None
        ok = got is not None and got == _as_int(want)
        per_item[str(i)] = ok
        right += 1 if ok else 0
    total = len(sol)
    score = _score_from_ratio(right, total)
    # A drill is a race, not a single question — 80% is a pass, and XP scales with the score.
    if total and right == total:
        return _verdict(True, 10, f"Perfect run — all {total} correct!", per_item)
    if score >= 8:
        return _verdict(True, score, f"Strong — {right} out of {total}. Nearly a clean sweep!", per_item)
    return _verdict(False, score,
                    f"{right} out of {total}. Let's warm up that table and race again.", per_item)


# ── 5. fraction_canvas ───────────────────────────────────────────────────────────
# A shape you split (÷2 / ÷3 / ÷5) and fill with colour. Params: {"denominator": 4, "shaded": 3}.

def _build_fraction_canvas(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    den = _require_int(
        p, ("denominator", "total", "parts"), 2, 12,
        "It's how many equal parts the shape must be split into (the bottom of the fraction). "
        "Keep it to halves/quarters for the youngest students.",
    )
    num = _require_int(
        p, ("shaded", "numerator", "filled"), 0, den,
        f"It's how many of the {den} parts must be coloured in (the top of the fraction).",
    )
    # A bar one time, a pie the next. Same fraction, different mental picture — which is the
    # point: a child who only ever meets 3/4 as a rectangle hasn't really met 3/4.
    shape = str(p.get("shape") or "").strip().lower()
    if shape not in FRACTION_SHAPES:
        shape = _pick(FRACTION_SHAPES)
    clean = {"denominator": den, "shaded": num, "shape": shape}
    part_word = "part" if num == 1 else "parts"
    prompt = (f"Split the shape into {den} equal parts, then colour in {num} {part_word} "
              f"to show {num}/{den}.")
    return clean, {"denominator": den, "shaded": num}, prompt, f"Make {num}/{den}"


def _mark_fraction_canvas(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    ans = answer if isinstance(answer, dict) else {}
    want_den = _as_int(sol.get("denominator"))
    want_num = _as_int(sol.get("shaded"))
    got_den = _as_int(ans.get("denominator", ans.get("parts")))
    got_num = _as_int(ans.get("shaded", ans.get("filled")))
    den_ok = got_den == want_den
    num_ok = got_num == want_num
    per_item = {"denominator": den_ok, "shaded": num_ok}
    if den_ok and num_ok:
        return _verdict(True, 10, "That's it — the right number of parts, and the right number coloured!", per_item)
    if not den_ok:
        return _verdict(False, 3 if num_ok else 0,
                        "Check how many equal parts the shape is split into — that's the bottom number.",
                        per_item)
    return _verdict(False, 5,
                    "The split is right! Now look again at how many parts you've coloured in.", per_item)


# ── 6. dot_array ─────────────────────────────────────────────────────────────────
# Build an r×c array of dots by tapping, then say the product. Params: {"rows": 4, "cols": 4}.

def _build_dot_array(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    rows = _require_int(
        p, ("rows", "r"), 1, 12,
        "It's how many rows of dots the array has — the first number of the multiplication.",
    )
    cols = _require_int(
        p, ("cols", "columns", "c"), 1, 12,
        "It's how many dots are in each row — the second number of the multiplication.",
    )
    product = rows * cols
    clean = {"rows": rows, "cols": cols, "max": 12, "dot_colour": _pick(DOT_THEMES)}
    prompt = (f"Build the array for {rows} × {cols} — make {rows} rows of {cols} dots — "
              f"then type the answer.")
    return clean, {"rows": rows, "cols": cols, "product": product}, prompt, f"{rows} × {cols}"


def _mark_dot_array(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    ans = answer if isinstance(answer, dict) else {}
    want = _as_int(sol.get("product"))
    got = _as_int(ans.get("product"))
    shape_ok = (_as_int(ans.get("rows")) == _as_int(sol.get("rows"))
                and _as_int(ans.get("cols")) == _as_int(sol.get("cols")))
    product_ok = got is not None and got == want
    per_item = {"array": shape_ok, "product": product_ok}
    if shape_ok and product_ok:
        return _verdict(True, 10, "Perfect — the array matches and the answer is right!", per_item)
    if product_ok and not shape_ok:
        return _verdict(True, 8, "Right answer! Next time build the array to match it too.", per_item)
    if shape_ok and not product_ok:
        return _verdict(False, 5,
                        "Your array is exactly right — now count the dots to find the answer.", per_item)
    return _verdict(False, 0,
                    "Not yet — build the rows first, then count all the dots.", per_item)


# ── 7. counting_bubbles ──────────────────────────────────────────────────────────
# KS1: count the objects. Params: {"count": 7, "item": "apples"}.

def _build_counting(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    count = _require_int(
        p, ("count", "total", "number"), 1, 20,
        "It's how many objects to draw — and it must fit the lesson's range "
        "('within 10' means 1-10).",
    )
    # If the tutor didn't name the objects, pick some — and pick DIFFERENT ones each time. Ten
    # apples, then ten apples again, is the same picture; ten frogs is a new one.
    item = str(p.get("item", p.get("object", "")) or "").strip()
    emoji = ""
    if item:
        emoji = next((e for name, e in COUNT_ITEMS if name == item.lower()), "")
    else:
        item, emoji = _pick(COUNT_ITEMS)

    clean = {
        "count": count, "item": item, "emoji": emoji,
        # scatter / neat rows / a ten-frame. The ten-frame is the one that actually teaches
        # number bonds, so it isn't just decoration.
        "layout": _pick(COUNT_LAYOUTS) if count <= 10 else _pick(["scatter", "rows"]),
    }
    prompt = f"How many {item} can you count? Tap each one, then type your answer."
    return clean, count, prompt, "Count them all"


def _mark_counting(solution: Any, answer: Any) -> Dict[str, Any]:
    want = _as_int(solution)
    got = _as_int(answer)
    if got is not None and got == want:
        return _verdict(True, 10, "That's right — great counting!")
    if got is None:
        return _verdict(False, 0, "Have a go at typing a number for me.")
    hint = "a few more" if got < (want or 0) else "a few less"
    return _verdict(False, 0, f"Not quite — try counting again slowly, there are {hint} than that.")


# ── 8. compare_numbers ─────────────────────────────────────────────────────────────
# Two big number cards. The child taps the BIGGER (or SMALLER) one, or drops the right
# <, = or > sign between them. Params: {"left": 29, "right": 92}. This replaces the AI asking
# "which number is bigger, 29 or 92?" in plain chat text — now it's a tappable puzzle.
# Comparing / ordering numbers is a core KS1–KS3 place-value skill.

_COMPARE_THEMES = [
    ("#3b82f6", "#ec4899"),  # blue / pink
    ("#22c55e", "#f97316"),  # green / orange
    ("#a855f7", "#06b6d4"),  # purple / cyan
    ("#f43f5e", "#14b8a6"),  # rose / teal
    ("#eab308", "#8b5cf6"),  # amber / violet
]

# Accept sign-ish student answers however they arrive (a tapped glyph, or a word).
_SIGN_WORDS = {
    ">": ">", "greater": ">", "more": ">", "bigger": ">", "gt": ">", "greater than": ">",
    "<": "<", "less": "<", "fewer": "<", "smaller": "<", "lt": "<", "less than": "<",
    "=": "=", "equal": "=", "equals": "=", "same": "=", "eq": "=", "equal to": "=",
}


def _build_compare_numbers(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    left = _require_int(
        p, ("left", "a", "first", "number_a", "n1", "x"), 0, 1_000_000,
        "It's the first number to compare — size it to the lesson's range "
        "('within 100' means up to 99).",
    )
    right = _require_int(
        p, ("right", "b", "second", "number_b", "n2", "y"), 0, 1_000_000,
        "It's the second number to compare — size it to the lesson's range "
        "('within 100' means up to 99).",
    )
    _check_ceiling(left, key_stage, "number")
    _check_ceiling(right, key_stage, "number")

    rng = _rng()
    # The <, =, > sign question is an ABSTRACTION that only lands once children have met the
    # notation — so it's KS3-and-up only. Younger students (KS1/KS2) just tap the bigger or the
    # smaller number; no signs. Within the allowed styles there's still lots of variety (bias
    # toward bigger/smaller, several phrasings each, a fresh colour theme).
    allow_sign = _norm_ks(key_stage) in ("KS3", "KS4", "KS5")
    if left == right:
        if not allow_sign:
            raise ParamError(
                "The two numbers are equal, so 'which is bigger/smaller?' has no answer. Pass two "
                "DIFFERENT numbers for a KS1/KS2 comparison."
            )
        mode = "sign"
    else:
        styles = ["bigger", "bigger", "smaller", "smaller"]
        if allow_sign:
            styles += ["sign", "sign"]
        mode = rng.choice(styles)
    if mode == "bigger":
        answer = str(max(left, right))
        prompt = rng.choice([
            "Which number is BIGGER? Tap it, then press Check.",
            "Tap the number that is GREATER, then press Check.",
            "Which of these two is the bigger number? Tap it and check.",
        ])
        title = "Which is bigger?"
    elif mode == "smaller":
        answer = str(min(left, right))
        prompt = rng.choice([
            "Which number is SMALLER? Tap it, then press Check.",
            "Tap the number that is LESS, then press Check.",
            "Which of these two is the smaller number? Tap it and check.",
        ])
        title = "Which is smaller?"
    else:
        answer = ">" if left > right else ("<" if left < right else "=")
        prompt = rng.choice([
            "Which sign goes in the middle? Tap <, = or >, then press Check.",
            "Put the right sign between the two numbers — tap <, = or >, then Check.",
        ])
        title = "Put in the sign"

    theme = rng.choice(_COMPARE_THEMES)
    clean = {
        "left": left, "right": right, "mode": mode,
        "signs": ["<", "=", ">"], "colours": list(theme),
    }
    solution = {"mode": mode, "answer": answer}
    return clean, solution, prompt, title


def _mark_compare_numbers(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    mode = sol.get("mode")
    want = str(sol.get("answer", "")).strip()
    got = answer
    if isinstance(got, dict):
        got = got.get("choice", got.get("answer", got.get("value", got.get("sign", ""))))
    got = str(got).strip()

    if mode in ("bigger", "smaller"):
        gi, wi = _as_int(got), _as_int(want)
        if gi is None:
            return _verdict(False, 0, "Tap one of the numbers, then press Check.")
        if gi == wi:
            word = "bigger" if mode == "bigger" else "smaller"
            return _verdict(True, 10, f"That's right — {want} is the {word} number!")
        return _verdict(False, 0,
                        "Not quite — compare the TENS first: the number with more tens is the "
                        "bigger one. Have another look.")

    # sign mode
    g = _SIGN_WORDS.get(got.lower(), got)
    if g == want:
        return _verdict(True, 10, "Exactly — the wide open end always faces the bigger number.")
    return _verdict(False, 0,
                    "Not quite — the wide open end of < or > points at the BIGGER number and the "
                    "pointy end at the smaller. Have another go.")


# ── 9. order_numbers ───────────────────────────────────────────────────────────────
# Scrambled number cards the child TAPS into order (smallest→biggest or biggest→smallest).
# Params: {"numbers": [45, 12, 51]}. Replaces "put these in order" asked in plain chat text.

def _build_order_numbers(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    raw = p.get("numbers") or p.get("values") or p.get("nums") or p.get("list") or []
    if isinstance(raw, (int, str)):
        raw = [raw]
    parsed = [n for n in (_as_int(x) for x in raw) if n is not None]
    # Distinct only — ordering with a repeated value makes "which slot" ambiguous to mark.
    seen, nums = set(), []
    for n in parsed:
        if n not in seen:
            seen.add(n)
            nums.append(n)
    nums = nums[:5]
    if len(nums) < 3:
        raise ParamError(
            "Missing 'numbers'. Pass 3-5 DIFFERENT numbers to put in order, sized to the lesson's "
            "range, e.g. {\"numbers\": [45, 12, 51]}. There is no default."
        )
    for n in nums:
        _check_ceiling(n, key_stage, "number")

    rng = _rng()
    direction = str(p.get("direction", p.get("order", ""))).lower()
    if direction not in ("asc", "desc"):
        direction = rng.choice(["asc", "desc"])
    ordered = sorted(nums, reverse=(direction == "desc"))
    # Present them scrambled — never already in the answer order.
    shown = nums[:]
    for _ in range(8):
        rng.shuffle(shown)
        if shown != ordered:
            break
    word = "smallest to biggest" if direction == "asc" else "biggest to smallest"
    prompt = rng.choice([
        f"Put these numbers in order, from {word}. Tap them one by one, then press Check.",
        f"Tap the numbers in order — {word} — then press Check.",
    ])
    clean = {"shown": shown, "direction": direction}
    return clean, {"order": ordered}, prompt, "Put them in order"


def _mark_order_numbers(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution.get("order") if isinstance(solution, dict) else None
    want = [_as_int(x) for x in (sol or [])]
    got_raw = answer.get("order") if isinstance(answer, dict) else answer
    got = [_as_int(x) for x in got_raw] if isinstance(got_raw, (list, tuple)) else []
    if want and got == want:
        return _verdict(True, 10, "Perfect — that's exactly the right order!")
    if not got:
        return _verdict(False, 0, "Tap the numbers one at a time to put them in order, then Check.")
    right = sum(1 for i, w in enumerate(want) if i < len(got) and got[i] == w)
    return _verdict(False, _score_from_ratio(right, len(want)),
                    "Not quite — compare the TENS first, then line them up in order. Have another go.")


# =================================================================================
# SCIENCE + ADVANCED MATHS ACTIVITIES
# =================================================================================
# The contract is the same as above — the AI passes semantic params, the server derives the
# question AND the answer — but science needs one extra idea to honour it.
#
# The server can derive that 3 tens + 4 ones is 34. It CANNOT derive that copper conducts and
# rubber doesn't; that is subject knowledge, not arithmetic. The obvious workaround — let the AI
# pass the items *and* their right answers — would hand the answer back to the model and re-open
# exactly the contradiction this whole module exists to prevent (a mislabelled item marked
# "correct" would teach a child something false).
#
# So science activities are backed by CURATED SERVER-OWNED CONTENT BANKS. The AI chooses a `set`
# that matches the lesson topic; the server owns the items, the answers and the key stages. The
# model cannot get the science wrong because it never supplies any.

def _as_float(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip().replace(",", ""))
        except ValueError:
            return None
    return None


def _norm_key(v: Any) -> str:
    return str(v or "").strip().lower().replace(" ", "_").replace("-", "_")


# ── 10. sorting_bins — sort items into labelled bins ──────────────────────────────
# The single most reusable science activity: living/non-living, materials, conductors,
# acids/alkalis, elements vs compounds… one component, one marker, dozens of topics.
# Each set carries its OWN key stages so a KS1 child can never be shown prokaryotes.

_SORTING_SETS: Dict[str, Dict[str, Any]] = {
    "living_nonliving": {
        "key_stages": ["KS1", "KS2"], "title": "Living or not living?",
        "bins": ["Living", "Not living"],
        "items": [("Oak tree", "Living"), ("Dog", "Living"), ("Butterfly", "Living"),
                  ("Mushroom", "Living"), ("Rock", "Not living"), ("Car", "Not living"),
                  ("Spoon", "Not living"), ("Cloud", "Not living")],
    },
    "materials": {
        "key_stages": ["KS1", "KS2"], "title": "Sort the materials",
        "bins": ["Wood", "Metal", "Plastic"],
        "items": [("Tree branch", "Wood"), ("Pencil", "Wood"), ("Spoon", "Metal"),
                  ("Coin", "Metal"), ("Key", "Metal"), ("Drinks bottle", "Plastic"),
                  ("Lego brick", "Plastic"), ("Ruler", "Plastic")],
    },
    "solid_liquid_gas": {
        "key_stages": ["KS1", "KS2", "KS3"], "title": "Solid, liquid or gas?",
        "bins": ["Solid", "Liquid", "Gas"],
        "items": [("Ice cube", "Solid"), ("Brick", "Solid"), ("Wood", "Solid"),
                  ("Water", "Liquid"), ("Milk", "Liquid"), ("Oil", "Liquid"),
                  ("Oxygen", "Gas"), ("Steam", "Gas"), ("Helium", "Gas")],
    },
    "magnetic_nonmagnetic": {
        "key_stages": ["KS1", "KS2", "KS3"], "title": "Magnetic or not?",
        "bins": ["Magnetic", "Not magnetic"],
        "items": [("Iron nail", "Magnetic"), ("Steel paperclip", "Magnetic"),
                  ("Nickel coin", "Magnetic"), ("Copper wire", "Not magnetic"),
                  ("Aluminium foil", "Not magnetic"), ("Plastic ruler", "Not magnetic"),
                  ("Wooden block", "Not magnetic"), ("Glass marble", "Not magnetic")],
    },
    "conductors_insulators": {
        "key_stages": ["KS2", "KS3", "KS4"], "title": "Conductor or insulator?",
        "bins": ["Conductor", "Insulator"],
        "items": [("Copper wire", "Conductor"), ("Iron nail", "Conductor"),
                  ("Aluminium foil", "Conductor"), ("Graphite", "Conductor"),
                  ("Rubber glove", "Insulator"), ("Plastic ruler", "Insulator"),
                  ("Wood", "Insulator"), ("Glass", "Insulator")],
    },
    "herbivore_carnivore_omnivore": {
        "key_stages": ["KS1", "KS2", "KS3"], "title": "What does it eat?",
        "bins": ["Herbivore", "Carnivore", "Omnivore"],
        "items": [("Rabbit", "Herbivore"), ("Cow", "Herbivore"), ("Caterpillar", "Herbivore"),
                  ("Lion", "Carnivore"), ("Shark", "Carnivore"), ("Eagle", "Carnivore"),
                  ("Bear", "Omnivore"), ("Human", "Omnivore"), ("Pig", "Omnivore")],
    },
    "vertebrates_invertebrates": {
        "key_stages": ["KS2", "KS3"], "title": "Backbone or not?",
        "bins": ["Vertebrate", "Invertebrate"],
        "items": [("Frog", "Vertebrate"), ("Eagle", "Vertebrate"), ("Shark", "Vertebrate"),
                  ("Snake", "Vertebrate"), ("Earthworm", "Invertebrate"),
                  ("Spider", "Invertebrate"), ("Jellyfish", "Invertebrate"),
                  ("Snail", "Invertebrate")],
    },
    "renewable_nonrenewable": {
        "key_stages": ["KS2", "KS3", "KS4"], "title": "Renewable or not?",
        "bins": ["Renewable", "Non-renewable"],
        "items": [("Solar", "Renewable"), ("Wind", "Renewable"), ("Hydroelectric", "Renewable"),
                  ("Tidal", "Renewable"), ("Coal", "Non-renewable"), ("Oil", "Non-renewable"),
                  ("Natural gas", "Non-renewable"), ("Nuclear (uranium)", "Non-renewable")],
    },
    "acids_alkalis": {
        "key_stages": ["KS3", "KS4"], "title": "Acid or alkali?",
        "bins": ["Acid", "Alkali"],
        "items": [("Lemon juice", "Acid"), ("Vinegar", "Acid"), ("Hydrochloric acid", "Acid"),
                  ("Stomach acid", "Acid"), ("Soap", "Alkali"), ("Bleach", "Alkali"),
                  ("Baking soda", "Alkali"), ("Sodium hydroxide", "Alkali")],
    },
    "metals_nonmetals": {
        "key_stages": ["KS3", "KS4"], "title": "Metal or non-metal?",
        "bins": ["Metal", "Non-metal"],
        "items": [("Iron", "Metal"), ("Copper", "Metal"), ("Sodium", "Metal"),
                  ("Magnesium", "Metal"), ("Oxygen", "Non-metal"), ("Sulfur", "Non-metal"),
                  ("Chlorine", "Non-metal"), ("Carbon", "Non-metal")],
    },
    "elements_compounds_mixtures": {
        "key_stages": ["KS3", "KS4", "KS5"], "title": "Element, compound or mixture?",
        "bins": ["Element", "Compound", "Mixture"],
        "items": [("Oxygen (O₂)", "Element"), ("Copper (Cu)", "Element"), ("Iron (Fe)", "Element"),
                  ("Water (H₂O)", "Compound"), ("Carbon dioxide (CO₂)", "Compound"),
                  ("Sodium chloride (NaCl)", "Compound"), ("Air", "Mixture"),
                  ("Sea water", "Mixture"), ("Brass", "Mixture")],
    },
    "prokaryote_eukaryote": {
        "key_stages": ["KS4", "KS5"], "title": "Prokaryote or eukaryote?",
        "bins": ["Prokaryote", "Eukaryote"],
        "items": [("Bacterium", "Prokaryote"), ("E. coli", "Prokaryote"),
                  ("Cyanobacterium", "Prokaryote"), ("Animal cell", "Eukaryote"),
                  ("Plant cell", "Eukaryote"), ("Yeast", "Eukaryote"), ("Amoeba", "Eukaryote")],
    },
    "plant_animal_cell": {
        "key_stages": ["KS3", "KS4", "KS5"], "title": "Which cells have it?",
        "bins": ["Plant only", "Both"],
        "items": [("Cell wall", "Plant only"), ("Chloroplast", "Plant only"),
                  ("Permanent vacuole", "Plant only"), ("Nucleus", "Both"),
                  ("Cell membrane", "Both"), ("Cytoplasm", "Both"), ("Mitochondria", "Both")],
    },
}


def _sets_for(bank: Dict[str, Dict[str, Any]], key_stage: Optional[str]) -> List[str]:
    ks = _norm_ks(key_stage)
    return [k for k, v in bank.items() if not ks or ks in v["key_stages"]]


def _build_sorting_bins(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    key = _norm_key(p.get("set") or p.get("topic") or p.get("name"))
    if not key:
        raise ParamError(
            "Missing 'set'. Choose the sorting set that matches this lesson's topic, e.g. "
            f"{{\"set\": \"living_nonliving\"}}. Available for this key stage: "
            f"{', '.join(_sets_for(_SORTING_SETS, key_stage)) or 'none'}."
        )
    entry = _SORTING_SETS.get(key)
    if not entry:
        raise ParamError(
            f"Unknown set {key!r}. Choose one of: "
            f"{', '.join(_sets_for(_SORTING_SETS, key_stage)) or 'none for this key stage'}."
        )
    ks = _norm_ks(key_stage)
    if ks and ks not in entry["key_stages"]:
        raise ParamError(
            f"The {key!r} set isn't suitable for {key_stage}. Pick one of: "
            f"{', '.join(_sets_for(_SORTING_SETS, key_stage)) or 'none'}."
        )

    rng = _rng()
    # A DIFFERENT subset, in a different order, every time — the same set must never build the
    # same activity twice or the student just recalls last time's screen instead of thinking.
    items = list(entry["items"])
    rng.shuffle(items)
    bins = list(entry["bins"])
    count = rng.randint(min(5, len(items)), min(8, len(items)))
    chosen: List[Tuple[str, str]] = []
    for b in bins:                                  # guarantee ≥1 of each bin
        pick = next((it for it in items if it[1] == b and it not in chosen), None)
        if pick:
            chosen.append(pick)
    for it in items:                                # then fill up to the (varying) count
        if len(chosen) >= count:
            break
        if it not in chosen:
            chosen.append(it)
    rng.shuffle(chosen)

    clean = {"bins": bins, "items": [{"id": str(i), "label": lab}
                                     for i, (lab, _b) in enumerate(chosen)]}
    solution = {str(i): b for i, (_lab, b) in enumerate(chosen)}
    prompt = rng.choice([
        f"Sort each one into the right group: {' · '.join(bins)}. Tap an item, then tap its group.",
        f"Put every card where it belongs — {' · '.join(bins)}. Tap a card, then tap its group.",
        f"Which group does each one go in? Tap an item, then tap {' or '.join(bins)}.",
    ])
    return clean, solution, prompt, entry["title"]


def _mark_sorting_bins(solution: Any, answer: Any) -> Dict[str, Any]:
    want = solution if isinstance(solution, dict) else {}
    got_raw = answer.get("placements") if isinstance(answer, dict) else answer
    got = got_raw if isinstance(got_raw, dict) else {}
    if not want:
        return _verdict(False, 0, "I couldn't mark that one — let's talk it through together.")
    per_item = {k: (str(got.get(k, "")).strip().lower() == str(v).strip().lower())
                for k, v in want.items()}
    right = sum(1 for ok in per_item.values() if ok)
    total = len(want)
    if right == total:
        return _verdict(True, 10, "Every single one in the right group — brilliant sorting!",
                        per_item)
    if right == 0:
        return _verdict(False, 0, "Not quite yet — think about what each group really means, "
                        "then try again.", per_item)
    return _verdict(False, _score_from_ratio(right, total),
                    f"Good start — {right} of {total} are in the right group. Have another look "
                    "at the ones that moved back.", per_item)


# ── 11. sequence_order — put the stages in the right order ────────────────────────
# Life cycles, food chains, the water cycle, digestion, mitosis… same shape, many topics.

_SEQUENCE_SETS: Dict[str, Dict[str, Any]] = {
    "butterfly_life_cycle": {
        "key_stages": ["KS1", "KS2"], "title": "Butterfly life cycle",
        "steps": ["Egg", "Caterpillar", "Chrysalis", "Butterfly"],
    },
    "frog_life_cycle": {
        "key_stages": ["KS1", "KS2"], "title": "Frog life cycle",
        "steps": ["Egg (spawn)", "Tadpole", "Tadpole with legs", "Froglet", "Frog"],
    },
    "plant_life_cycle": {
        "key_stages": ["KS1", "KS2"], "title": "Plant life cycle",
        "steps": ["Seed", "Germination", "Seedling", "Adult plant", "Flower", "New seeds"],
    },
    "food_chain": {
        "key_stages": ["KS1", "KS2", "KS3"], "title": "Build the food chain",
        "steps": ["Grass", "Grasshopper", "Frog", "Snake", "Eagle"],
    },
    "water_cycle": {
        "key_stages": ["KS2", "KS3"], "title": "The water cycle",
        "steps": ["Evaporation", "Condensation", "Precipitation", "Collection"],
    },
    "planets": {
        "key_stages": ["KS2", "KS3"], "title": "Planets from the Sun",
        "steps": ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"],
    },
    "scientific_method": {
        "key_stages": ["KS2", "KS3", "KS4"], "title": "The scientific method",
        "steps": ["Question", "Hypothesis", "Method", "Experiment", "Results", "Conclusion"],
    },
    "digestion": {
        "key_stages": ["KS3", "KS4"], "title": "The journey of food",
        "steps": ["Mouth", "Oesophagus", "Stomach", "Small intestine", "Large intestine",
                  "Rectum"],
    },
    "blood_circulation": {
        "key_stages": ["KS3", "KS4"], "title": "Blood through the heart",
        "steps": ["Vena cava", "Right atrium", "Right ventricle", "Lungs", "Left atrium",
                  "Left ventricle", "Aorta"],
    },
    "mitosis": {
        "key_stages": ["KS4", "KS5"], "title": "Stages of mitosis",
        "steps": ["Interphase", "Prophase", "Metaphase", "Anaphase", "Telophase", "Cytokinesis"],
    },
    "rock_cycle": {
        "key_stages": ["KS2", "KS3"], "title": "The rock cycle",
        "steps": ["Weathering", "Erosion", "Deposition", "Compaction", "Sedimentary rock",
                  "Metamorphic rock"],
    },
}


def _build_sequence_order(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    key = _norm_key(p.get("set") or p.get("topic") or p.get("name"))
    if not key:
        raise ParamError(
            "Missing 'set'. Choose the sequence that matches this lesson's topic, e.g. "
            f"{{\"set\": \"water_cycle\"}}. Available for this key stage: "
            f"{', '.join(_sets_for(_SEQUENCE_SETS, key_stage)) or 'none'}."
        )
    entry = _SEQUENCE_SETS.get(key)
    if not entry:
        raise ParamError(
            f"Unknown set {key!r}. Choose one of: "
            f"{', '.join(_sets_for(_SEQUENCE_SETS, key_stage)) or 'none for this key stage'}."
        )
    ks = _norm_ks(key_stage)
    if ks and ks not in entry["key_stages"]:
        raise ParamError(
            f"The {key!r} sequence isn't suitable for {key_stage}. Pick one of: "
            f"{', '.join(_sets_for(_SEQUENCE_SETS, key_stage)) or 'none'}."
        )

    ordered = list(entry["steps"])
    rng = _rng()
    shown = ordered[:]
    for _ in range(10):                     # never present it already solved
        rng.shuffle(shown)
        if shown != ordered:
            break
    clean = {"shown": shown}
    prompt = rng.choice([
        "Put these in the correct order. Tap them one by one, then press Check.",
        "What happens first, and what comes next? Tap them in order, then press Check.",
        "Tap the stages in the right order from start to finish, then press Check.",
    ])
    return clean, {"order": ordered}, prompt, entry["title"]


def _mark_sequence_order(solution: Any, answer: Any) -> Dict[str, Any]:
    want = list((solution or {}).get("order") or []) if isinstance(solution, dict) else []
    got_raw = answer.get("order") if isinstance(answer, dict) else answer
    got = [str(x) for x in got_raw] if isinstance(got_raw, (list, tuple)) else []
    if not want:
        return _verdict(False, 0, "I couldn't mark that one — let's talk it through together.")
    if got == want:
        return _verdict(True, 10, "Perfect — that's exactly the right order!")
    if not got:
        return _verdict(False, 0, "Tap the stages one at a time to put them in order, then Check.")
    right = sum(1 for i, w in enumerate(want) if i < len(got) and got[i] == w)
    return _verdict(False, _score_from_ratio(right, len(want)),
                    f"Close — {right} of {len(want)} are in the right place. Think about what has "
                    "to happen FIRST, then work forward.")


# ── 12. atom_builder — build an atom from protons/neutrons/electrons ──────────────
# Server owns the element data, so the model can't misstate an atomic number.

_ELEMENTS: Dict[str, Dict[str, Any]] = {
    "hydrogen": {"symbol": "H", "z": 1, "mass": 1}, "helium": {"symbol": "He", "z": 2, "mass": 4},
    "lithium": {"symbol": "Li", "z": 3, "mass": 7}, "beryllium": {"symbol": "Be", "z": 4, "mass": 9},
    "boron": {"symbol": "B", "z": 5, "mass": 11}, "carbon": {"symbol": "C", "z": 6, "mass": 12},
    "nitrogen": {"symbol": "N", "z": 7, "mass": 14}, "oxygen": {"symbol": "O", "z": 8, "mass": 16},
    "fluorine": {"symbol": "F", "z": 9, "mass": 19}, "neon": {"symbol": "Ne", "z": 10, "mass": 20},
    "sodium": {"symbol": "Na", "z": 11, "mass": 23}, "magnesium": {"symbol": "Mg", "z": 12, "mass": 24},
    "aluminium": {"symbol": "Al", "z": 13, "mass": 27}, "silicon": {"symbol": "Si", "z": 14, "mass": 28},
    "phosphorus": {"symbol": "P", "z": 15, "mass": 31}, "sulfur": {"symbol": "S", "z": 16, "mass": 32},
    "chlorine": {"symbol": "Cl", "z": 17, "mass": 35}, "argon": {"symbol": "Ar", "z": 18, "mass": 40},
    "potassium": {"symbol": "K", "z": 19, "mass": 39}, "calcium": {"symbol": "Ca", "z": 20, "mass": 40},
}


# Common ion charge by group, for the main-group elements in the bank. Server-owned so the
# model can never assert that sodium forms Na²⁺.
_ION_CHARGE = {1: 1, 3: 1, 11: 1, 19: 1,          # group 1  → +1
               4: 2, 12: 2, 20: 2,                 # group 2  → +2
               8: -2, 16: -2,                       # group 6  → −2
               9: -1, 17: -1}                       # group 7  → −1


def _build_atom_builder(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    name = _norm_key(p.get("element") or p.get("name") or p.get("atom"))
    if not name:
        raise ParamError(
            "Missing 'element'. Pass the element this lesson is about, e.g. "
            "{\"element\": \"carbon\"}. Available: " + ", ".join(sorted(_ELEMENTS)) + "."
        )
    el = _ELEMENTS.get(name)
    if not el:
        raise ParamError(
            f"Unknown element {name!r}. Choose one of the first 20: " + ", ".join(sorted(_ELEMENTS)) + "."
        )
    z, mass = int(el["z"]), int(el["mass"])
    label = name.capitalize()
    rng = _rng()
    ks = _norm_ks(key_stage)

    # VARY THE ASK, not just the numbers. A fixed element can only build one "neutral atom", so
    # without this the same element rebuilds a byte-identical activity and the student just
    # recalls last time's answer instead of working it out. Weighted EVENLY (not neutral-heavy)
    # so the shape of the ask genuinely changes between attempts.
    variants = ["neutral", "isotope"]
    if ks in ("KS4", "KS5") and z in _ION_CHARGE:
        variants.append("ion")
    variant = str(p.get("variant") or "").strip().lower() or rng.choice(variants)

    if variant == "isotope":
        # A real-ish isotope: shift the neutron count a little, never below zero.
        shift = rng.choice([s for s in (-2, -1, 1, 2) if (mass - z) + s >= 0]) if (mass - z) > 0 else rng.choice([1, 2])
        mass_number = mass + shift
        neutrons, electrons, charge = mass_number - z, z, 0
        ask = (f"Build the isotope {label}-{mass_number} (a neutral atom with mass number "
               f"{mass_number}).")
    elif variant == "ion":
        charge = _ION_CHARGE[z]
        neutrons, electrons = mass - z, z - charge
        mass_number = mass
        sign = f"{abs(charge)}{'+' if charge > 0 else '−'}"
        ask = (f"Build the {label} ion, {el['symbol']}{sign} (mass number {mass_number}). "
               "Careful — an ion does NOT have equal protons and electrons.")
    else:
        variant = "neutral"
        neutrons, electrons, charge = mass - z, z, 0
        mass_number = mass
        ask = (f"Build a neutral atom of {label} ({el['symbol']}): atomic number {z}, mass "
               f"number {mass_number}.")

    clean = {
        "element": label, "symbol": el["symbol"], "atomic_number": z,
        "mass_number": mass_number, "shell_capacity": [2, 8, 8, 2],
        "variant": variant, "charge": charge,
    }
    solution = {"protons": z, "neutrons": neutrons, "electrons": electrons}
    tail = rng.choice([
        "Add the right protons, neutrons and electrons, then Check.",
        "Use the +/− buttons to build it, then press Check.",
        "Get all three particle counts right, then press Check.",
    ])
    return clean, solution, f"{ask} {tail}", f"Build a {label} atom"


def _mark_atom_builder(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    got = answer if isinstance(answer, dict) else {}
    fields = ("protons", "neutrons", "electrons")
    per_item = {f: (_as_int(got.get(f)) == int(sol.get(f, -1))) for f in fields}
    right = sum(1 for ok in per_item.values() if ok)
    if right == 3:
        return _verdict(True, 10, "Spot on — protons, neutrons and electrons all correct!", per_item)
    hints = []
    if not per_item["protons"]:
        hints.append("the number of protons IS the atomic number")
    if not per_item["neutrons"]:
        hints.append("neutrons = mass number − atomic number")
    if not per_item["electrons"]:
        hints.append("electrons balance the protons unless it's an ion (then the charge tells you "
                     "how many were lost or gained)")
    return _verdict(False, _score_from_ratio(right, 3),
                    "Not quite — remember: " + "; ".join(hints) + ".", per_item)


# ── 13. ph_scale — place a substance on the pH scale ──────────────────────────────

_PH_SUBSTANCES: Dict[str, int] = {
    "stomach_acid": 1, "battery_acid": 0, "lemon_juice": 2, "vinegar": 3, "orange_juice": 4,
    "black_coffee": 5, "milk": 6, "pure_water": 7, "blood": 7, "sea_water": 8,
    "baking_soda": 9, "soap": 10, "ammonia": 11, "bleach": 13, "oven_cleaner": 14,
}


def _build_ph_scale(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    name = _norm_key(p.get("substance") or p.get("name"))
    if not name:
        raise ParamError(
            "Missing 'substance'. Pass what the student should place on the pH scale, e.g. "
            "{\"substance\": \"lemon_juice\"}. Available: " + ", ".join(sorted(_PH_SUBSTANCES)) + "."
        )
    ph = _PH_SUBSTANCES.get(name)
    if ph is None:
        raise ParamError(
            f"Unknown substance {name!r}. Choose one of: " + ", ".join(sorted(_PH_SUBSTANCES)) + "."
        )
    label = name.replace("_", " ")
    clean = {"substance": label}
    prompt = _rng().choice([
        f"Where does {label} sit on the pH scale? Slide the marker, then press Check.",
        f"Slide the marker to the pH you think {label} has, then press Check.",
        f"What's the pH of {label}? Move the marker along the scale and press Check.",
    ])
    return clean, {"ph": ph}, prompt, "The pH scale"


def _mark_ph_scale(solution: Any, answer: Any) -> Dict[str, Any]:
    want = int((solution or {}).get("ph", -1)) if isinstance(solution, dict) else -1
    got_raw = answer.get("ph") if isinstance(answer, dict) else answer
    got = _as_int(got_raw)
    if got is None:
        return _verdict(False, 0, "Slide the marker to a pH, then press Check.")
    if got == want:
        return _verdict(True, 10, f"Exactly — pH {want}. Well judged!")
    if abs(got - want) == 1:
        return _verdict(True, 8, f"Very close — it's pH {want}, and you were only one out. Good judgement!")
    side = "acidic (below 7)" if want < 7 else ("neutral (exactly 7)" if want == 7 else "alkaline (above 7)")
    return _verdict(False, _score_from_ratio(max(0, 4 - abs(got - want)), 4),
                    f"Not quite — think about whether it should be {side}, then try again.")


# ── 14. punnett_square — a genetic cross ─────────────────────────────────────────
# Fully derivable: the four offspring genotypes follow from the two parent genotypes.

def _norm_genotype(v: Any) -> str:
    s = str(v or "").strip()
    if len(s) != 2 or not s.isalpha() or s[0].lower() != s[1].lower():
        return ""
    # dominant (upper) first, so "bB" and "Bb" are the same genotype
    return "".join(sorted(s, key=lambda c: (c.islower(), c)))


def _build_punnett(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    p1 = _norm_genotype(p.get("parent1") or p.get("mother") or p.get("p1"))
    p2 = _norm_genotype(p.get("parent2") or p.get("father") or p.get("p2"))
    if not p1 or not p2:
        raise ParamError(
            "Missing 'parent1'/'parent2'. Pass both parent genotypes as two letters of the SAME "
            "letter, e.g. {\"parent1\": \"Bb\", \"parent2\": \"Bb\"}. There is no default."
        )
    if p1[0].lower() != p2[0].lower():
        raise ParamError(
            f"'parent1' ({p1}) and 'parent2' ({p2}) use different genes. Both parents must use the "
            "same letter, e.g. Bb x bb."
        )
    trait = str(p.get("trait") or "").strip()
    letter = p1[0].upper()
    cols = list(p1)                   # parent 1 alleles across the top
    rows = list(p2)                   # parent 2 alleles down the side
    cells: Dict[str, str] = {}
    for r, ra in enumerate(rows):
        for c, ca in enumerate(cols):
            cells[f"{r}{c}"] = "".join(sorted(ca + ra, key=lambda ch: (ch.islower(), ch)))
    clean = {"cols": cols, "rows": rows, "letter": letter,
             "alleles": [letter, letter.lower()], "trait": trait}
    tail = f" for {trait}" if trait else ""
    prompt = _rng().choice([
        f"Complete the Punnett square for {p1} × {p2}{tail}. Tap a box, then tap the alleles it should contain.",
        f"Cross {p1} × {p2}{tail}. Fill in every box — tap a box, then tap its two alleles.",
        f"Work out the offspring of {p1} × {p2}{tail}. Tap each box and give it its alleles.",
    ])
    return clean, {"cells": cells}, prompt, f"Punnett square: {p1} × {p2}"


def _mark_punnett(solution: Any, answer: Any) -> Dict[str, Any]:
    want = (solution or {}).get("cells") if isinstance(solution, dict) else None
    want = want if isinstance(want, dict) else {}
    got_raw = answer.get("cells") if isinstance(answer, dict) else answer
    got = got_raw if isinstance(got_raw, dict) else {}
    if not want:
        return _verdict(False, 0, "I couldn't mark that one — let's talk it through together.")
    per_item = {k: (_norm_genotype(got.get(k)) == v) for k, v in want.items()}
    right = sum(1 for ok in per_item.values() if ok)
    total = len(want)
    if right == total:
        return _verdict(True, 10, "Every box correct — that's a perfect Punnett square!", per_item)
    return _verdict(False, _score_from_ratio(right, total),
                    f"{right} of {total} boxes are right. Remember: each box takes ONE allele from "
                    "the top and ONE from the side.", per_item)


# ── 15. force_arrows — resultant of two horizontal forces ────────────────────────

def _mirror_dir(d: str) -> str:
    return "left" if d == "right" else "right"


def _force_dir(v: Any, default: str) -> str:
    s = str(v if v is not None else "").strip().lower()
    if s in ("left", "l", "-", "back", "backward", "backwards", "west", "<-", "←"):
        return "left"
    if s in ("right", "r", "+", "forward", "forwards", "east", "->", "→"):
        return "right"
    return default


def _build_force_arrows(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    """Two forces act on the box — A (drawn on top) and B (drawn below), EACH with its own
    direction. That's the fix for "the arrows always point right and the AI subtracts anyway":
    the picture now genuinely shows each force's direction, and the resultant is the SIGNED sum,
    so BOTH cases are covered — same direction → the forces ADD; opposite → the difference,
    pointing the way of the bigger force. Either force can be the bigger one.

    Params: {"a": 30, "a_dir": "right", "b": 50, "b_dir": "left"}. Legacy {"left": x, "right": y}
    still works and means two OPPOSITE forces (a left-pointing x and a right-pointing y)."""
    legacy = (p.get("a") is None and p.get("force_a") is None
              and (p.get("left") is not None or p.get("right") is not None))
    if legacy:
        a_raw, a_dir = p.get("left", 0), "left"
        b_raw, b_dir = p.get("right", 0), "right"
    else:
        a_raw = next((p[k] for k in ("a", "force_a", "f1", "first") if p.get(k) is not None), None)
        b_raw = next((p[k] for k in ("b", "force_b", "f2", "second") if p.get(k) is not None), None)
        a_dir = _force_dir(p.get("a_dir", p.get("dir_a")), "right")
        b_dir = _force_dir(p.get("b_dir", p.get("dir_b")), "left")

    a, b = _as_int(a_raw), _as_int(b_raw)
    if a is None or b is None:
        raise ParamError(
            "Pass TWO forces, each with a size (newtons) and a direction, e.g. "
            "{\"a\": 30, \"a_dir\": \"right\", \"b\": 50, \"b_dir\": \"left\"}. Vary it — sometimes "
            "have them point the SAME way (they add) and sometimes OPPOSITE (they subtract)."
        )
    if not (0 <= a <= 500 and 0 <= b <= 500):
        raise ParamError("Each force must be between 0 and 500 N.")
    if a == 0 and b == 0:
        raise ParamError("Both forces are 0 N — pass at least one non-zero force.")

    # RANDOMISE WHICH WAY IT RESOLVES. Left to itself the model almost always builds the same
    # shape (bigger force on the right → answer always "right"), so a student learns "tap Right"
    # instead of reading the arrows. Mirroring the whole set-up half the time flips left↔right —
    # same physics and same magnitudes, but the answer genuinely varies. Safe to do server-side:
    # the SERVER derives the answer, and the final a/b/dirs go back in `clean`, so the picture,
    # the marking and what the tutor sees all agree.
    if not p.get("no_mirror") and _rng().random() < 0.5:
        a, b = b, a
        a_dir, b_dir = _mirror_dir(b_dir), _mirror_dir(a_dir)

    signed = (a if a_dir == "right" else -a) + (b if b_dir == "right" else -b)
    magnitude = abs(signed)
    direction = "balanced" if signed == 0 else ("right" if signed > 0 else "left")
    same = a_dir == b_dir
    clean = {"a": a, "a_dir": a_dir, "b": b, "b_dir": b_dir, "max": max(a, b, 1)}
    prompt = _rng().choice([
        "Look at the two forces on the box — note which WAY each one points. Work out the RESULTANT: set its size, choose its direction, then press Check.",
        "Two forces pull on this box. What single force would have the same effect? Watch the arrows' directions — set the size and direction, then Check.",
        "Find the resultant of these two forces. Do they point the same way or opposite ways? Set how big it is and which way it acts, then press Check.",
    ])
    return clean, {"magnitude": magnitude, "direction": direction, "same_dir": same}, prompt, "Resultant force"


def _mark_force_arrows(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    got = answer if isinstance(answer, dict) else {}
    want_mag = int(sol.get("magnitude", -1))
    want_dir = str(sol.get("direction", ""))
    same = bool(sol.get("same_dir", False))
    got_mag = _as_int(got.get("magnitude"))
    got_dir = str(got.get("direction", "")).strip().lower()
    if got_mag is None or not got_dir:
        return _verdict(False, 0, "Set the size of the resultant and pick a direction, then Check.")
    mag_ok = got_mag == want_mag
    # When the forces balance, the direction buttons are irrelevant — 0 N has no direction.
    dir_ok = True if want_dir == "balanced" and want_mag == 0 and got_mag == 0 else got_dir == want_dir
    method = "ADD the two forces together" if same else "subtract the smaller force from the bigger one"
    if mag_ok and dir_ok:
        if want_dir == "balanced":
            return _verdict(True, 10, "Exactly — equal forces in opposite directions cancel out, "
                            "so the resultant is 0 N and the box stays still.")
        extra = "adding them" if same else "taking the difference"
        return _verdict(True, 10, f"Spot on — {want_mag} N to the {want_dir}, by {extra}.")
    if mag_ok and not dir_ok:
        return _verdict(False, 6, "The size is right — check the direction: the resultant points "
                        "the way of the bigger force.", {"magnitude": True, "direction": False})
    return _verdict(False, 4 if dir_ok else 0,
                    f"Not quite — the two forces point the {'SAME way, so you ' + method if same else 'OPPOSITE way, so you ' + method}. "
                    "The resultant then points the way of the bigger force.",
                    {"magnitude": False, "direction": dir_ok})


# ── 16. clock_hands — set the hands to show a time ───────────────────────────────
# The Time topic had NO hands-on activity at all, so the tutor kept typing "what time is it?"
# into the chat — exactly what a 5-year-old cannot answer.

def _time_in_words(hour: int, minute: int) -> str:
    nxt = 1 if hour == 12 else hour + 1
    if minute == 0:
        return f"{hour} o'clock"
    if minute == 15:
        return f"quarter past {hour}"
    if minute == 30:
        return f"half past {hour}"
    if minute == 45:
        return f"quarter to {nxt}"
    if minute < 30:
        return f"{minute} minutes past {hour}"
    return f"{60 - minute} minutes to {nxt}"


def _build_clock_hands(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    hour = _require_int(p, ("hour", "hours"), 1, 12, "The hour the clock should show (1-12).")
    minute = _require_int(p, ("minute", "minutes"), 0, 59,
                          "The minutes the clock should show. Use 0/15/30/45 for KS1; "
                          "multiples of 5 for KS2.")
    ks = _norm_ks(key_stage)
    allowed = (0, 15, 30, 45) if ks == "KS1" else tuple(range(0, 60, 5))
    if minute not in allowed:
        raise ParamError(
            f"'minute' is {minute}, which {key_stage or 'this key stage'} shouldn't be asked to "
            f"set. Use one of: {', '.join(str(m) for m in allowed)}."
        )
    clean = {"step": 15 if ks == "KS1" else 5}
    words = _time_in_words(hour, minute)
    prompt = _rng().choice([
        f"Make the clock show {words}. Drag the hands, then press Check.",
        f"Can you set the clock to {words}? Move the hands, then press Check.",
        f"Show me {words} on the clock — drag each hand, then press Check.",
    ])
    return clean, {"hour": hour, "minute": minute}, prompt, "Set the clock"


def _mark_clock_hands(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    got = answer if isinstance(answer, dict) else {}
    wh, wm = int(sol.get("hour", -1)), int(sol.get("minute", -1))
    gh, gm = _as_int(got.get("hour")), _as_int(got.get("minute"))
    if gh is None or gm is None:
        return _verdict(False, 0, "Drag both hands to set the time, then press Check.")
    if gh == wh and gm == wm:
        return _verdict(True, 10, f"Perfect — that's {_time_in_words(wh, wm)}!")
    per_item = {"hour": gh == wh, "minute": gm == wm}
    if gm == wm and gh != wh:
        return _verdict(False, 5, "The minute hand is right — now check the SHORT hour hand.",
                        per_item)
    if gh == wh and gm != wm:
        return _verdict(False, 5, "The hour hand is right — now move the LONG minute hand.",
                        per_item)
    return _verdict(False, 0, "Not quite — the SHORT hand shows the hour and the LONG hand shows "
                    "the minutes. Have another go.", per_item)


# ── 17. money_coins — make an amount with coins ──────────────────────────────────
# Marked on the TOTAL, never on which coins: 50p+20p and 20p+20p+20p+10p are both "70p".

_UK_COINS = [1, 2, 5, 10, 20, 50, 100, 200]


def _fmt_money(pence: int) -> str:
    if pence < 100:
        return f"{pence}p"
    pounds, rem = divmod(pence, 100)
    return f"£{pounds}" if rem == 0 else f"£{pounds}.{rem:02d}"


def _build_money_coins(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    ks = _norm_ks(key_stage)
    hi = 100 if ks == "KS1" else 1000
    amount = _require_int(p, ("amount_p", "amount", "pence", "target"), 1, hi,
                          f"The amount to make, IN PENCE (e.g. 47 for 47p). Keep it within "
                          f"{_fmt_money(hi)} for {key_stage or 'this key stage'}.")
    coins = [c for c in _UK_COINS if c <= max(amount, 2) * 2 and (ks != "KS1" or c <= 100)]
    clean = {"amount_p": amount, "coins": coins, "label": _fmt_money(amount)}
    prompt = _rng().choice([
        f"Make {_fmt_money(amount)} using the coins. Tap coins to add them, then press Check.",
        f"Can you make exactly {_fmt_money(amount)}? Tap the coins you need, then press Check.",
        f"Put together {_fmt_money(amount)} from these coins, then press Check.",
    ])
    return clean, {"amount_p": amount}, prompt, "Make the amount"


def _mark_money_coins(solution: Any, answer: Any) -> Dict[str, Any]:
    want = int((solution or {}).get("amount_p", -1)) if isinstance(solution, dict) else -1
    got_raw = answer.get("total_p") if isinstance(answer, dict) else answer
    got = _as_int(got_raw)
    if got is None:
        return _verdict(False, 0, "Tap some coins to make the amount, then press Check.")
    if got == want:
        return _verdict(True, 10, f"That's exactly {_fmt_money(want)} — lovely coin work!")
    if got < want:
        return _verdict(False, _score_from_ratio(got, max(want, 1)),
                        f"You've made {_fmt_money(got)} — that's {_fmt_money(want - got)} short. "
                        "Add a bit more.")
    return _verdict(False, 0, f"You've made {_fmt_money(got)} — that's {_fmt_money(got - want)} "
                    "too much. Take a coin off and try again.")


# ── 18. number_line_jump — hops along a number line ──────────────────────────────

def _build_number_line(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    ks = _norm_ks(key_stage)
    hi = 20 if ks == "KS1" else (100 if ks == "KS2" else 200)
    start = _require_int(p, ("start", "from"), 0, hi, f"Where the jumps start (0-{hi}).")
    step = _require_int(p, ("step", "jump", "size"), 1, max(2, hi // 4),
                        "How big each jump is.")
    jumps = _require_int(p, ("jumps", "count", "times"), 1, 10, "How many jumps to make.")
    direction = str(p.get("direction", "forward")).strip().lower()
    if direction in ("back", "backward", "backwards", "left", "-"):
        direction = "back"
    else:
        direction = "forward"
    end = start + step * jumps if direction == "forward" else start - step * jumps
    if not (0 <= end <= hi):
        raise ParamError(
            f"Those jumps land on {end}, which is off a 0-{hi} number line for "
            f"{key_stage or 'this key stage'}. Adjust start/step/jumps so the landing point is "
            f"between 0 and {hi}."
        )
    clean = {"min": 0, "max": hi, "start": start, "step": step, "jumps": jumps,
             "direction": direction}
    word = "forwards" if direction == "forward" else "backwards"
    js = "s" if jumps != 1 else ""
    prompt = _rng().choice([
        f"Start at {start} and make {jumps} jump{js} of {step} {word}. Tap where you land, then press Check.",
        f"Begin at {start}. Hop {word} {jumps} time{js}, {step} each hop. Where do you end up? Tap it, then Check.",
        f"From {start}, jump {word} in steps of {step} — {jumps} jump{js}. Tap the number you land on, then Check.",
    ])
    return clean, {"end": end}, prompt, "Jump along the number line"


def _mark_number_line(solution: Any, answer: Any) -> Dict[str, Any]:
    want = int((solution or {}).get("end", -10 ** 9)) if isinstance(solution, dict) else -10 ** 9
    got_raw = answer.get("landed") if isinstance(answer, dict) else answer
    got = _as_int(got_raw)
    if got is None:
        return _verdict(False, 0, "Tap a number on the line to show where you land, then Check.")
    if got == want:
        return _verdict(True, 10, f"Bang on — you land on {want}!")
    return _verdict(False, 0, "Not quite — count each jump one at a time along the line, and "
                    "check you're going the right way.")


# ── 19. equation_balance — solve ax + b = c on a balance ─────────────────────────
# Advanced maths for KS3-KS5: the beam tips in real time as x changes, so the algebra is felt
# rather than just written.

def _build_equation_balance(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    a = _require_int(p, ("a", "coefficient"), 1, 12, "The number multiplying x in ax + b = c.")
    b = _require_int(p, ("b", "constant"), -50, 50, "The constant added on the left of ax + b = c.")
    c = _require_int(p, ("c", "result"), -100, 200, "The value on the right of ax + b = c.")
    if (c - b) % a != 0:
        raise ParamError(
            f"{a}x + {b} = {c} doesn't have a whole-number solution (x = {c - b}/{a}). Choose a, b "
            "and c so that (c − b) is divisible by a."
        )
    x = (c - b) // a
    if not (-20 <= x <= 20):
        raise ParamError(f"That gives x = {x}, which is off the slider. Keep x between -20 and 20.")
    sign = "+" if b >= 0 else "−"
    eq = f"{a}x {sign} {abs(b)} = {c}" if b else f"{a}x = {c}"
    clean = {"a": a, "b": b, "c": c, "equation": eq, "min": -20, "max": 20}
    prompt = _rng().choice([
        f"Slide x until the scales balance and {eq} is true. What is x?",
        f"Find the value of x that balances the beam: {eq}. Slide x, then press Check.",
        f"Solve {eq} — move the x slider until both pans sit level, then press Check.",
    ])
    return clean, {"x": x}, prompt, "Balance the equation"


def _mark_equation_balance(solution: Any, answer: Any) -> Dict[str, Any]:
    want = (solution or {}).get("x") if isinstance(solution, dict) else None
    got_raw = answer.get("x") if isinstance(answer, dict) else answer
    got = _as_int(got_raw)
    if got is None or want is None:
        return _verdict(False, 0, "Slide x to a value, then press Check.")
    if got == int(want):
        return _verdict(True, 10, f"Balanced — x = {want}. That's exactly it!")
    return _verdict(False, 0, "Not balanced yet — take the constant off BOTH sides first, then "
                    "divide both sides by the number in front of x.")


# ── 20. algebra_tiles — build/factorise x² + bx + c with an area model ───────────

def _build_algebra_tiles(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    b = _require_int(p, ("b", "x_coefficient"), 2, 20, "The coefficient of x in x² + bx + c.")
    c = _require_int(p, ("c", "constant"), 1, 100, "The constant in x² + bx + c.")
    # Needs positive integer roots so the area model is actually buildable with tiles.
    pair = next((( i, b - i) for i in range(1, b) if i * (b - i) == c), None)
    if not pair:
        raise ParamError(
            f"x² + {b}x + {c} doesn't factorise into two positive whole numbers, so it can't be "
            "built as a tile rectangle. Choose b and c with c = p×q and b = p+q (e.g. b=5, c=6)."
        )
    q, r = sorted(pair)
    clean = {"b": b, "c": c, "expression": f"x² + {b}x + {c}", "max_side": max(q, r) + 3}
    prompt = _rng().choice([
        f"Build x² + {b}x + {c} as a rectangle. Set the two side lengths (x + ?) and (x + ?) so the tiles match, then press Check.",
        f"Factorise x² + {b}x + {c} with the tiles — set both side lengths until the area model matches, then Check.",
        f"Make a rectangle whose area is x² + {b}x + {c}. Adjust each side, then press Check.",
    ])
    return clean, {"p": q, "q": r}, prompt, "Factorise with tiles"


def _mark_algebra_tiles(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    want = sorted([int(sol.get("p", -1)), int(sol.get("q", -1))])
    got = answer if isinstance(answer, dict) else {}
    gp, gq = _as_int(got.get("p")), _as_int(got.get("q"))
    if gp is None or gq is None:
        return _verdict(False, 0, "Set both side lengths, then press Check.")
    if sorted([gp, gq]) == want:
        return _verdict(True, 10,
                        f"Perfect — it factorises to (x + {want[0]})(x + {want[1]}).")
    return _verdict(False, 0, "Not quite — you need two numbers that MULTIPLY to give the "
                    "constant and ADD to give the x coefficient.")


# ── 21. balance_equation — balance a chemical equation ──────────────────────────
# The one place linear algebra genuinely earns its keep here. Rather than keeping a bank of
# pre-balanced equations (which would only ever cover what we thought of), we parse each
# formula into its element counts, build the composition matrix, and take its NULL SPACE with
# sympy's exact rationals — that IS the balanced set of coefficients. So the AI can pass any
# sensible equation and the server still derives the answer itself; the model never supplies
# one, and a chemically impossible equation is rejected rather than silently "balanced".

def _parse_formula(formula: str) -> Dict[str, int]:
    """"Ca(OH)2" → {"Ca": 1, "O": 2, "H": 2}. Handles nested brackets and element subscripts."""
    s = (formula or "").strip().replace(" ", "")
    if not s:
        raise ParamError("Empty formula in the equation.")
    stack: List[Dict[str, int]] = [{}]
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "(":
            stack.append({})
            i += 1
        elif ch == ")":
            i += 1
            num = ""
            while i < len(s) and s[i].isdigit():
                num += s[i]
                i += 1
            mult = int(num) if num else 1
            if len(stack) < 2:
                raise ParamError(f"Unbalanced brackets in {formula!r}.")
            top = stack.pop()
            for k, v in top.items():
                stack[-1][k] = stack[-1].get(k, 0) + v * mult
        elif ch.isupper():
            sym = ch
            i += 1
            if i < len(s) and s[i].islower():
                sym += s[i]
                i += 1
            num = ""
            while i < len(s) and s[i].isdigit():
                num += s[i]
                i += 1
            stack[-1][sym] = stack[-1].get(sym, 0) + (int(num) if num else 1)
        else:
            raise ParamError(
                f"Couldn't read {formula!r} — unexpected {ch!r}. Write formulae like 'H2', 'O2', "
                "'H2O', 'Ca(OH)2' (element symbols with subscripts, no coefficients)."
            )
    if len(stack) != 1:
        raise ParamError(f"Unbalanced brackets in {formula!r}.")
    return stack[0]


def _split_equation(eq: str) -> Tuple[List[str], List[str]]:
    s = (eq or "").strip()
    parts = re.split(r"->|→|=>|=", s)
    if len(parts) != 2:
        raise ParamError(
            "Write the equation with ONE arrow, e.g. {\"equation\": \"H2 + O2 -> H2O\"}."
        )
    def side(t: str) -> List[str]:
        out = [x.strip() for x in t.split("+") if x.strip()]
        # strip any coefficient the model wrote — the student supplies those.
        return [re.sub(r"^\d+\s*", "", x) for x in out]
    lhs, rhs = side(parts[0]), side(parts[1])
    if not lhs or not rhs:
        raise ParamError("Both sides of the equation need at least one substance.")
    if len(lhs) + len(rhs) > 6:
        raise ParamError("Keep the equation to at most 6 substances in total.")
    return lhs, rhs


def _solve_balance(lhs: List[str], rhs: List[str]) -> List[int]:
    """The balanced coefficients, derived (not supplied). Null space of the composition matrix,
    scaled to the smallest positive whole numbers."""
    from sympy import Matrix, ilcm
    species = lhs + rhs
    comps = [_parse_formula(f) for f in species]
    elements = sorted({e for c in comps for e in c})
    rows = []
    for e in elements:
        rows.append([(c.get(e, 0) if i < len(lhs) else -c.get(e, 0))
                     for i, c in enumerate(comps)])
    ns = Matrix(rows).nullspace()
    if len(ns) != 1:
        raise ParamError(
            "That equation can't be balanced uniquely — check the formulae are right and that "
            "every element appears on both sides."
        )
    vec = ns[0]
    denom = 1
    for t in vec:
        denom = ilcm(denom, t.q)
    ints = [int(t * denom) for t in vec]
    if any(n < 0 for n in ints) and all(n <= 0 for n in ints):
        ints = [-n for n in ints]
    g = 0
    for n in ints:
        g = gcd(g, abs(n))
    if g == 0:
        raise ParamError("That equation can't be balanced.")
    ints = [n // g for n in ints]
    if any(n <= 0 for n in ints):
        raise ParamError(
            "That equation can't be balanced with positive whole numbers — check the formulae."
        )
    return ints


def _build_balance_equation(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    eq = str(p.get("equation") or p.get("reaction") or "").strip()
    if not eq:
        raise ParamError(
            "Missing 'equation'. Pass the UNBALANCED equation for this lesson, e.g. "
            "{\"equation\": \"H2 + O2 -> H2O\"} or {\"equation\": \"CH4 + O2 -> CO2 + H2O\"}. "
            "Write formulae only — no coefficients; the student supplies those."
        )
    lhs, rhs = _split_equation(eq)
    coeffs = _solve_balance(lhs, rhs)          # derived server-side, never from the model
    if all(c == 1 for c in coeffs):
        raise ParamError(
            f"{eq} is already balanced with all 1s, so there's nothing for the student to do. "
            "Pick an equation that actually needs balancing (e.g. 'H2 + O2 -> H2O')."
        )
    atoms = {f: _parse_formula(f) for f in lhs + rhs}
    clean = {
        "lhs": lhs, "rhs": rhs,
        "atoms": {f: atoms[f] for f in lhs + rhs},
        "elements": sorted({e for c in atoms.values() for e in c}),
        "max_coeff": max(max(coeffs) + 3, 6),
    }
    prompt = _rng().choice([
        "Balance the equation — set the numbers in front of each substance so every element has "
        "the same count on both sides, then press Check.",
        "Add the coefficients that balance this equation. Watch the atom tally on each side, "
        "then press Check.",
        "Make both sides have equal numbers of every atom. Set each coefficient, then Check.",
    ])
    return clean, {"coefficients": coeffs, "lhs_len": len(lhs)}, prompt, "Balance the equation"


def _mark_balance_equation(solution: Any, answer: Any) -> Dict[str, Any]:
    """Marked by CHECKING THE CHEMISTRY, not by string-matching our own answer: any coefficients
    that genuinely balance every element (and are in simplest form) are correct."""
    sol = solution if isinstance(solution, dict) else {}
    want = list(sol.get("coefficients") or [])
    got_raw = answer.get("coefficients") if isinstance(answer, dict) else answer
    got = [_as_int(x) for x in got_raw] if isinstance(got_raw, (list, tuple)) else []
    if not want or len(got) != len(want) or any(g is None for g in got):
        return _verdict(False, 0, "Set a number in front of every substance, then press Check.")
    if any(g <= 0 for g in got):
        return _verdict(False, 0, "Every coefficient has to be at least 1 — have another go.")
    if got == want:
        return _verdict(True, 10, "Perfectly balanced — every element matches on both sides!")
    # A correct-but-scaled answer (2,2,4 instead of 1,1,2) balances but isn't simplest.
    g = 0
    for n in got:
        g = gcd(g, n)
    if g > 1 and [n // g for n in got] == want:
        return _verdict(True, 8, "That does balance! It's a multiple of the simplest answer though "
                        "— divide them all through and you'd have it exactly.")
    return _verdict(False, 0, "Not balanced yet — count each element on BOTH sides and compare. "
                    "Change one coefficient at a time and watch the tally.")


# ── 22. coordinate_plot — plot a point on a grid ────────────────────────────────

def _build_coordinate_plot(p: dict, key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    ks = _norm_ks(key_stage)
    four_quadrant = ks in ("KS3", "KS4", "KS5") or bool(p.get("four_quadrant"))
    lo, hi = (-6, 6) if four_quadrant else (0, 10)
    x = _require_int(p, ("x",), lo, hi, f"The x coordinate ({lo} to {hi}).")
    y = _require_int(p, ("y",), lo, hi, f"The y coordinate ({lo} to {hi}).")
    clean = {"min": lo, "max": hi, "four_quadrant": four_quadrant}
    prompt = _rng().choice([
        f"Plot the point ({x}, {y}) on the grid. Tap the right spot, then press Check.",
        f"Where is ({x}, {y})? Tap that point on the grid, then press Check.",
        f"Find ({x}, {y}) — remember along first, then up. Tap it, then press Check.",
    ])
    return clean, {"x": x, "y": y}, prompt, "Plot the point"


def _mark_coordinate_plot(solution: Any, answer: Any) -> Dict[str, Any]:
    sol = solution if isinstance(solution, dict) else {}
    got = answer if isinstance(answer, dict) else {}
    wx, wy = int(sol.get("x", 10 ** 9)), int(sol.get("y", 10 ** 9))
    gx, gy = _as_int(got.get("x")), _as_int(got.get("y"))
    if gx is None or gy is None:
        return _verdict(False, 0, "Tap a point on the grid, then press Check.")
    if (gx, gy) == (wx, wy):
        return _verdict(True, 10, f"Exactly — ({wx}, {wy}) is spot on!")
    if (gx, gy) == (wy, wx):
        return _verdict(False, 4, "So close — you've swapped them. Remember: along the corridor "
                        "(x) FIRST, then up the stairs (y).")
    return _verdict(False, 0, "Not quite — count along the x axis first, then up the y axis.")


# ── Registry ─────────────────────────────────────────────────────────────────────

BuildFn = Callable[[dict, Optional[str]], Tuple[dict, Any, str, str]]
MarkFn = Callable[[Any, Any], Dict[str, Any]]

MANIPULATIVES: Dict[str, Dict[str, Any]] = {
    "place_value_counters": {
        "key_stages": ["KS1", "KS2", "KS3"],
        "build": _build_place_value, "mark": _mark_place_value,
    },
    "column_addition": {
        "key_stages": ["KS2", "KS3", "KS4"],
        "build": _build_column_addition, "mark": _mark_column_addition,
    },
    "number_grid_sums": {
        "key_stages": ["KS2", "KS3", "KS4"],
        "build": _build_number_grid, "mark": _mark_number_grid,
    },
    "times_table_dash": {
        "key_stages": ["KS1", "KS2", "KS3"],
        "build": _build_times_table, "mark": _mark_times_table,
    },
    "fraction_canvas": {
        "key_stages": ["KS1", "KS2", "KS3"],
        "build": _build_fraction_canvas, "mark": _mark_fraction_canvas,
    },
    "dot_array": {
        "key_stages": ["KS1", "KS2", "KS3"],
        "build": _build_dot_array, "mark": _mark_dot_array,
    },
    "counting_bubbles": {
        "key_stages": ["KS1", "KS2"],
        "build": _build_counting, "mark": _mark_counting,
    },
    "compare_numbers": {
        "key_stages": ["KS1", "KS2", "KS3"],
        "build": _build_compare_numbers, "mark": _mark_compare_numbers,
    },
    "order_numbers": {
        "key_stages": ["KS1", "KS2", "KS3"],
        "build": _build_order_numbers, "mark": _mark_order_numbers,
    },

    # ── Maths — foundational gaps ────────────────────────────────────────────────
    "clock_hands": {
        "key_stages": ["KS1", "KS2"], "subjects": ["maths"],
        "build": _build_clock_hands, "mark": _mark_clock_hands,
    },
    "money_coins": {
        "key_stages": ["KS1", "KS2"], "subjects": ["maths"],
        "build": _build_money_coins, "mark": _mark_money_coins,
    },
    "number_line_jump": {
        "key_stages": ["KS1", "KS2", "KS3"], "subjects": ["maths"],
        "build": _build_number_line, "mark": _mark_number_line,
    },
    "coordinate_plot": {
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["maths"],
        "build": _build_coordinate_plot, "mark": _mark_coordinate_plot,
    },

    # ── Maths — advanced (KS3-KS5 get hands-on at THEIR level: never counters) ────
    "equation_balance": {
        "key_stages": ["KS3", "KS4", "KS5"], "subjects": ["maths"],
        "build": _build_equation_balance, "mark": _mark_equation_balance,
    },
    "algebra_tiles": {
        "key_stages": ["KS3", "KS4", "KS5"], "subjects": ["maths"],
        "build": _build_algebra_tiles, "mark": _mark_algebra_tiles,
    },

    # ── Science — universal shapes, server-owned content banks ───────────────────
    "sorting_bins": {
        "key_stages": ["KS1", "KS2", "KS3", "KS4", "KS5"],
        "subjects": ["science", "biology", "chemistry", "physics"],
        "build": _build_sorting_bins, "mark": _mark_sorting_bins,
    },
    "sequence_order": {
        "key_stages": ["KS1", "KS2", "KS3", "KS4", "KS5"],
        "subjects": ["science", "biology", "chemistry", "physics"],
        "build": _build_sequence_order, "mark": _mark_sequence_order,
    },

    # ── Chemistry ────────────────────────────────────────────────────────────────
    "atom_builder": {
        "key_stages": ["KS3", "KS4", "KS5"], "subjects": ["science", "chemistry"],
        "build": _build_atom_builder, "mark": _mark_atom_builder,
    },
    "balance_equation": {
        "key_stages": ["KS3", "KS4", "KS5"], "subjects": ["science", "chemistry"],
        "build": _build_balance_equation, "mark": _mark_balance_equation,
    },
    "ph_scale": {
        "key_stages": ["KS2", "KS3", "KS4"], "subjects": ["science", "chemistry"],
        "build": _build_ph_scale, "mark": _mark_ph_scale,
    },

    # ── Physics ──────────────────────────────────────────────────────────────────
    "force_arrows": {
        "key_stages": ["KS3", "KS4", "KS5"], "subjects": ["science", "physics"],
        "build": _build_force_arrows, "mark": _mark_force_arrows,
    },

    # ── Biology ──────────────────────────────────────────────────────────────────
    "punnett_square": {
        "key_stages": ["KS4", "KS5"], "subjects": ["science", "biology"],
        "build": _build_punnett, "mark": _mark_punnett,
    },
}

# Every maths activity that predates the science expansion is maths-only. Tagging them here
# (rather than editing each entry) keeps the diff honest: an untagged entry would be offered to
# a Chemistry lesson, and "3 tens and 4 ones" in a Chemistry lesson is exactly the mismatch the
# subject gate exists to stop.
for _k in ("place_value_counters", "column_addition", "number_grid_sums", "times_table_dash",
           "fraction_canvas", "dot_array", "counting_bubbles", "compare_numbers",
           "order_numbers"):
    MANIPULATIVES[_k].setdefault("subjects", ["maths"])

KINDS = list(MANIPULATIVES)


def _norm_ks(key_stage: Optional[str]) -> str:
    return (key_stage or "").upper().replace(" ", "")


# Lesson subjects come from the Resource Hub in many spellings ("Maths", "Mathematics",
# "Combined Science", "GCSE Biology"). Normalise to the handful of families the registry tags
# against, so a Chemistry lesson can never be handed a times-table activity and a Maths lesson
# can never be handed a Punnett square. Most specific first — "GCSE Combined Science: Biology"
# should read as biology, not science.
_SUBJECT_MATCHES: Tuple[Tuple[str, str], ...] = (
    ("biolog", "biology"), ("chemist", "chemistry"), ("physic", "physics"),
    ("mathematic", "maths"), ("maths", "maths"), ("math", "maths"), ("numeracy", "maths"),
    ("science", "science"),
)


def _norm_subject(subject: Optional[str]) -> str:
    s = (subject or "").strip().lower()
    if not s:
        return ""
    for needle, fam in _SUBJECT_MATCHES:
        if needle in s:
            return fam
    return s


def build_spec(kind: str, params: Optional[dict],
               key_stage: Optional[str] = None) -> Tuple[dict, Any, str, str]:
    """Validate the AI's params, then derive the prompt AND the solution from those same
    values. Returns (clean_params, solution, prompt, title); solution is None if the kind is
    unknown. Raises ParamError when the params can't make a sound activity — the caller feeds
    the message back to the model rather than inventing a default.

    `key_stage` is a ceiling, not a suggestion: it's what stops a Year 1 "within 10" lesson
    ever rendering a four-digit number.
    """
    entry = MANIPULATIVES.get((kind or "").strip().lower())
    if not entry:
        return {}, None, "", ""
    clean, solution, prompt, title = entry["build"](params or {}, key_stage)
    return clean, solution, prompt, title


def mark(kind: str, solution: Any, answer: Any) -> Dict[str, Any]:
    """Mark deterministically. No model call — the answer was computed from the same params
    that drew the picture, so an exact comparison is both correct and instant."""
    entry = MANIPULATIVES.get((kind or "").strip().lower())
    if not entry:
        return _verdict(False, 0, "I couldn't mark that one — let's talk it through together.")
    try:
        return entry["mark"](solution, answer)
    except Exception as e:  # noqa: BLE001 — marking must never break the tutor's reply
        logger.warning("manipulative mark failed kind=%s: %s: %s", kind, type(e).__name__, e)
        return _verdict(False, 0, "I couldn't quite mark that — let's talk it through together.")


def allowed_kinds(key_stage: Optional[str], subject: Optional[str] = None) -> List[str]:
    """The activities that suit this key stage AND this subject.

    Subject gating is what lets the registry hold maths AND science activities at once: an
    atom builder is right for KS4 Chemistry and absurd for KS4 Maths. A blank/unknown subject
    doesn't filter (older callers keep working).
    """
    ks = _norm_ks(key_stage)
    subj = _norm_subject(subject)
    out: List[str] = []
    for k, e in MANIPULATIVES.items():
        if ks not in e["key_stages"]:
            continue
        subjects = e.get("subjects")
        if subj and subjects and subj not in subjects:
            continue
        out.append(k)
    return out


def manipulatives_enabled(key_stage: Optional[str], subject: Optional[str] = None) -> bool:
    """Are there ANY hands-on activities for this key stage + subject?

    This used to be a flat "KS5 gets none — an A-Level student does not want counters". That was
    right about counters and wrong about everything else: an A-Level student should still be
    doing hands-on work, just at their own level — a Punnett square, an atom builder, algebra
    tiles, a probability tree. The honest test is whether the registry HAS something suitable,
    and LEVEL is enforced per entry: counting_bubbles/fraction_canvas are tagged KS1-KS3 so an
    older student can never be handed them, while algebra_tiles/probability_tree are tagged
    KS3-KS5 so a young one can never be handed those.
    POLICY (curriculum team): KS4 and KS5 get NO manipulatives — they use the mature puzzle types
    (math / graph / diagram / labelling / matching). KS1-KS2 get plenty; KS3 gets very few (see
    _manip_lean — lowest in Years 8-9). Level is still enforced per registry entry on top of this.
    """
    if _norm_ks(key_stage) in ("KS4", "KS5"):
        return False
    return bool(allowed_kinds(key_stage, subject))


def next_puzzle_style(key_stage: Optional[str], mix: Optional[dict]) -> str:
    """Which style the NEXT puzzle should be: "manipulative" | "classic".

    A running quota, not a dice roll. Asking "would showing a manipulative now keep us at or
    under the target share?" converges on the real ratio (KS3 → 60/40), whereas rolling a
    0.6 die each time only gets there in expectation and can hand a KS3 student five
    counter puzzles in a row.
    """
    target = target_mix(key_stage)
    if target <= 0.0:
        return "classic"
    if target >= 1.0:
        return "manipulative"
    m = dict(mix or {})
    manip = int(m.get("manipulative", 0) or 0)
    classic = int(m.get("classic", 0) or 0)
    return "manipulative" if manip / (manip + classic + 1) < target else "classic"


# How strongly each stage leans toward hands-on manipulatives WITHIN the mix (only applies to
# topics that HAVE a matching manipulative). Per the curriculum team: heavy for the youngest,
# tapering to almost nothing by upper KS3, and none at all at KS4/KS5 (they're unbound there).
_MAX_RUN = 3   # never more than this many of the SAME style in a row → the order stays varied


def _year_num(year_group: Optional[str]) -> Optional[int]:
    """'Year 7' / 'Y7' / '7' → 7."""
    if not year_group:
        return None
    m = re.search(r"(\d{1,2})", str(year_group))
    return int(m.group(1)) if m else None


def _manip_lean(key_stage: Optional[str], year_group: Optional[str] = None) -> float:
    """Share of puzzles that should be hands-on manipulatives, by key stage + year group.
    KS1-KS2: most. KS3: very few — Year 7 a little, Years 8-9 almost none. KS4-KS5: none."""
    ks = _norm_ks(key_stage)
    if ks == "KS1":
        return 0.80
    if ks == "KS2":
        return 0.75
    if ks == "KS3":
        y = _year_num(year_group)
        if y == 7:
            return 0.25            # Year 7 — a little hands-on
        if y in (8, 9):
            return 0.06            # Years 8-9 — almost none
        return 0.12                # KS3, year unknown — low
    return 0.0                     # KS4 / KS5 — none (also unbound in manipulatives_enabled)


def next_style_mixed(key_stage: Optional[str], style_seq: Optional[List[str]],
                     has_topic_manip: bool, year_group: Optional[str] = None) -> str:
    """The NEXT puzzle style for a genuinely MIXED, non-repeating lesson.

    The rule the user asked for: when the topic HAS a matching manipulative, weave manipulatives
    and classic puzzles together in a random, varied order (e.g. 1 classic, 3 hands-on, 2 classic,
    1 hands-on…) — never a fixed alternation and never a long run of one kind. When the topic has
    NO manipulative (or the key stage gets none), always "classic" so we never force a mismatched
    hands-on activity.

    `style_seq` is the recent history of shown styles ("manipulative"/"classic"); we cap the
    current run at _MAX_RUN and otherwise pick at random, leaning by key stage.

    `has_topic_manip` already means "a suitable activity exists for this topic/key stage/subject"
    (the caller got it from pick_topic_kind), so it is the only gate needed here.
    """
    if not has_topic_manip:
        return "classic"
    lean = _manip_lean(key_stage, year_group)
    if lean <= 0.0:
        return "classic"
    seq = [s for s in (style_seq or []) if s in ("manipulative", "classic")]

    # length of the current same-style streak
    run, last = 0, (seq[-1] if seq else None)
    for s in reversed(seq):
        if s == last:
            run += 1
        else:
            break
    other = "classic" if last == "manipulative" else "manipulative"
    if last and run >= _MAX_RUN:
        return other                         # hard switch — the run is long enough
    if last and run == _MAX_RUN - 1:
        return other if _rng().random() < 0.8 else last   # strongly bias a switch
    return "manipulative" if _rng().random() < lean else "classic"


async def _load_plan(db: AsyncSession, appointment_id: int):
    from app.models.lesson_plan import LessonPlan
    return (await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )).scalar_one_or_none()


async def get_mix(db: AsyncSession, appointment_id: int) -> dict:
    plan = await _load_plan(db, appointment_id)
    if plan is None or not plan.session_state:
        return {"manipulative": 0, "classic": 0}
    return dict(plan.session_state.get("puzzle_mix") or {"manipulative": 0, "classic": 0})


async def bump_mix(db: AsyncSession, appointment_id: int, style: str,
                   kind: Optional[str] = None) -> None:
    """Count a shown puzzle against the quota, and remember WHICH activity it was.

    Read-modify-write the whole session_state dict (the same pattern as
    puzzle_service.set_puzzle_shown) — session_state is a JSONB column, so mutating a nested
    key in place isn't seen as dirty and would silently not save. Both the mix and the history
    are written in ONE pass for the same reason: two separate read-modify-writes would clobber
    each other.
    """
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}

    mix = dict(state.get("puzzle_mix") or {"manipulative": 0, "classic": 0})
    key = "manipulative" if style == "manipulative" else "classic"
    mix[key] = int(mix.get(key, 0) or 0) + 1
    state["puzzle_mix"] = mix

    # The ORDER of styles shown, so the mixed chooser can keep runs short and the order varied.
    seq = list(state.get("style_seq") or [])
    seq.append(key)
    state["style_seq"] = seq[-12:]

    if kind:
        history = list(state.get("manip_history") or [])
        history.append(kind)
        state["manip_history"] = history[-12:]

    plan.session_state = state
    await db.flush()


async def get_history(db: AsyncSession, appointment_id: int) -> List[str]:
    plan = await _load_plan(db, appointment_id)
    if plan is None or not plan.session_state:
        return []
    return list(plan.session_state.get("manip_history") or [])


async def get_style_seq(db: AsyncSession, appointment_id: int) -> List[str]:
    """The recent sequence of shown puzzle styles ("manipulative"/"classic") for the mixed chooser."""
    plan = await _load_plan(db, appointment_id)
    if plan is None or not plan.session_state:
        return []
    return list(plan.session_state.get("style_seq") or [])


def suggest_kind(key_stage: Optional[str], history: Optional[List[str]] = None,
                 subject: Optional[str] = None) -> str:
    """Pick the NEXT hands-on activity — at random, and never the one just used.

    Left to itself the model reaches for the same activity in the same order every lesson
    (counting, then counters, then the same third thing), because a list in a docstring has an
    order and an LLM has a bias. So the SERVER chooses and the anchor tells it what to use.

    Not a pure coin flip: activities used least this lesson are preferred, and the most recent
    one is excluded outright, so a short lesson still gets genuine variety rather than random
    repetition.
    """
    allowed = allowed_kinds(key_stage, subject)
    if not allowed:
        return ""
    hist = list(history or [])
    recent = hist[-1] if hist else None

    pool = [k for k in allowed if k != recent] or allowed
    fewest = min(hist.count(k) for k in pool)
    least_used = [k for k in pool if hist.count(k) == fewest]
    return _rng().choice(least_used)


# ── Topic matching — use a manipulative ONLY when it fits the lesson topic ──────────
# A manipulative that doesn't match the topic is worse than a normal puzzle (a fractions
# lesson should never show counting bubbles). These keywords decide which manipulative(s)
# genuinely fit a topic; if none fit, the caller steers the AI to other puzzle types.
_TOPIC_KEYWORDS: Dict[str, List[str]] = {
    "fraction_canvas": ["fraction", "half", "halves", "quarter", "third", "numerator",
                        "denominator", "equal part", "parts of a", "parts of the"],
    "place_value_counters": ["place value", "tens and ones", "tens & ones", "ones and tens",
                             "expanded form", "partition", "digit value", "hundreds and tens",
                             "hundreds, tens", "regroup"],
    "compare_numbers": ["compare", "comparing", "greater than", "less than", "bigger",
                        "smaller", "more than", "fewer than", "greater or less"],
    "order_numbers": ["order", "ordering", "sequenc", "smallest to", "largest to", "biggest to",
                      "ascending", "descending", "put in order"],
    "times_table_dash": ["times table", "times-table", "multiplication table", "multiply",
                         "multiplication fact", "x table"],
    "dot_array": ["array", "square number", "rows of", "repeated addition", "grouping",
                  "multiplication and", "multiplication &", "multiplication/"],
    "column_addition": ["column addition", "column method", "adding", "addition", "carrying",
                        "add ", "sum of", "adding numbers"],
    "number_grid_sums": ["number bond", "missing number", "magic square", "mental maths",
                         "number grid"],
    "counting_bubbles": ["counting", "count to", "count the", "count in", "how many",
                         "one more", "one less"],

    # ── Maths — foundational gaps ────────────────────────────────────────────────
    "clock_hands": ["time", "clock", "o'clock", "oclock", "hour", "minute", "half past",
                    "quarter past", "quarter to", "telling the time"],
    "money_coins": ["money", "coin", "pence", "pounds", "change", "buying", "shopping",
                    "price", "cost"],
    "number_line_jump": ["number line", "counting on", "counting back", "jumps of",
                         "skip count", "adding", "subtracting", "subtraction"],
    "coordinate_plot": ["coordinate", "co-ordinate", "grid reference", "plot", "axes",
                        "quadrant", "x axis", "y axis"],

    # ── Maths — advanced ─────────────────────────────────────────────────────────
    "equation_balance": ["equation", "solve for", "solving equations", "linear equation",
                         "unknown", "inverse operation", "balance"],
    "algebra_tiles": ["factoris", "factoriz", "quadratic", "expand", "brackets",
                      "algebraic expression", "area model"],

    # ── Science — universal ──────────────────────────────────────────────────────
    "sorting_bins": ["sort", "sorting", "classify", "classification", "group", "grouping",
                     "living", "non-living", "material", "conductor", "insulator",
                     "magnetic", "acid", "alkali", "element", "compound", "mixture",
                     "vertebrate", "invertebrate", "renewable", "herbivore", "carnivore",
                     "omnivore", "metal", "solid", "liquid", "gas", "states of matter",
                     "prokaryot", "eukaryot", "cell"],
    "sequence_order": ["order", "sequence", "life cycle", "lifecycle", "stages", "food chain",
                       "water cycle", "digestion", "digestive", "circulation", "mitosis",
                       "rock cycle", "planets", "solar system", "scientific method",
                       "process", "steps"],

    # ── Chemistry ────────────────────────────────────────────────────────────────
    "atom_builder": ["atom", "atomic structure", "proton", "neutron", "electron", "isotope",
                     "ion", "atomic number", "mass number", "shell", "subatomic"],
    "balance_equation": ["balancing", "balanced equation", "chemical equation", "reaction",
                         "conservation of mass", "reactants", "products", "symbol equation"],
    "ph_scale": ["ph", "acid", "alkali", "alkaline", "neutral", "indicator", "litmus",
                 "acids and bases", "base"],

    # ── Physics ──────────────────────────────────────────────────────────────────
    "force_arrows": ["force", "resultant", "balanced forces", "unbalanced", "newton",
                     "push", "pull", "friction", "motion"],

    # ── Biology ──────────────────────────────────────────────────────────────────
    "punnett_square": ["genetic", "inheritance", "punnett", "allele", "genotype", "phenotype",
                       "dominant", "recessive", "heredity", "cross", "offspring"],
}


def topic_manipulatives(topic: Optional[str], key_stage: Optional[str],
                        subject: Optional[str] = None) -> List[str]:
    """The manipulative kind(s) whose subject genuinely matches this lesson topic, restricted
    to those allowed at the key stage AND subject. Empty when NO manipulative fits — the caller
    then uses a different puzzle type instead of forcing a mismatched manipulative."""
    t = (topic or "").lower()
    if not t:
        return []
    allowed = set(allowed_kinds(key_stage, subject))
    return [k for k, kws in _TOPIC_KEYWORDS.items()
            if k in allowed and any(kw in t for kw in kws)]


def pick_topic_kind(topic: Optional[str], key_stage: Optional[str],
                    history: Optional[List[str]] = None,
                    subject: Optional[str] = None) -> str:
    """The manipulative to use for THIS topic: the topic-matching kind, and when several match
    (e.g. multiplication → times_table_dash + dot_array) the least-used / not-just-used one for
    variety. Returns "" when NO manipulative matches the topic (→ use another puzzle type)."""
    matches = topic_manipulatives(topic, key_stage, subject)
    if not matches:
        return ""
    if len(matches) == 1:
        return matches[0]
    hist = list(history or [])
    recent = hist[-1] if hist else None
    pool = [k for k in matches if k != recent] or matches
    fewest = min(hist.count(k) for k in pool)
    least = [k for k in pool if hist.count(k) == fewest]
    return _rng().choice(least)


# ═══════════════════════════════════════════════════════════════════════════
# GRAPH PUZZLES (merged from the former graph_service.py)
# ═══════════════════════════════════════════════════════════════════════════
"""
graph_service.py — render maths/science graphs with matplotlib for GRAPH puzzles.

The AI supplies a small, safe spec (kind + data/expression + axis info); we draw a clean
PNG to the served media dir and return its URL. Used for KS4/KS5 (and any graph/trig
topic): reading coordinates, straight-line graphs, quadratics, sine/cos, bar/scatter.

`function` specs evaluate a whitelisted maths expression over a range with numpy — no
`eval` of arbitrary Python; only a fixed set of names (sin, cos, x, etc.) is exposed.
"""
import asyncio
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import matplotlib
matplotlib.use("Agg")  # headless — no display, thread-safe rendering
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.patches as mpatches  # noqa: E402
from matplotlib.ticker import MultipleLocator  # noqa: E402

from app.core.config import settings
from app.services.image_gen_service import media_url

logger = logging.getLogger(__name__)

# Whitelisted names available to a `function` expression (numpy-backed, safe).
_SAFE_NS = {
    "sin": np.sin, "cos": np.cos, "tan": np.tan, "sqrt": np.sqrt, "exp": np.exp,
    "log": np.log, "abs": np.abs, "pi": np.pi, "e": np.e,
}


def _media_dir() -> Path:
    d = Path(settings.puzzle_media_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


# Distinct, colour-blind-safe line colours. A two-line graph is useless if the student can't
# tell the lines apart.
_LINE_COLOURS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed"]


def _normalise_functions(spec: Dict[str, Any]) -> list[Dict[str, Any]]:
    """Every way the model might express "plot these curves" → one list of {expr, label}.

    `kind="function"` originally accepted only a SINGLE `expr`, which made a whole class of
    question — "where do these two lines intersect?" — impossible to draw correctly: the model
    would ask about two lines and the renderer would plot one. So we now accept a list, and
    keep the old single `expr` working.
    """
    raw = spec.get("functions") or spec.get("exprs") or spec.get("expr")
    if raw is None:
        raw = "x"
    if isinstance(raw, (str, dict)):
        raw = [raw]

    out: list[Dict[str, Any]] = []
    for item in raw:
        if isinstance(item, str):
            out.append({"expr": item, "label": item})
        elif isinstance(item, dict) and item.get("expr"):
            out.append({"expr": str(item["expr"]), "label": str(item.get("label") or item["expr"])})
    return out


def curve_count(spec: Dict[str, Any]) -> int:
    """How many curves/series this spec will actually draw. The tool layer uses this to refuse
    a question that talks about two lines when only one would appear on screen."""
    spec = spec or {}
    kind = str(spec.get("kind", "line")).lower()
    if kind == "function":
        return len(_normalise_functions(spec))
    if kind == "line":
        series = spec.get("series")
        if series:
            return len(series)
        return 1 if spec.get("points") else 0
    return 1 if (spec.get("values") or spec.get("points")) else 0


def _tidy_axes(ax, spec: Dict[str, Any]) -> None:
    """Readable gridlines. A coordinate-reading question is unanswerable if the student can't
    count squares — so on a small range we force ticks every 1 unit."""
    for axis, lo_key, hi_key in ((ax.xaxis, "xmin", "xmax"), (ax.yaxis, "ymin", "ymax")):
        lo, hi = (spec.get(lo_key), spec.get(hi_key))
        try:
            span = abs(float(hi) - float(lo)) if lo is not None and hi is not None else None
        except (TypeError, ValueError):
            span = None
        if span and span <= 12:
            axis.set_major_locator(MultipleLocator(1))


def _draw(spec: Dict[str, Any]) -> str:
    kind = str(spec.get("kind", "line")).lower()
    title = str(spec.get("title", "") or "")
    xlabel = str(spec.get("xlabel", "x") or "x")
    ylabel = str(spec.get("ylabel", "y") or "y")

    fig, ax = plt.subplots(figsize=(5.2, 4.0), dpi=130)
    try:
        if kind == "function":
            funcs = _normalise_functions(spec)
            xmin = float(spec.get("xmin", -10))
            xmax = float(spec.get("xmax", 10))
            x = np.linspace(xmin, xmax, 400)
            for i, f in enumerate(funcs):
                # A failed expression must NOT silently vanish — a graph that's missing a line
                # the question asks about is worse than no graph at all, because the student
                # is then asked something unanswerable. Let it raise; the tool reports it.
                y = eval(f["expr"], {"__builtins__": {}}, {**_SAFE_NS, "x": x})  # noqa: S307 — whitelisted ns only
                y = np.broadcast_to(np.asarray(y, dtype=float), x.shape)  # constants, e.g. "3"
                ax.plot(x, y, linewidth=2, color=_LINE_COLOURS[i % len(_LINE_COLOURS)],
                        label=f["label"])
            ax.axhline(0, color="#888", linewidth=0.8)
            ax.axvline(0, color="#888", linewidth=0.8)
            if len(funcs) > 1:
                ax.legend()   # with 2+ lines the student MUST be able to tell which is which
        elif kind == "bar":
            labels = [str(l) for l in (spec.get("labels") or [])]
            values = [float(v) for v in (spec.get("values") or [])]
            ax.bar(labels, values, color="#7c3aed")
        elif kind == "scatter":
            pts = spec.get("points") or []
            xs = [float(p[0]) for p in pts]
            ys = [float(p[1]) for p in pts]
            ax.scatter(xs, ys, color="#7c3aed", s=40)
        else:  # line (default) — one or more series of [x,y] points
            series = spec.get("series")
            if not series and spec.get("points"):
                series = [{"points": spec["points"]}]
            for s in (series or []):
                pts = s.get("points") or []
                xs = [float(p[0]) for p in pts]
                ys = [float(p[1]) for p in pts]
                ax.plot(xs, ys, marker="o", linewidth=2, label=s.get("label"))
            if any((s or {}).get("label") for s in (series or [])):
                ax.legend()

        ax.set_title(title)
        ax.set_xlabel(xlabel)
        ax.set_ylabel(ylabel)
        ax.grid(True, linestyle="--", alpha=0.4)
        if kind == "function":
            _tidy_axes(ax, spec)
        fig.tight_layout()

        name = f"g_{uuid.uuid4().hex[:16]}.png"
        path = _media_dir() / name
        fig.savefig(str(path))
        return name
    finally:
        plt.close(fig)


async def generate_graph(spec: Dict[str, Any]) -> Optional[str]:
    """Render `spec` to a PNG and return its served URL (or None on failure)."""
    try:
        name = await asyncio.to_thread(_draw, spec or {})
        logger.info("GRAPH rendered %s kind=%s", name, (spec or {}).get("kind"))
        return media_url(name)
    except Exception as e:  # noqa: BLE001
        logger.warning("GRAPH render failed: %s: %s", type(e).__name__, e)
        return None


# ── Deterministic maths diagrams (answer must EXACTLY match the picture) ───────────
# Generated (Nano Banana) images can't render "exactly 1 of 8 shaded" or "3 o'clock"
# reliably, so for fractions + telling the time we DRAW them precisely here and the
# answer is computed from the same params (in puzzle_service) — they can never disagree.

def _save_fig(fig, prefix: str) -> str:
    name = f"{prefix}_{uuid.uuid4().hex[:16]}.png"
    fig.savefig(str(_media_dir() / name), bbox_inches="tight")
    return name


def _draw_fraction(total: int, shaded: int) -> str:
    """A circle split into `total` equal wedges, the first `shaded` filled."""
    fig, ax = plt.subplots(figsize=(4.0, 4.0), dpi=130)
    try:
        for i in range(total):
            t2 = 90 - i * 360.0 / total
            t1 = 90 - (i + 1) * 360.0 / total
            ax.add_patch(mpatches.Wedge(
                (0, 0), 1.0, t1, t2,
                facecolor=("#7c3aed" if i < shaded else "white"),
                edgecolor="#334155", linewidth=2.2,
            ))
        ax.set_xlim(-1.15, 1.15)
        ax.set_ylim(-1.15, 1.15)
        ax.set_aspect("equal")
        ax.axis("off")
        return _save_fig(fig, "fr")
    finally:
        plt.close(fig)


def _draw_clock(hour: int, minute: int) -> str:
    """An analogue clock face with hour + minute hands at exactly hour:minute."""
    fig, ax = plt.subplots(figsize=(4.0, 4.0), dpi=130)
    try:
        ax.add_patch(mpatches.Circle((0, 0), 1.0, fill=False, linewidth=2.4, edgecolor="#334155"))
        for h in range(1, 13):
            ang = np.deg2rad(90 - h * 30)
            ax.text(0.82 * np.cos(ang), 0.82 * np.sin(ang), str(h),
                    ha="center", va="center", fontsize=14, fontweight="bold", color="#334155")
        m_ang = np.deg2rad(90 - minute * 6)
        h_ang = np.deg2rad(90 - ((hour % 12) + minute / 60.0) * 30)
        ax.plot([0, 0.48 * np.cos(h_ang)], [0, 0.48 * np.sin(h_ang)], linewidth=5, color="#334155",
                solid_capstyle="round")          # hour hand
        ax.plot([0, 0.78 * np.cos(m_ang)], [0, 0.78 * np.sin(m_ang)], linewidth=3, color="#7c3aed",
                solid_capstyle="round")          # minute hand
        ax.plot(0, 0, marker="o", markersize=7, color="#334155")
        ax.set_xlim(-1.15, 1.15)
        ax.set_ylim(-1.15, 1.15)
        ax.set_aspect("equal")
        ax.axis("off")
        return _save_fig(fig, "cl")
    finally:
        plt.close(fig)


def _draw_ruler(length_cm: int, object_name: str = "object", start: int = 0) -> str:
    """A horizontal cm ruler (0…max) with an object bar spanning `start`→`start+length`."""
    max_cm = min(30, max(15, start + length_cm + 1))
    fig, ax = plt.subplots(figsize=(6.4, 2.4), dpi=130)
    try:
        ax.add_patch(mpatches.Rectangle((0, 0), max_cm, 1.0,
                     facecolor="#fde68a", edgecolor="#334155", linewidth=1.6))
        for cm in range(0, max_cm + 1):
            ax.plot([cm, cm], [0.6, 1.0], color="#334155", linewidth=1.3)
            ax.text(cm, 0.28, str(cm), ha="center", va="center", fontsize=9, color="#334155")
            if cm < max_cm:  # mm ticks
                for mm in range(1, 10):
                    ax.plot([cm + mm / 10.0] * 2, [0.82, 1.0], color="#334155", linewidth=0.5)
        # object above the ruler, aligned to the scale
        ax.add_patch(mpatches.FancyBboxPatch((start, 1.32), length_cm, 0.5,
                     boxstyle="round,pad=0.02", mutation_aspect=0.4,
                     facecolor="#7c3aed", edgecolor="#4c1d95", linewidth=1.6))
        ax.text(start + length_cm / 2.0, 1.57, object_name, ha="center", va="center",
                color="white", fontsize=11, fontweight="bold")
        ax.set_xlim(-0.6, max_cm + 0.6)
        ax.set_ylim(-0.1, 2.15)
        ax.axis("off")
        return _save_fig(fig, "rl")
    finally:
        plt.close(fig)


async def generate_math_diagram(concept: str, params: Dict[str, Any]) -> Optional[str]:
    """Draw a deterministic maths diagram (fraction | clock | ruler) and return its served
    URL. `params` are already validated/clamped by puzzle_service.diagram_math_spec, so the
    picture matches the computed answer exactly."""
    concept = (concept or "").strip().lower()
    p = params or {}
    try:
        if concept == "fraction":
            name = await asyncio.to_thread(_draw_fraction, int(p["total"]), int(p["shaded"]))
        elif concept == "clock":
            name = await asyncio.to_thread(_draw_clock, int(p["hour"]), int(p["minute"]))
        elif concept == "ruler":
            name = await asyncio.to_thread(
                _draw_ruler, int(p["length_cm"]), str(p.get("object", "object")), int(p.get("start", 0)))
        else:
            return None
        logger.info("MATH DIAGRAM rendered %s concept=%s params=%s", name, concept, p)
        return media_url(name)
    except Exception as e:  # noqa: BLE001
        logger.warning("MATH DIAGRAM render failed (%s): %s: %s", concept, type(e).__name__, e)
        return None


# ═══════════════════════════════════════════════════════════════════════════
# PUZZLE BUILDERS + MATH/LATEX + EVALUATION + PUZZLE STATE + VISUAL-FAMILY ROTATION
# (merged from puzzle_service.py practice half. _clampi/_load_plan are identical to the
# manipulative copies above — harmless redefinition. pick_background is duplicated below.)
# ═══════════════════════════════════════════════════════════════════════════
_LIGHT_BACKGROUNDS = ["aurora", "blueprint", "paper"]
_DARK_BACKGROUNDS = ["mesh", "bubbles"]


def pick_background(dark: bool = False) -> str:
    return random.choice(_DARK_BACKGROUNDS if dark else _LIGHT_BACKGROUNDS)


# ── Builders ─────────────────────────────────────────────────────────────────────
# Each returns a full payload INCLUDING `solution` + `puzzle_type`. The tool persists
# the whole thing, then strips `solution` before handing the client payload to the model.

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


# KaTeX commands the model commonly writes. When the tool-argument layer eats the leading backslash
# (single-backslash `\frac` arrives as bare `frac`, which KaTeX happily renders as the letters
# "frac" — so it never errors and never bounces back), we put the backslash back. Longest-first so
# `cdots` matches before `cdot`, `dfrac` before `frac`. 2-letter tokens (pi, le, to…) are omitted:
# too easy to hit inside a real word and not worth the false-positive risk.
_LATEX_CMD_WORDS = sorted((
    "dfrac", "tfrac", "frac", "binom", "sqrt", "times", "div", "cdots", "cdot", "ldots", "dots",
    "leq", "geq", "neq", "approx", "equiv", "propto", "infty", "angle", "triangle", "perp",
    "parallel", "circ", "degree", "pi", "tau", "theta", "alpha", "beta", "gamma", "delta",
    "Delta", "sigma", "Sigma", "omega", "Omega", "lambda", "mu", "phi", "rho",
    "sum", "prod", "int", "lim", "sin", "cos", "tan", "cot", "sec", "csc", "log", "ln",
    "text", "mathrm", "mathbf", "left", "right", "overline", "vec", "hat", "bar",
    "rightarrow", "Rightarrow", "leftarrow", "cup", "cap", "in", "forall", "exists",
), key=len, reverse=True)
# A command word NOT already preceded by a backslash and NOT part of a longer word.
_BARE_CMD_RE = re.compile(r"(?<![\\A-Za-z])(" + "|".join(_LATEX_CMD_WORDS) + r")(?![A-Za-z])")


def _rebackslash_commands(s: str) -> str:
    """Repair KaTeX commands whose leading backslash was stripped by the tool-arg layer
    (`frac{3}{7}` → `\\frac{3}{7}`). Idempotent: an already-backslashed `\\frac` is skipped by the
    negative look-behind, so re-running never doubles it."""
    if not s:
        return s
    return _BARE_CMD_RE.sub(lambda m: "\\" + m.group(1), s)


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
    # Decide prose-vs-maths on the RAW text. Doing it after the repairs is circular: they turn
    # "times" into "\times", which then looks like maths, so the sentence "The times table is
    # fun" would be typeset as an equation instead of being dropped.
    if not _HAS_MATH.search(t):
        return "", "prose"
    # NO server-side LaTeX repair — the AI emits valid KaTeX directly (aligned in the agent
    # prompts). A genuine parse error is caught by the frontend KaTeX validator, which bounces a
    # `latex_error` event back so the AI re-emits corrected LaTeX (validate → fix → retry). We only
    # strip the surrounding math delimiters that KaTeX's BlockMath doesn't accept.
    t = t.strip()
    for a, b in (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$")):
        if t.startswith(a) and t.endswith(b) and len(t) > len(a) + len(b):
            t = t[len(a):len(t) - len(b)].strip()
            break
    if not t:
        return "", "prose"
    # SAFETY NET: the tool-argument layer sometimes strips the leading backslash off LaTeX commands
    # (`\frac{3}{7}` arrives as `frac{3}{7}`), and control chars can leak in from escape mangling
    # (`\f`→formfeed). KaTeX renders `frac{3}{7}` as the literal letters "frac37" WITHOUT erroring,
    # so it never bounces back — the only place to fix it is here. Drop stray control chars, then
    # re-backslash bare commands. Done AFTER the prose check above so real prose isn't mathified.
    t = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", t)
    t = _rebackslash_commands(t).strip()
    if not t:
        return "", "prose"
    return t, ""


def _latexish_to_plain(s: str) -> str:
    """Turn simple LaTeX into plain reading text for places that are NOT rendered by KaTeX — the
    question line and the tappable answer bubbles. The model sometimes writes options/answers as
    "\\frac{3}{5}" or wraps the question in "\\(…\\)"; those show up as the raw string on a plain
    button. Fractions become "3/5", common operators become their symbols, math delimiters are
    dropped. (The main equation card gets the AI's raw LaTeX as-is, validated by KaTeX on the
    client — an invalid one bounces a latex_error back for the AI to fix, no server repair.)"""
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
        # `mark` is defined above (merged from the former manipulative_service).
        return mark(render, solution, student_answer)

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
VISUAL_FAMILIES = ("puzzle", "animation", "svg", "mermaid", "image")


def visual_family_for(render: Optional[str]) -> str:
    """Which family a shown visual belongs to, from its render key."""
    r = (render or "").strip().lower()
    if r == "mermaid":
        return "mermaid"
    if r == "animation":
        return "animation"
    if r == "svg_diagram":
        return "svg"
    if r == "explanatory_image":
        # A generated teaching picture is something the student LOOKS AT, not something they
        # DO — it used to fall through to "puzzle", so showing one during a teaching phase
        # spent the puzzle quota and the rotation then steered AWAY from explanatory content,
        # the exact opposite of what a teaching phase wants.
        return "image"
    return "puzzle"          # math/graph/labelling/matching/manipulatives


# The three EXPLANATORY families — things the student LOOKS AT while the tutor teaches — as
# opposed to "puzzle", which is something they DO.
EXPLANATORY_FAMILIES = ("mermaid", "svg", "animation", "image")

# What the mix should be in each phase of the lesson. A lesson that opens with puzzles makes the
# student solve before they have been taught anything; a practice phase full of diagrams never
# lets them try it themselves. So the phase — not the tutor's mood — decides the balance, and
# EVERY tool stays bound in every phase (this is priority, not a gate: a practice phase can still
# draw a diagram when one genuinely helps, it just won't lead with one).
#
# The split is DECISIVE, not a gentle 70/30 blend, for two reasons. Pedagogically the phases mean
# different things: a teaching phase is slides + the visual that explains them, a practice phase
# is the student working. Arithmetically, real plan_blocks give recap ~2 turns and review ~3 —
# a 30% target over 2 picks cannot be expressed at all (you get 0% or 50%), so a soft blend in a
# short phase is decided entirely by rounding. Near the extremes the rounding stops mattering.
VISUAL_PHASE_WEIGHTS: Dict[str, Dict[str, float]] = {
    "recap":    {"puzzle": 0.15, "explanatory": 0.85},   # remind them how it works
    "teach":    {"puzzle": 0.15, "explanatory": 0.85},   # explain first, practise second
    "practice": {"puzzle": 0.85, "explanatory": 0.15},   # now they do it
    "quiz":     {"puzzle": 0.90, "explanatory": 0.10},
    "review":   {"puzzle": 0.30, "explanatory": 0.70},   # summarise, with a little recall
}
_DEFAULT_PHASE = "teach"

# How the EXPLANATORY share is divided between the four teaching visuals. Not an even 4-way
# split: an even split gave animation only ~20% of teaching turns and animations stayed rare,
# even after the prompt was told to reach for them. Motion is what a still genuinely cannot do —
# current flowing and splitting, a shape reflecting, a graph being traced — and it is the format
# students learn most from here, so during TEACHING it leads. Review leans on mermaid instead,
# because summarising what was covered is a structure job, not a motion one.
_EXPL_BIAS: Dict[str, Dict[str, float]] = {
    "recap":    {"animation": 0.40, "svg": 0.25, "mermaid": 0.20, "image": 0.15},
    # TEACH is written as the share of the WHOLE turn budget, not of the explanatory slice —
    # these four sum to 85, matching `explanatory: 0.85` above, and family_weights renormalises
    # anyway. Written this way so the numbers here are the numbers you measure: animation 35%,
    # svg 20%, mermaid 15%, image 15%, puzzle 15%.
    # svg is nudged BELOW its nominal 20 because a teach phase is only ~4-5 picks long, and with
    # so few picks the largest-deficit rounding consistently broke ties in svg's favour — it
    # measured 25% at a raw 20. These raw numbers are tuned so the MEASURED mix matches the
    # intent (animation 35 · svg 20 · mermaid 15 · image 15 · puzzle 15).
    "teach":    {"animation": 35, "svg": 20, "mermaid": 15, "image": 15},
    "practice": {"animation": 0.40, "svg": 0.30, "mermaid": 0.15, "image": 0.15},
    "quiz":     {"animation": 0.35, "svg": 0.30, "mermaid": 0.20, "image": 0.15},
    "review":   {"animation": 0.25, "svg": 0.20, "mermaid": 0.40, "image": 0.15},
}


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

    The phase split is puzzle-vs-explanatory; the explanatory share is then divided among
    whichever of mermaid/svg/animation/image can be offered, using the per-phase bias below, so
    losing manim re-splits its share among the others instead of quietly handing it to puzzles.
    """
    avail = [f for f in (available or VISUAL_FAMILIES) if f in VISUAL_FAMILIES]
    if not avail:
        return {}
    split = VISUAL_PHASE_WEIGHTS.get((phase or "").strip().lower()) \
        or VISUAL_PHASE_WEIGHTS[_DEFAULT_PHASE]
    expl = [f for f in avail if f in EXPLANATORY_FAMILIES]
    bias = _EXPL_BIAS.get((phase or "").strip().lower()) or _EXPL_BIAS[_DEFAULT_PHASE]
    out: Dict[str, float] = {}
    if "puzzle" in avail:
        out["puzzle"] = split["puzzle"] if expl else 1.0
    expl_share = (split["explanatory"] if "puzzle" in avail else 1.0)
    bias_total = sum(bias.get(f, 0.0) for f in expl) or 1.0
    for f in expl:
        out[f] = expl_share * (bias.get(f, 0.0) / bias_total)
    total = sum(out.values()) or 1.0
    return {f: w / total for f, w in out.items()}


def pick_visual_family(seq: Optional[List[str]], available: Optional[List[str]] = None,
                       phase: Optional[str] = None, seed: Optional[int] = None) -> str:
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

    # STOCHASTIC ROUNDING (dithering). A teach phase is only ~4-5 picks, so starting every
    # lesson's credit at exactly zero makes the result "the top-k families by weight" — the SAME
    # k every lesson. Measured across lessons the mix then quantises to k/5 instead of the
    # target: svg sat at 25% against a 20% target and no amount of weight-tuning fixed it
    # (nudging svg down to 16 sent it to 12% and threw mermaid/image up to 22%).
    # A per-lesson offset in [0,1) makes the expected count exactly n*weight, so the average
    # over lessons hits the target while any single lesson still looks sensible. Seeded from the
    # appointment so a turn is deterministic — replaying the same turn gives the same answer.
    offset = {f: 0.0 for f in avail}
    if seed is not None:
        rnd = random.Random(f"{seed}:{ph}")
        offset = {f: rnd.random() for f in avail}

    best, best_score = [], None
    for f in avail:
        w = weights.get(f, 0.0)
        if w <= 0:
            continue
        deficit = w * turn + offset[f] - hist.count(f)
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
