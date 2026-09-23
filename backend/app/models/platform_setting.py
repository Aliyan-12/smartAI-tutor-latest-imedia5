from datetime import datetime, timezone

from sqlalchemy import Integer, String, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# scope values: "platform" or "school:{school_id}".
SCOPE_PLATFORM = "platform"


def school_scope(school_id: int) -> str:
    return f"school:{school_id}"


class PlatformSetting(Base):
    """A single configurable setting value, at platform or school scope. The catalogue
    of valid keys + metadata lives in services/settings_registry.py — this table only
    stores overrides of those defaults."""
    __tablename__ = "platform_settings"
    __table_args__ = (UniqueConstraint("scope", "key", name="uq_platform_setting_scope_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(40), nullable=False, index=True, default=SCOPE_PLATFORM)
    key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)  # always wrapped as {"v": ...}
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc), nullable=False,
    )


class SettingChange(Base):
    """Immutable audit of every admin settings change (before/after, actor, reason)."""
    __tablename__ = "setting_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    old_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
