"""Liveness, readiness and dependency health (feature 15)."""
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health_check():
    """Liveness — the process is up. Cheap and dependency-free."""
    return {"status": "healthy", "service": "SmartAI Tutor API"}


@router.get("/api/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)):
    """Readiness — can we serve traffic? Checks the database. 503 if not."""
    try:
        await db.execute(text("SELECT 1"))
        return {"status": "ready", "database": "ok"}
    except Exception as e:
        logger.warning("readiness DB check failed: %s", e)
        return JSONResponse(status_code=503, content={"status": "not_ready", "database": "error"})


@router.get("/api/health/deps")
async def dependencies(db: AsyncSession = Depends(get_db)):
    """Provider/dependency health snapshot for ops dashboards."""
    from app.core.config import settings
    from app.services.billing.provider import is_mock

    db_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    return {
        "database": "ok" if db_ok else "error",
        "billing_provider": "mock" if is_mock() else "stripe",
        "billing_mode": settings.stripe_mode,
        "resource_hub_configured": bool(settings.resourcehub_api_key),
        "email_enabled": bool(getattr(settings, "email_enabled", False)),
        "ai_configured": bool(settings.gemini_api_key),
    }
