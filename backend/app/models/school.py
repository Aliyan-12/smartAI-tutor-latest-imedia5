from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Integer, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# account_type values
SCHOOL_ACCOUNT = "school"          # an institution that signed up
INDIVIDUAL_HOST = "individual_host"  # the default school that holds individual signups

DEFAULT_SCHOOL_NAME = "Smart Tuition (United Kingdom & United Arab Emirates)"
DEFAULT_SCHOOL_SLUG = "smart-tuition"


class School(Base):
    """A tenant. Either a real institution (account_type='school') or the single
    default 'individual_host' school that every individual parent/student attaches
    to. The registering email of a school becomes its superadmin."""

    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    country: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    account_type: Mapped[str] = mapped_column(String(20), default=SCHOOL_ACCOUNT, nullable=False)
    # The user that owns/administers this school (its superadmin). Nullable so the
    # school row can be created in the same transaction as the user.
    #
    # users.school_id -> schools.id and schools.superadmin_user_id -> users.id form a
    # deliberate FK CYCLE. SQLAlchemy can't order a CREATE/DROP across a cycle, so this side
    # is marked use_alter: it is emitted as its own ALTER TABLE ADD CONSTRAINT after both
    # tables exist, and dropped with DROP CONSTRAINT before them. use_alter REQUIRES an
    # explicit name — without it `metadata.drop_all()` raises CircularDependencyError.
    superadmin_user_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_schools_superadmin_user_id",
        ),
        nullable=True,
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
