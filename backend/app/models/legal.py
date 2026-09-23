"""
Legal / privacy / compliance models (UK Children's Code foundation).

- LegalDocument: versioned legal documents (privacy policy, terms, safeguarding, …). Only one
  version per key is `is_current`. History is never overwritten.
- LegalAcceptance: an immutable record of which user accepted which document VERSION and when,
  so a material change triggers re-consent without erasing prior acceptances.
- DataRequest: a trackable data-subject request workflow (access / correction / deletion /
  export / objection) with an auditable status.

NOTE: the seeded document text is a DRAFT scaffold and is NOT legal advice — see
app/services/legal_service.py and /docs/compliance/.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, Integer, Boolean, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Canonical document keys (kept in sync with legal_service.TEMPLATES).
DOC_KEYS = (
    "privacy_policy", "terms_of_service", "parent_terms", "school_terms",
    "acceptable_use", "safeguarding", "cookie_policy", "refund_policy",
    "ai_use_notice", "accessibility_statement",
)

DATA_REQUEST_TYPES = ("access", "correction", "deletion", "export", "objection")
DATA_REQUEST_STATUS = ("pending", "in_progress", "completed", "rejected")


class LegalDocument(Base):
    __tablename__ = "legal_documents"
    __table_args__ = (UniqueConstraint("doc_key", "version", name="uq_legal_doc_key_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_key: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")   # age-appropriate concise summary
    content: Mapped[str] = mapped_column(Text, nullable=False)               # markdown
    requires_consent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    is_draft: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)  # pending legal review
    effective_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class LegalAcceptance(Base):
    __tablename__ = "legal_acceptances"
    __table_args__ = (UniqueConstraint("user_id", "doc_key", "version", name="uq_legal_acceptance"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    doc_key: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class DataRequest(Base):
    __tablename__ = "data_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # A parent can raise a request on behalf of a child; null = about themselves.
    subject_user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    request_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resolution_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
