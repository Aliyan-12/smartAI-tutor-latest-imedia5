"""Billing API (features 09/10). Serves both individual-parent billing (owner = the
parent user) and school billing (owner = the school). Credits are granted only by
provider webhooks; nothing here grants credits on a button press."""
import logging
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.middleware.auth import get_current_user
from app.models.user import User, ROLE_PARENT, ROLE_ADMIN, ROLE_ADMINISTRATOR
from app.models.billing import (
    BillingCustomer, PaymentMethodRef, InvoiceRef, OWNER_USER, OWNER_SCHOOL,
)
from app.services.billing import service as billing
from app.services.billing import plans as plan_catalog
from app.services.billing.provider import get_provider, is_mock

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])


def _owner_for(user: User) -> Tuple[str, int, str]:
    """(owner_type, owner_id, audience) for the caller. Parents own individual billing;
    school admins own school billing. Students never own billing."""
    if user.role == ROLE_PARENT:
        return OWNER_USER, user.id, "individual"
    if user.role in (ROLE_ADMIN, ROLE_ADMINISTRATOR):
        if not user.school_id:
            raise HTTPException(400, "Your account is not attached to a school")
        return OWNER_SCHOOL, user.school_id, "school"
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot manage billing")


class PlanSelect(BaseModel):
    plan_slug: str


class PackageSelect(BaseModel):
    package_slug: str


class CancelBody(BaseModel):
    at_period_end: bool = True


class DevComplete(BaseModel):
    kind: str  # "subscription" | "topup"
    slug: str


# ── catalogue ──────────────────────────────────────────────────────────────
@router.get("/plans")
async def list_plans(user: User = Depends(get_current_user)):
    _, _, audience = _owner_for(user)
    return {"plans": [p.__dict__ for p in plan_catalog.plans_for(audience)], "currency": "GBP"}


@router.get("/packages")
async def list_packages(user: User = Depends(get_current_user)):
    _, _, audience = _owner_for(user)
    return {"packages": [p.__dict__ for p in plan_catalog.packages_for(audience)], "currency": "GBP"}


# ── summary ─────────────────────────────────────────────────────────────────
@router.get("/me")
async def billing_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    owner_type, owner_id, audience = _owner_for(user)
    wallet = await billing.get_or_create_wallet(db, owner_type, owner_id)
    cust_res = await db.execute(select(BillingCustomer).where(
        BillingCustomer.owner_type == owner_type, BillingCustomer.owner_id == owner_id))
    cust = cust_res.scalar_one_or_none()
    sub = await billing.active_subscription(db, cust.id) if cust else None
    pm = None
    if cust and cust.default_payment_method_id:
        r = await db.execute(select(PaymentMethodRef).where(
            PaymentMethodRef.provider_pm_id == cust.default_payment_method_id))
        pmrow = r.scalar_one_or_none()
        if pmrow:
            pm = {"brand": pmrow.brand, "last4": pmrow.last4, "exp_month": pmrow.exp_month, "exp_year": pmrow.exp_year}
    await db.commit()
    return {
        "audience": audience,
        "mock_mode": is_mock(),
        "balance": float(wallet.balance),
        "currency": wallet.currency,
        "payment_method": pm,
        "subscription": None if sub is None else {
            "plan_slug": sub.plan_slug, "status": sub.status,
            "cancel_at_period_end": sub.cancel_at_period_end,
            "current_period_end": sub.current_period_end,
            "credits_per_period": float(sub.credits_per_period),
        },
    }


# ── checkout ────────────────────────────────────────────────────────────────
@router.post("/subscribe")
async def subscribe(payload: PlanSelect, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    owner_type, owner_id, audience = _owner_for(user)
    plan = plan_catalog.get_plan(payload.plan_slug)
    if plan is None or plan.audience != audience:
        raise HTTPException(400, "That plan is not available for your account")
    base = settings.frontend_base_url.rstrip("/")
    try:
        session = await billing.start_subscription_checkout(
            db, owner_type, owner_id, payload.plan_slug, user.email, user.name,
            success_url=f"{base}/billing?status=success", cancel_url=f"{base}/billing?status=cancelled")
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return session


@router.post("/topup")
async def topup(payload: PackageSelect, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    owner_type, owner_id, audience = _owner_for(user)
    pkg = plan_catalog.get_package(payload.package_slug)
    if pkg is None or pkg.audience != audience:
        raise HTTPException(400, "That package is not available for your account")
    base = settings.frontend_base_url.rstrip("/")
    try:
        session = await billing.start_topup_checkout(
            db, owner_type, owner_id, payload.package_slug, user.email,
            success_url=f"{base}/billing?status=success", cancel_url=f"{base}/billing?status=cancelled")
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return session


@router.post("/dev/complete")
async def dev_complete(payload: DevComplete, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """DEV ONLY (mock provider): completes a checkout by replaying provider webhooks so the
    end-to-end credit-allocation loop can be exercised without Stripe."""
    if not is_mock():
        raise HTTPException(400, "Available only in mock/dev billing mode")
    owner_type, owner_id, _ = _owner_for(user)
    try:
        if payload.kind == "subscription":
            res = await billing.dev_complete_subscription(db, owner_type, owner_id, payload.slug)
        else:
            res = await billing.dev_complete_topup(db, owner_type, owner_id, payload.slug)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return res


# ── subscription lifecycle ──────────────────────────────────────────────────
async def _my_subscription(db: AsyncSession, user: User):
    owner_type, owner_id, _ = _owner_for(user)
    cust_res = await db.execute(select(BillingCustomer).where(
        BillingCustomer.owner_type == owner_type, BillingCustomer.owner_id == owner_id))
    cust = cust_res.scalar_one_or_none()
    sub = await billing.active_subscription(db, cust.id) if cust else None
    if sub is None:
        raise HTTPException(404, "No subscription found")
    return sub


@router.post("/subscription/cancel")
async def cancel(payload: CancelBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = await _my_subscription(db, user)
    await billing.cancel_subscription(db, sub, payload.at_period_end)
    await db.commit()
    return {"status": sub.status, "cancel_at_period_end": sub.cancel_at_period_end}


@router.post("/subscription/reactivate")
async def reactivate(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    sub = await _my_subscription(db, user)
    await billing.reactivate_subscription(db, sub)
    await db.commit()
    return {"status": sub.status, "cancel_at_period_end": sub.cancel_at_period_end}


@router.post("/portal")
async def portal(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    owner_type, owner_id, _ = _owner_for(user)
    cust = await billing.get_or_create_customer(db, owner_type, owner_id, user.email, user.name)
    base = settings.frontend_base_url.rstrip("/")
    result = get_provider().create_billing_portal(customer_id=cust.provider_customer_id, return_url=f"{base}/billing")
    await db.commit()
    return result


# ── history ─────────────────────────────────────────────────────────────────
@router.get("/invoices")
async def invoices(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    owner_type, owner_id, _ = _owner_for(user)
    cust_res = await db.execute(select(BillingCustomer).where(
        BillingCustomer.owner_type == owner_type, BillingCustomer.owner_id == owner_id))
    cust = cust_res.scalar_one_or_none()
    if cust is None:
        return {"invoices": []}
    res = await db.execute(select(InvoiceRef).where(InvoiceRef.customer_id == cust.id)
                           .order_by(desc(InvoiceRef.created_at)).limit(100))
    return {"invoices": [{
        "number": i.number, "status": i.status, "amount_total": float(i.amount_total),
        "tax": float(i.tax), "currency": i.currency, "hosted_invoice_url": i.hosted_invoice_url,
        "pdf_url": i.pdf_url, "paid_at": i.paid_at, "created_at": i.created_at,
    } for i in res.scalars().all()]}


@router.get("/ledger")
async def ledger(entry_type: Optional[str] = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    owner_type, owner_id, _ = _owner_for(user)
    wallet = await billing.get_or_create_wallet(db, owner_type, owner_id)
    entries = await billing.ledger_entries(db, wallet, entry_type=entry_type)
    await db.commit()
    return {"balance": float(wallet.balance), "entries": [{
        "delta": float(e.delta), "balance_after": float(e.balance_after), "entry_type": e.entry_type,
        "source": e.source, "reference": e.reference, "reason": e.reason, "created_at": e.created_at,
    } for e in entries]}


# ── webhook (public; signature-verified) ─────────────────────────────────────
@router.post("/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        event = get_provider().verify_webhook(payload, sig)
    except Exception as e:
        logger.warning("BILLING webhook verify failed: %s", e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook signature")
    result = await billing.handle_event(db, dict(event), provider_name=get_provider().name)
    await db.commit()
    return result
