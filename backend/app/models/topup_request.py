from datetime import datetime, timezone

from sqlalchemy import Integer, String, ForeignKey, DateTime, Text, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

TOPUP_STATUSES = ("pending", "approved", "declined", "fulfilled")


class SchoolTopupRequest(Base):
    """A school member (e.g. a teacher) asks the school billing admin to buy credits.
    The admin approves — which runs the actual purchase — or declines."""
    __tablename__ = "school_topup_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    school_id: Mapped[int] = mapped_column(Integer, ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    package_slug: Mapped[str] = mapped_column(String(60), nullable=False)
    credits: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
