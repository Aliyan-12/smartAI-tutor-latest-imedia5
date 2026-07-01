"""
registry.py — per-turn tool assembly + group filtering.

The session WS binds only the tool GROUPS relevant to the current lesson state
each turn (web-backed anti-hallucination: fewer, scoped tools per call). Groups:
  teaching   — slide nav (session_tools) — bind only when the lesson has slides
  puzzles    — visual puzzles (session_tools)
  assessment — generate_quiz (platform) — bind in quiz phase / practice
  mastery    — student mastery + answer evaluation (platform)
  platform   — lesson-phase, assignments, load_resource, pause/resume (platform)
  lifecycle  — end_lesson + report (platform) — bound when end_allowed OR the lesson is
               in its closing stage / the student asks to end (end_lesson stays guarded)
  research   — web/deep search (platform)
"""
import logging
from typing import Iterable, List, Set

from app.tools.session_tools import ToolContext, session_tool_groups
from app.tools.platform_tools import platform_tool_groups

logger = logging.getLogger(__name__)

# Stable bind order — keep view tools first, lifecycle last.
GROUP_ORDER: List[str] = [
    "teaching", "puzzles", "assessment", "mastery", "platform", "lifecycle", "research",
]
ALL_SESSION_GROUPS: Set[str] = set(GROUP_ORDER)


def make_tools(ctx: ToolContext, groups: Iterable[str]) -> list:
    """Assemble the LangChain tools for the requested groups (order-stable). Logs the
    bound groups + tool names so the per-turn filtering is visible in backend logs."""
    wanted = set(groups)
    grouped: dict = {}
    grouped.update(session_tool_groups(ctx))
    grouped.update(platform_tool_groups(ctx))

    tools: list = []
    bound: List[str] = []
    for name in GROUP_ORDER:
        if name in wanted and name in grouped:
            tools.extend(grouped[name])
            bound.append(name)
    logger.info("TOOLS bound groups=%s tools=%s", bound, [t.name for t in tools])
    return tools
