import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app.core.config import settings
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.maintenance import MaintenanceMiddleware
from app.middleware.sensitive_rate_limit import SensitiveRateLimitMiddleware
from app.middleware.observability import ObservabilityMiddleware, RequestIdFilter, request_id_ctx
from app.observability import metrics
from app.routers import auth, chat, health, admin, teacher, subscription, documents
from app.routers import parent, appointments, assessments, gamification, lessons, assignments
from app.routers import settings as settings_router
from app.routers import sessions, curriculum, school, puzzles
from app.routers import legal, school_verification
from app.routers import parent_settings, teacher_settings, admin_settings, billing, school_billing
from app.routers import notifications as notifications_router
from app.routers import observability as observability_router

# Structured logs carry the request id so a single failing request is traceable end-to-end.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] rid=%(request_id)s %(name)s: %(message)s",
    force=True,
)
for _h in logging.getLogger().handlers:
    _h.addFilter(RequestIdFilter())
logging.getLogger("uvicorn.access").setLevel(logging.INFO)
logging.getLogger("uvicorn.error").setLevel(logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    logger.info("=== SmartAI Tutor starting up — running DB init ===")
    from app.db.init_db import init_database
    await init_database()

    # Initialise Casbin RBAC enforcer + ensure default role policies exist, so
    # require_permission(...) works from the first request (non-fatal on failure).
    try:
        from app.services import casbin_service
        await casbin_service.get_enforcer()
        await casbin_service.seed_default_policies()
        logger.info("Casbin RBAC enforcer ready.")
    except Exception as _casbin_err:
        logger.warning(f"Casbin enforcer init failed (non-fatal): {_casbin_err}")

    # Pre-warm Kokoro TTS pipeline AND download every tutor voice pack so the first voice
    # request (and the first lesson using a given tutor's voice) is not slow.
    try:
        from app.services.agent.session.voice import _get_kokoro, prewarm_voices
        await asyncio.to_thread(_get_kokoro)
        await asyncio.to_thread(prewarm_voices)
        logger.info("Kokoro TTS pipeline + tutor voices pre-warmed successfully.")
    except Exception as _kokoro_err:
        logger.warning(f"Kokoro TTS pre-warm failed (non-fatal): {_kokoro_err}")

    # Resource Hub: hand both syncs to the scheduler and move on (non-fatal — the app must
    # boot even if the hub is unreachable). Startup deliberately does NOT run them itself:
    # the first run is delayed (RESOURCE_SYNC_START_DELAY_MINUTES, default 5), leaving a
    # window after a rebuild in which `python -m app.setup --fresh` can drop and recreate
    # the schema without a sync holding rh_* table locks. See app/jobs/scheduler.py.
    if settings.resource_sync_enabled:
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
app.add_middleware(SensitiveRateLimitMiddleware)
app.add_middleware(MaintenanceMiddleware)
# Required by Authlib's OAuth handshake to stash state/nonce between redirect
# and callback. Falls back to the JWT secret when SESSION_SECRET isn't set.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret or settings.jwt_secret_key,
    same_site="lax",
    https_only=False,
)
# Added LAST so it is the OUTERMOST middleware: assigns the request id before anything else
# and logs/measures every request (including ones the inner middlewares short-circuit).
app.add_middleware(ObservabilityMiddleware)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Full detail (with the request id) goes to the server log; the client gets a safe,
    # opaque message + the id so support can correlate — never a stack trace or internals.
    rid = request_id_ctx.get()
    metrics.incr("http.unhandled_exception")
    logger.error(
        "Unhandled error rid=%s %s %s → %s\n%s",
        rid, request.method, request.url.path, type(exc).__name__, traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong. Please try again.", "request_id": rid},
    )

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(chat.router)
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
app.include_router(school.router)
app.include_router(puzzles.router)
app.include_router(legal.router)
app.include_router(school_verification.router)
app.include_router(parent_settings.router)
app.include_router(teacher_settings.router)
app.include_router(admin_settings.router)
app.include_router(billing.router)
app.include_router(school_billing.router)
app.include_router(notifications_router.router)
app.include_router(observability_router.router)
