"""
scheduler.py — APScheduler wiring for the Resource Hub sync jobs.

Started from main.py's lifespan. Runs Job 1 (curriculum) and Job 2 (resources)
on configurable intervals. An initial run is kicked off separately at startup.
"""
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import settings
from app.services import resource_sync_service

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler | None:
    return _scheduler


def start_scheduler() -> AsyncIOScheduler | None:
    global _scheduler
    if not settings.resource_sync_enabled:
        logger.info("RESOURCE_SYNC_ENABLED is false — Resource Hub scheduler not started.")
        return None
    if _scheduler is not None:
        return _scheduler

    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        resource_sync_service.sync_curriculum, "interval",
        hours=settings.curriculum_sync_hours, id="curriculum_sync",
        max_instances=1, coalesce=True,
    )
    _scheduler.add_job(
        resource_sync_service.sync_resources, "interval",
        hours=settings.resource_sync_hours, id="resource_sync",
        max_instances=1, coalesce=True,
    )
    # NOTE: the topic-image catalog is NOT a separate scheduled job — it is chained
    # automatically at the end of each SUCCESSFUL sync_curriculum() run (see
    # resource_sync_service.sync_curriculum), so it always refreshes right after the
    # topic list is up to date.
    _scheduler.start()
    logger.info(
        "Resource Hub scheduler started (curriculum=%dh, resources=%dh; topic-images chained after curriculum).",
        settings.curriculum_sync_hours, settings.resource_sync_hours,
    )
    return _scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
