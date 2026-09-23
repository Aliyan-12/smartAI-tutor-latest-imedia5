"""Billing orchestration: customers, wallets, subscriptions, the idempotent credit
ledger, and webhook processing. Credits are allocated ONLY from authoritative provider
events (invoice paid / top-up paid), never from a button click, and every allocation is
idempotent by a stable key so a re-delivered webhook can't double-credit."""
import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.models.billing import (
    BillingCustomer, BillingWallet, BillingLedgerEntry, ProviderSubscription,
    InvoiceRef, WebhookEvent, PaymentMethodRef,
)
from app.services.billing import plans as plan_catalog
from app.services.billing import offerings
from app.services.billing.provider import get_provider

logger = logging.getLogger(__name__)


# ── customers + wallets ────────────────────────────────────────────────────
async def get_or_create_customer(db: AsyncSession, owner_type: str, owner_id: int,
                                 email: Optional[str] = None, name: Optional[str] = None) -> BillingCustomer:
    res = await db.execute(select(BillingCustomer).where(
        BillingCustomer.owner_type == owner_type, BillingCustomer.owner_id == owner_id))
    cust = res.scalar_one_or_none()
    if cust is None:
        provider = get_provider()
        pcid = provider.create_customer(email, name)
        cust = BillingCustomer(owner_type=owner_type, owner_id=owner_id, provider=provider.name,
                               provider_customer_id=pcid, billing_email=email)
        db.add(cust)
        await db.flush()
    return cust


async def get_or_create_wallet(db: AsyncSession, owner_type: str, owner_id: int,
                               currency: str = "GBP") -> BillingWallet:
    res = await db.execute(select(BillingWallet).where(
        BillingWallet.owner_type == owner_type, BillingWallet.owner_id == owner_id))
    wallet = res.scalar_one_or_none()
    if wallet is None:
        wallet = BillingWallet(owner_type=owner_type, owner_id=owner_id, balance=0, currency=currency)
        db.add(wallet)
        await db.flush()
    return wallet


async def transfer_credits(db: AsyncSession, src: BillingWallet, dst: BillingWallet,
                           amount: float, reason: str, actor_id: int) -> None:
    """Move `amount` credits src -> dst, recording BOTH sides in the immutable ledger.
    Raises ValueError if the source lacks the balance. Used for school->member funding and
    parent/teacher->student funding."""
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    if float(src.balance) < amount:
        raise ValueError("Not enough credits in the source wallet")
    key = f"xfer:{src.id}->{dst.id}:{uuid.uuid4().hex}"
    await credit_wallet(db, src, -amount, "transfer_out", source="internal_transfer",
                        reference=f"wallet:{dst.id}", idempotency_key=f"{key}:out",
                        reason=reason, actor_id=actor_id)
    await credit_wallet(db, dst, amount, "transfer_in", source="internal_transfer",
                        reference=f"wallet:{src.id}", idempotency_key=f"{key}:in",
                        reason=reason, actor_id=actor_id)


async def _customer_by_provider_id(db: AsyncSession, provider_customer_id: str) -> Optional[BillingCustomer]:
    res = await db.execute(select(BillingCustomer).where(
        BillingCustomer.provider_customer_id == provider_customer_id))
    return res.scalar_one_or_none()


# ── the immutable ledger ───────────────────────────────────────────────────
async def credit_wallet(db: AsyncSession, wallet: BillingWallet, delta: float, entry_type: str,
                        source: Optional[str] = None, reference: Optional[str] = None,
                        idempotency_key: Optional[str] = None, reason: str = "",
                        actor_id: Optional[int] = None) -> Optional[BillingLedgerEntry]:
    """Append a ledger entry and move the wallet balance. If idempotency_key was already
    used, this is a no-op returning None (prevents double-crediting)."""
    if idempotency_key:
        existing = await db.execute(select(BillingLedgerEntry).where(
            BillingLedgerEntry.idempotency_key == idempotency_key))
        if existing.scalar_one_or_none() is not None:
            logger.info("LEDGER skip duplicate key=%s", idempotency_key)
            return None

    new_balance = Decimal(str(wallet.balance)) + Decimal(str(delta))
    entry = BillingLedgerEntry(
        wallet_id=wallet.id, delta=delta, balance_after=new_balance, entry_type=entry_type,
        source=source, reference=reference, idempotency_key=idempotency_key,
        reason=reason, actor_id=actor_id)
    db.add(entry)
    wallet.balance = new_balance
    try:
        await db.flush()
    except IntegrityError:
        # A concurrent insert won the idempotency key — treat as already applied.
        await db.rollback()
        logger.info("LEDGER race on key=%s — treated as applied", idempotency_key)
        return None
    return entry


async def ledger_entries(db: AsyncSession, wallet: BillingWallet, limit: int = 100,
                         entry_type: Optional[str] = None) -> List[BillingLedgerEntry]:
    q = select(BillingLedgerEntry).where(BillingLedgerEntry.wallet_id == wallet.id)
    if entry_type:
        q = q.where(BillingLedgerEntry.entry_type == entry_type)
    q = q.order_by(desc(BillingLedgerEntry.created_at)).limit(limit)
    return list((await db.execute(q)).scalars().all())


# ── subscriptions / checkout ──────────────────────────────────────────────
async def start_subscription_checkout(db: AsyncSession, owner_type: str, owner_id: int,
                                      plan_slug: str, email: Optional[str], name: Optional[str],
                                      success_url: str, cancel_url: str) -> Dict[str, Any]:
    plan = await offerings.resolve_plan(db, plan_slug)
    if plan is None:
        raise ValueError("Unknown plan")
    cust = await get_or_create_customer(db, owner_type, owner_id, email, name)
    session = get_provider().create_subscription_checkout(
        customer_id=cust.provider_customer_id, price_slug=plan_slug,
        success_url=success_url, cancel_url=cancel_url)
    return session


async def start_topup_checkout(db: AsyncSession, owner_type: str, owner_id: int, package_slug: str,
                               email: Optional[str], success_url: str, cancel_url: str) -> Dict[str, Any]:
    pkg = await offerings.resolve_package(db, package_slug)
    if pkg is None:
        raise ValueError("Unknown package")
    cust = await get_or_create_customer(db, owner_type, owner_id, email)
    return get_provider().create_payment_checkout(
        customer_id=cust.provider_customer_id, package_slug=package_slug,
        amount=pkg.price, success_url=success_url, cancel_url=cancel_url)


async def active_subscription(db: AsyncSession, customer_id: int) -> Optional[ProviderSubscription]:
    res = await db.execute(select(ProviderSubscription)
                           .where(ProviderSubscription.customer_id == customer_id)
                           .order_by(desc(ProviderSubscription.created_at)).limit(1))
    return res.scalar_one_or_none()


async def cancel_subscription(db: AsyncSession, sub: ProviderSubscription, at_period_end: bool = True):
    result = get_provider().cancel_subscription(sub.provider_subscription_id, at_period_end)
    sub.cancel_at_period_end = bool(result.get("cancel_at_period_end", at_period_end))
    sub.status = result.get("status", sub.status)
    if not at_period_end:
        sub.canceled_at = datetime.now(timezone.utc)
    await db.flush()
    return sub


async def reactivate_subscription(db: AsyncSession, sub: ProviderSubscription):
    result = get_provider().reactivate_subscription(sub.provider_subscription_id)
    sub.cancel_at_period_end = False
    sub.status = result.get("status", "active")
    await db.flush()
    return sub


# ── admin / manual ledger ops (audited via the ledger itself) ─────────────
async def manual_credit(db: AsyncSession, wallet: BillingWallet, amount: float, reason: str, actor_id: int):
    if not reason.strip():
        raise ValueError("A reason is required for a manual credit")
    return await credit_wallet(db, wallet, amount, entry_type="manual", source="admin",
                               reason=reason, actor_id=actor_id)


async def refund(db: AsyncSession, wallet: BillingWallet, amount: float, reference: str, reason: str, actor_id: int):
    return await credit_wallet(db, wallet, -abs(amount), entry_type="refund", source="refund",
                               reference=reference, reason=reason, actor_id=actor_id)


# ── webhook processing (idempotent) ───────────────────────────────────────
async def _record_event(db: AsyncSession, provider: str, event_id: str, event_type: str) -> bool:
    """Return True if this event is new (should be processed), False if already seen."""
    db.add(WebhookEvent(provider=provider, event_id=event_id, event_type=event_type,
                        processed_at=datetime.now(timezone.utc)))
    try:
        await db.flush()
        return True
    except IntegrityError:
        await db.rollback()
        return False


def _ts(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        return datetime.fromtimestamp(int(val), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


async def handle_event(db: AsyncSession, event: Dict[str, Any], provider_name: str = "stripe") -> Dict[str, Any]:
    from app.observability import metrics
    metrics.incr("billing.webhook.received")
    event_id = event.get("id") or f"evt_{datetime.now(timezone.utc).timestamp()}"
    event_type = event.get("type", "")
    if not await _record_event(db, provider_name, event_id, event_type):
        metrics.incr("billing.webhook.duplicate")
        return {"status": "duplicate", "event_id": event_id}

    obj = (event.get("data") or {}).get("object") or {}
    handler = _HANDLERS.get(event_type)
    if handler is None:
        logger.info("BILLING unhandled event type=%s", event_type)
        metrics.incr("billing.webhook.ignored")
        return {"status": "ignored", "type": event_type}
    try:
        await handler(db, obj)
    except Exception:
        metrics.incr("billing.webhook.error")
        raise
    metrics.incr("billing.webhook.processed")
    return {"status": "processed", "type": event_type}


async def _notify_billing(db: AsyncSession, cust, *, category: str, type: str, title: str,
                          body: str, dedup_key: str) -> None:
    """Notify the billing owner of a billing event. Best-effort; never breaks webhook processing.
    Titles/bodies carry no sensitive child data."""
    try:
        from app.services import notification_service
        from app.models.user import User as _User
        from app.models.school import School as _School
        target_id = None
        if cust.owner_type == "user":
            target_id = cust.owner_id
        else:
            school = await db.get(_School, cust.owner_id)
            target_id = getattr(school, "superadmin_user_id", None)
        if target_id:
            await notification_service.notify(
                db, user_id=target_id, category=category, type=type, title=title, body=body,
                dedup_key=dedup_key, link="/billing")
    except Exception:
        logger.exception("billing notification failed (non-fatal)")


async def _on_subscription_upsert(db: AsyncSession, obj: Dict[str, Any]):
    cust = await _customer_by_provider_id(db, obj.get("customer"))
    if cust is None:
        return
    sub_id = obj.get("id")
    res = await db.execute(select(ProviderSubscription).where(
        ProviderSubscription.provider_subscription_id == sub_id))
    sub = res.scalar_one_or_none()
    plan_slug = (obj.get("metadata") or {}).get("plan_slug", "") or (sub.plan_slug if sub else "")
    plan = await offerings.resolve_plan(db, plan_slug)
    if sub is None:
        sub = ProviderSubscription(customer_id=cust.id, provider_subscription_id=sub_id, plan_slug=plan_slug,
                                   credits_per_period=plan.credits_per_period if plan else 0)
        db.add(sub)
    sub.status = obj.get("status", sub.status)
    sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end", sub.cancel_at_period_end))
    sub.current_period_start = _ts(obj.get("current_period_start")) or sub.current_period_start
    sub.current_period_end = _ts(obj.get("current_period_end")) or sub.current_period_end
    sub.latest_invoice_id = obj.get("latest_invoice") or sub.latest_invoice_id
    if obj.get("status") in ("canceled", "incomplete_expired"):
        sub.canceled_at = datetime.now(timezone.utc)
    await db.flush()


async def _on_invoice_paid(db: AsyncSession, obj: Dict[str, Any]):
    cust = await _customer_by_provider_id(db, obj.get("customer"))
    if cust is None:
        return
    wallet = await get_or_create_wallet(db, cust.owner_type, cust.owner_id)
    invoice_id = obj.get("id")

    # Persist an invoice reference (idempotent on provider_invoice_id).
    res = await db.execute(select(InvoiceRef).where(InvoiceRef.provider_invoice_id == invoice_id))
    inv = res.scalar_one_or_none()
    if inv is None:
        inv = InvoiceRef(customer_id=cust.id, provider_invoice_id=invoice_id)
        db.add(inv)
    inv.number = obj.get("number") or inv.number
    inv.status = "paid"
    # Stripe reports monetary amounts in the smallest currency unit (pence/cents).
    inv.amount_total = float(obj.get("amount_paid", obj.get("total", 0)) or 0) / 100.0
    inv.tax = float(obj.get("tax", 0) or 0) / 100.0
    inv.currency = (obj.get("currency") or "gbp").upper()
    inv.hosted_invoice_url = obj.get("hosted_invoice_url")
    inv.pdf_url = obj.get("invoice_pdf")
    inv.period_start = _ts(obj.get("period_start"))
    inv.period_end = _ts(obj.get("period_end"))
    inv.paid_at = datetime.now(timezone.utc)
    await db.flush()

    # Allocate the subscription's credits from the plan — idempotent by invoice id.
    credits = 0.0
    sub_id = obj.get("subscription")
    if sub_id:
        r = await db.execute(select(ProviderSubscription).where(
            ProviderSubscription.provider_subscription_id == sub_id))
        sub = r.scalar_one_or_none()
        if sub:
            credits = float(sub.credits_per_period or 0)
    if credits > 0:
        await credit_wallet(db, wallet, credits, entry_type="subscription", source="invoice",
                            reference=invoice_id, idempotency_key=f"invoice:{invoice_id}",
                            reason=f"Subscription allocation for invoice {inv.number or invoice_id}")
    await _notify_billing(db, cust, category="billing", type="payment_succeeded",
                          title="Payment received", body="Your subscription payment was successful.",
                          dedup_key=f"paid:{invoice_id}")


async def _on_invoice_failed(db: AsyncSession, obj: Dict[str, Any]):
    cust = await _customer_by_provider_id(db, obj.get("customer"))
    if cust is None:
        return
    sub_id = obj.get("subscription")
    if sub_id:
        r = await db.execute(select(ProviderSubscription).where(
            ProviderSubscription.provider_subscription_id == sub_id))
        sub = r.scalar_one_or_none()
        if sub:
            sub.status = "past_due"
            await db.flush()
    await _notify_billing(db, cust, category="billing", type="payment_failed",
                          title="Payment issue", body="A payment failed. Please update your payment method to keep your subscription active.",
                          dedup_key=f"failed:{obj.get('id')}")


async def _on_checkout_completed(db: AsyncSession, obj: Dict[str, Any]):
    # One-time top-up: allocate credits idempotently by the checkout session id.
    if obj.get("mode") != "payment":
        return
    cust = await _customer_by_provider_id(db, obj.get("customer"))
    if cust is None:
        return
    package_slug = (obj.get("metadata") or {}).get("package_slug", "")
    pkg = await offerings.resolve_package(db, package_slug)
    if pkg is None:
        return
    wallet = await get_or_create_wallet(db, cust.owner_type, cust.owner_id)
    session_id = obj.get("id")
    await credit_wallet(db, wallet, pkg.credits, entry_type="topup", source="checkout",
                        reference=session_id, idempotency_key=f"checkout:{session_id}",
                        reason=f"Top-up: {pkg.name}")


async def _on_pm_attached(db: AsyncSession, obj: Dict[str, Any]):
    cust = await _customer_by_provider_id(db, obj.get("customer"))
    if cust is None:
        return
    card = obj.get("card") or {}
    res = await db.execute(select(PaymentMethodRef).where(PaymentMethodRef.provider_pm_id == obj.get("id")))
    pm = res.scalar_one_or_none()
    if pm is None:
        pm = PaymentMethodRef(customer_id=cust.id, provider_pm_id=obj.get("id"))
        db.add(pm)
    pm.brand = card.get("brand")
    pm.last4 = card.get("last4")
    pm.exp_month = card.get("exp_month")
    pm.exp_year = card.get("exp_year")
    pm.detached = False
    cust.default_payment_method_id = obj.get("id")
    await db.flush()


# ── dev-mode event synthesis (mock provider only) ─────────────────────────
# Replays exactly the webhook sequence Stripe would send, so the subscribe/top-up loop
# is fully exercised in dev without any Stripe credentials or webhook forwarding.
import secrets as _secrets


def _now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


async def dev_complete_subscription(db: AsyncSession, owner_type: str, owner_id: int, plan_slug: str) -> Dict[str, Any]:
    plan = await offerings.resolve_plan(db, plan_slug)
    if plan is None:
        raise ValueError("Unknown plan")
    cust = await get_or_create_customer(db, owner_type, owner_id)
    cid = cust.provider_customer_id
    sub_id = f"sub_mock_{_secrets.token_hex(8)}"
    inv_id = f"in_mock_{_secrets.token_hex(8)}"
    period = _now_ts()
    period_end = period + 30 * 24 * 3600
    price_cents = int(round(plan.price * 100))
    seq = _secrets.token_hex(4)
    events = [
        {"id": f"evt_{_secrets.token_hex(8)}", "type": "customer.subscription.created",
         "data": {"object": {"id": sub_id, "customer": cid, "status": "active",
                             "cancel_at_period_end": False, "current_period_start": period,
                             "current_period_end": period_end, "latest_invoice": inv_id,
                             "metadata": {"plan_slug": plan_slug}}}},
        {"id": f"evt_{_secrets.token_hex(8)}", "type": "invoice.paid",
         "data": {"object": {"id": inv_id, "customer": cid, "subscription": sub_id,
                             "number": f"SMART-{seq}", "amount_paid": price_cents, "total": price_cents,
                             "tax": 0, "currency": "gbp", "period_start": period, "period_end": period_end,
                             "hosted_invoice_url": None, "invoice_pdf": None}}},
    ]
    results = [await handle_event(db, e, provider_name="mock") for e in events]
    return {"ok": True, "events": results}


async def dev_complete_topup(db: AsyncSession, owner_type: str, owner_id: int, package_slug: str) -> Dict[str, Any]:
    pkg = await offerings.resolve_package(db, package_slug)
    if pkg is None:
        raise ValueError("Unknown package")
    cust = await get_or_create_customer(db, owner_type, owner_id)
    session_id = f"cs_mock_{_secrets.token_hex(8)}"
    event = {"id": f"evt_{_secrets.token_hex(8)}", "type": "checkout.session.completed",
             "data": {"object": {"id": session_id, "customer": cust.provider_customer_id,
                                 "mode": "payment", "metadata": {"package_slug": package_slug}}}}
    return {"ok": True, "events": [await handle_event(db, event, provider_name="mock")]}


_HANDLERS = {
    "customer.subscription.created": _on_subscription_upsert,
    "customer.subscription.updated": _on_subscription_upsert,
    "customer.subscription.deleted": _on_subscription_upsert,
    "invoice.paid": _on_invoice_paid,
    "invoice.payment_succeeded": _on_invoice_paid,
    "invoice.payment_failed": _on_invoice_failed,
    "checkout.session.completed": _on_checkout_completed,
    "payment_method.attached": _on_pm_attached,
}
