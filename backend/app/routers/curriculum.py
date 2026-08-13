"""
curriculum.py — read API over the Resource Hub mirror + admin sync controls.

GET endpoints back the lesson-setup curriculum pickers (Key Stage → Year Group →
Subject → Unit → Topic). Admin endpoints trigger / inspect the sync jobs.
"""
import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.middleware.auth import require_any_authenticated, require_admin
from app.models.user import User
from app.services import curriculum_service
from app.services.jobs import sync_service as resource_sync_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/curriculum", tags=["curriculum"])


def _rh_slides_dir() -> Path:
    return Path(settings.upload_dir).resolve().parent / "rh_slides"


@router.get("/tutors")
async def get_tutors(current_user: User = Depends(require_any_authenticated)):
    """The AI tutor voice personas a booker can choose from (name + gender + emoji). The chosen
    tutor id is written into the appointment description as `Tutor: <id>` and drives the lesson's
    Kokoro voice."""
    from app.services.agent.session.voice import list_tutors, DEFAULT_TUTOR
    return {"tutors": list_tutors(), "default": DEFAULT_TUTOR}


# Cache the synthesized sample per tutor — the line is fixed, so we only pay the
# Kokoro cost once per tutor per process.
_TUTOR_PREVIEW_CACHE: dict[str, bytes] = {}


@router.get("/tutors/{tutor_id}/preview")
async def preview_tutor_voice(tutor_id: str):
    """Synthesize a short spoken sample in the chosen tutor's voice so a booker can
    hear it before confirming. Public on purpose (a canned, non-sensitive line) so a
    plain <audio>/Audio() element can play it without auth headers."""
    from app.services.agent.session.voice import (
        text_to_speech, tutor_voice, normalise_tutor_id, TUTORS,
    )
    tid = normalise_tutor_id(tutor_id)
    if tid not in _TUTOR_PREVIEW_CACHE:
        name = TUTORS[tid]["name"]
        sample = f"Hi, I'm {name}. I'll be teaching you the lesson today!"
        try:
            wav, _mime = await asyncio.to_thread(text_to_speech, sample, "en", tutor_voice(tid))
        except Exception as exc:
            logger.warning("Tutor voice preview failed for %s: %s", tid, exc)
            raise HTTPException(status_code=503, detail="Voice preview unavailable")
        _TUTOR_PREVIEW_CACHE[tid] = wav
    return Response(
        content=_TUTOR_PREVIEW_CACHE[tid],
        media_type="audio/wav",
        headers={"Cache-Control": "public, max-age=86400"},
    )


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


@router.get("/animations/{key}.mp4")
async def get_animation(key: str):
    """Serve a rendered Manim animation MP4 from the cache (played in the session Learn panel)."""
    from app.services.agent.teacher_service import ANIM_DIR
    # `key` is a server-generated hash slug; refuse traversal characters defensively.
    if "/" in key or "\\" in key or ".." in key:
        raise HTTPException(status_code=400, detail="bad key")
    path = ANIM_DIR / f"{key}.mp4"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Animation not ready")
    return FileResponse(
        str(path), media_type="video/mp4",
        headers={"Cache-Control": "public, max-age=86400", "Content-Disposition": "inline"},
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
    target: str = Query("all", description="all | curriculum | resources"),
    current_user: User = Depends(require_admin),
):
    """Kick off a sync in the background (returns immediately)."""
    if target in ("all", "curriculum"):
        asyncio.create_task(resource_sync_service.sync_curriculum())
    if target in ("all", "resources"):
        asyncio.create_task(resource_sync_service.sync_resources())
    return {"status": "started", "target": target}


@router.get("/sync/status")
async def sync_status(current_user: User = Depends(require_admin)):
    return resource_sync_service.get_sync_state()
