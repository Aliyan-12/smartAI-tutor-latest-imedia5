"""Server-side aggregations for the teacher class-progress tracker (feature 13).

Everything is scoped to the teacher's own school (administrators are cross-school). Data
is aggregated in the database/here — never by shipping thousands of raw events to the
browser."""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, ROLE_STUDENT, ROLE_ADMINISTRATOR
from app.models.student_profile import TopicMastery

logger = logging.getLogger(__name__)

INACTIVE_DAYS = 14


def _age_days(ts: Optional[datetime]) -> Optional[float]:
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts).total_seconds() / 86400.0


async def class_students(db: AsyncSession, teacher: User, limit: int = 200, offset: int = 0) -> List[User]:
    q = select(User).where(User.role == ROLE_STUDENT)
    if teacher.role != ROLE_ADMINISTRATOR:
        # Teachers/admins: only their own school. No cross-school data.
        if not teacher.school_id:
            return []
        q = q.where(User.school_id == teacher.school_id)
    q = q.order_by(User.name).limit(limit).offset(offset)
    return list((await db.execute(q)).scalars().all())


async def assert_can_view(db: AsyncSession, teacher: User, student_id: int) -> User:
    res = await db.execute(select(User).where(User.id == student_id, User.role == ROLE_STUDENT))
    student = res.scalar_one_or_none()
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found")
    if teacher.role != ROLE_ADMINISTRATOR and student.school_id != teacher.school_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This student is not in your school")
    return student


async def _mastery_by_student(db: AsyncSession, student_ids: List[int]) -> Dict[int, List[TopicMastery]]:
    if not student_ids:
        return {}
    res = await db.execute(select(TopicMastery).where(TopicMastery.student_id.in_(student_ids)))
    out: Dict[int, List[TopicMastery]] = {}
    for tm in res.scalars().all():
        out.setdefault(tm.student_id, []).append(tm)
    return out


def _student_summary(student: User, topics: List[TopicMastery]) -> Dict[str, Any]:
    active = [t for t in topics if (t.evidence_count or 0) > 0]
    perfs = [float(t.performance or 0) for t in active]
    avg = sum(perfs) / len(perfs) if perfs else 0.0
    needs_review = sum(1 for t in active if t.state == "needs_review")
    mastered = sum(1 for t in active if t.state in ("mastered", "secure"))
    last = max((t.last_computed_at or t.last_practiced_at for t in active
                if (t.last_computed_at or t.last_practiced_at)), default=None)
    last_age = _age_days(last)
    return {
        "id": student.id, "name": student.name,
        "avg_performance": round(avg, 3), "topics_tracked": len(active),
        "needs_review": needs_review, "mastered": mastered,
        "last_active": last, "inactive": last_age is None or last_age > INACTIVE_DAYS,
        "support_flag": needs_review > 0 or (len(active) >= 2 and avg < 0.5),
    }


async def class_overview(db: AsyncSession, teacher: User) -> Dict[str, Any]:
    students = await class_students(db, teacher)
    mastery = await _mastery_by_student(db, [s.id for s in students])

    rows = [_student_summary(s, mastery.get(s.id, [])) for s in students]
    distribution: Dict[str, int] = {}
    all_perfs: List[float] = []
    for s in students:
        for t in mastery.get(s.id, []):
            if (t.evidence_count or 0) > 0:
                distribution[t.state] = distribution.get(t.state, 0) + 1
                all_perfs.append(float(t.performance or 0))

    class_avg = round(sum(all_perfs) / len(all_perfs), 3) if all_perfs else 0.0
    needing_support = [r for r in rows if r["support_flag"]]
    inactive = [r for r in rows if r["inactive"] and r["topics_tracked"] > 0]
    improving = [r for r in rows if r["mastered"] > r["needs_review"] and r["topics_tracked"] > 0]

    return {
        "student_count": len(students),
        "class_avg_performance": class_avg,
        "mastery_distribution": distribution,
        "students": rows,
        "needing_support": [r["name"] for r in needing_support][:20],
        "inactive_students": [r["name"] for r in inactive][:20],
        "improving_students": [r["name"] for r in improving][:20],
    }


async def class_heatmap(db: AsyncSession, teacher: User, subject: Optional[str] = None,
                        max_students: int = 40, max_topics: int = 15) -> Dict[str, Any]:
    students = await class_students(db, teacher, limit=max_students)
    mastery = await _mastery_by_student(db, [s.id for s in students])

    # Pick the most common topics across the class (optionally within a subject).
    freq: Dict[str, int] = {}
    for tms in mastery.values():
        for t in tms:
            if subject and t.subject != subject:
                continue
            if (t.evidence_count or 0) > 0:
                freq[t.topic] = freq.get(t.topic, 0) + 1
    top_topics = [t for t, _ in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:max_topics]]

    cells = []
    for s in students:
        by_topic = {t.topic: t for t in mastery.get(s.id, [])}
        row = []
        for topic in top_topics:
            tm = by_topic.get(topic)
            row.append({
                "state": tm.state if tm else "not_started",
                "evidence_count": tm.evidence_count if tm else 0,
                "last_practiced": (tm.last_computed_at or tm.last_practiced_at) if tm else None,
            })
        cells.append({"student_id": s.id, "student_name": s.name, "cells": row})

    return {"topics": top_topics, "rows": cells}
