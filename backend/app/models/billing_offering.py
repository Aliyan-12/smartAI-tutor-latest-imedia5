"""Admin-managed billing catalogue (plans + top-up packs).

Plans and top-up packages were originally code-defined (services/billing/plans.py).
This table lets platform administrators — and school admins for their own school —
create, edit and retire custom offerings without a code change. The code defaults are
seeded in on setup, and remain the fallback when the table is empty.

`kind` distinguishes a recurring subscription **plan** from a one-off **topup** pack.
`school_id` NULL means a platform-wide offering visible to every school; a value scopes
it to that one school. Slugs are globally unique so the billing engine can resolve an
offering by slug regardless of scope.
"""
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Integer, ForeignKey, Numeric, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class BillingOffering(Base):
    __tablename__ = "billing_offerings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)          # "plan" | "topup"
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    audience: Mapped[str] = mapped_column(String(20), default="school", nullable=False)  # "school" | "individual"
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    credits: Mapped[int] = mapped_column(Integer, nullable=False)
    # Recurring interval for plans ("month"); NULL for one-off top-ups.
    interval: Mapped[str | None] = mapped_column(String(20), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # NULL = platform-wide (all schools); a school_id scopes it to that school only.
    school_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("schools.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
