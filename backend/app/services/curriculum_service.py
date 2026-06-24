"""
curriculum_service.py — read API over the local Resource Hub mirror (rh_* tables).

Powers the new /api/curriculum endpoints and the repointed legacy /api/lessons
curriculum endpoints. Subjects honour the (key_stage, year_group) availability
edges and fall back to the global catalogue when the hub hasn't year-tagged a
subject yet.
"""
import re
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resource_hub import (
    RHKeyStage, RHYearGroup, RHSubject, RHUnit, RHTopic, RHAvailability, RHResource,
)

# Leading "Unit N" number, used to order units numerically (so the picker reads
# 1,2,…,10,11 rather than lexicographically — which sorts "Unit 10" before "Unit 2").
_UNIT_NUM_RE = re.compile(r"unit\s*0*(\d+)", re.IGNORECASE)


def _unit_order(u: RHUnit) -> int:
    m = _UNIT_NUM_RE.search(u.title or "")
    if m:
        return int(m.group(1))
    if u.unit_number:
        return u.unit_number
    return 10 ** 6


def _unit_sort_key(u: RHUnit):
    return (_unit_order(u), u.hub_id)


async def _unit_titles_with_resources(
    db: AsyncSession, subject_id: int,
    key_stage: Optional[str], year_group: Optional[str], titles: List[str],
) -> set:
    """The unit titles (among `titles`) that have at least one Resource Hub resource.

    Matches resources the SAME way the session's build_playlist does — by subject
    name + key stage (+ year group) + unit title — so the lesson-setup "no resources"
    warning accurately predicts whether the session will actually find any teaching
    material for the chosen unit.
    """
    if not titles:
        return set()
    subj_name = (await db.execute(
        select(RHSubject.name).where(RHSubject.hub_id == subject_id)
    )).scalar_one_or_none()
    q = select(RHResource.unit_title).where(RHResource.unit_title.in_(titles))
    if subj_name:
        q = q.where(RHResource.subject_name == subj_name)
    if key_stage:
        q = q.where(RHResource.key_stage == key_stage)
    if year_group:
        q = q.where(RHResource.year_group == year_group)
    rows = (await db.execute(q.distinct())).all()
    return {r[0] for r in rows}


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
    """Subjects available for a (key_stage[, year_group]) per the hub's availability
    edges. When a key stage is given there is NO fallback to the full catalogue — an
    empty result means the hub genuinely has no subjects there (e.g. KS4/KS5 year
    groups with no content), and we must not invent options the hub doesn't have.
    Only the unfiltered call returns the whole catalogue."""
    if key_stage:
        q = (
            select(RHSubject)
            .join(RHAvailability, RHAvailability.subject_hub_id == RHSubject.hub_id)
            .where(RHAvailability.key_stage == key_stage)
        )
        if year_group:
            q = q.where(RHAvailability.year_group == year_group)
        q = q.distinct().order_by(RHSubject.name)
        rows = (await db.execute(q)).scalars().all()
        return [{"id": s.hub_id, "name": s.name} for s in rows]

    rows = (await db.execute(select(RHSubject).order_by(RHSubject.name))).scalars().all()
    return [{"id": s.hub_id, "name": s.name} for s in rows]


async def get_units(
    db: AsyncSession, subject_id: int,
    key_stage: Optional[str] = None, year_group: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Units for a subject, scoped to a (key_stage, year_group) when given.

    A subject (e.g. "Science") spans every year group, so the unfiltered list
    mixes units from KS1–KS5. The (key_stage[, year_group]) → unit availability
    edges built by the curriculum sync let us return only the units that belong
    to the chosen key stage / year. When a key stage is given there is NO fallback
    to the subject's full unit list — returning every year's units is exactly what
    made the picker look "tripled" (each year group has its own UNIT 1/2/3…). An
    empty result means the hub has no units for that (key stage[, year]).
    Always returned in ascending unit order.
    """
    rows: List[RHUnit] = []
    if key_stage:
        q = (
            select(RHUnit)
            .join(RHAvailability, RHAvailability.unit_hub_id == RHUnit.hub_id)
            .where(
                RHAvailability.subject_hub_id == subject_id,
                RHAvailability.key_stage == key_stage,
            )
        )
        if year_group:
            q = q.where(RHAvailability.year_group == year_group)
        rows = (await db.execute(q.distinct())).scalars().all()
    else:
        # Unfiltered call only (no key stage) → the subject's whole unit catalogue.
        rows = (await db.execute(
            select(RHUnit).where(RHUnit.subject_hub_id == subject_id)
        )).scalars().all()

    rows = sorted(rows, key=_unit_sort_key)
    covered = await _unit_titles_with_resources(
        db, subject_id, key_stage, year_group, [u.title for u in rows]
    )
    return [
        {
            "id": u.hub_id, "title": u.title, "unit_number": u.unit_number,
            "has_resources": u.title in covered,
        }
        for u in rows
    ]


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
