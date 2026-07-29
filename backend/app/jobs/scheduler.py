"""
scheduler.py — APScheduler wiring for the Resource Hub sync jobs.

Started from main.py's lifespan. This is the ONLY place the syncs are triggered from
(besides the on-demand admin endpoint) — startup does not run them, and neither does
app.setup. That matters:

  * The syncs hold locks on the rh_* tables for minutes at a time. `app.setup --fresh`
    needs an ACCESS EXCLUSIVE lock on every table to DROP SCHEMA, so a sync running at
    boot made a reset hang, and a sync started by a *second* process (setup exec'd into
    the same container) raced the backend's own and crashed one of them on the unique
    rh_resources.hub_id.
  * With sync confined to this one process, resource_sync_service's in-process "already
    running" guard is enough to keep the jobs from overlapping each other.

So both jobs are scheduled with a first run RESOURCE_SYNC_START_DELAY_MINUTES after boot,
not immediately. That delay is the window in which you can rebuild the images, restart,
and run setup + seed against a fresh database. Once it passes, the jobs repopulate the
curriculum and the resources on their own, on every restart, without anyone asking.
"""
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import settings
from app.services.jobs import sync_service as resource_sync_service

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

    delay_min = max(0, settings.resource_sync_start_delay_minutes)
    first_run = datetime.now(timezone.utc) + timedelta(minutes=delay_min)

    _scheduler = AsyncIOScheduler(timezone="UTC")
    # next_run_time overrides the interval trigger's first fire. Without it an interval job
    # first runs one full interval (12h/6h) after boot — far too late to repopulate a DB that
    # was just wiped.
    _scheduler.add_job(
        resource_sync_service.sync_curriculum, "interval",
        hours=settings.curriculum_sync_hours, id="curriculum_sync",
        max_instances=1, coalesce=True, next_run_time=first_run,
    )
    # Job 2 resolves each resource's subject/unit/topic to a hub id by looking it up in the
    # curriculum tables, so it must not start before Job 1. It waits for an in-flight
    # curriculum sync by itself (see resource_sync_service._await_curriculum); the one-minute
    # offset just guarantees Job 1 has raised its "running" flag before Job 2 looks at it,
    # rather than the two racing on the same tick.
    _scheduler.add_job(
        resource_sync_service.sync_resources, "interval",
        hours=settings.resource_sync_hours, id="resource_sync",
        max_instances=1, coalesce=True, next_run_time=first_run + timedelta(minutes=1),
    )
    # NOTE: the topic-image catalog is NOT a separate scheduled job — it is chained
    # automatically at the end of each SUCCESSFUL sync_curriculum() run (see
    # resource_sync_service.sync_curriculum), so it always refreshes right after the
    # topic list is up to date.
    _scheduler.start()
    logger.info(
        "Resource Hub scheduler started — first sync in %d min (at %s), then curriculum=%dh, "
        "resources=%dh; topic-images chained after curriculum.",
        delay_min, first_run.strftime("%H:%M:%S UTC"),
        settings.curriculum_sync_hours, settings.resource_sync_hours,
    )
    return _scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
