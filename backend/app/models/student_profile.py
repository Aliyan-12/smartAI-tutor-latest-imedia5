from datetime import datetime, date, timezone
from typing import Optional, List
from sqlalchemy import (
    Integer, String, Text, DateTime, Date, ForeignKey, UniqueConstraint, Index, Boolean
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

    # Task 5: Learning preferences
    learning_style: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    # e.g. ["visual", "step_by_step", "examples"]
    teaching_pace: Mapped[str] = mapped_column(String(20), default="just_right", nullable=False)
    # slower | just_right | faster
    teaching_preferences: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # e.g. {"step_by_step": true, "real_life_examples": true, "practice_as_we_go": true, "short_summaries": false, "analogies": false}
    learning_goals: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    year_group: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    key_stage: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    default_session_length: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    voice_responses: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_hints: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auto_start_next_topic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notification_prefs: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # e.g. {"assignment_reminders": true, "session_reminders": true, "messages": true, "weekly_progress": true}

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
