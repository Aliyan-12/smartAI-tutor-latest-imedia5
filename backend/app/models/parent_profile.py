from datetime import datetime, timezone

from sqlalchemy import Integer, String, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# Default notification switches for a parent. Kept as a dict so new channels can be
# added without a migration.
DEFAULT_PARENT_NOTIFICATIONS = {
    "session_reminders": True,
    "reports": True,
    "assignments": True,
    "weekly_progress": True,
    "billing": True,
    "school_notices": True,
}


class ParentProfile(Base):
    """Parent-specific account settings (mirrors StudentProfile for parents)."""
    __tablename__ = "parent_profiles"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    timezone: Mapped[str] = mapped_column(String(60), default="Europe/London", nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    notification_prefs: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc), nullable=False,
    )
