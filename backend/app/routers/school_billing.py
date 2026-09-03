"""School billing extensions (feature 10): token-top-up request queue, manual credits &
refunds (audited via the immutable ledger), CSV export, and billing settings. Wallet,
subscription, plans, packages, invoices and ledger are served by the shared /api/billing
engine (feature 09) with the school as the owner.

Isolation: every read/write is scoped to the caller's own school — a school admin can never
see or change another school's wallet."""
import csv
import io
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_admin, require_teacher
from app.models.user import User, ROLE_ADMIN, ROLE_ADMINISTRATOR
from app.models.school import School
from app.models.billing import OWNER_SCHOOL
from app.models.topup_request import SchoolTopupRequest
from app.services.billing import service as billing
from app.services.billing import plans as plan_catalog
from app.services.billing import offerings
from app.services.billing.provider import is_mock
from app.services import platform_settings_service as settings_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing/school", tags=["school-billing"])


def _require_school(user: User) -> int:
    if not user.school_id:
        raise HTTPException(400, "Your account is not attached to a school")
    return user.school_id


async def _assert_can_view(db: AsyncSession, user: User) -> int:
    """Admins always; teachers only if the school policy permits."""
    school_id = _require_school(user)
    if user.role in (ROLE_ADMIN, ROLE_ADMINISTRATOR):
        return school_id
    allowed = await settings_svc.value(db, "teachers_can_view_billing", school_id)
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your school hasn't enabled billing visibility for teachers")
    return school_id


class TopupRequestCreate(BaseModel):
    package_slug: str
    note: str = ""


class ManualCredit(BaseModel):
    amount: float = Field(gt=0)
    reason: str = Field(min_length=3)


class RefundBody(BaseModel):
    amount: float = Field(gt=0)
    reference: str = ""
    reason: str = Field(min_length=3)


class SettingsUpdate(BaseModel):
    billing_contact_email: Optional[str] = None
    billing_address: Optional[str] = None


# ── top-up requests ────────────────────────────────────────────────────────
@router.get("/requests")
async def list_requests(user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    school_id = await _assert_can_view(db, user)
    q = select(SchoolTopupRequest).where(SchoolTopupRequest.school_id == school_id)
    # A plain teacher only sees their own requests; admins see all.
    if user.role not in (ROLE_ADMIN, ROLE_ADMINISTRATOR):
        q = q.where(SchoolTopupRequest.requested_by_id == user.id)
    q = q.order_by(desc(SchoolTopupRequest.created_at)).limit(100)
    rows = (await db.execute(q)).scalars().all()
    # Requestable top-up packs so staff can pick one to request (tap options).
    packages = await offerings.list_offerings(db, "topup", "school", school_id)
    return {"requests": [{
        "id": r.id, "package_slug": r.package_slug, "credits": float(r.credits), "amount": float(r.amount),
        "status": r.status, "note": r.note, "requested_by_id": r.requested_by_id,
        "created_at": r.created_at, "decided_at": r.decided_at,
    } for r in rows], "packages": packages}


@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def create_request(payload: TopupRequestCreate, user: User = Depends(require_teacher), db: AsyncSession = Depends(get_db)):
    school_id = _require_school(user)
    pkg = await offerings.resolve_package(db, payload.package_slug)
    if pkg is None or pkg.audience != "school":
        raise HTTPException(400, "Unknown token package")
    req = SchoolTopupRequest(school_id=school_id, requested_by_id=user.id, package_slug=pkg.slug,
                             credits=pkg.credits, amount=pkg.price, note=payload.note[:2000])
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return {"id": req.id, "status": req.status}


@router.post("/requests/{req_id}/decline")
async def decline_request(req_id: int, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    school_id = _require_school(user)
    req = await db.get(SchoolTopupRequest, req_id)
    if req is None or req.school_id != school_id:
        raise HTTPException(404, "Request not found")
    if req.status != "pending":
        raise HTTPException(400, "Request already decided")
    req.status = "declined"
    req.decided_by_id = user.id
    req.decided_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": req.id, "status": req.status}


@router.post("/requests/{req_id}/approve")
async def approve_request(req_id: int, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Approve → run the purchase. In mock mode credits are granted immediately (via replayed
    webhook); in live mode a checkout session URL is returned for the admin to complete."""
    school_id = _require_school(user)
    req = await db.get(SchoolTopupRequest, req_id)
    if req is None or req.school_id != school_id:
        raise HTTPException(404, "Request not found")
    if req.status != "pending":
        raise HTTPException(400, "Request already decided")

    req.status = "approved"
    req.decided_by_id = user.id
    req.decided_at = datetime.now(timezone.utc)

    if is_mock():
        await billing.dev_complete_topup(db, OWNER_SCHOOL, school_id, req.package_slug)
        req.status = "fulfilled"
        await db.commit()
        return {"id": req.id, "status": req.status, "mock": True}

    session = await billing.start_topup_checkout(
        db, OWNER_SCHOOL, school_id, req.package_slug, user.email,
        success_url="", cancel_url="")
    await db.commit()
    return {"id": req.id, "status": req.status, "checkout": session}


# ── manual credit / refund (audited via the ledger) ────────────────────────
@router.post("/manual-credit")
async def manual_credit(payload: ManualCredit, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    school_id = _require_school(user)
    wallet = await billing.get_or_create_wallet(db, OWNER_SCHOOL, school_id)
    entry = await billing.manual_credit(db, wallet, payload.amount, payload.reason, user.id)
    await db.commit()
    return {"balance": float(wallet.balance), "applied": entry is not None}


@router.post("/refund")
async def refund(payload: RefundBody, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    school_id = _require_school(user)
    wallet = await billing.get_or_create_wallet(db, OWNER_SCHOOL, school_id)
    entry = await billing.refund(db, wallet, payload.amount, payload.reference, payload.reason, user.id)
    await db.commit()
    return {"balance": float(wallet.balance), "applied": entry is not None}


# ── CSV export ─────────────────────────────────────────────────────────────
@router.get("/ledger.csv")
async def export_ledger_csv(user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    school_id = _require_school(user)
    wallet = await billing.get_or_create_wallet(db, OWNER_SCHOOL, school_id)
    entries = await billing.ledger_entries(db, wallet, limit=10000)
    await db.commit()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "type", "source", "reference", "delta", "balance_after", "reason"])
    for e in entries:
        w.writerow([e.created_at.isoformat(), e.entry_type, e.source or "", e.reference or "",
                    float(e.delta), float(e.balance_after), e.reason])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=school_wallet_ledger.csv"})


# ── billing settings ───────────────────────────────────────────────────────
@router.get("/settings")
async def get_settings(user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    school_id = _require_school(user)
    school = await db.get(School, school_id)
    # Platform-owned financial config is read-only for a school admin.
    currency = await settings_svc.value(db, "currency")
    tax_rate = await settings_svc.value(db, "tax_rate_percent")
    invoice_prefix = await settings_svc.value(db, "invoice_prefix")
    payment_model = await settings_svc.value(db, "payment_model")
    await db.commit()
    return {
        "payment_model": payment_model, "currency": currency, "tax_rate_percent": tax_rate,
        "invoice_prefix": invoice_prefix,
        "billing_contact_email": getattr(school, "contact_email", None),
        "billing_address": getattr(school, "address", None),
        "school_name": school.name if school else None,
    }


@router.put("/settings")
async def update_settings(payload: SettingsUpdate, user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    school_id = _require_school(user)
    school = await db.get(School, school_id)
    if school is None:
        raise HTTPException(404, "School not found")
    if payload.billing_contact_email is not None:
        school.contact_email = payload.billing_contact_email.strip()[:255]
    if payload.billing_address is not None:
        school.address = payload.billing_address.strip()
    await db.commit()
    return {"billing_contact_email": school.contact_email, "billing_address": school.address}
