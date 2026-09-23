from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Integer, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

# ── School verification workflow (feature 04) ──
VERIFICATION_STATES = (
    "draft", "submitted", "under_review", "verified", "rejected", "changes_requested", "suspended",
)
# Allowed transitions. A school self-serves draft→submitted and (after changes) →submitted;
# the platform administrator drives review outcomes.
VERIFICATION_TRANSITIONS = {
    "draft": {"submitted"},
    "submitted": {"under_review", "verified", "rejected", "changes_requested"},
    "under_review": {"verified", "rejected", "changes_requested"},
    "changes_requested": {"submitted"},
    "rejected": {"submitted"},           # allow resubmission
    "verified": {"suspended"},
    "suspended": {"under_review", "verified"},
}

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

    # ── Verification workflow (feature 04) ── an email domain alone does NOT prove legitimacy;
    # evidence + administrator review are required. The default school is treated as verified.
    verification_status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft", nullable=False, index=True)
    legal_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    domain: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, index=True)
    school_type: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)   # primary/secondary/college/mat/other
    identifier: Mapped[Optional[str]] = mapped_column(String(60), nullable=True, index=True)  # URN / UKPRN / other
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    verification_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # reviewer note / changes requested
    suspended_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
