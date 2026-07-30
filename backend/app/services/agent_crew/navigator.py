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

from app.services.agent_crew.roles import (
    RoleSpec, SUMMARIZER, PRACTITIONER, TEACHER, role_for_phase,
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
    recap_done: bool = False,
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

    # 4) Recap is a SINGLE hand-off turn. Once it's done, don't keep the Intro agent re-greeting
    #    for the rest of the recap phase (the "7 warm-ups in a row" bug) — move to teaching.
    if (phase or "").lower() == "recap" and recap_done:
        return TEACHER

    # 5) Phase-driven default (recap→Intro, teach→Teacher, practice→Practitioner, review→Summarizer).
    return role_for_phase(phase)


def log_selection(appt_id: int, role: RoleSpec, phase: Optional[str]) -> None:
    logger.info("NAVIGATOR appt=%s phase=%s → agent=%s tools=%s",
                appt_id, phase, role.name, list(role.tool_groups))


# The Navigator's scope reinforcement, injected at the TOP of every agent's task so it can't
# drift out of its remit. This is the "Navigator corrects/guides a sub-agent that tries to get
# out of scope" — done as a per-turn instruction (no extra LLM call, so it never adds latency or
# alters the agent's streamed answer).
_SCOPE_GUARD = {
    "intro": "You are the RECAP agent — a brief reconnection ONLY. Do NOT launch into full "
             "teaching, do NOT quiz, do NOT close the lesson. Hand over to teaching quickly.",
    "teacher": "You are the TEACHER — TEACH the slide/concept on screen, ONE idea, with one "
               "visual. Do NOT drill, do NOT quiz, do NOT say goodbye. If you feel pulled "
               "off-task, come straight back to teaching what is on the current slide.",
    "practitioner": "You are the PRACTICE COACH — make the student DO what was already taught "
                    "(see the covered list). Do NOT re-teach from scratch, do NOT re-ask a "
                    "covered question, do NOT close the lesson. Set the ONE quiz only inside the "
                    "quiz window.",
    "summarizer": "You are the SUMMARISER — a concise, specific recap + the report + one next "
                  "step. This is the ONLY place a sign-off belongs.",
}


def reinforce(role: RoleSpec) -> str:
    """The Navigator's one-line scope reinforcement for the active agent this turn."""
    guard = _SCOPE_GUARD.get(role.name, "")
    return f"🧭 NAVIGATOR (stay in scope): {guard}" if guard else ""
