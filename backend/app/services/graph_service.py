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


def _draw(spec: Dict[str, Any]) -> str:
    kind = str(spec.get("kind", "line")).lower()
    title = str(spec.get("title", "") or "")
    xlabel = str(spec.get("xlabel", "x") or "x")
    ylabel = str(spec.get("ylabel", "y") or "y")

    fig, ax = plt.subplots(figsize=(5.2, 4.0), dpi=130)
    try:
        if kind == "function":
            expr = str(spec.get("expr", "x"))
            xmin = float(spec.get("xmin", -10))
            xmax = float(spec.get("xmax", 10))
            x = np.linspace(xmin, xmax, 400)
            y = eval(expr, {"__builtins__": {}}, {**_SAFE_NS, "x": x})  # noqa: S307 — whitelisted ns only
            ax.plot(x, y, linewidth=2)
            ax.axhline(0, color="#888", linewidth=0.8)
            ax.axvline(0, color="#888", linewidth=0.8)
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
