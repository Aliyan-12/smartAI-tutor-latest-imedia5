from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import Integer, String, Text, DateTime, ForeignKey, SmallInteger
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Homework(Base):
    __tablename__ = "homework"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    key_stage: Mapped[str] = mapped_column(String(10), nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    estimated_minutes: Mapped[int] = mapped_column(SmallInteger, default=60, nullable=False)
    assignment_type: Mapped[str] = mapped_column(
        String(20), default="homework", nullable=False
    )  # homework | reading | prep | revision
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    teacher = relationship("User", foreign_keys=[teacher_id])
    assignments = relationship(
        "HomeworkAssignment",
        back_populates="homework",
        cascade="all, delete-orphan",
    )


class HomeworkAssignment(Base):
    __tablename__ = "homework_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    homework_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("homework.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default="assigned", nullable=False, index=True
    )  # assigned | started | completed
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    homework = relationship("Homework", back_populates="assignments")
    student = relationship("User", foreign_keys=[student_id])
