"""
Database setup script.
Run this once after cloning the project to create all tables.

Usage:
    cd backend
    python -m app.setup
"""
import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("setup")


async def run_setup(fresh: bool = False):
    from sqlalchemy import text
    from app.db.session import engine, Base

    import app.models  # noqa: F401

    logger.info("Connecting to database...")

    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("Database connection successful")
    except Exception as e:
        logger.error(f"Cannot connect to database: {e}")
        logger.error("Make sure PostgreSQL is running and .env credentials are correct")
        sys.exit(1)

    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        logger.info("pgvector extension enabled")
    except Exception:
        logger.warning("pgvector extension not available. Vector features will be disabled.")

    if fresh:
        logger.info("Dropping all existing tables...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        logger.info("Tables dropped")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("All tables created successfully")

    # Column migrations (idempotent — safe to re-run)
    _migrations = [
        "ALTER TABLE chats ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id)",
        "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS total_paused_seconds INTEGER DEFAULT 0",
        "ALTER TABLE assessments ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id)",
        "ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_type VARCHAR(20)",
        # kb_type — separates course material from model training transcripts
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS kb_type VARCHAR(20) NOT NULL DEFAULT 'course_material'",
        "CREATE INDEX IF NOT EXISTS ix_documents_kb_type ON documents(kb_type)",
        # student key stage (KS1/KS2/KS3/GCSE/A-Level/Degree) — determines available session lengths
        "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS key_stage VARCHAR(20)",
        "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS ai_briefing TEXT",
        "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS learn_mode VARCHAR(20) NOT NULL DEFAULT 'ai_recommended'",
        # ================================================================
        # Resource Hub mirror — 9 tables (curriculum tree + resources + vectors).
        # Explicit, idempotent DDL (also created automatically by create_all above).
        # ================================================================
        # 1. rh_keystages
        """CREATE TABLE IF NOT EXISTS rh_keystages (
            code VARCHAR(10) PRIMARY KEY,
            position INTEGER DEFAULT 0,
            synced_at TIMESTAMP WITH TIME ZONE
        )""",
        # 2. rh_year_groups
        """CREATE TABLE IF NOT EXISTS rh_year_groups (
            id SERIAL PRIMARY KEY,
            key_stage_code VARCHAR(10) NOT NULL,
            name VARCHAR(50) NOT NULL,
            position INTEGER DEFAULT 0,
            synced_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT uq_rh_year_group UNIQUE (key_stage_code, name)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_rh_year_groups_key_stage_code ON rh_year_groups(key_stage_code)",
        # 3. rh_subjects
        """CREATE TABLE IF NOT EXISTS rh_subjects (
            id SERIAL PRIMARY KEY,
            hub_id INTEGER NOT NULL UNIQUE,
            name VARCHAR(200) NOT NULL,
            synced_at TIMESTAMP WITH TIME ZONE
        )""",
        # 4. rh_units
        """CREATE TABLE IF NOT EXISTS rh_units (
            id SERIAL PRIMARY KEY,
            hub_id INTEGER NOT NULL UNIQUE,
            subject_hub_id INTEGER NOT NULL,
            title VARCHAR(500) NOT NULL,
            unit_number INTEGER,
            synced_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_rh_units_subject_hub_id ON rh_units(subject_hub_id)",
        # 5. rh_topics
        """CREATE TABLE IF NOT EXISTS rh_topics (
            id SERIAL PRIMARY KEY,
            hub_id INTEGER NOT NULL UNIQUE,
            unit_hub_id INTEGER NOT NULL,
            title VARCHAR(500) NOT NULL,
            position INTEGER DEFAULT 0,
            synced_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_rh_topics_unit_hub_id ON rh_topics(unit_hub_id)",
        # 6. rh_availability
        """CREATE TABLE IF NOT EXISTS rh_availability (
            id SERIAL PRIMARY KEY,
            key_stage VARCHAR(10) NOT NULL,
            year_group VARCHAR(50) NOT NULL,
            subject_hub_id INTEGER,
            unit_hub_id INTEGER,
            synced_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_rh_availability_key_stage ON rh_availability(key_stage)",
        "CREATE INDEX IF NOT EXISTS ix_rh_availability_year_group ON rh_availability(year_group)",
        "CREATE INDEX IF NOT EXISTS ix_rh_availability_subject_hub_id ON rh_availability(subject_hub_id)",
        "CREATE INDEX IF NOT EXISTS ix_rh_availability_unit_hub_id ON rh_availability(unit_hub_id)",
        "CREATE INDEX IF NOT EXISTS ix_rh_availability_lookup ON rh_availability(key_stage, year_group, subject_hub_id)",
        # 7. rh_resources
        """CREATE TABLE IF NOT EXISTS rh_resources (
            id SERIAL PRIMARY KEY,
            hub_id INTEGER NOT NULL UNIQUE,
            title VARCHAR(1000) NOT NULL,
            description TEXT,
            resource_type VARCHAR(50) NOT NULL,
            key_stage VARCHAR(10),
            year_group VARCHAR(50),
            subject_name VARCHAR(200),
            unit_title VARCHAR(500),
            topic_title VARCHAR(500),
            subject_hub_id INTEGER,
            unit_hub_id INTEGER,
            topic_hub_id INTEGER,
            file_url TEXT,
            youtube_url TEXT,
            external_url TEXT,
            tags TEXT,
            created_at_hub TIMESTAMP WITH TIME ZONE,
            vectorize_status VARCHAR(20) NOT NULL DEFAULT 'pending',
            content_hash VARCHAR(64),
            page_count INTEGER DEFAULT 0,
            error_message TEXT,
            raw_json JSONB,
            synced_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE,
            updated_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_rh_resources_resource_type ON rh_resources(resource_type)",
        "CREATE INDEX IF NOT EXISTS ix_rh_resources_key_stage ON rh_resources(key_stage)",
        "CREATE INDEX IF NOT EXISTS ix_rh_resources_year_group ON rh_resources(year_group)",
        "CREATE INDEX IF NOT EXISTS ix_rh_resources_subject_hub_id ON rh_resources(subject_hub_id)",
        "CREATE INDEX IF NOT EXISTS ix_rh_resources_unit_hub_id ON rh_resources(unit_hub_id)",
        "CREATE INDEX IF NOT EXISTS ix_rh_resources_topic_hub_id ON rh_resources(topic_hub_id)",
        "CREATE INDEX IF NOT EXISTS ix_rh_resources_vectorize_status ON rh_resources(vectorize_status)",
        # 8. rh_documents
        """CREATE TABLE IF NOT EXISTS rh_documents (
            id SERIAL PRIMARY KEY,
            resource_id INTEGER NOT NULL UNIQUE REFERENCES rh_resources(id) ON DELETE CASCADE,
            file_url TEXT,
            file_type VARCHAR(16),
            page_count INTEGER DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            error_message TEXT,
            created_at TIMESTAMP WITH TIME ZONE,
            updated_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_rh_documents_status ON rh_documents(status)",
        # 9. rh_document_chunks (needs pgvector for the vector column + HNSW index)
        """CREATE TABLE IF NOT EXISTS rh_document_chunks (
            id SERIAL PRIMARY KEY,
            rh_document_id INTEGER NOT NULL REFERENCES rh_documents(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            slide_index INTEGER DEFAULT 0,
            content TEXT NOT NULL,
            embedding vector(768),
            token_count INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_rh_document_chunks_rh_document_id ON rh_document_chunks(rh_document_id)",
        "CREATE INDEX IF NOT EXISTS ix_rh_document_chunks_slide_index ON rh_document_chunks(slide_index)",
        "CREATE INDEX IF NOT EXISTS ix_rh_chunk_embedding_hnsw ON rh_document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)",
    ]
    async with engine.begin() as conn:
        for sql in _migrations:
            try:
                await conn.execute(text(sql))
                logger.info(f"Migration applied: {sql[:70]}")
            except Exception as e:
                logger.warning(f"Migration skipped (already applied?): {e}")
    await engine.dispose()


def main():
    logger.info("SmartAI Tutor - Database Setup")
    logger.info("=" * 40)

    fresh = "--fresh" in sys.argv
    if fresh:
        logger.info("Fresh mode: will drop and recreate all tables")

    asyncio.run(run_setup(fresh=fresh))
    logger.info("Setup complete. You can now run: python -m app.seed")


if __name__ == "__main__":
    main()
