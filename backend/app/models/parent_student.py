import secrets
from datetime import datetime, timezone, timedelta

from sqlalchemy import Integer, String, ForeignKey, Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# How long a freshly minted child-link code stays valid.
INVITE_TTL_HOURS = 72
# Unambiguous alphabet (no 0/O/1/I) for codes read aloud / typed by a parent.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


class InviteCode(Base):
    """A one-time, expiring code that links a specific student to a parent.

    The code is bound to a single student_id, so redeeming it can only ever attach
    that one child — a parent can never link an arbitrary account by guessing."""
    __tablename__ = "invite_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    used_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    @staticmethod
    def generate_code() -> str:
        return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))

    @staticmethod
    def default_expiry() -> datetime:
        return datetime.now(timezone.utc) + timedelta(hours=INVITE_TTL_HOURS)

    def is_redeemable(self) -> bool:
        if self.used:
            return False
        if self.expires_at is not None:
            exp = self.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                return False
        return True


class ParentChildEvent(Base):
    """Immutable audit trail for parent↔child link changes."""
    __tablename__ = "parent_child_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parent_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)  # linked | unlinked | child_created | link_failed
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
