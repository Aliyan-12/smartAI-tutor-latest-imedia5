"""
navigator.py — the deterministic phase → agent router (the "Navigator" agent, as code).

The Navigator is what stops the lesson getting stuck. The single agent had no external
clock telling it "teaching time is over, start practice, now wrap up" — so it looped. The
Navigator IS that clock: it reads the same lesson-state signals the LESSON STATE anchor
computes (phase, quiz window, closing stage, end-allowed) and picks the ONE agent whose job
matches this moment. No LLM call — it's a pure function over lesson state, so it adds zero
latency and never disagrees with the anchor.

Precedence (most-urgent first) mirrors the anchor's own ⚡ DO NOW ladder so the chosen agent
and the on-screen imperative always agree:
  1. end_allowed / closing stage / student asks to end  → Summarizer (the only closer)
  2. quiz window open and no quiz yet                    → Practitioner (sets the one quiz)
  3. otherwise                                           → the phase's agent (recap/teach/practice/review)
"""
from __future__ import annotations

import logging
from typing import Optional

from app.services.agent_roles.roles import (
    RoleSpec, SUMMARIZER, PRACTITIONER, role_for_phase,
)

logger = logging.getLogger(__name__)

_END_INTENT = ("end the lesson", "finish the lesson", "i'm done", "im done", "stop the lesson",
               "that's all", "end lesson", "we're done", "were done", "bye")


def select_role(
    *,
    phase: Optional[str],
    end_allowed: bool = False,
    closing_stage: bool = False,
    quiz_phase: bool = False,
    quiz_done: bool = False,
    intent_text: Optional[str] = None,
    event_kind: str = "user_message",
) -> RoleSpec:
    """Pick the active agent for THIS turn from lesson state. Pure + deterministic."""
    txt = (intent_text or "").lower()

    # 1) Closing — only the Summarizer may end, and it leads whenever the lesson is ending,
    #    is in its closing stage, or the student explicitly asks to stop.
    if end_allowed or closing_stage or event_kind == "lesson_end_request" \
            or any(k in txt for k in _END_INTENT):
        return SUMMARIZER

    # 2) A maths puzzle's LaTeX was rejected by the client → the Practitioner owns the puzzle
    #    tools, so it must be the one to re-emit a corrected puzzle (validate → fix → retry).
    if event_kind == "latex_error":
        return PRACTITIONER

    # 3) Quiz window open and not yet done → the Practitioner sets the single quiz.
    if quiz_phase and not quiz_done:
        return PRACTITIONER

    # 4) Phase-driven default. The Intro agent is MERGED into the Teacher, so the recap phase now
    #    routes to the Teacher too (it opens with one brief welcome, then teaches) — no separate
    #    greeter re-introducing for the whole recap phase (the "7 warm-ups in a row" bug).
    #    (recap→Teacher, teach→Teacher, practice→Practitioner, quiz→Practitioner, review→Summarizer.)
    return role_for_phase(phase)


def log_selection(appt_id: int, role: RoleSpec, phase: Optional[str]) -> None:
    logger.info("NAVIGATOR appt=%s phase=%s → agent=%s tools=%s",
                appt_id, phase, role.name, list(role.tool_groups))
