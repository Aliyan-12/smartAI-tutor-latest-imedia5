"""School (tenant) CRUD + the default-school accessor."""
import re
from typing import List, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.school import (
    School, DEFAULT_SCHOOL_NAME, DEFAULT_SCHOOL_SLUG, INDIVIDUAL_HOST, SCHOOL_ACCOUNT,
)
from app.models.user import User


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "school"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    slug = base
    i = 2
    while True:
        exists = await db.execute(select(School.id).where(School.slug == slug))
        if not exists.scalar_one_or_none():
            return slug
        slug = f"{base}-{i}"
        i += 1


async def get_school(db: AsyncSession, school_id: int) -> Optional[School]:
    res = await db.execute(select(School).where(School.id == school_id))
    return res.scalar_one_or_none()


async def get_or_create_default_school(db: AsyncSession) -> School:
    """The single 'individual_host' school all individual signups attach to."""
    res = await db.execute(select(School).where(School.slug == DEFAULT_SCHOOL_SLUG))
    school = res.scalar_one_or_none()
    if school:
        return school
    school = School(
        name=DEFAULT_SCHOOL_NAME,
        slug=DEFAULT_SCHOOL_SLUG,
        country="United Kingdom & United Arab Emirates",
        account_type=INDIVIDUAL_HOST,
        is_default=True,
    )
    db.add(school)
    await db.flush()
    return school


async def create_school(
    db: AsyncSession,
    name: str,
    country: Optional[str] = None,
    account_type: str = SCHOOL_ACCOUNT,
) -> School:
    slug = await _unique_slug(db, _slugify(name))
    school = School(name=name, slug=slug, country=country, account_type=account_type)
    db.add(school)
    await db.flush()
    return school


async def list_school_users(
    db: AsyncSession, school_id: int, role: Optional[str] = None
) -> List[User]:
    q = select(User).where(User.school_id == school_id)
    if role:
        q = q.where(User.role == role)
    q = q.order_by(User.created_at.desc())
    res = await db.execute(q)
    return list(res.scalars().all())


async def count_school_users(db: AsyncSession, school_id: int) -> int:
    res = await db.execute(
        select(func.count(User.id)).where(User.school_id == school_id)
    )
    return res.scalar() or 0
