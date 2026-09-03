from datetime import datetime, timezone

from sqlalchemy import Integer, String, ForeignKey, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

DEFAULT_TEACHER_NOTIFICATIONS = {
    "new_booking": True,
    "report_ready": True,
    "assignment_submission": True,
    "weekly_digest": True,
    "parent_communication": True,
    "org_notices": True,
}

# What the booking / lesson flow reads as sensible starting points.
TEACHING_APPROACHES = ("balanced", "exam_focused", "conceptual", "practice_heavy", "socratic")
REPORT_VISIBILITY = ("parents_and_students", "parents_only", "school_only")


class TeacherProfile(Base):
    """Teacher account + classroom defaults. The booking flow reads the `default_*`
    fields to pre-fill new sessions. School-owned policies (e.g. whether a teacher may
    manage assignments) live elsewhere and are never writable from here."""
    __tablename__ = "teacher_profiles"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    timezone: Mapped[str] = mapped_column(String(60), default="Europe/London", nullable=False)

    # Classroom / session defaults (consumed by the booking flow).
    default_session_length: Mapped[int] = mapped_column(Integer, default=40, nullable=False)
    default_key_stage: Mapped[str | None] = mapped_column(String(20), nullable=True)
    default_subjects: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    teaching_approach: Mapped[str] = mapped_column(String(30), default="balanced", nullable=False)
    default_objectives: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Credits a newly added student starts with, chosen by the teacher (tap options in settings).
    default_student_credits: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    # Availability / preferred windows — a light structure, e.g.
    # {"mon": ["16:00-18:00"], "sat": ["09:00-12:00"]}.
    availability: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    report_visibility: Mapped[str] = mapped_column(String(30), default="parents_and_students", nullable=False)

    notification_prefs: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc), nullable=False,
    )
