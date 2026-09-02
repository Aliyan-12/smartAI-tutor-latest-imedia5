"""In-app / email notification store (feature 14). A single row per notification with a
delivery status and an optional dedup key so a retried or repeated event never spams a user."""
from datetime import datetime, timezone

from sqlalchemy import Integer, String, ForeignKey, DateTime, Text, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# Delivery lifecycle.
STATUS_QUEUED = "queued"
STATUS_SENT = "sent"
STATUS_FAILED = "failed"


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)  # maps to a preference key
    type: Mapped[str] = mapped_column(String(60), nullable=False)                   # machine event name
    title: Mapped[str] = mapped_column(String(160), nullable=False)                 # no sensitive child data
    body: Mapped[str] = mapped_column(Text, default="")
    channel: Mapped[str] = mapped_column(String(10), default="inapp")               # inapp | email
    status: Mapped[str] = mapped_column(String(10), default=STATUS_QUEUED, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    # Unique per (user, dedup_key) is enforced in the service; a repeated event with the same
    # key is a no-op so duplicate deliveries never spam.
    dedup_key: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    link: Mapped[str | None] = mapped_column(String(255), nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AccessAudit(Base):
    """Records access to sensitive data (a child's progress/reports). Answers 'who looked at
    whose data, when'. Immutable."""
    __tablename__ = "access_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_role: Mapped[str] = mapped_column(String(20), default="")
    subject_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    resource: Mapped[str] = mapped_column(String(60), nullable=False)   # e.g. "child_mastery"
    action: Mapped[str] = mapped_column(String(20), default="view")
    school_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
