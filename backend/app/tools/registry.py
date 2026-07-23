"""
registry.py — per-turn tool assembly + group filtering.

The session WS binds only the tool GROUPS relevant to the current lesson state
each turn (web-backed anti-hallucination: fewer, scoped tools per call). Groups:
  teaching   — slide nav (session_tools) — bind only when the lesson has slides
  visuals    — display-only teaching visuals: mermaid / svg / manim (visual_tools).
               What the tutor EXPLAINS with; prioritised in the TEACH + RECAP phases.
  puzzles    — hands-on puzzles + evaluators (puzzle_tools). What the student DOES;
               prioritised, with `assessment`, in the PRACTICE + QUIZ phases.
  assessment — generate_quiz (platform) — bind in quiz phase / practice
  mastery    — student mastery + answer evaluation (platform)
  platform   — lesson-phase, assignments, load_resource, pause/resume (platform)
  lifecycle  — end_lesson + report (platform) — bound when end_allowed OR the lesson is
               in its closing stage / the student asks to end (end_lesson stays guarded)
  research   — web/deep search (platform)

PRIORITY, NOT GATING: the phase decides which group leads, and the LESSON STATE anchor says
so in words. The core view groups stay bound in every phase regardless, because an unbound
tool the model wants is worse than a deprioritised one — it silently no-ops and the model
then claims it did something it didn't.
"""
import logging
from typing import Iterable, List, Set

from app.tools.session_tools import ToolContext, session_tool_groups
from app.tools.puzzle_tools import puzzle_tool_groups
from app.tools.visual_tools import visual_tool_groups
from app.tools.platform_tools import platform_tool_groups

logger = logging.getLogger(__name__)

# Stable bind order — keep view tools first, lifecycle last.
GROUP_ORDER: List[str] = [
    "teaching", "visuals", "puzzles", "assessment", "mastery", "platform", "lifecycle", "research",
]
ALL_SESSION_GROUPS: Set[str] = set(GROUP_ORDER)


def make_tools(ctx: ToolContext, groups: Iterable[str]) -> list:
    """Assemble the LangChain tools for the requested groups (order-stable). Logs the
    bound groups + tool names so the per-turn filtering is visible in backend logs."""
    wanted = set(groups)
    grouped: dict = {}
    grouped.update(session_tool_groups(ctx))     # teaching (slide nav)
    grouped.update(visual_tool_groups(ctx))      # visuals (mermaid / svg / manim)
    grouped.update(puzzle_tool_groups(ctx))      # puzzles (generators + evaluators)
    grouped.update(platform_tool_groups(ctx))

    tools: list = []
    bound: List[str] = []
    for name in GROUP_ORDER:
        if name in wanted and name in grouped:
            tools.extend(grouped[name])
            bound.append(name)
    logger.info("TOOLS bound groups=%s tools=%s", bound, [t.name for t in tools])
    return tools
