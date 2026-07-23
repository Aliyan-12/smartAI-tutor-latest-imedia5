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
import logging
import random
import re
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
    """
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


# How strongly each key stage leans toward hands-on manipulatives WITHIN the mix (only applies
# to topics that HAVE a matching manipulative — younger students get more, but never all-or-none
# so the lesson always varies between hands-on and classic puzzles).
# KS5 is deliberately NOT 0 any more. The old rule ("A-Level students don't want counters") was
# right about counters and wrong about hands-on: what a KS5 student gets is a Punnett square, an
# atom builder or algebra tiles — never counting bubbles, because those are tagged KS1-KS3 on
# their own registry entries. Level is enforced by the entry, not by switching the mix off.
_MIX_LEAN = {"KS1": 0.6, "KS2": 0.6, "KS3": 0.5, "KS4": 0.45, "KS5": 0.4}
_MAX_RUN = 3   # never more than this many of the SAME style in a row → the order stays varied


def next_style_mixed(key_stage: Optional[str], style_seq: Optional[List[str]],
                     has_topic_manip: bool) -> str:
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
    lean = _MIX_LEAN.get(_norm_ks(key_stage), 0.5)
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
