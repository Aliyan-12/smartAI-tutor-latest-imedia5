from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Boolean, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

ROLE_ADMINISTRATOR = "administrator"  # platform-wide super role (sees all schools/users)
ROLE_ADMIN = "admin"      # admin/owner of a single school tenant (school-scoped)
ROLE_TEACHER = "teacher"
ROLE_STUDENT = "student"
ROLE_PARENT = "parent"

VALID_ROLES = {ROLE_ADMINISTRATOR, ROLE_ADMIN, ROLE_TEACHER, ROLE_STUDENT, ROLE_PARENT}

# account_type values (how the user signed up)
ACCOUNT_SCHOOL = "school"
ACCOUNT_INDIVIDUAL = "individual"

# approval_status — school admins must be approved by an administrator before they
# can sign in. Everyone else defaults to "approved".
APPROVAL_APPROVED = "approved"
APPROVAL_PENDING = "pending"
APPROVAL_REJECTED = "rejected"

DEFAULT_CREDITS = 100


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    # Nullable: OAuth-only (e.g. Google) accounts have no local password.
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default=ROLE_STUDENT, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    credits: Mapped[float] = mapped_column(Numeric(12, 2), default=DEFAULT_CREDITS)
    parent_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Tenant + onboarding state.
    school_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auth_provider: Mapped[str] = mapped_column(String(20), default="password", nullable=False)
    account_type: Mapped[str] = mapped_column(String(20), default=ACCOUNT_INDIVIDUAL, nullable=False)
    # School admins start "pending" until an administrator approves them; all other
    # accounts are "approved" by default.
    approval_status: Mapped[str] = mapped_column(String(20), default=APPROVAL_APPROVED, nullable=False)
    # Bumped to revoke all existing sessions ("log out of all devices"). Access tokens
    # carry the value they were minted with; get_current_user rejects a stale one.
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")
    credit_transactions = relationship("CreditTransaction", back_populates="user", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="user", cascade="all, delete-orphan")

    children = relationship(
        "User",
        backref="parent",
        remote_side="User.id",
        primaryjoin="User.parent_id == User.id",
        foreign_keys="User.parent_id",
    )

    # The tenant this user belongs to. Eager-loaded so school_name/country are
    # always available (e.g. for the sidebar) without async lazy-load errors.
    school = relationship("School", foreign_keys=[school_id], lazy="selectin")

    @property
    def school_name(self) -> Optional[str]:
        return self.school.name if self.school else None

    @property
    def school_country(self) -> Optional[str]:
        return self.school.country if self.school else None

    @property
    def is_administrator(self) -> bool:
        return self.role == ROLE_ADMINISTRATOR

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN

    @property
    def is_teacher(self) -> bool:
        return self.role == ROLE_TEACHER

    @property
    def is_student(self) -> bool:
        return self.role == ROLE_STUDENT

    @property
    def is_parent(self) -> bool:
        return self.role == ROLE_PARENT

    @property
    def has_credits(self) -> bool:
        return float(self.credits) > 0
