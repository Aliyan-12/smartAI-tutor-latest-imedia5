"""
manim_service.py — compile, sandbox, render and cache MODEL-AUTHORED Manim animations.

The tutor writes the body of a Manim `Scene.construct()` for whatever it is teaching right now,
so animation coverage is no longer capped by a handful of hand-written templates. Running
model-authored Python is genuinely dangerous, so it is gated by TWO independent layers — either
one alone would be insufficient:

  LAYER 1 — STATIC ALLOW-LIST (`validate_scene_code`). The code is parsed to an AST and every
    node is checked against an allow-list. No imports, no def/class/lambda-free-for-all, no
    `while`, no attribute whose name starts with `_` (this is what kills the classic
    `().__class__.__base__.__subclasses__()` sandbox escape), and every free variable must be a
    curated Manim name or a safe builtin. Rejections come back as a message the model can act on.

  LAYER 2 — PROCESS ISOLATION (`_render_sync`). Validated code still runs in a SEPARATE process,
    never in the API worker: a scrubbed environment (the app's DB URL, Gemini key and JWT secret
    are NOT passed), a throwaway cwd, an empty PYTHONPATH so `app.*` is unimportable, POSIX
    rlimits on CPU/memory/file-size, its own session so a timeout kills the whole process group,
    and a hard wall-clock timeout.

  Layer 1 assumes it is bypassable and Layer 2 assumes it will be reached. Known residual gap:
  there is no network namespace, so egress is not blocked at the OS level — it is blocked by
  Layer 1 having no reachable import/socket name, and its blast radius is limited by the
  scrubbed env holding no credentials. Closing it properly means running this in its own
  container or as a separate unprivileged user.

Two operational properties are unchanged:
  - GRACEFUL DEGRADATION. Manim (+ cairo/pango/ffmpeg) is OPTIONAL. Without it `MANIM_AVAILABLE`
    is False and the tool tells the model to use a diagram instead.
  - NEVER BLOCKS A TURN. A cache HIT serves instantly; a MISS renders in the BACKGROUND and the
    turn reports "rendering" (the tutor explains with a diagram now; it is instant next time).
"""
import ast
import asyncio
import hashlib
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# Rendered MP4s live here; served at /api/curriculum/animations/{key}.mp4
ANIM_DIR = Path("/app/media/animations")

# Scratch space for the generated scene script. This MUST live outside /app: dev runs uvicorn
# with --reload, whose watcher restarts the server whenever a .py file under the app tree
# changes — writing the scene there restarted the backend on every render and dropped every
# live lesson WebSocket. The system temp dir is not watched.
_WORK_DIR = Path(tempfile.gettempdir()) / "manim_work"

try:  # manim is heavy + optional — its absence disables animations, it never breaks the app
    import manim as _manim  # type: ignore  # noqa: F401
    MANIM_AVAILABLE = True
except Exception as e:  # noqa: BLE001
    MANIM_AVAILABLE = False
    logger.info("Manim not available (%s) — animations disabled; the tutor uses diagrams.", e)


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 1 — static validation
# ─────────────────────────────────────────────────────────────────────────────

MAX_CODE_CHARS = 6000
MAX_AST_NODES = 900

# Statements/expressions the scene body may use. Anything absent is refused, so this list is the
# whole grammar the model is allowed to write — deliberately smaller than Python.
_ALLOWED_NODES = {
    ast.Module, ast.Expr, ast.Assign, ast.AugAssign, ast.For, ast.If, ast.Pass,
    ast.Break, ast.Continue, ast.Call, ast.Name, ast.Attribute, ast.Constant,
    ast.JoinedStr, ast.FormattedValue, ast.List, ast.Tuple, ast.Dict, ast.Set,
    ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.Subscript, ast.Slice,
    ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.comprehension,
    ast.Starred, ast.keyword, ast.arg, ast.arguments, ast.Lambda, ast.IfExp,
    ast.Load, ast.Store, ast.Del, ast.NamedExpr,
    # operators
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.USub, ast.UAdd, ast.Not, ast.Invert, ast.And, ast.Or,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn,
    ast.Is, ast.IsNot, ast.MatMult, ast.BitAnd, ast.BitOr, ast.BitXor,
    ast.LShift, ast.RShift,
}

# Refused with a specific explanation, because the model would otherwise keep retrying these.
_NODE_HELP = {
    ast.Import: "imports are not allowed — every Manim name you need is already available",
    ast.ImportFrom: "imports are not allowed — every Manim name you need is already available",
    ast.FunctionDef: "'def' is not allowed — use a lambda or write the steps inline",
    ast.AsyncFunctionDef: "'async def' is not allowed",
    ast.ClassDef: "'class' is not allowed — write only the body of construct()",
    ast.While: "'while' is not allowed (it can hang) — use 'for i in range(n)'",
    ast.Try: "try/except is not allowed",
    ast.Raise: "'raise' is not allowed",
    ast.With: "'with' is not allowed",
    ast.Global: "'global' is not allowed",
    ast.Nonlocal: "'nonlocal' is not allowed",
    ast.Delete: "'del' is not allowed",
    ast.Assert: "'assert' is not allowed",
    ast.Return: "'return' is not allowed — this is the body of construct()",
    ast.Yield: "generators are not allowed",
    ast.YieldFrom: "generators are not allowed",
    ast.Await: "'await' is not allowed",
}

_SAFE_BUILTINS = {
    "range", "len", "min", "max", "abs", "round", "sum", "int", "float", "str",
    "list", "tuple", "dict", "set", "enumerate", "zip", "sorted", "reversed",
    "bool", "any", "all", "map", "filter",
}

_MANIM_CONSTANTS = {
    "PI", "TAU", "DEGREES", "UP", "DOWN", "LEFT", "RIGHT", "IN", "OUT", "ORIGIN",
    "UL", "UR", "DL", "DR", "X_AXIS", "Y_AXIS", "Z_AXIS",
    "SMALL_BUFF", "MED_SMALL_BUFF", "MED_LARGE_BUFF", "LARGE_BUFF",
}

_MANIM_COLORS = {
    "WHITE", "BLACK", "RED", "GREEN", "BLUE", "YELLOW", "ORANGE", "PURPLE", "PINK",
    "GREY", "GRAY", "TEAL", "MAROON", "GOLD", "LIGHT_GREY", "DARK_GREY", "LIGHT_GRAY",
    "DARK_GRAY", "LIGHT_BROWN", "DARK_BROWN", "PURE_RED", "PURE_GREEN", "PURE_BLUE",
    "LIGHT_PINK", "DARKER_GREY", "DARKER_GRAY",
}
# BLUE_A … GOLD_E etc.
for _stem in ("BLUE", "RED", "GREEN", "YELLOW", "PURPLE", "GREY", "GRAY", "TEAL",
              "MAROON", "GOLD", "PINK", "ORANGE"):
    for _suf in ("A", "B", "C", "D", "E"):
        _MANIM_COLORS.add(f"{_stem}_{_suf}")

_MANIM_MOBJECTS = {
    # shapes
    "Circle", "Square", "Rectangle", "RoundedRectangle", "Triangle", "Polygon",
    "RegularPolygon", "Line", "DashedLine", "Arrow", "DoubleArrow", "Vector",
    "Dot", "LabeledDot", "Ellipse", "Annulus", "Arc", "ArcBetweenPoints", "Sector",
    "AnnularSector", "Star", "Cross", "Elbow", "Angle", "RightAngle", "Brace",
    "BraceBetweenPoints", "SurroundingRectangle", "Underline", "Cutout", "ArcPolygon",
    "CubicBezier", "ArrowVectorField", "Polyline", "DashedVMobject",
    # text (LaTeX-free — see _BLOCKED_NAMES)
    "Text", "MarkupText", "Paragraph",
    # containers
    "VGroup", "Group", "VDict", "VMobject", "Mobject",
    # graphing
    "Axes", "NumberPlane", "NumberLine", "ComplexPlane", "BarChart",
    "ParametricFunction", "FunctionGraph", "ImplicitFunction", "ValueTracker",
    "always_redraw", "Table", "MobjectTable", "IntegerTable",
    # tables/braces helpers
    "Rectangle", "Square",
}

_MANIM_ANIMATIONS = {
    "Create", "Uncreate", "Write", "Unwrite", "DrawBorderThenFill", "AddTextLetterByLetter",
    "FadeIn", "FadeOut", "Transform", "ReplacementTransform", "TransformMatchingShapes",
    "GrowFromCenter", "GrowFromEdge", "GrowFromPoint", "GrowArrow", "SpinInFromNothing",
    "ShrinkToCenter", "Rotate", "Rotating", "MoveAlongPath", "Indicate", "Flash",
    "Circumscribe", "FocusOn", "Wiggle", "ApplyWave", "ShowPassingFlash", "Blink",
    "LaggedStart", "LaggedStartMap", "AnimationGroup", "Succession", "Wait", "Restore",
    "ScaleInPlace", "ApplyMethod", "MoveToTarget", "CounterclockwiseTransform",
    "ClockwiseTransform", "FadeTransform",
    # rate functions
    "linear", "smooth", "there_and_back", "there_and_back_with_pause", "rush_into",
    "rush_from", "slow_into", "double_smooth", "wiggle", "ease_in_sine", "ease_out_sine",
    "ease_in_out_sine", "ease_in_quad", "ease_out_quad", "ease_in_out_quad",
}

ALLOWED_NAMES = (
    {"self"} | _SAFE_BUILTINS | _MANIM_CONSTANTS | _MANIM_COLORS
    | _MANIM_MOBJECTS | _MANIM_ANIMATIONS
)

# Named explicitly so the refusal can say WHY and point at the alternative.
_BLOCKED_NAMES = {
    "MathTex": "MathTex needs LaTeX, which is not installed — use Text(\"x^2\") instead",
    "Tex": "Tex needs LaTeX, which is not installed — use Text(...) instead",
    "SingleStringMathTex": "LaTeX is not installed — use Text(...)",
    "TexTemplate": "LaTeX is not installed — use Text(...)",
    "Title": "Title renders via LaTeX — use Text(...) instead",
    "DecimalNumber": "DecimalNumber renders via LaTeX — use Text(str(value)) instead",
    "Integer": "Integer renders via LaTeX — use Text(str(value)) instead",
    "Variable": "Variable renders via LaTeX — use Text(...) instead",
    "config": "the global config is not writable from a scene",
    "np": "numpy is not available — build points as plain lists, e.g. [x, y, 0]",
    "numpy": "numpy is not available — build points as plain lists, e.g. [x, y, 0]",
    "open": "file access is not allowed",
    "eval": "eval is not allowed",
    "exec": "exec is not allowed",
    "compile": "compile is not allowed",
    "getattr": "getattr is not allowed",
    "setattr": "setattr is not allowed",
    "delattr": "delattr is not allowed",
    "globals": "globals is not allowed",
    "locals": "locals is not allowed",
    "vars": "vars is not allowed",
    "dir": "dir is not allowed",
    "type": "type is not allowed",
    "object": "object is not allowed",
    "super": "super is not allowed",
    "input": "input is not allowed",
    "breakpoint": "breakpoint is not allowed",
    "exit": "exit is not allowed",
    "quit": "quit is not allowed",
    "help": "help is not allowed",
    "__import__": "imports are not allowed",
    "__builtins__": "builtins access is not allowed",
}

# Attributes that expose frames/globals without a leading underscore.
_BLOCKED_ATTRS = {
    "gi_frame", "gi_code", "cr_frame", "cr_code", "ag_frame", "ag_code",
    "f_globals", "f_locals", "f_builtins", "f_back", "tb_frame", "tb_next",
    "func_globals", "func_code", "func_builtins", "im_func", "im_self",
}


class SceneCodeError(ValueError):
    """Validation failed — the message is written to be actionable by the model."""


def _bound_names(tree: ast.AST) -> set:
    """Every name the body itself binds (assignments, loop vars, comprehensions, lambda args)."""
    out: set = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            out.add(node.id)
        elif isinstance(node, ast.arg):
            out.add(node.arg)
        elif isinstance(node, ast.NamedExpr) and isinstance(node.target, ast.Name):
            out.add(node.target.id)
    return out


def validate_scene_code(code: str) -> str:
    """Return the cleaned scene body, or raise SceneCodeError with a model-actionable message.

    This is Layer 1. It assumes it can be bypassed — process isolation is what contains a
    bypass — but it is what stops the overwhelming majority of dangerous code, and it is what
    gives the model a specific reason it can correct.
    """
    src = textwrap.dedent(code or "").strip("\n")
    if not src.strip():
        raise SceneCodeError("the animation code was empty")
    if len(src) > MAX_CODE_CHARS:
        raise SceneCodeError(f"the animation code is too long ({len(src)} chars, max {MAX_CODE_CHARS})")

    try:
        tree = ast.parse(src, mode="exec")
    except SyntaxError as e:
        raise SceneCodeError(f"Python syntax error on line {e.lineno}: {e.msg}") from e

    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_AST_NODES:
        raise SceneCodeError(f"the animation is too complex ({len(nodes)} nodes, max {MAX_AST_NODES}) "
                             "— show ONE idea, not a whole lesson")

    local = _bound_names(tree)

    for node in nodes:
        kind = type(node)
        if kind in _NODE_HELP:
            raise SceneCodeError(_NODE_HELP[kind])
        if kind not in _ALLOWED_NODES:
            raise SceneCodeError(f"'{kind.__name__}' is not allowed in an animation body")

        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_") or node.attr in _BLOCKED_ATTRS:
                raise SceneCodeError(f"attribute '.{node.attr}' is not allowed")

        elif isinstance(node, ast.Name):
            name = node.id
            if name in _BLOCKED_NAMES:
                raise SceneCodeError(_BLOCKED_NAMES[name])
            if name.startswith("__"):
                raise SceneCodeError(f"'{name}' is not allowed")
            if isinstance(node.ctx, ast.Load) and name not in ALLOWED_NAMES and name not in local:
                raise SceneCodeError(
                    f"'{name}' is not an available Manim name. Use only standard Manim objects "
                    "(Circle, Square, Line, Arrow, Dot, Text, VGroup, Axes, NumberLine, "
                    "NumberPlane, ParametricFunction …) and animations (Create, Write, FadeIn, "
                    "Transform, Rotate, Indicate …)."
                )

    return src


# ─────────────────────────────────────────────────────────────────────────────
# LAYER 2 — isolated execution
# ─────────────────────────────────────────────────────────────────────────────

RENDER_TIMEOUT_S = 90
_CPU_SECONDS = 60
_MEM_BYTES = 3 * 1024 * 1024 * 1024      # 3 GB — cairo/ffmpeg need real headroom
_FSIZE_BYTES = 256 * 1024 * 1024

_RUNNER = '''\
from manim import *
from manim import tempconfig

class Gen(Scene):
    def construct(self):
{body}

with tempconfig({{
    "quality": "low_quality",
    "output_file": {key!r},
    "format": "mp4",
    "media_dir": {media!r},
    "disable_caching": True,
    "verbosity": "ERROR",
    "progress_bar": "none",
}}):
    Gen().render()
'''


def _limits():
    """POSIX rlimits for the render process. None on platforms without `resource`."""
    try:
        import resource  # noqa: PLC0415 — POSIX-only, imported lazily on purpose
    except ImportError:
        return None

    def _apply():
        resource.setrlimit(resource.RLIMIT_CPU, (_CPU_SECONDS, _CPU_SECONDS))
        resource.setrlimit(resource.RLIMIT_AS, (_MEM_BYTES, _MEM_BYTES))
        resource.setrlimit(resource.RLIMIT_FSIZE, (_FSIZE_BYTES, _FSIZE_BYTES))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    return _apply


def code_key(code: str) -> str:
    """Cache key for a scene body — identical code renders once, ever."""
    return f"gen-{hashlib.sha256(code.encode()).hexdigest()[:16]}"


def cached_path(key: str) -> Optional[Path]:
    p = ANIM_DIR / f"{key}.mp4"
    return p if p.exists() else None


def _render_sync(code: str, key: str) -> bool:
    """Render validated scene code to ANIM_DIR/{key}.mp4 in an ISOLATED process.

    Blocking — always call via a thread. Returns True only if the MP4 landed.
    """
    if not MANIM_AVAILABLE:
        return False
    ANIM_DIR.mkdir(parents=True, exist_ok=True)
    _WORK_DIR.mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp(prefix="scene-", dir=str(_WORK_DIR)))
    try:
        script = _RUNNER.format(
            body=textwrap.indent(code, " " * 8),
            key=key,
            media=str(work / "media"),
        )
        script_path = work / "scene.py"
        script_path.write_text(script, encoding="utf-8")

        # Scrubbed environment. The API process holds DATABASE_URL, GEMINI_API_KEY, JWT/SESSION
        # secrets and SMTP credentials — none of them are passed here. PYTHONPATH is emptied so
        # `app.*` cannot be imported even if Layer 1 were bypassed.
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": str(work),
            "TMPDIR": str(work),
            "PYTHONPATH": "",
            "PYTHONDONTWRITEBYTECODE": "1",
            "MPLBACKEND": "Agg",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
        }

        popen_kw = {}
        limits = _limits()
        if limits is not None:
            # start_new_session gives the child its own process group, so a timeout kills
            # ffmpeg and every other grandchild too rather than orphaning them.
            popen_kw = {"preexec_fn": limits, "start_new_session": True}
        else:
            logger.warning("manim sandbox: rlimits unavailable on this platform "
                           "(no `resource` module) — relying on the wall-clock timeout only")

        proc = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(work), env=env, capture_output=True, timeout=RENDER_TIMEOUT_S,
            **popen_kw,
        )
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
            logger.warning("ANIMATION render failed key=%s rc=%s: %s",
                           key, proc.returncode, err[-1] if err else "(no stderr)")
            return False

        matches = sorted(work.rglob(f"{key}.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not matches:
            logger.warning("ANIMATION render produced no file for %s", key)
            return False
        shutil.move(str(matches[0]), str(ANIM_DIR / f"{key}.mp4"))
        logger.info("ANIMATION rendered key=%s", key)
        return True

    except subprocess.TimeoutExpired:
        logger.warning("ANIMATION render timed out after %ss key=%s", RENDER_TIMEOUT_S, key)
        return False
    except Exception as e:  # noqa: BLE001 — a failed render must never break the tutor
        logger.warning("ANIMATION render error key=%s: %s: %s", key, type(e).__name__, e)
        return False
    finally:
        shutil.rmtree(work, ignore_errors=True)


_inflight: set = set()


def render_code_or_queue(code: str) -> Tuple[str, Optional[str]]:
    """(status, key). status: 'ready' (cache hit → show now) or 'rendering' (background).

    Never blocks the turn: a miss starts the render and returns immediately.
    Raises SceneCodeError if the code fails validation.
    """
    if not MANIM_AVAILABLE:
        return "unavailable", None
    clean = validate_scene_code(code)
    key = code_key(clean)
    if cached_path(key):
        return "ready", key
    if key not in _inflight:
        _inflight.add(key)

        async def _bg():
            try:
                await asyncio.to_thread(_render_sync, clean, key)
            finally:
                _inflight.discard(key)

        try:
            asyncio.get_running_loop().create_task(_bg())
        except RuntimeError:
            _inflight.discard(key)
    return "rendering", key


def available_kinds(key_stage: Optional[str] = None, subject: Optional[str] = None) -> List[str]:
    """Kept for the lesson anchor's visual rotation.

    Animations used to be a fixed template list gated by key stage and subject, which is exactly
    why they almost never appeared. The tutor now writes the scene, so an animation is available
    for ANY topic whenever manim is installed.
    """
    return ["animation"] if MANIM_AVAILABLE else []
