from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class LessonPlan(Base):
    __tablename__ = "lesson_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    appointment_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True
    )
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    created_by: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False
    )
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    key_stage: Mapped[str] = mapped_column(String(10), nullable=False)
    exam_board: Mapped[str] = mapped_column(String(20), default="None", nullable=False)
    tier: Mapped[str] = mapped_column(String(20), default="None", nullable=False)
    unit_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    subtopic: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    ability_level: Mapped[str] = mapped_column(String(20), default="new", nullable=False)
    goal: Mapped[str] = mapped_column(String(30), default="teach_from_scratch", nullable=False)
    teacher_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False, index=True)
    session_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    materials_uploaded: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    # Task 1: AI-generated lesson plan blocks
    plan_blocks: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # Task 2: Session checkpoint state (LIVE scratchpad: puzzle_state, end_allowed, ledger…)
    session_state: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    # Finalised coverage ledger for THIS lesson (slides/concepts/questions/puzzles + outcomes),
    # snapshotted from session_state["ledger"] when the lesson completes. A durable, clean record
    # (separate from the live session_state) that cross-lesson memory reads to adapt the next lesson.
    coverage: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    student = relationship("User", foreign_keys=[student_id])
    creator = relationship("User", foreign_keys=[created_by])
    appointment = relationship(
        "Appointment",
        foreign_keys=[appointment_id],
        back_populates="lesson_plan",
    )
