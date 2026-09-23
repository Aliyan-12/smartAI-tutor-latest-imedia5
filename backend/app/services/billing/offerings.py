"""DB-backed billing catalogue service.

Wraps the `billing_offerings` table so plans + top-up packs can be managed by admins at
runtime, while presenting the same `Plan` / `TokenPackage` shapes the billing engine already
consumes. The code-defined catalogue in `plans.py` is the seed + the fallback when the table
is empty (e.g. before `seed_defaults` has run), so billing never breaks.
"""
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing_offering import BillingOffering
from app.services.billing.plans import (
    Plan, TokenPackage, PLANS as _DEF_PLANS, TOKEN_PACKAGES as _DEF_PKGS,
    get_plan as _default_plan, get_package as _default_package,
)


def _to_plan(o: BillingOffering) -> Plan:
    return Plan(o.slug, o.name, o.audience, float(o.price), int(o.credits),
                o.interval or "month", o.description or "")


def _to_package(o: BillingOffering) -> TokenPackage:
    return TokenPackage(o.slug, o.name, o.audience, float(o.price), int(o.credits),
                        o.description or "")


# ── resolution used by the billing engine (money path) ────────────────────────
async def resolve_plan(db: AsyncSession, slug: str) -> Optional[Plan]:
    o = (await db.execute(
        select(BillingOffering).where(
            BillingOffering.kind == "plan", BillingOffering.slug == slug,
            BillingOffering.active.is_(True))
    )).scalars().first()
    return _to_plan(o) if o else _default_plan(slug)


async def resolve_package(db: AsyncSession, slug: str) -> Optional[TokenPackage]:
    o = (await db.execute(
        select(BillingOffering).where(
            BillingOffering.kind == "topup", BillingOffering.slug == slug,
            BillingOffering.active.is_(True))
    )).scalars().first()
    return _to_package(o) if o else _default_package(slug)


# ── catalogue listing (billing pages) ─────────────────────────────────────────
async def list_offerings(db: AsyncSession, kind: str, audience: Optional[str] = None,
                         school_id: Optional[int] = None,
                         include_inactive: bool = False) -> List[dict]:
    """Platform-wide offerings (school_id NULL) plus the caller's own school offerings."""
    stmt = select(BillingOffering).where(BillingOffering.kind == kind)
    if not include_inactive:
        stmt = stmt.where(BillingOffering.active.is_(True))
    if audience:
        stmt = stmt.where(BillingOffering.audience == audience)
    stmt = stmt.where(
        (BillingOffering.school_id.is_(None)) | (BillingOffering.school_id == school_id)
    ).order_by(BillingOffering.price)
    rows = (await db.execute(stmt)).scalars().all()
    if rows:
        return [_row_dict(o) for o in rows]
    # Table not seeded yet — fall back to the code catalogue so pages still render.
    defaults = _DEF_PLANS if kind == "plan" else _DEF_PKGS
    out = []
    for d in defaults:
        if audience and d.audience != audience:
            continue
        out.append({
            "id": None, "kind": kind, "slug": d.slug, "name": d.name, "audience": d.audience,
            "price": float(d.price),
            "credits": int(getattr(d, "credits_per_period", getattr(d, "credits", 0))),
            "interval": getattr(d, "interval", None), "description": d.description,
            "active": True, "school_id": None,
        })
    return out


def _row_dict(o: BillingOffering) -> dict:
    return {
        "id": o.id, "kind": o.kind, "slug": o.slug, "name": o.name, "audience": o.audience,
        "price": float(o.price), "credits": int(o.credits), "interval": o.interval,
        "description": o.description, "active": o.active, "school_id": o.school_id,
    }


# ── admin CRUD ────────────────────────────────────────────────────────────────
async def create_offering(db: AsyncSession, *, kind: str, name: str, price: float, credits: int,
                          audience: str = "school", interval: Optional[str] = None,
                          description: str = "", school_id: Optional[int] = None) -> dict:
    import re
    base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or kind
    slug = f"{kind}_{base}"[:70]
    # Ensure the slug is unique.
    n, candidate = 1, slug
    while (await db.execute(select(BillingOffering.id).where(BillingOffering.slug == candidate))).scalars().first():
        n += 1
        candidate = f"{slug}_{n}"[:80]
    o = BillingOffering(
        kind=kind, slug=candidate, name=name.strip(), audience=audience,
        price=price, credits=credits, interval=(interval if kind == "plan" else None),
        description=description.strip(), active=True, school_id=school_id,
    )
    db.add(o)
    await db.flush()
    return _row_dict(o)


async def update_offering(db: AsyncSession, offering_id: int, *, school_id: Optional[int],
                          is_platform_admin: bool, **fields) -> dict:
    o = await db.get(BillingOffering, offering_id)
    if o is None:
        raise ValueError("Offering not found")
    # A school admin may only edit their own school's offerings.
    if not is_platform_admin and o.school_id != school_id:
        raise ValueError("You can only edit your own school's offerings")
    for k in ("name", "price", "credits", "description", "active", "interval", "audience"):
        if k in fields and fields[k] is not None:
            setattr(o, k, fields[k])
    await db.flush()
    return _row_dict(o)


async def delete_offering(db: AsyncSession, offering_id: int, *, school_id: Optional[int],
                          is_platform_admin: bool) -> None:
    o = await db.get(BillingOffering, offering_id)
    if o is None:
        return
    if not is_platform_admin and o.school_id != school_id:
        raise ValueError("You can only remove your own school's offerings")
    # Soft-delete so historical subscriptions keep resolving.
    o.active = False
    await db.flush()


# ── seed the code defaults so admins can edit them too ────────────────────────
async def seed_defaults(db: AsyncSession) -> int:
    created = 0
    for p in _DEF_PLANS:
        exists = (await db.execute(select(BillingOffering.id).where(BillingOffering.slug == p.slug))).scalars().first()
        if not exists:
            db.add(BillingOffering(kind="plan", slug=p.slug, name=p.name, audience=p.audience,
                                   price=p.price, credits=p.credits_per_period, interval=p.interval,
                                   description=p.description, active=True, school_id=None))
            created += 1
    for pk in _DEF_PKGS:
        exists = (await db.execute(select(BillingOffering.id).where(BillingOffering.slug == pk.slug))).scalars().first()
        if not exists:
            db.add(BillingOffering(kind="topup", slug=pk.slug, name=pk.name, audience=pk.audience,
                                   price=pk.price, credits=pk.credits, interval=None,
                                   description=pk.description, active=True, school_id=None))
            created += 1
    await db.flush()
    return created
