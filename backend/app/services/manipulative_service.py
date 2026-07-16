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
}

KINDS = list(MANIPULATIVES)


def _norm_ks(key_stage: Optional[str]) -> str:
    return (key_stage or "").upper().replace(" ", "")


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


def allowed_kinds(key_stage: Optional[str]) -> List[str]:
    ks = _norm_ks(key_stage)
    return [k for k, e in MANIPULATIVES.items() if ks in e["key_stages"]]


# ── Age mix — how much of the practice should be hands-on ─────────────────────────
# The user's rule: KS1/KS2 100% interactive, KS3 60%, KS4 30%, KS5 0%.

_MIX = {"KS1": 1.0, "KS2": 1.0, "KS3": 0.6, "KS4": 0.3, "KS5": 0.0}


def target_mix(key_stage: Optional[str]) -> float:
    return _MIX.get(_norm_ks(key_stage), 0.6)


def manipulatives_enabled(key_stage: Optional[str]) -> bool:
    """KS5 gets none at all — an A-Level student does not want counters."""
    return target_mix(key_stage) > 0.0


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
_MIX_LEAN = {"KS1": 0.6, "KS2": 0.6, "KS3": 0.5, "KS4": 0.4, "KS5": 0.0}
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
    """
    if not has_topic_manip or not manipulatives_enabled(key_stage):
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


def suggest_kind(key_stage: Optional[str], history: Optional[List[str]] = None) -> str:
    """Pick the NEXT hands-on activity — at random, and never the one just used.

    Left to itself the model reaches for the same activity in the same order every lesson
    (counting, then counters, then the same third thing), because a list in a docstring has an
    order and an LLM has a bias. So the SERVER chooses and the anchor tells it what to use.

    Not a pure coin flip: activities used least this lesson are preferred, and the most recent
    one is excluded outright, so a short lesson still gets genuine variety rather than random
    repetition.
    """
    allowed = allowed_kinds(key_stage)
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
}


def topic_manipulatives(topic: Optional[str], key_stage: Optional[str]) -> List[str]:
    """The manipulative kind(s) whose subject genuinely matches this lesson topic, restricted
    to those allowed at the key stage. Empty when NO manipulative fits — the caller then uses a
    different puzzle type instead of forcing a mismatched manipulative."""
    t = (topic or "").lower()
    if not t:
        return []
    allowed = set(allowed_kinds(key_stage))
    return [k for k, kws in _TOPIC_KEYWORDS.items()
            if k in allowed and any(kw in t for kw in kws)]


def pick_topic_kind(topic: Optional[str], key_stage: Optional[str],
                    history: Optional[List[str]] = None) -> str:
    """The manipulative to use for THIS topic: the topic-matching kind, and when several match
    (e.g. multiplication → times_table_dash + dot_array) the least-used / not-just-used one for
    variety. Returns "" when NO manipulative matches the topic (→ use another puzzle type)."""
    matches = topic_manipulatives(topic, key_stage)
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
