from datetime import datetime, date, timezone
from typing import Optional, List
from sqlalchemy import (
    Integer, String, DateTime, Date, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class StudentProfile(Base):
    __tablename__ = "student_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True
    )
    xp_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    xp_level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    current_streak: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    longest_streak: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_active_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    interests: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    preferred_subjects: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    student = relationship("User", foreign_keys=[student_id])


class TopicMastery(Base):
    __tablename__ = "topic_mastery"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    key_stage: Mapped[str] = mapped_column(String(10), nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    mastery_level: Mapped[str] = mapped_column(
        String(20), default="not_started", nullable=False
    )
    score_history: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_practiced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    student = relationship("User", foreign_keys=[student_id])

    __table_args__ = (
        UniqueConstraint("student_id", "subject", "topic", name="uq_topic_mastery_student_subject_topic"),
    )
