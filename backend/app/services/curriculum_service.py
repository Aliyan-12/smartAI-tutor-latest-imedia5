"""
curriculum_service.py — read API over the local Resource Hub mirror (rh_* tables).

Powers the new /api/curriculum endpoints and the repointed legacy /api/lessons
curriculum endpoints. Subjects honour the (key_stage, year_group) availability
edges and fall back to the global catalogue when the hub hasn't year-tagged a
subject yet.
"""
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resource_hub import (
    RHKeyStage, RHYearGroup, RHSubject, RHUnit, RHTopic, RHAvailability,
)


async def get_keystages(db: AsyncSession) -> List[str]:
    rows = (await db.execute(
        select(RHKeyStage.code).order_by(RHKeyStage.position, RHKeyStage.code)
    )).all()
    return [r[0] for r in rows]


async def get_years(db: AsyncSession, key_stage: Optional[str] = None) -> List[str]:
    q = select(RHYearGroup).order_by(RHYearGroup.key_stage_code, RHYearGroup.position)
    if key_stage:
        q = q.where(RHYearGroup.key_stage_code == key_stage)
    rows = (await db.execute(q)).scalars().all()
    return [r.name for r in rows]


async def get_subjects(
    db: AsyncSession, key_stage: Optional[str] = None, year_group: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Subjects for a (key_stage, year_group), falling back to the full catalogue."""
    if key_stage and year_group:
        q = (
            select(RHSubject)
            .join(RHAvailability, RHAvailability.subject_hub_id == RHSubject.hub_id)
            .where(
                RHAvailability.key_stage == key_stage,
                RHAvailability.year_group == year_group,
            )
            .distinct()
            .order_by(RHSubject.name)
        )
        rows = (await db.execute(q)).scalars().all()
        if rows:
            return [{"id": s.hub_id, "name": s.name} for s in rows]
    elif key_stage:
        q = (
            select(RHSubject)
            .join(RHAvailability, RHAvailability.subject_hub_id == RHSubject.hub_id)
            .where(RHAvailability.key_stage == key_stage)
            .distinct()
            .order_by(RHSubject.name)
        )
        rows = (await db.execute(q)).scalars().all()
        if rows:
            return [{"id": s.hub_id, "name": s.name} for s in rows]

    rows = (await db.execute(select(RHSubject).order_by(RHSubject.name))).scalars().all()
    return [{"id": s.hub_id, "name": s.name} for s in rows]


async def get_units(
    db: AsyncSession, subject_id: int,
    key_stage: Optional[str] = None, year_group: Optional[str] = None,
) -> List[Dict[str, Any]]:
    rows = (await db.execute(
        select(RHUnit).where(RHUnit.subject_hub_id == subject_id)
        .order_by(RHUnit.id)
    )).scalars().all()
    return [{"id": u.hub_id, "title": u.title, "unit_number": u.unit_number} for u in rows]


async def get_topics_by_unit(db: AsyncSession, unit_id: int) -> List[Dict[str, Any]]:
    rows = (await db.execute(
        select(RHTopic).where(RHTopic.unit_hub_id == unit_id)
        .order_by(RHTopic.position, RHTopic.id)
    )).scalars().all()
    return [{"id": t.hub_id, "title": t.title} for t in rows]


# ---------------------------------------------------------------------------
# Name-based helpers for the legacy /api/lessons curriculum endpoints
# ---------------------------------------------------------------------------

async def get_subject_names(db: AsyncSession) -> List[str]:
    rows = (await db.execute(select(RHSubject.name).order_by(RHSubject.name))).all()
    return [r[0] for r in rows]


async def get_subject_by_name(db: AsyncSession, name: str) -> Optional[RHSubject]:
    return (await db.execute(
        select(RHSubject).where(RHSubject.name == name)
    )).scalar_one_or_none()


async def get_units_by_subject_name(
    db: AsyncSession, subject_name: str, key_stage: Optional[str] = None
) -> List[Dict[str, Any]]:
    subj = await get_subject_by_name(db, subject_name)
    if subj is None:
        return []
    return await get_units(db, subj.hub_id, key_stage)
