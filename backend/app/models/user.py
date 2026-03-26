from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Integer, Boolean, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

ROLE_ADMIN = "admin"
ROLE_TEACHER = "teacher"
ROLE_STUDENT = "student"

VALID_ROLES = {ROLE_ADMIN, ROLE_TEACHER, ROLE_STUDENT}

DEFAULT_CREDITS = 100


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default=ROLE_STUDENT, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    credits: Mapped[float] = mapped_column(Numeric(12, 2), default=DEFAULT_CREDITS)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")
    credit_transactions = relationship("CreditTransaction", back_populates="user", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="user", cascade="all, delete-orphan")

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
    def has_credits(self) -> bool:
        return float(self.credits) > 0
