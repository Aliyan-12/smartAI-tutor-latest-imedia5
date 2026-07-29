"""
tools.py — adapt our existing LangChain tools into crewai BaseTools, WITHOUT losing the
WebSocket side-effect that makes them work.

Our session tools do two things when called: (1) return a result dict to the caller, and
(2) cause a WS frame to reach the student's screen (show_puzzle / show_resource / clear …).
In the current path, gemini_service runs the tool and _run_turn translates the result into a
`{type:"tool"}` frame. Under crewai, the tool runs INSIDE the crew's executor — so the wrapper
itself must emit that frame.

The spike proved the thread model: crewai calls a tool's sync `_run` on a WORKER thread, so we
bridge to the async tool body on the WS event loop with `run_coroutine_threadsafe(coro, ws_loop)`
— no deadlock, and the request's AsyncSession stays on its own loop. The async body:
  1. invokes the real LangChain tool (DB work happens on the WS loop),
  2. emits the WS frame + the thinking-strip label (exactly like _run_turn's [TOOL_RESULT] path),
  3. records side-band signals (puzzle shown / quiz done / lesson ended) for the runner,
  4. returns a COMPACT string to the crew agent so its next words match what's on screen.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from crewai.tools import BaseTool
from pydantic import BaseModel, PrivateAttr

logger = logging.getLogger(__name__)

# Keep the string handed back to the agent small — big fields (SVG markup, image/audio b64,
# raw params, the puzzle SOLUTION) must never bloat the agent context or leak on screen.
_DROP_KEYS = {"svg", "image_b64", "audio_b64", "params", "_catalog", "solution", "answer",
              "answer_key", "per_item", "questions", "figure_svg", "spec"}
_TOOL_TIMEOUT_S = 90


@dataclass
class ToolBridge:
    """Everything a wrapped tool needs to reach the live WS turn. One per turn."""
    send: Callable[[dict], Awaitable[None]]
    ws_loop: asyncio.AbstractEventLoop
    emit_thinking: Callable[[str], Awaitable[None]]   # already bound to send + thinking_steps
    appt_id: Optional[int] = None
    signals: dict = field(default_factory=dict)       # puzzle_shown, quick_replies_shown, ended_appt


def _thinking_labels() -> dict:
    # Lazy import breaks the import cycle (session_agent_service imports the runner).
    try:
        from app.services.agent.session.core import _THINKING_LABELS
        return _THINKING_LABELS
    except Exception:  # noqa: BLE001
        return {}


def _summarize_for_agent(tool_name: str, result: Any) -> str:
    """The compact string the crew agent sees as the tool's result — enough to speak accurately,
    nothing big or secret."""
    if not isinstance(result, dict):
        return str(result)[:800]
    err = result.get("error")
    if err:
        # Give the agent the refusal reason + any message so it adapts instead of pretending.
        return f'tool_result: error={err}. {str(result.get("message", ""))[:300]}'
    # Slide tools: the agent must teach from the slide text.
    if "slide_content" in result:
        sc = (result.get("slide_content") or "").strip()
        idx = result.get("slide_index")
        tot = result.get("page_count")
        return f"Now showing slide {idx} of {tot}. Slide text to teach from:\n{sc[:1500]}"
    action = result.get("action")
    if action == "show_puzzle":
        return (f"A '{result.get('render')}' activity is now on the student's screen. "
                "Briefly tell them what to do — do not reveal the answer.")
    if action == "clear_puzzle":
        return "The puzzle has been cleared from the screen."
    if action == "quick_replies":
        return "Tap-to-answer options are now on screen for your question."
    if action == "show_quiz" or tool_name == "generate_quiz":
        return "The quiz is now on the student's screen. Briefly introduce it; do not read out answers."
    # Generic: compact JSON minus big/secret fields.
    slim = {k: v for k, v in result.items() if k not in _DROP_KEYS}
    return "tool_result: " + json.dumps(slim, default=str)[:800]


async def _emit_frame(bridge: ToolBridge, tool_name: str, result: Any) -> None:
    """Replicates _run_turn's [TOOL_RESULT] handling: WS tool frame + thinking label + signals."""
    data = result if isinstance(result, dict) else {"value": result}
    action = data.get("action")
    ws_tool = tool_name
    if action == "show_puzzle":
        ws_tool = "show_puzzle"
    elif action == "clear_puzzle":
        ws_tool = "clear_puzzle"

    suppressed = bool(data.get("suppressed"))
    if not suppressed:
        await bridge.send({"type": "tool", "tool": ws_tool, "data": data})
        label = _thinking_labels().get(tool_name)
        if label:
            await bridge.emit_thinking(label)
    else:
        logger.info("CREW tool refused (suppressed) tool=%s reason=%s", tool_name, data.get("error"))

    if action == "show_puzzle" and not data.get("error"):
        bridge.signals["puzzle_shown"] = True
    if action == "quick_replies" and not data.get("error"):
        bridge.signals["quick_replies_shown"] = True

    xp = data.get("xp_awarded")
    if isinstance(xp, (int, float)) and xp > 0:
        await bridge.emit_thinking(f"🌟 +{int(xp)} XP earned")

    if tool_name == "end_lesson" and data.get("ended"):
        bridge.signals["ended_appt"] = bridge.appt_id


class _EmptyArgs(BaseModel):
    pass


def _resolve_args_schema(lc_tool: Any) -> type[BaseModel]:
    schema = getattr(lc_tool, "args_schema", None)
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        return schema
    return _EmptyArgs


class LangChainAdapterTool(BaseTool):
    """A crewai BaseTool that runs one of our async LangChain tools + emits its WS frame."""
    _lc_tool: Any = PrivateAttr()
    _bridge: ToolBridge = PrivateAttr()

    def __init__(self, *, lc_tool: Any, bridge: ToolBridge, **data: Any):
        data.setdefault("name", lc_tool.name)
        data.setdefault("description", (lc_tool.description or lc_tool.name)[:1024])
        data.setdefault("args_schema", _resolve_args_schema(lc_tool))
        super().__init__(**data)
        self._lc_tool = lc_tool
        self._bridge = bridge

    async def _body(self, kwargs: dict) -> str:
        # Runs on the WS event loop (scheduled from the worker thread) — so ctx.db is safe here.
        result = await self._lc_tool.ainvoke(kwargs or {})
        try:
            await _emit_frame(self._bridge, self.name, result)
        except Exception:  # noqa: BLE001 — a frame hiccup must not fail the tool for the agent
            logger.warning("CREW emit_frame failed tool=%s", self.name, exc_info=True)
        return _summarize_for_agent(self.name, result)

    def _run(self, **kwargs: Any) -> str:
        # crewai calls this on a WORKER thread (verified) → bridge to the WS loop.
        try:
            fut = asyncio.run_coroutine_threadsafe(self._body(kwargs), self._bridge.ws_loop)
            return fut.result(timeout=_TOOL_TIMEOUT_S)
        except Exception as e:  # noqa: BLE001
            logger.warning("CREW tool %s failed: %s", self.name, e, exc_info=True)
            return f"tool_result: error=tool_failed ({type(e).__name__})"


def adapt_tools(lc_tools: list, bridge: ToolBridge) -> list[BaseTool]:
    """Wrap each LangChain tool for this turn's crew. Names are logged for parity with the
    single-agent path's `TOOLS bound` line."""
    wrapped = [LangChainAdapterTool(lc_tool=t, bridge=bridge) for t in lc_tools]
    logger.info("CREW tools adapted: %s", [t.name for t in wrapped])
    return wrapped
