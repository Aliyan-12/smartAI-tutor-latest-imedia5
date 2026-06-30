"""
curriculum.py — read API over the Resource Hub mirror + admin sync controls.

GET endpoints back the lesson-setup curriculum pickers (Key Stage → Year Group →
Subject → Unit → Topic). Admin endpoints trigger / inspect the sync jobs.
"""
import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.middleware.auth import require_any_authenticated, require_admin
from app.models.user import User
from app.services import curriculum_service, resource_sync_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/curriculum", tags=["curriculum"])


def _rh_slides_dir() -> Path:
    return Path(settings.upload_dir).resolve().parent / "rh_slides"


@router.get("/resources/{hub_id}/slides.pdf")
async def get_resource_slides_pdf(hub_id: int):
    """Serve the LibreOffice-rendered slide PDF for a resource.

    Public + framable on purpose: it is loaded in the session ResourceViewer
    iframe with `#page=N` so the AI can drive slide-by-slide navigation. The
    Resource Hub already serves the underlying files publicly.
    """
    path = _rh_slides_dir() / f"{hub_id}.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Rendered slides not available")
    return FileResponse(
        str(path),
        media_type="application/pdf",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": "inline",
        },
    )


@router.get("/keystages")
async def list_keystages(
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    return {"keystages": await curriculum_service.get_keystages(db)}


@router.get("/years")
async def list_years(
    keyStage: str | None = Query(None),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    return {"years": await curriculum_service.get_years(db, keyStage)}


@router.get("/subjects")
async def list_subjects(
    keyStage: str | None = Query(None),
    yearGroup: str | None = Query(None),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    return {"subjects": await curriculum_service.get_subjects(db, keyStage, yearGroup)}


@router.get("/units")
async def list_units(
    subjectId: int = Query(...),
    keyStage: str | None = Query(None),
    yearGroup: str | None = Query(None),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    return {"units": await curriculum_service.get_units(db, subjectId, keyStage, yearGroup)}


@router.get("/topics")
async def list_topics(
    unitId: int = Query(...),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    return {"topics": await curriculum_service.get_topics_by_unit(db, unitId)}


# ---- Admin: sync controls ----

@router.post("/sync")
async def trigger_sync(
    target: str = Query("all", description="all | curriculum | resources | topic_images"),
    force: bool = Query(False, description="topic_images: re-resolve rows already cached"),
    current_user: User = Depends(require_admin),
):
    """Kick off a sync in the background (returns immediately). The topic-image catalog
    is refreshed automatically after each successful curriculum sync; target=topic_images
    is only needed for a manual / forced re-resolve."""
    if target in ("all", "curriculum"):
        # sync_curriculum chains sync_topic_images on success.
        asyncio.create_task(resource_sync_service.sync_curriculum())
    if target in ("all", "resources"):
        asyncio.create_task(resource_sync_service.sync_resources())
    if target == "topic_images":
        asyncio.create_task(resource_sync_service.sync_topic_images(force=force))
    return {"status": "started", "target": target}


@router.get("/sync/status")
async def sync_status(current_user: User = Depends(require_admin)):
    return resource_sync_service.get_sync_state()
