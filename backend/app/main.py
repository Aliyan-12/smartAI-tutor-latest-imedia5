import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.middleware.rate_limit import RateLimitMiddleware
from app.routers import auth, chat, voice, health, admin, teacher, subscription, documents
from app.routers import parent, appointments, assessments, gamification, lessons, assignments
from app.routers import settings as settings_router
from app.routers import sessions, curriculum

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    force=True,
)
logging.getLogger("uvicorn.access").setLevel(logging.INFO)
logging.getLogger("uvicorn.error").setLevel(logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    logger.info("=== SmartAI Tutor starting up — running DB init ===")
    from app.db.init_db import init_database
    await init_database()

    # Pre-warm Kokoro TTS pipeline so the first voice request is not slow
    try:
        from app.services.voice_agent_service import _get_kokoro
        await asyncio.to_thread(_get_kokoro)
        logger.info("Kokoro TTS pipeline pre-warmed successfully.")
    except Exception as _kokoro_err:
        logger.warning(f"Kokoro TTS pre-warm failed (non-fatal): {_kokoro_err}")

    # Resource Hub: kick off an initial sync + start the periodic scheduler
    # (all non-fatal — the app must boot even if the hub is unreachable). The
    # initial sync is decoupled from the scheduler so it still runs if APScheduler
    # is unavailable.
    if settings.resource_sync_enabled:
        try:
            from app.services import resource_sync_service
            asyncio.create_task(resource_sync_service.sync_curriculum())
            asyncio.create_task(resource_sync_service.sync_resources())
            logger.info("Resource Hub initial sync scheduled.")
        except Exception as _sync_err:
            logger.warning(f"Resource Hub initial sync failed (non-fatal): {_sync_err}")
        try:
            from app.jobs.scheduler import start_scheduler
            start_scheduler()
        except Exception as _sched_err:
            logger.warning(f"Resource Hub scheduler not started (non-fatal): {_sched_err}")

    logger.info("=== SmartAI Tutor ready ===")
    yield
    logger.info("=== SmartAI Tutor shutting down ===")
    try:
        from app.jobs.scheduler import shutdown_scheduler
        shutdown_scheduler()
    except Exception:
        pass


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="AI-powered tutoring platform API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled error %s %s → %s\n%s",
        request.method,
        request.url.path,
        type(exc).__name__,
        traceback.format_exc(),
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.include_router(admin.router)
app.include_router(teacher.router)
app.include_router(subscription.router)
app.include_router(documents.router)
app.include_router(parent.router)
app.include_router(appointments.router)
app.include_router(assessments.router)
app.include_router(gamification.router)
app.include_router(lessons.router)
app.include_router(assignments.router)
app.include_router(settings_router.router)
app.include_router(sessions.router)
app.include_router(curriculum.router)
