import logging

from sqlalchemy import text
from app.db.session import engine, Base

logger = logging.getLogger(__name__)


async def init_database():
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception as e:
        logger.warning(f"pgvector extension not available: {e}. Skipping vector setup.")

    # Import all models so create_all sees every table
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Idempotent column migrations for tables that already existed
    # _migrations = [
    #     "ALTER TABLE chats ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id)",
    # ]
    # async with engine.begin() as conn:
    #     for sql in _migrations:
    #         try:
    #             await conn.execute(text(sql))
    #             logger.info(f"Migration OK: {sql[:60]}…")
    #         except Exception as e:
    #             logger.warning(f"Migration skipped ({sql[:40]}…): {e}")
