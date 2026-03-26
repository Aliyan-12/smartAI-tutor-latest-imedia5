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
