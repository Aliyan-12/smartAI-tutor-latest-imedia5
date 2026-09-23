"""Billing data model (features 09/10).

Design invariants:
- The application backend NEVER stores raw card data — only provider references
  (customer id, payment-method id, price id, invoice id) + display-safe brand/last4/expiry.
- BillingLedgerEntry is an APPEND-ONLY financial ledger. Every balance change has a
  traceable source and an idempotency key so a retried webhook never double-credits.
- A wallet's balance always equals the balance_after of its latest ledger entry.
"""
from datetime import datetime, timezone

from sqlalchemy import (
    String, DateTime, Integer, ForeignKey, Numeric, Text, Boolean, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

OWNER_USER = "user"      # an individual parent's billing
OWNER_SCHOOL = "school"  # a school's billing


class BillingCustomer(Base):
    """A payment-provider customer, owned by a parent user or a school."""
    __tablename__ = "billing_customers"
    __table_args__ = (UniqueConstraint("owner_type", "owner_id", name="uq_billing_customer_owner"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_type: Mapped[str] = mapped_column(String(10), nullable=False)
    owner_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(20), default="stripe", nullable=False)
    provider_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    default_payment_method_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    billing_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc))


class PaymentMethodRef(Base):
    """Display-safe reference to a saved card. No PAN/CVC ever."""
    __tablename__ = "payment_method_refs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("billing_customers.id", ondelete="CASCADE"), index=True)
    provider_pm_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    brand: Mapped[str | None] = mapped_column(String(30), nullable=True)
    last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    exp_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exp_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    detached: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ProviderSubscription(Base):
    """A recurring subscription mirrored from the provider. Authoritative status/period
    come from provider webhooks — never from a local button click."""
    __tablename__ = "provider_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("billing_customers.id", ondelete="CASCADE"), index=True)
    provider_subscription_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    provider_price_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    plan_slug: Mapped[str] = mapped_column(String(60), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="incomplete", index=True)
    credits_per_period: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latest_invoice_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    extra: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc))


class InvoiceRef(Base):
    __tablename__ = "invoice_refs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("billing_customers.id", ondelete="CASCADE"), index=True)
    provider_invoice_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    amount_total: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    tax: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    currency: Mapped[str] = mapped_column(String(8), default="GBP")
    hosted_invoice_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class WebhookEvent(Base):
    """Idempotency guard: a provider event id is recorded once. Re-delivery is a no-op."""
    __tablename__ = "billing_webhook_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(20), default="stripe")
    event_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class BillingWallet(Base):
    """Credit balance for a parent or a school. Balance == latest ledger entry's balance_after."""
    __tablename__ = "billing_wallets"
    __table_args__ = (UniqueConstraint("owner_type", "owner_id", name="uq_billing_wallet_owner"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_type: Mapped[str] = mapped_column(String(10), nullable=False)
    owner_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    balance: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="GBP")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc))


class BillingLedgerEntry(Base):
    """APPEND-ONLY. Every credit change: subscription allocation, top-up, refund, manual
    adjustment. idempotency_key makes provider-driven grants safe against retries."""
    __tablename__ = "billing_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wallet_id: Mapped[int] = mapped_column(Integer, ForeignKey("billing_wallets.id", ondelete="CASCADE"), index=True)
    delta: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    balance_after: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)  # subscription|topup|refund|manual|adjustment
    source: Mapped[str | None] = mapped_column(String(40), nullable=True)            # e.g. "invoice", "checkout"
    reference: Mapped[str | None] = mapped_column(String(160), nullable=True)        # provider id
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True, unique=True, index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    actor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
