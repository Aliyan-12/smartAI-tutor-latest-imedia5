"""
memory.py — cross-lesson memory for the AI tutor.

The coverage ledger ([[coverage_ledger]]) and the session report already record, PER lesson,
what was taught/asked/played (`LessonPlan.session_state["ledger"]`) and how the student did
(`LessonPlan.session_summary` JSON: weak/strong areas, understanding, quiz %, next-step). Both
are persisted in the DB and a finished lesson is marked `LessonPlan.status="completed"`.

This module AGGREGATES a student's *completed* prior lessons into a compact "memory brief" so a
NEW lesson can adapt its OBJECTIVE (not its structure): re-drill the areas they were weak on,
move faster through their strengths, vary the puzzle kinds, and — when they re-take the SAME
subtopic — pick up where the last one left off instead of repeating it.

Two consumers:
  • `build_session_system_prompt` injects `render_memory_brief(...)` at the top of the prompt so
    EVERY agent teaches to the student's history automatically.
  • the `recall_lesson_history` platform tool returns `summary_text(...)` on demand.
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# How many past lessons to look back over. Plenty for a real student, bounded so the query and
# the rendered block stay small.
_LOOKBACK = 15


def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _load_report(session_summary: Optional[str]) -> dict:
    if not session_summary:
        return {}
    try:
        r = json.loads(session_summary)
        return r if isinstance(r, dict) else {}
    except Exception:
        return {}


def _load_ledger(session_state: Optional[dict]) -> dict:
    if not isinstance(session_state, dict):
        return {}
    led = session_state.get("ledger")
    return led if isinstance(led, dict) else {}


def _as_list(v: Any) -> List[str]:
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if isinstance(v, dict):
        return [str(k).strip() for k in v.keys() if str(k).strip()]
    if isinstance(v, str) and v.strip():
        return [v.strip()]
    return []


async def build_memory_brief(
    db: AsyncSession,
    student_id: int,
    subject: str,
    unit_title: Optional[str],
    current_subtopic: Optional[str],
    exclude_appointment_id: Optional[int],
) -> Dict[str, Any]:
    """Aggregate the student's COMPLETED prior lessons in this subject into a memory brief.

    Never raises — a memory lookup must never break a lesson; on any error it returns an empty
    brief and the lesson runs exactly as it would with no history.
    """
    empty = {"has_history": False}
    try:
        from app.models.lesson_plan import LessonPlan
        from app.models.appointment import Appointment
        rows = (await db.execute(
            select(LessonPlan)
            .join(Appointment, Appointment.id == LessonPlan.appointment_id)
            .where(
                LessonPlan.student_id == student_id,
                LessonPlan.status == "completed",
                Appointment.subject == subject,
                Appointment.id != (exclude_appointment_id or -1),
            )
            .order_by(LessonPlan.created_at.desc())
            .limit(_LOOKBACK)
        )).scalars().all()
    except Exception:
        logger.warning("lesson-memory lookup failed student=%s subject=%s", student_id, subject,
                       exc_info=True)
        return empty

    if not rows:
        return empty

    unit_n = _norm(unit_title)
    cur_sub = _norm(current_subtopic)

    subject_lessons = len(rows)
    unit_rows = [p for p in rows if _norm(p.unit_name) == unit_n] if unit_n else rows

    subtopics_done: List[str] = []
    weak_counter: Counter = Counter()
    strong_counter: Counter = Counter()
    quiz_scores: List[float] = []
    puzzle_kinds: Counter = Counter()
    puzzle_missed: Counter = Counter()
    last_reco = ""
    last_understanding = ""
    same_subtopic: Optional[Dict[str, Any]] = None

    # rows are newest-first; the FIRST unit row we see is the most recent.
    for p in unit_rows:
        report = _load_report(getattr(p, "session_summary", None))
        # Prefer the durable per-lesson snapshot; fall back to the live session_state ledger for
        # lessons that completed before the `coverage` column existed.
        _cov = getattr(p, "coverage", None)
        ledger = _cov if isinstance(_cov, dict) else _load_ledger(getattr(p, "session_state", None))
        sub = (p.subtopic or "").strip()
        if sub and sub.lower() not in {s.lower() for s in subtopics_done}:
            subtopics_done.append(sub)

        for w in _as_list(report.get("weak_areas")):
            weak_counter[w] += 1
        for s in _as_list(report.get("strong_areas")):
            strong_counter[s] += 1
        qs = report.get("quiz_score_percent")
        if isinstance(qs, (int, float)):
            quiz_scores.append(float(qs))

        for pk in _as_list(ledger.get("puzzles_done")):
            puzzle_kinds[pk.split(":")[0]] += 1
        for po in _as_list(ledger.get("puzzle_outcomes")):
            k, _, res = po.partition(":")
            if res == "wrong":
                puzzle_missed[k] += 1

        if not last_reco:
            last_reco = (report.get("next_session_recommendation") or "").strip()
        if not last_understanding:
            last_understanding = (report.get("understanding_level") or "").strip()

        # The re-taken-subtopic case: this student has done THIS EXACT subtopic before.
        if cur_sub and _norm(sub) == cur_sub and same_subtopic is None:
            same_subtopic = {
                "subtopic": sub,
                "understanding": (report.get("understanding_level") or "").strip(),
                "weak_areas": _as_list(report.get("weak_areas")),
                "summary": (report.get("summary") or "").strip(),
                "recommendation": (report.get("next_session_recommendation") or "").strip(),
                "quiz_score": report.get("quiz_score_percent"),
            }

    avg_quiz = round(sum(quiz_scores) / len(quiz_scores), 0) if quiz_scores else None

    return {
        "has_history": True,
        "subject": subject,
        "unit_title": unit_title or "",
        "subject_lessons": subject_lessons,
        "unit_lessons": len(unit_rows),
        "subtopics_done": subtopics_done,
        "weak_areas": [w for w, _ in weak_counter.most_common(6)],
        "strong_areas": [s for s, _ in strong_counter.most_common(6)],
        "avg_quiz": avg_quiz,
        "last_recommendation": last_reco,
        "last_understanding": last_understanding,
        "puzzle_kinds_used": [k for k, _ in puzzle_kinds.most_common(8)],
        "puzzle_kinds_missed": [k for k, _ in puzzle_missed.most_common(6)],
        "same_subtopic": same_subtopic,
    }


def render_memory_brief(brief: Dict[str, Any]) -> str:
    """The high-priority block injected into the system prompt. '' when there's no usable history."""
    if not brief or not brief.get("has_history"):
        return ""
    lines: List[str] = [
        "🧠 LESSON MEMORY — ADAPT THE OBJECTIVE (keep the SAME lesson structure; only the FOCUS "
        "changes based on this student's past lessons):",
    ]
    unit = brief.get("unit_title")
    scope = f" on \"{unit}\"" if unit else ""
    lines.append(
        f"• This student has completed {brief['unit_lessons']} prior lesson(s){scope} "
        f"({brief['subject_lessons']} in {brief['subject']} overall)."
    )
    if brief.get("subtopics_done"):
        lines.append("• Subtopics already covered: " + ", ".join(brief["subtopics_done"][:8]) + ".")
    if brief.get("weak_areas"):
        lines.append(
            "• They were WEAK on: " + ", ".join(brief["weak_areas"])
            + " → spend MORE time here, re-drill these, and check they've truly got them THIS time."
        )
    if brief.get("strong_areas"):
        lines.append(
            "• They were STRONG on: " + ", ".join(brief["strong_areas"])
            + " → move briskly through these; don't over-explain what they already know."
        )
    if brief.get("avg_quiz") is not None:
        lines.append(f"• Average past quiz score: {int(brief['avg_quiz'])}% "
                     f"(understanding last time: {brief.get('last_understanding') or 'n/a'}).")
    if brief.get("last_recommendation"):
        lines.append(f"• Last lesson's recommended next step: \"{brief['last_recommendation']}\".")
    if brief.get("puzzle_kinds_used"):
        lines.append(
            "• Puzzle kinds already used with them: " + ", ".join(brief["puzzle_kinds_used"])
            + " → pick DIFFERENT kinds so practice stays fresh"
            + (", but DO revisit " + ", ".join(brief["puzzle_kinds_missed"]) + " (they got those wrong)."
               if brief.get("puzzle_kinds_missed") else ".")
        )
    ss = brief.get("same_subtopic")
    if ss:
        detail = f" (they scored {int(ss['quiz_score'])}% / {ss.get('understanding') or 'n/a'})" \
            if isinstance(ss.get("quiz_score"), (int, float)) else \
            (f" ({ss.get('understanding')})" if ss.get("understanding") else "")
        weak = ", ".join(ss.get("weak_areas") or []) or "the parts they found hard"
        lines.append(
            f"⚠️ THEY HAVE TAKEN THIS EXACT SUBTOPIC BEFORE{detail}. Do NOT just repeat it — quickly "
            f"confirm what they remember, then re-teach and push further on: {weak}."
        )
    lines.append(
        "So: run the normal lesson flow, but make the PRIMARY objective mastering their weak "
        "areas and building on their strengths — do not re-teach mastered material from scratch."
    )
    return "\n".join(lines)


def summary_text(brief: Dict[str, Any]) -> str:
    """Plain-text version returned by the recall_lesson_history tool."""
    if not brief or not brief.get("has_history"):
        return ("No completed prior lessons on record for this student in this subject — treat this "
                "as a fresh start and teach the topic from the beginning.")
    parts = [
        f"{brief['unit_lessons']} prior lesson(s) on this unit, {brief['subject_lessons']} in "
        f"{brief['subject']} total.",
    ]
    if brief.get("subtopics_done"):
        parts.append("Subtopics covered: " + ", ".join(brief["subtopics_done"][:10]) + ".")
    if brief.get("weak_areas"):
        parts.append("Weak on: " + ", ".join(brief["weak_areas"]) + ".")
    if brief.get("strong_areas"):
        parts.append("Strong on: " + ", ".join(brief["strong_areas"]) + ".")
    if brief.get("avg_quiz") is not None:
        parts.append(f"Avg quiz {int(brief['avg_quiz'])}%.")
    if brief.get("last_recommendation"):
        parts.append("Last recommended next step: " + brief["last_recommendation"])
    if brief.get("puzzle_kinds_used"):
        parts.append("Puzzle kinds already used: " + ", ".join(brief["puzzle_kinds_used"]) + ".")
    if brief.get("same_subtopic"):
        parts.append("NOTE: this exact subtopic was taken before — re-drill its weak points, don't repeat.")
    parts.append("Start the new lesson aimed at the weak areas above; go faster on strengths.")
    return " ".join(parts)
