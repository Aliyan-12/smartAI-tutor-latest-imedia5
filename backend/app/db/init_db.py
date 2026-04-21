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

