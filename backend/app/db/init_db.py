import logging

from sqlalchemy import text
from app.db.session import engine, Base

logger = logging.getLogger(__name__)

# Any process about to run create_all takes this advisory lock first.
#
# create_all is check-then-create: it asks "does this table exist?" and only then issues
# CREATE TABLE. So if two processes do that at once against an empty schema — e.g. uvicorn
# --reload restarts the app on a git pull at the same moment someone runs
# `python -m app.setup --fresh` — BOTH see `schools` missing and BOTH try to create it. One
# wins; the other dies with "duplicate key value violates unique constraint
# pg_type_typname_nsp_index" and uvicorn exits.
#
# A transaction-scoped advisory lock serialises them: the second process blocks until the
# first commits, by which point checkfirst correctly sees the tables and skips them.
# Arbitrary but must be identical everywhere it's used (see app/setup.py).
SCHEMA_LOCK_KEY = 4815162342


async def init_database():
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception as e:
        logger.warning(f"pgvector extension not available: {e}. Skipping vector setup.")

    # Import all models so create_all sees every table
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": SCHEMA_LOCK_KEY})
        await conn.run_sync(Base.metadata.create_all)
