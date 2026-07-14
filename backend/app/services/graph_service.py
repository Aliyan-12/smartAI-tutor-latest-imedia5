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
