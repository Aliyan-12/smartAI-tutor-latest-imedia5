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

    if fresh:
        logger.info("Dropping all existing tables...")
        async with engine.begin() as conn:
            # Deliberately NOT Base.metadata.drop_all(). Two reasons:
            #  1. users <-> schools is a real FK cycle, and drop_all can only order a DROP
            #     across it if the constraint is named in the LIVE database — which it isn't
            #     on any DB created before fk_schools_superadmin_user_id was named.
            #  2. It only drops tables the models still declare, silently orphaning any that
            #     were renamed or removed.
            # Dropping the schema wholesale sidesteps both and is what "fresh" should mean.
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        logger.info("Tables dropped")

    # AFTER the fresh drop, never before: the extension lives in the public schema, so
    # dropping that schema takes pgvector with it.
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        logger.info("pgvector extension enabled")
    except Exception:
        logger.warning("pgvector extension not available. Vector features will be disabled.")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("All tables created successfully")

    # Column migrations (idempotent — safe to re-run)
    _migrations = [
        # ================================================================
        # Auth overhaul — schools (multi-tenancy), email verification + OAuth
        # identities, Casbin policy store, and new users columns.
        # (create_all above already builds these for fresh DBs; the ALTERs
        #  below upgrade an EXISTING users table.)
        # ================================================================
        """CREATE TABLE IF NOT EXISTS schools (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(120) NOT NULL UNIQUE,
            country VARCHAR(60),
            account_type VARCHAR(20) NOT NULL DEFAULT 'school',
            superadmin_user_id INTEGER,
            is_default BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_schools_slug ON schools(slug)",
        "CREATE INDEX IF NOT EXISTS ix_schools_is_default ON schools(is_default)",
        """CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(64) NOT NULL UNIQUE,
            purpose VARCHAR(16) NOT NULL DEFAULT 'verify',
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            used BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE
        )""",
        "CREATE INDEX IF NOT EXISTS ix_evt_user_id ON email_verification_tokens(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_evt_token ON email_verification_tokens(token)",
        """CREATE TABLE IF NOT EXISTS oauth_identities (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider VARCHAR(32) NOT NULL,
            provider_user_id VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            created_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT uq_oauth_provider_user UNIQUE (provider, provider_user_id)
        )""",
        "CREATE INDEX IF NOT EXISTS ix_oauth_identities_user_id ON oauth_identities(user_id)",
        # Casbin policy store (matches casbin-async-sqlalchemy-adapter default schema)
        """CREATE TABLE IF NOT EXISTS casbin_rule (
            id SERIAL PRIMARY KEY,
            ptype VARCHAR(255),
            v0 VARCHAR(255),
            v1 VARCHAR(255),
            v2 VARCHAR(255),
            v3 VARCHAR(255),
            v4 VARCHAR(255),
            v5 VARCHAR(255)
        )""",
        # users: tenant + onboarding columns; relax password for OAuth-only users
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_users_school_id ON users(school_id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'password'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'individual'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'",
        "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
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
            rendered_pdf_url TEXT,
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
