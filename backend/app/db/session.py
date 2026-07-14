from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# pool_pre_ping: cheaply check a pooled connection is still alive before handing it out, and
# transparently replace it if not. Without it, ANY event that severs the server side of a
# connection — `app.setup --fresh` disconnecting clients so it can drop the schema, a Postgres
# restart, an idle-timeout reaper — leaves dead sockets in the pool and the next ~20 requests
# fail with "connection was closed" until they're all cycled out.
engine = create_async_engine(
    settings.database_url, echo=False, pool_size=20, max_overflow=10, pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
