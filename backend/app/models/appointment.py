from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING
from sqlalchemy import Integer, String, Text, DateTime, ForeignKey, SmallInteger
from sqlalchemy.dialects.postgresql import NUMERIC
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    booked_by: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    key_stage: Mapped[str] = mapped_column(String(10), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scheduled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    duration_minutes: Mapped[int] = mapped_column(SmallInteger, default=60)
    status: Mapped[str] = mapped_column(String(20), default="booked", nullable=False, index=True)
    payment_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    payment_amount: Mapped[Optional[float]] = mapped_column(NUMERIC(10, 2), nullable=True, default=25.00)
    passcode: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    session_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    paused_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    total_paused_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    meeting_link: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_briefing: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    student = relationship("User", foreign_keys=[student_id])
    teacher = relationship("User", foreign_keys=[teacher_id])
    booked_by_user = relationship("User", foreign_keys=[booked_by])
    # One appointment can have at most one lesson plan (FK lives on lesson_plans side)
    lesson_plan = relationship(
        "LessonPlan",
        foreign_keys="[LessonPlan.appointment_id]",
        back_populates="appointment",
        uselist=False,
    )
