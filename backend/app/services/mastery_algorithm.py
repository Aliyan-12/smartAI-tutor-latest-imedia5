"""Evidence-based mastery algorithm (pure + deterministic + versioned).

This module contains NO database or LLM calls: it maps a list of evidence records to a
mastery result. Because it is pure, identical evidence always yields an identical result
(a key acceptance criterion) and it is unit-testable without any infrastructure — run
`python -m app.services.mastery_algorithm` for the built-in scenarios.

Design (documented, bounded):
- Each piece of evidence is weighted by reliability × recency × difficulty.
- Reliability: exact evaluators (puzzles, auto-marked quizzes) outweigh free-form LLM
  grading, which outweighs self-report. LLM judgement is evidence, not absolute truth.
- Recency: evidence decays with a half-life so stale results fade gradually.
- Difficulty: harder evidence counts for more.
- Performance = weighted mean of (hint-adjusted) scores.
- Confidence is SEPARATE from performance and grows with the amount of reliable, recent,
  independent evidence across distinct sessions. Sparse data => low confidence.
- A low-confidence topic is capped below 'secure'/'mastered' so sparse data can't falsely
  show mastery. A single anomalous score can't tank mastery (weighted mean + a trend, not a
  single dip, triggers needs_review).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

MASTERY_ALGORITHM_VERSION = "1.0"
EVIDENCE_SCHEMA_VERSION = "1.0"

# Tunables (documented).
HALF_LIFE_DAYS = 30.0          # recency half-life
CONFIDENCE_MASS_K = 2.0        # weight-mass at which confidence ~ 0.63
MIN_EVIDENCE_FOR_SECURE = 3
MIN_EVIDENCE_FOR_MASTERY = 4
MIN_SESSIONS_FOR_MASTERY = 2
SPARSE_CONFIDENCE = 0.4        # below this, cap at 'developing'
STALE_DAYS = 75.0              # older-than-this best evidence => needs_review nudge

STATES = ["not_started", "emerging", "developing", "secure", "mastered", "needs_review"]

# Default reliability per evaluator/source type. Exact evaluators are the most trustworthy.
RELIABILITY = {
    "puzzle_exact": 1.0,
    "quiz_exact": 0.9,
    "assignment": 0.8,
    "objective_completion": 0.7,
    "llm_open": 0.6,
    "self_report": 0.3,
}


@dataclass
class Evidence:
    normalized_score: float              # 0..1
    evaluator_type: str = "llm_open"
    difficulty: float = 0.5              # 0..1
    age_days: float = 0.0
    hints_used: int = 0
    session_id: Any = None
    reliability: float | None = None     # override; else derived from evaluator_type

    def rel(self) -> float:
        if self.reliability is not None:
            return _clip(self.reliability, 0.0, 1.0)
        return RELIABILITY.get(self.evaluator_type, 0.6)


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _recency_factor(age_days: float) -> float:
    age = max(0.0, age_days)
    return 0.5 ** (age / HALF_LIFE_DAYS)


def _difficulty_factor(difficulty: float) -> float:
    # 0.7 (easy) .. 1.3 (hard)
    return 0.7 + 0.6 * _clip(difficulty, 0.0, 1.0)


def _hint_adjust(score: float, hints_used: int) -> float:
    # up to a 30% haircut for heavy hinting; bounded.
    return _clip(score * (1.0 - 0.1 * min(max(hints_used, 0), 3)), 0.0, 1.0)


def compute_mastery(evidence: List[Evidence]) -> Dict[str, Any]:
    """Map evidence -> mastery result. Deterministic and pure."""
    if not evidence:
        return {
            "state": "not_started", "performance": 0.0, "confidence": 0.0,
            "evidence_count": 0, "effective_evidence": 0.0, "distinct_sessions": 0,
            "algorithm_version": MASTERY_ALGORITHM_VERSION,
            "breakdown": {"reason": "No learning activities recorded yet."},
        }

    weights: List[float] = []
    contribs: List[float] = []
    for e in evidence:
        w = e.rel() * _recency_factor(e.age_days) * _difficulty_factor(e.difficulty)
        weights.append(w)
        contribs.append(w * _hint_adjust(_clip(e.normalized_score, 0.0, 1.0), e.hints_used))

    total_w = sum(weights)
    performance = (sum(contribs) / total_w) if total_w > 0 else 0.0

    # Confidence from effective (decayed, reliability-scaled) evidence mass, discounted when
    # all evidence comes from a single session (not independent).
    distinct_sessions = len({e.session_id for e in evidence if e.session_id is not None}) or 1
    diversity = _clip(0.6 + 0.4 * min(distinct_sessions, 3) / 3.0, 0.0, 1.0)
    confidence = (1.0 - 0.5 ** (total_w / CONFIDENCE_MASS_K)) * diversity
    confidence = _clip(confidence, 0.0, 1.0)

    state = _state(evidence, performance, confidence, distinct_sessions)

    return {
        "state": state,
        "performance": round(performance, 4),
        "confidence": round(confidence, 4),
        "evidence_count": len(evidence),
        "effective_evidence": round(total_w, 4),
        "distinct_sessions": distinct_sessions,
        "algorithm_version": MASTERY_ALGORITHM_VERSION,
        "breakdown": _explain(evidence, performance, confidence, state, total_w, distinct_sessions),
    }


def _recent_trend(evidence: List[Evidence]) -> float:
    """Signed trend: mean of the 3 most-recent hint-adjusted scores minus the mean of the
    older ones. Negative => declining. Uses recency (age) to order."""
    ordered = sorted(evidence, key=lambda e: e.age_days)  # freshest first
    recent = ordered[:3]
    older = ordered[3:]
    if not older:
        return 0.0
    rm = sum(_hint_adjust(e.normalized_score, e.hints_used) for e in recent) / len(recent)
    om = sum(_hint_adjust(e.normalized_score, e.hints_used) for e in older) / len(older)
    return rm - om


def _state(evidence: List[Evidence], performance: float, confidence: float, sessions: int) -> str:
    n = len(evidence)
    freshest_age = min(e.age_days for e in evidence)
    trend = _recent_trend(evidence)

    # Needs review: a genuine decline (not one dip) OR previously-known topic gone stale.
    if trend <= -0.2 and performance < 0.7:
        return "needs_review"
    if freshest_age > STALE_DAYS and performance >= 0.5:
        return "needs_review"

    # Sparse data can't claim secure/mastered.
    capped = confidence < SPARSE_CONFIDENCE

    if not capped and performance >= 0.85 and confidence >= 0.7 \
            and n >= MIN_EVIDENCE_FOR_MASTERY and sessions >= MIN_SESSIONS_FOR_MASTERY:
        return "mastered"
    if not capped and performance >= 0.70 and confidence >= 0.5 and n >= MIN_EVIDENCE_FOR_SECURE:
        return "secure"
    if performance >= 0.50:
        return "developing"
    return "emerging"


def _explain(evidence, performance, confidence, state, total_w, sessions) -> Dict[str, Any]:
    by_type: Dict[str, int] = {}
    for e in evidence:
        by_type[e.evaluator_type] = by_type.get(e.evaluator_type, 0) + 1
    notes: List[str] = []
    notes.append(f"Based on {len(evidence)} activities across {sessions} session(s).")
    if confidence < SPARSE_CONFIDENCE:
        notes.append("Limited evidence so far — do a bit more to confirm mastery.")
    if state == "needs_review":
        notes.append("Recent results dipped or the topic has gone stale — worth a review.")
    if any(e.evaluator_type in ("puzzle_exact", "quiz_exact") for e in evidence):
        notes.append("Includes exactly-marked activities (weighted more heavily).")
    return {
        "performance_pct": round(performance * 100),
        "confidence_pct": round(confidence * 100),
        "evidence_by_type": by_type,
        "notes": notes,
    }


# ── built-in scenario tests (run: python -m app.services.mastery_algorithm) ──
def _selftest() -> None:
    def E(**kw):
        return Evidence(**kw)

    # 1) No evidence -> not_started
    r = compute_mastery([])
    assert r["state"] == "not_started", r

    # 2) One high LLM score -> NOT mastered (sparse) — must not falsely show mastery.
    r = compute_mastery([E(normalized_score=1.0, evaluator_type="llm_open")])
    assert r["state"] in ("developing", "emerging"), r
    assert r["confidence"] < SPARSE_CONFIDENCE, r

    # 3) Determinism: identical evidence -> identical result.
    ev = [E(normalized_score=0.9, evaluator_type="quiz_exact", session_id=1, age_days=1),
          E(normalized_score=0.85, evaluator_type="puzzle_exact", session_id=2, age_days=2)]
    assert compute_mastery(ev) == compute_mastery(list(ev)), "not deterministic"

    # 4) Strong, diverse, recent exact evidence -> mastered.
    ev = [E(normalized_score=0.95, evaluator_type="puzzle_exact", session_id=1, age_days=1, difficulty=0.7),
          E(normalized_score=0.9, evaluator_type="quiz_exact", session_id=2, age_days=2, difficulty=0.6),
          E(normalized_score=0.9, evaluator_type="quiz_exact", session_id=2, age_days=2, difficulty=0.6),
          E(normalized_score=0.92, evaluator_type="puzzle_exact", session_id=3, age_days=3, difficulty=0.6)]
    r = compute_mastery(ev)
    assert r["state"] == "mastered", r

    # 5) One anomalous low score among many good ones must NOT destroy mastery.
    ev2 = ev + [E(normalized_score=0.1, evaluator_type="llm_open", session_id=3, age_days=1)]
    r2 = compute_mastery(ev2)
    assert r2["state"] in ("mastered", "secure"), r2

    # 6) Duplicates handled by the service, but a sustained decline -> needs_review.
    ev3 = [E(normalized_score=0.9, evaluator_type="quiz_exact", session_id=1, age_days=40),
           E(normalized_score=0.9, evaluator_type="quiz_exact", session_id=1, age_days=38),
           E(normalized_score=0.3, evaluator_type="quiz_exact", session_id=4, age_days=1),
           E(normalized_score=0.35, evaluator_type="quiz_exact", session_id=5, age_days=0)]
    assert compute_mastery(ev3)["state"] == "needs_review", compute_mastery(ev3)

    print("mastery_algorithm self-test: all scenarios passed ✓")


if __name__ == "__main__":
    _selftest()
