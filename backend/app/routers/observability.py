"""Operational observability for administrators (feature 15).

Surfaces in-process metrics (request/webhook/notification/error counters) plus a couple of
live reconciliation checks (billing wallet balance vs its ledger) so drift is visible.
Administrator-only; contains no personal or payment secrets.
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_administrator
from app.models.user import User
from app.observability import metrics

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/observability", tags=["observability"])


@router.get("")
async def observability(user: User = Depends(require_administrator), db: AsyncSession = Depends(get_db)):
    from app.models.billing import BillingWallet, BillingLedgerEntry
    from app.models.billing import WebhookEvent
    from app.models.notification import Notification

    # Billing reconciliation: for each wallet, latest ledger balance_after should equal balance.
    wallets = list((await db.execute(select(BillingWallet))).scalars().all())
    drift = 0
    for w in wallets:
        last = await db.scalar(
            select(BillingLedgerEntry.balance_after)
            .where(BillingLedgerEntry.wallet_id == w.id)
            .order_by(BillingLedgerEntry.id.desc()).limit(1))
        expected = float(last) if last is not None else 0.0
        if abs(float(w.balance) - expected) > 0.001:
            drift += 1

    webhook_total = int(await db.scalar(select(func.count(WebhookEvent.id))) or 0)
    notif_total = int(await db.scalar(select(func.count(Notification.id))) or 0)
    notif_failed = int(await db.scalar(
        select(func.count(Notification.id)).where(Notification.status == "failed")) or 0)

    await db.commit()
    return {
        "metrics": metrics.snapshot(),
        "billing": {
            "wallets": len(wallets),
            "reconciliation_drift": drift,   # wallets whose balance != ledger tail (should be 0)
            "webhook_events_recorded": webhook_total,
        },
        "notifications": {"total": notif_total, "failed": notif_failed},
    }
