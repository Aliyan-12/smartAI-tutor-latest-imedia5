"""Mastery engine persistence layer. Records evidence (deduped), recomputes TopicMastery
via the pure algorithm, explains scores, recommends next topics, and backfills from the
legacy score history. All deterministic scoring lives in mastery_algorithm."""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select, desc
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.mastery import MasteryEvidence
from app.models.student_profile import TopicMastery
from app.services import mastery_algorithm as algo

logger = logging.getLogger(__name__)

# Map a source_type to the default evaluator reliability bucket.
_EVALUATOR_FOR_SOURCE = {
    "puzzle": "puzzle_exact",
    "quiz": "quiz_exact",
    "assignment": "assignment",
    "objective": "objective_completion",
    "open_answer": "llm_open",
    "practice": "llm_open",
    "self_report": "self_report",
}


def _age_days(ts: datetime) -> float:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - ts).total_seconds() / 86400.0)


async def record_evidence(
    db: AsyncSession, *, student: User, subject: str, key_stage: str, topic: str,
    source_type: str, source_id: str, score: float, max_score: float = 1.0,
    evaluator_type: Optional[str] = None, difficulty: float = 0.5, hints_used: int = 0,
    attempts: int = 1, session_id: Optional[str] = None, subtopic: Optional[str] = None,
    year_group: Optional[str] = None, misconception_tags: Optional[List[str]] = None,
    provenance: Optional[Dict[str, Any]] = None, recompute: bool = True,
) -> Optional[MasteryEvidence]:
    """Insert one evidence row (idempotent on student+source_type+source_id) and recompute
    the topic. A replayed submission (same source id) is ignored — no double-counting."""
    if not topic or not subject:
        return None
    normalized = 0.0
    if max_score and max_score > 0:
        normalized = max(0.0, min(1.0, float(score) / float(max_score)))
    # Dedup pre-check: a replayed submission (same source id) is ignored — no double-count.
    src = str(source_id)
    exists = await db.scalar(select(MasteryEvidence.id).where(
        MasteryEvidence.student_id == student.id,
        MasteryEvidence.source_type == source_type,
        MasteryEvidence.source_id == src))
    if exists is not None:
        return None

    ev = MasteryEvidence(
        student_id=student.id, school_id=getattr(student, "school_id", None),
        subject=subject, key_stage=key_stage or "", year_group=year_group, topic=topic,
        subtopic=subtopic, source_type=source_type, source_id=src,
        evaluator_type=evaluator_type or _EVALUATOR_FOR_SOURCE.get(source_type, "llm_open"),
        score=score, max_score=max_score, normalized_score=normalized,
        difficulty=max(0.0, min(1.0, difficulty)), hints_used=max(0, hints_used),
        attempts=max(1, attempts), session_id=session_id,
        misconception_tags=misconception_tags or [], provenance=provenance or {},
        schema_version=algo.EVIDENCE_SCHEMA_VERSION,
    )
    try:
        # A SAVEPOINT so a rare concurrent-insert conflict rolls back only this row.
        async with db.begin_nested():
            db.add(ev)
            await db.flush()
    except IntegrityError:
        logger.info("MASTERY evidence duplicate skipped source=%s/%s", source_type, src)
        return None
    if recompute:
        await recompute_topic(db, student.id, subject, topic, key_stage)
    return ev


async def _topic_evidence(db: AsyncSession, student_id: int, subject: str, topic: str) -> List[MasteryEvidence]:
    res = await db.execute(select(MasteryEvidence).where(
        MasteryEvidence.student_id == student_id, MasteryEvidence.subject == subject,
        MasteryEvidence.topic == topic).order_by(desc(MasteryEvidence.created_at)))
    return list(res.scalars().all())


async def recompute_topic(db: AsyncSession, student_id: int, subject: str, topic: str,
                          key_stage: str = "") -> Optional[TopicMastery]:
    rows = await _topic_evidence(db, student_id, subject, topic)
    evidence = [algo.Evidence(
        normalized_score=r.normalized_score, evaluator_type=r.evaluator_type,
        difficulty=r.difficulty, age_days=_age_days(r.created_at),
        hints_used=r.hints_used, session_id=r.session_id) for r in rows]
    result = algo.compute_mastery(evidence)

    res = await db.execute(select(TopicMastery).where(
        TopicMastery.student_id == student_id, TopicMastery.subject == subject,
        TopicMastery.topic == topic))
    tm = res.scalar_one_or_none()
    if tm is None:
        tm = TopicMastery(student_id=student_id, subject=subject, key_stage=key_stage or "",
                          topic=topic, mastery_level="not_started")
        db.add(tm)
    tm.state = result["state"]
    tm.performance = result["performance"]
    tm.confidence = result["confidence"]
    tm.evidence_count = result["evidence_count"]
    tm.algorithm_version = result["algorithm_version"]
    tm.last_computed_at = datetime.now(timezone.utc)
    # Keep the legacy label roughly in sync for older readers.
    tm.mastery_level = {"mastered": "mastered", "secure": "mastered", "developing": "practicing",
                        "emerging": "learning", "needs_review": "practicing",
                        "not_started": "not_started"}.get(result["state"], "learning")
    await db.flush()
    return tm


async def topic_breakdown(db: AsyncSession, student_id: int, subject: str, topic: str) -> Dict[str, Any]:
    rows = await _topic_evidence(db, student_id, subject, topic)
    evidence = [algo.Evidence(
        normalized_score=r.normalized_score, evaluator_type=r.evaluator_type,
        difficulty=r.difficulty, age_days=_age_days(r.created_at),
        hints_used=r.hints_used, session_id=r.session_id) for r in rows]
    result = algo.compute_mastery(evidence)
    result["evidence"] = [{
        "source_type": r.source_type, "evaluator_type": r.evaluator_type,
        "normalized_score": round(r.normalized_score, 3), "difficulty": r.difficulty,
        "hints_used": r.hints_used, "when": r.created_at,
    } for r in rows[:20]]
    return result


async def mastery_overview(db: AsyncSession, student_id: int) -> List[TopicMastery]:
    res = await db.execute(select(TopicMastery).where(TopicMastery.student_id == student_id)
                           .order_by(desc(TopicMastery.last_computed_at)))
    return list(res.scalars().all())


async def recommend_next(db: AsyncSession, student_id: int, limit: int = 5) -> List[Dict[str, Any]]:
    """Recommend topics to work on: anything needing review first, then still-developing
    topics with the lowest performance. (Curriculum-graph expansion can layer on later.)"""
    topics = await mastery_overview(db, student_id)
    scored: List[Dict[str, Any]] = []
    for t in topics:
        priority = {"needs_review": 0, "emerging": 1, "developing": 2, "secure": 4, "mastered": 5,
                    "not_started": 3}.get(t.state, 3)
        scored.append({
            "subject": t.subject, "topic": t.topic, "state": t.state,
            "performance": float(t.performance or 0), "confidence": float(t.confidence or 0),
            "reason": "Needs review" if t.state == "needs_review" else
                      "Keep practising" if t.state in ("emerging", "developing") else "Strengthen further",
            "_priority": (priority, float(t.performance or 0)),
        })
    scored.sort(key=lambda x: x["_priority"])
    for s in scored:
        s.pop("_priority", None)
    return [s for s in scored if s["state"] in ("needs_review", "emerging", "developing")][:limit]


async def ensure_backfilled(db: AsyncSession, student_id: int) -> None:
    """Make history-based mastery dynamic: if a student has legacy TopicMastery history but
    no evidence rows yet, seed evidence once (idempotent). This means the evidence engine
    lights up automatically on first view — no manual 'build from history' step required."""
    from app.models.mastery import MasteryEvidence
    has_evidence = await db.scalar(
        select(MasteryEvidence.id).where(MasteryEvidence.student_id == student_id).limit(1))
    if has_evidence is not None:
        return
    has_history = await db.scalar(
        select(TopicMastery.id).where(TopicMastery.student_id == student_id).limit(1))
    if has_history is None:
        return
    student = await db.get(User, student_id)
    if student is not None:
        await backfill_student(db, student)


async def engine_payload(db: AsyncSession, student_id: int) -> Dict[str, Any]:
    """The mastery-engine overview payload for a student — reused by the student's own view
    and by authorised parent/teacher views. Auto-seeds evidence from history on first view."""
    await ensure_backfilled(db, student_id)
    topics = await mastery_overview(db, student_id)
    recs = await recommend_next(db, student_id)
    return {
        "algorithm_version": algo.MASTERY_ALGORITHM_VERSION,
        "topics": [{
            "subject": t.subject, "key_stage": t.key_stage, "topic": t.topic,
            "state": t.state, "performance": float(t.performance or 0),
            "confidence": float(t.confidence or 0), "evidence_count": t.evidence_count,
            "last_computed_at": t.last_computed_at,
        } for t in topics],
        "recommendations": recs,
    }


async def backfill_student(db: AsyncSession, student: User) -> int:
    """Seed evidence from a student's legacy TopicMastery.score_history, then recompute.
    Idempotent — re-running won't duplicate (unique source id per history entry)."""
    res = await db.execute(select(TopicMastery).where(TopicMastery.student_id == student.id))
    created = 0
    for tm in res.scalars().all():
        history = tm.score_history or []
        for i, entry in enumerate(history):
            if "score" not in entry:
                continue
            raw = float(entry["score"])
            normalized = raw / 100.0 if raw > 1 else raw
            ev = await record_evidence(
                db, student=student, subject=tm.subject, key_stage=tm.key_stage, topic=tm.topic,
                source_type="quiz", source_id=f"backfill:{tm.id}:{i}",
                evaluator_type="quiz_exact", score=normalized, max_score=1.0,
                provenance={"backfilled": True, "when": entry.get("date")}, recompute=False)
            if ev is not None:
                created += 1
        await recompute_topic(db, student.id, tm.subject, tm.topic, tm.key_stage)
    return created
