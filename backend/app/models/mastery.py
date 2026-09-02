"""Mastery evidence (feature 11). One row per learning activity that says something about
a student's grasp of a topic. The mastery engine derives TopicMastery state from these."""
from datetime import datetime, timezone

from sqlalchemy import Integer, String, ForeignKey, DateTime, Numeric, Float, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class MasteryEvidence(Base):
    __tablename__ = "mastery_evidence"
    # A given source activity is counted once — replays don't inflate mastery.
    __table_args__ = (
        UniqueConstraint("student_id", "source_type", "source_id", name="uq_mastery_evidence_source"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True, index=True)

    subject: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    key_stage: Mapped[str] = mapped_column(String(10), default="", nullable=False)
    year_group: Mapped[str | None] = mapped_column(String(30), nullable=True)
    topic: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    subtopic: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # source_type: practice | quiz | open_answer | puzzle | assignment | objective | self_report
    source_type: Mapped[str] = mapped_column(String(30), nullable=False)
    source_id: Mapped[str] = mapped_column(String(120), nullable=False)
    # evaluator_type drives reliability (see mastery_algorithm.RELIABILITY).
    evaluator_type: Mapped[str] = mapped_column(String(30), default="llm_open", nullable=False)

    score: Mapped[float] = mapped_column(Numeric(10, 3), default=0)
    max_score: Mapped[float] = mapped_column(Numeric(10, 3), default=1)
    normalized_score: Mapped[float] = mapped_column(Float, default=0.0)  # 0..1
    difficulty: Mapped[float] = mapped_column(Float, default=0.5)        # 0..1
    hints_used: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    retries: Mapped[int] = mapped_column(Integer, default=0)
    time_on_task_s: Mapped[int | None] = mapped_column(Integer, nullable=True)

    session_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    misconception_tags: Mapped[list] = mapped_column(JSONB, default=list)
    provenance: Mapped[dict] = mapped_column(JSONB, default=dict)   # quality/confidence metadata
    schema_version: Mapped[str] = mapped_column(String(10), default="1.0")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
