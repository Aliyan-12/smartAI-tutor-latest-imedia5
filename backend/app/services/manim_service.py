"""
manim_service.py — render (and cache) the curated Manim animation templates.

Three decisions make this safe and non-blocking:

- TEMPLATE-ONLY. The AI passes `kind` + numeric params; it never authors Manim code. The Scene
  classes in `manim_scenes` are the only code that runs (no arbitrary code execution).
- GRACEFUL DEGRADATION. Manim (and its cairo/pango/ffmpeg system deps) is OPTIONAL. Without it
  `MANIM_AVAILABLE` is False and the tool tells the model to use a mermaid diagram instead — so
  the app works fully without the heavier image, and animations light up the moment you rebuild
  the backend with manim installed.
- NEVER BLOCKS A TURN. Rendering an MP4 takes seconds, so a turn never waits on one: a cache HIT
  serves instantly; a MISS starts a BACKGROUND render and reports "rendering" for this turn (the
  tutor shows a diagram now; the same animation is instant next time). Pre-seed the common ones
  with `python -m app.seed_animations`.
"""
import asyncio
import hashlib
import json
import logging
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Rendered MP4s live here; served at /api/curriculum/animations/{key}.mp4
ANIM_DIR = Path("/app/media/animations")
_WORK_DIR = Path("/app/media/_manim_work")

try:
    from app.services import manim_scenes as _scenes
    MANIM_AVAILABLE = True
except Exception as e:  # noqa: BLE001 — manim or a system dep missing → feature simply off
    _scenes = None  # type: ignore
    MANIM_AVAILABLE = False
    logger.info("Manim not available (%s) — animations disabled; the tutor uses diagrams.", e)


def _clampi(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


TEMPLATES: Dict[str, Dict[str, Any]] = {
    "sine_wave": {
        "scene": "SineWave", "key_stages": ["KS4", "KS5"],
        "subjects": ["maths", "physics", "science"],
        "params": lambda p: {"cycles": _clampi(p.get("cycles"), 1, 3, 2)},
        "title": "Sine wave from the circle",
        "caption": "As the point goes round the circle, its height traces a sine wave.",
    },
    "vector_addition": {
        "scene": "VectorAddition", "key_stages": ["KS4", "KS5"],
        "subjects": ["maths", "physics", "science"],
        "params": lambda p: {
            "ax": _clampi(p.get("ax"), -4, 4, 3), "ay": _clampi(p.get("ay"), -4, 4, 1),
            "bx": _clampi(p.get("bx"), -4, 4, 1), "by": _clampi(p.get("by"), -4, 4, 2),
        },
        "title": "Adding vectors tip-to-tail",
        "caption": "Place the vectors tip-to-tail; the resultant runs start to finish.",
    },
    "number_line_add": {
        "scene": "NumberLineAdd", "key_stages": ["KS1", "KS2", "KS3"], "subjects": ["maths"],
        "params": lambda p: {
            "start": _clampi(p.get("start"), 0, 20, 3), "step": _clampi(p.get("step"), 1, 5, 2),
            "jumps": _clampi(p.get("jumps"), 1, 6, 4),
        },
        "title": "Jumping along the number line",
        "caption": "Count on in equal jumps to add.",
    },
}

KINDS = list(TEMPLATES)


def available_kinds(key_stage: Optional[str], subject: Optional[str]) -> List[str]:
    if not MANIM_AVAILABLE:
        return []
    ks = (key_stage or "").upper().replace(" ", "")
    subj = (subject or "").strip().lower()
    out = []
    for k, e in TEMPLATES.items():
        if ks and e["key_stages"] and ks not in e["key_stages"]:
            continue
        if subj and e["subjects"] and not any(s in subj for s in e["subjects"]):
            continue
        out.append(k)
    return out


def _key(kind: str, clean: dict) -> str:
    raw = f"{kind}:{json.dumps(clean, sort_keys=True)}"
    return f"{kind}-{hashlib.sha1(raw.encode()).hexdigest()[:12]}"


def spec_for(kind: str, params: Optional[dict]) -> Optional[Tuple[str, dict, str, str]]:
    """(key, clean_params, title, caption) — or None if the kind is unknown/unavailable."""
    entry = TEMPLATES.get((kind or "").strip().lower())
    if not entry or not MANIM_AVAILABLE:
        return None
    clean = entry["params"](params or {})
    return _key(kind, clean), clean, entry["title"], entry["caption"]


def cached_path(key: str) -> Optional[Path]:
    p = ANIM_DIR / f"{key}.mp4"
    return p if p.exists() else None


def _render_sync(kind: str, clean: dict, key: str) -> bool:
    """Render one animation to ANIM_DIR/{key}.mp4. Blocking — always call via a thread."""
    if not MANIM_AVAILABLE:
        return False
    from manim import tempconfig  # type: ignore
    ANIM_DIR.mkdir(parents=True, exist_ok=True)
    _WORK_DIR.mkdir(parents=True, exist_ok=True)
    scene_cls = getattr(_scenes, TEMPLATES[kind]["scene"])
    try:
        with tempconfig({
            "quality": "low_quality",        # 480p15 — fast, fine for a teaching clip
            "output_file": key,
            "format": "mp4",
            "media_dir": str(_WORK_DIR),
            "disable_caching": True,
            "verbosity": "ERROR",
            "progress_bar": "none",
        }):
            scene_cls(**clean).render()
        # Manim's output subdir varies by version/config — find the file and move it.
        matches = sorted(_WORK_DIR.rglob(f"{key}.mp4"),
                         key=lambda p: p.stat().st_mtime, reverse=True)
        if not matches:
            logger.warning("manim render produced no file for %s", key)
            return False
        shutil.move(str(matches[0]), str(ANIM_DIR / f"{key}.mp4"))
        logger.info("ANIMATION rendered key=%s kind=%s", key, kind)
        return True
    except Exception as e:  # noqa: BLE001 — a failed render must never break the tutor
        logger.warning("manim render failed kind=%s key=%s: %s: %s",
                       kind, key, type(e).__name__, e)
        return False


_inflight: set = set()


def render_or_queue(kind: str, params: Optional[dict]) -> Tuple[str, Optional[str], str, str]:
    """(status, key, title, caption). status: 'ready' (cache hit → show now),
    'rendering' (queued in background → use a diagram this turn), 'unavailable'."""
    spec = spec_for(kind, params)
    if not spec:
        return "unavailable", None, "", ""
    key, clean, title, caption = spec
    if cached_path(key):
        return "ready", key, title, caption
    if key not in _inflight:
        _inflight.add(key)

        async def _bg():
            try:
                await asyncio.to_thread(_render_sync, kind, clean, key)
            finally:
                _inflight.discard(key)

        try:
            asyncio.get_running_loop().create_task(_bg())
        except RuntimeError:
            _inflight.discard(key)
    return "rendering", key, title, caption
