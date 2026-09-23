"""Deterministic unit tests for the mastery algorithm (feature 11).

Pure — no DB or network — so they run anywhere pytest is available:
    pytest backend/tests/test_mastery_algorithm.py
The same scenarios also run via `python -m app.services.mastery_algorithm`.
"""
from app.services.mastery_algorithm import Evidence, compute_mastery, SPARSE_CONFIDENCE


def _e(**kw):
    return Evidence(**kw)


def test_no_evidence_is_not_started():
    assert compute_mastery([])["state"] == "not_started"


def test_single_score_is_not_falsely_mastered():
    r = compute_mastery([_e(normalized_score=1.0, evaluator_type="llm_open")])
    assert r["state"] in ("emerging", "developing")
    assert r["confidence"] < SPARSE_CONFIDENCE


def test_identical_evidence_is_deterministic():
    ev = [_e(normalized_score=0.9, evaluator_type="quiz_exact", session_id=1, age_days=1),
          _e(normalized_score=0.85, evaluator_type="puzzle_exact", session_id=2, age_days=2)]
    assert compute_mastery(ev) == compute_mastery(list(ev))


def test_strong_diverse_recent_exact_evidence_is_mastered():
    ev = [_e(normalized_score=0.95, evaluator_type="puzzle_exact", session_id=1, age_days=1, difficulty=0.7),
          _e(normalized_score=0.9, evaluator_type="quiz_exact", session_id=2, age_days=2, difficulty=0.6),
          _e(normalized_score=0.9, evaluator_type="quiz_exact", session_id=2, age_days=2, difficulty=0.6),
          _e(normalized_score=0.92, evaluator_type="puzzle_exact", session_id=3, age_days=3, difficulty=0.6)]
    assert compute_mastery(ev)["state"] == "mastered"


def test_single_anomaly_does_not_destroy_mastery():
    ev = [_e(normalized_score=0.95, evaluator_type="puzzle_exact", session_id=1, age_days=1, difficulty=0.7),
          _e(normalized_score=0.9, evaluator_type="quiz_exact", session_id=2, age_days=2, difficulty=0.6),
          _e(normalized_score=0.9, evaluator_type="quiz_exact", session_id=2, age_days=2, difficulty=0.6),
          _e(normalized_score=0.92, evaluator_type="puzzle_exact", session_id=3, age_days=3, difficulty=0.6),
          _e(normalized_score=0.1, evaluator_type="llm_open", session_id=3, age_days=1)]
    assert compute_mastery(ev)["state"] in ("mastered", "secure")


def test_sustained_decline_needs_review():
    ev = [_e(normalized_score=0.9, evaluator_type="quiz_exact", session_id=1, age_days=40),
          _e(normalized_score=0.9, evaluator_type="quiz_exact", session_id=1, age_days=38),
          _e(normalized_score=0.3, evaluator_type="quiz_exact", session_id=4, age_days=1),
          _e(normalized_score=0.35, evaluator_type="quiz_exact", session_id=5, age_days=0)]
    assert compute_mastery(ev)["state"] == "needs_review"
