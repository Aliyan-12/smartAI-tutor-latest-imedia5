from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    Integer, String, Float, Text, ForeignKey, DateTime,
    SmallInteger, Boolean,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_session_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True, index=True
    )
    appointment_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("appointments.id"), nullable=True, index=True
    )
    assessment_type: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, index=True
    )
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    key_stage: Mapped[str] = mapped_column(String(10), nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    total_questions: Mapped[int] = mapped_column(SmallInteger, default=0)
    correct_answers: Mapped[int] = mapped_column(SmallInteger, default=0)
    score_percent: Mapped[float] = mapped_column(Float, default=0.0)
    weak_topics: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    strong_topics: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    report_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="in_progress", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student = relationship("User", foreign_keys=[student_id])
    questions = relationship(
        "AssessmentQuestion", back_populates="assessment",
        cascade="all, delete-orphan",
        order_by="AssessmentQuestion.question_index",
    )


class AssessmentQuestion(Base):
    __tablename__ = "assessment_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assessment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question_index: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    options: Mapped[dict] = mapped_column(JSONB, nullable=False)
    correct_answer: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    student_answer: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    is_correct: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    topic_tag: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    assessment = relationship("Assessment", back_populates="questions")
