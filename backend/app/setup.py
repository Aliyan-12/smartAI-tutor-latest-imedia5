"""
Database setup script — creates the schema, applies the raw-SQL migrations, and seeds.

Usage:
    docker compose exec backend python -m app.setup            # additive; safe on an existing DB
    docker compose exec backend python -m app.setup --fresh    # DROPS EVERYTHING, recreates, seeds
    docker compose exec backend python -m app.setup --no-seed  # schema only

Scope: this touches the SCHEMA and the SEED DATA only. It does NOT sync the Resource Hub.
--fresh does drop the rh_* mirror, but the backend's scheduler rebuilds it on its own a few
minutes after boot (RESOURCE_SYNC_START_DELAY_MINUTES) — which is the window this command is
designed to run in. Syncing from here as well would mean two processes walking the same
resource list, and one of them dying on the unique rh_resources.hub_id.
"""
import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("setup")


async def run_setup(fresh: bool = False, seed: bool = True):
    from sqlalchemy import text
    from app.db.session import engine, Base
    from app.db.init_db import SCHEMA_LOCK_KEY
    from app.core.config import settings

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

    # ONE transaction holding the schema advisory lock for the whole drop -> create window.
    # The app's own startup also runs create_all, and `uvicorn --reload` will happily restart
    # it mid-setup (a git pull is enough). Without the lock both processes see an empty schema
    # and both issue CREATE TABLE, and the loser dies with "duplicate key value violates unique
    # constraint pg_type_typname_nsp_index". With it, the app simply waits for us to finish.
    async with engine.begin() as conn:
        await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": SCHEMA_LOCK_KEY})

        if fresh:
            # Kick every OTHER connection off this database first.
            #
            # DROP SCHEMA CASCADE needs an ACCESS EXCLUSIVE lock on every table, so a single
            # live backend connection blocks it forever — most often the Resource Hub sync,
            # which sits "idle in transaction" holding rh_* locks for minutes after startup.
            # That's the hang at "Dropping all existing tables...".
            #
            # We can't stop the backend CONTAINER from in here (this process runs inside it,
            # and there's no docker socket). But stopping the container was only ever a means
            # to this end: get its connections off the database. pg_terminate_backend does
            # exactly that, directly. The backend's pool reconnects on its next query
            # (pool_pre_ping in db/session.py makes that transparent).
            killed = (await conn.execute(text("""
                SELECT count(*) FROM (
                    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                    WHERE datname = current_database()
                      AND pid <> pg_backend_pid()
                      AND backend_type = 'client backend'
                ) t
            """))).scalar()
            if killed:
                logger.info("Disconnected %s other DB connection(s) (the running backend).", killed)

            logger.info("Dropping all existing tables...")
            # Belt and braces: if something reconnects in the split second after the kill, fail
            # fast with an explanation instead of hanging silently forever.
            await conn.execute(text("SET LOCAL lock_timeout = '20s'"))
            try:
                # Deliberately NOT Base.metadata.drop_all(). Two reasons:
                #  1. users <-> schools is a real FK cycle, and drop_all can only order a DROP
                #     across it if the constraint is named in the LIVE database — which it isn't
                #     on any DB created before fk_schools_superadmin_user_id was named.
                #  2. It only drops tables the models still declare, silently orphaning any that
                #     were renamed or removed.
                # Dropping the schema wholesale sidesteps both and is what "fresh" should mean.
                await conn.execute(text("DROP SCHEMA public CASCADE"))
                await conn.execute(text("CREATE SCHEMA public"))
            except Exception as e:  # noqa: BLE001
                if "lock" not in str(e).lower():
                    raise
                logger.error("Could not drop the schema — something is still holding table locks")
                logger.error("even after disconnecting other clients. Stop the backend and retry:")
                logger.error("    docker compose stop backend")
                sys.exit(1)
            logger.info("Tables dropped")

        # AFTER the fresh drop, never before: the extension lives in the public schema, so
        # dropping that schema takes pgvector with it. Nested so that a DB without pgvector
        # available degrades to a warning instead of aborting the whole transaction.
        try:
            async with conn.begin_nested():
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            logger.info("pgvector extension enabled")
        except Exception:
            logger.warning("pgvector extension not available. Vector features will be disabled.")

        await conn.run_sync(Base.metadata.create_all)

    logger.info("All tables created successfully")

    # Column migrations (idempotent — safe to re-run)
    _migrations = [
        "ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS default_student_credits INTEGER NOT NULL DEFAULT 100",
        "ALTER TABLE parent_profiles ADD COLUMN IF NOT EXISTS default_child_credits INTEGER NOT NULL DEFAULT 100",
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
        # School verification workflow (feature 04). The event/document tables are created by
        # create_all once app.models.school_verification is imported.
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) NOT NULL DEFAULT 'draft'",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS legal_name VARCHAR(255)",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS website VARCHAR(255)",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS domain VARCHAR(120)",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_type VARCHAR(60)",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS identifier VARCHAR(60)",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS address TEXT",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(40)",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS verification_notes TEXT",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS suspended_reason TEXT",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE schools ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_schools_verification_status ON schools(verification_status)",
        "CREATE INDEX IF NOT EXISTS ix_schools_domain ON schools(domain)",
        "UPDATE schools SET verification_status='verified' WHERE is_default=true",
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
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
        # Parent settings (feature 06): secure, expiring, one-time child-link codes + audit.
        "ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS used_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS used_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
        # Admin settings (feature 08): an earlier build shipped a different platform_settings
        # schema. Drop it only when it lacks the new `scope` column so create_all rebuilds it.
        """DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='platform_settings')
             AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_name='platform_settings' AND column_name='scope') THEN
            DROP TABLE IF EXISTS setting_changes CASCADE;
            DROP TABLE platform_settings CASCADE;
          END IF;
        END $$;""",
        # Mastery engine (feature 11): TopicMastery gains engine outputs; an earlier
        # mastery_evidence schema is dropped so create_all rebuilds the current one.
        "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS state VARCHAR(20) NOT NULL DEFAULT 'not_started'",
        "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS performance DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS evidence_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS algorithm_version VARCHAR(10)",
        "ALTER TABLE topic_mastery ADD COLUMN IF NOT EXISTS last_computed_at TIMESTAMP WITH TIME ZONE",
        """DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='mastery_evidence')
             AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_name='mastery_evidence' AND column_name='score') THEN
            DROP TABLE mastery_evidence CASCADE;
          END IF;
        END $$;""",
        # Notifications (feature 14): drop an incompatible legacy table so create_all rebuilds it.
        """DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='notifications')
             AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_name='notifications' AND column_name='category') THEN
            DROP TABLE notifications CASCADE;
          END IF;
        END $$;""",
        # Indexes for the new high-volume queries (feature 15). IF NOT EXISTS keeps it idempotent.
        "CREATE INDEX IF NOT EXISTS ix_mastery_evidence_student_subject_topic ON mastery_evidence(student_id, subject, topic)",
        "CREATE INDEX IF NOT EXISTS ix_billing_ledger_wallet_created ON billing_ledger(wallet_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_notifications_user_read ON notifications(user_id, read)",
        "CREATE INDEX IF NOT EXISTS ix_access_audit_subject ON access_audit(subject_user_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_topic_mastery_student_state ON topic_mastery(student_id, state)",
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
        # Lessons are taught by the AI tutor (chosen at booking), not a human teacher, so a
        # booking no longer requires a teacher — relax the legacy NOT NULL on teacher_id.
        "ALTER TABLE appointments ALTER COLUMN teacher_id DROP NOT NULL",
        # Finalised per-lesson coverage ledger (snapshotted on completion) — read by cross-lesson memory
        "ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS coverage JSONB",
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

    # ── Seed ──────────────────────────────────────────────────────────────────────────
    # Run automatically: a freshly-wiped database with no users and no school can't be
    # logged into, so "setup then remember to seed" was a footgun with no upside. Seeding
    # is idempotent, so it's safe on the additive path too.
    if seed:
        logger.info("")
        logger.info("Seeding default users, school and policies...")
        from app.seed import run_seed
        await run_seed()

    # ── Resource Hub ──────────────────────────────────────────────────────────────────
    # NOT rebuilt here, on purpose. --fresh drops the whole rh_* mirror (curriculum AND
    # resources + their RAG vectors), but syncing it back is the backend's job, not setup's:
    # setup runs as a second process inside the backend container, so a sync started here
    # races the one the backend runs and one of them dies on the unique rh_resources.hub_id.
    #
    # The backend's scheduler picks it up by itself, RESOURCE_SYNC_START_DELAY_MINUTES after
    # it boots (default 5) — which is exactly the window this command is meant to run in.
    if fresh and settings.resource_sync_enabled:
        logger.info("")
        logger.info(
            "The Resource Hub mirror (curriculum, slides, RAG vectors) was dropped. The backend "
            "rebuilds it automatically ~%d min after it starts — no action needed.",
            settings.resource_sync_start_delay_minutes,
        )
        logger.info("Watch it with:  docker compose logs -f backend")

    await engine.dispose()


def main():
    logger.info("SmartAI Tutor - Database Setup")
    logger.info("=" * 40)

    fresh = "--fresh" in sys.argv
    seed = "--no-seed" not in sys.argv

    if fresh:
        logger.info("Fresh mode: drop + recreate every table, then seed")

    asyncio.run(run_setup(fresh=fresh, seed=seed))

    logger.info("")
    logger.info("=" * 40)
    logger.info("Setup complete.")
    if not seed:
        logger.info("Seeding was skipped (--no-seed). Run: python -m app.seed")


if __name__ == "__main__":
    main()
