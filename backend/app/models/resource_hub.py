"""
resource_hub.py — local mirror of the external Resource Hub curriculum + resources.

Two background jobs keep these `rh_*` tables in sync with
https://hub.resourcefullearning.co.uk:
  * Job 1 (sync_curriculum) populates keystages → years → subjects → units → topics
    and the (key_stage, year_group) → subject/unit availability edges.
  * Job 2 (sync_resources) populates resources and vectorizes the file-based ones
    (slides / worksheets / mark schemes — not videos / links) into
    RHDocument + RHDocumentChunk for pgvector retrieval.

The Resource Hub's own numeric ids are stored as `hub_id` and used as the upsert key.
Resources reference curriculum by NAME (subject / unit_title / topic_title +
key_stage + year_group), so links to RHSubject/RHUnit/RHTopic are best-effort.
"""
from datetime import datetime, timezone

from sqlalchemy import (
    String, DateTime, Integer, ForeignKey, Text, Index, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.db.session import Base

EMBEDDING_DIM = 768

# Resource types that are external references (never downloaded / vectorized).
NON_FILE_RESOURCE_TYPES = {"youtube", "external_link", "link", "video"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Curriculum tree
# ---------------------------------------------------------------------------

class RHKeyStage(Base):
    __tablename__ = "rh_keystages"

    code: Mapped[str] = mapped_column(String(10), primary_key=True)  # "KS1".."KS5"
    position: Mapped[int] = mapped_column(Integer, default=0)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class RHYearGroup(Base):
    __tablename__ = "rh_year_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key_stage_code: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)  # "Year 4"
    position: Mapped[int] = mapped_column(Integer, default=0)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (
        UniqueConstraint("key_stage_code", "name", name="uq_rh_year_group"),
    )


class RHSubject(Base):
    __tablename__ = "rh_subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hub_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class RHUnit(Base):
    __tablename__ = "rh_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hub_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    subject_hub_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    unit_number: Mapped[int] = mapped_column(Integer, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class RHTopic(Base):
    __tablename__ = "rh_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hub_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    unit_hub_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class RHAvailability(Base):
    """
    (key_stage, year_group) → subject / unit availability edges.

    Populated from both the filtered curriculum queries and from distinct
    resource rows, so the app knows which subjects/units exist for a given
    key stage + year group ("different subjects for different year groups").
    A row with unit_hub_id NULL is a subject-level edge; with unit_hub_id set
    it is a unit-level edge. Uniqueness is enforced in the sync code (Postgres
    treats NULLs as distinct, so no DB unique constraint here).
    """
    __tablename__ = "rh_availability"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key_stage: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    year_group: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    subject_hub_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    unit_hub_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    __table_args__ = (
        Index("ix_rh_availability_lookup", "key_stage", "year_group", "subject_hub_id"),
    )


# ---------------------------------------------------------------------------
# Resources + vector store
# ---------------------------------------------------------------------------

class RHResource(Base):
    __tablename__ = "rh_resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hub_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)

    title: Mapped[str] = mapped_column(String(1000), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # Curriculum coordinates (by name, as the hub returns them)
    key_stage: Mapped[str] = mapped_column(String(10), nullable=True, index=True)
    year_group: Mapped[str] = mapped_column(String(50), nullable=True, index=True)
    subject_name: Mapped[str] = mapped_column(String(200), nullable=True)
    unit_title: Mapped[str] = mapped_column(String(500), nullable=True)
    topic_title: Mapped[str] = mapped_column(String(500), nullable=True)

    # Best-effort resolved links to the curriculum tree
    subject_hub_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    unit_hub_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)
    topic_hub_id: Mapped[int] = mapped_column(Integer, nullable=True, index=True)

    # Where the content lives
    file_url: Mapped[str] = mapped_column(Text, nullable=True)
    youtube_url: Mapped[str] = mapped_column(Text, nullable=True)
    external_url: Mapped[str] = mapped_column(Text, nullable=True)
    tags: Mapped[str] = mapped_column(Text, nullable=True)
    created_at_hub: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    # Vectorization bookkeeping
    vectorize_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str] = mapped_column(Text, nullable=True)

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    document = relationship(
        "RHDocument", back_populates="resource",
        uselist=False, cascade="all, delete-orphan",
    )


class RHDocument(Base):
    """A downloaded, vectorized file-based resource (one per RHResource)."""
    __tablename__ = "rh_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    resource_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("rh_resources.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    file_url: Mapped[str] = mapped_column(Text, nullable=True)
    file_type: Mapped[str] = mapped_column(String(16), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    resource = relationship("RHResource", back_populates="document")
    chunks = relationship(
        "RHDocumentChunk", back_populates="document", cascade="all, delete-orphan"
    )


class RHDocumentChunk(Base):
    __tablename__ = "rh_document_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rh_document_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("rh_documents.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # The slide / page number this chunk came from — drives the synced viewer.
    slide_index: Mapped[int] = mapped_column(Integer, default=0, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    document = relationship("RHDocument", back_populates="chunks")

    __table_args__ = (
        Index(
            "ix_rh_chunk_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )
