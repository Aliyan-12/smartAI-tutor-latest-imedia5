"""A student's request for a credit top-up.

Students never pay — they ask a parent, teacher or school admin to fund them. The request is a
durable record (for support / audit); fulfilling it performs a wallet transfer into the
student's wallet and stamps who fulfilled it.
"""
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Integer, ForeignKey, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CreditRequest(Base):
    __tablename__ = "credit_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    requester_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    school_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True, index=True
    )
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)  # pending | fulfilled | declined
    fulfilled_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
