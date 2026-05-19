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
        # session_slides — persists AI-generated lesson slides per appointment
        """CREATE TABLE IF NOT EXISTS session_slides (
            id          SERIAL PRIMARY KEY,
            appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
            student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            slide_order INTEGER NOT NULL DEFAULT 0,
            title       VARCHAR(200) NOT NULL,
            emoji       VARCHAR(10) NOT NULL DEFAULT '📄',
            bullets     JSONB NOT NULL DEFAULT '[]',
            key_terms   JSONB NOT NULL DEFAULT '[]',
            highlight   VARCHAR(500) NOT NULL DEFAULT '',
            created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_session_slides_appointment_id ON session_slides(appointment_id)",
        "CREATE INDEX IF NOT EXISTS ix_session_slides_student_id ON session_slides(student_id)",
        # session_presentations — Presenton-generated slides per appointment
        """CREATE TABLE IF NOT EXISTS session_presentations (
            id                SERIAL PRIMARY KEY,
            appointment_id    INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
            student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            slide_order       INTEGER NOT NULL DEFAULT 0,
            topic             VARCHAR(300) NOT NULL DEFAULT '',
            presentation_id   VARCHAR(200) NOT NULL DEFAULT '',
            viewer_url        VARCHAR(1000) NOT NULL DEFAULT '',
            pptx_url          VARCHAR(1000) NOT NULL DEFAULT '',
            status            VARCHAR(20) NOT NULL DEFAULT 'generating',
            created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS ix_session_presentations_appointment_id ON session_presentations(appointment_id)",
        "CREATE INDEX IF NOT EXISTS ix_session_presentations_student_id ON session_presentations(student_id)",
        # kb_type — separates course material from model training transcripts
        "ALTER TABLE documents ADD COLUMN IF NOT EXISTS kb_type VARCHAR(20) NOT NULL DEFAULT 'course_material'",
        "CREATE INDEX IF NOT EXISTS ix_documents_kb_type ON documents(kb_type)",
        # student key stage (KS1/KS2/KS3/GCSE/A-Level/Degree) — determines available session lengths
        "ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS key_stage VARCHAR(20)",
        "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS ai_briefing TEXT",
        "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS learn_mode VARCHAR(20) NOT NULL DEFAULT 'ai_recommended'",
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
