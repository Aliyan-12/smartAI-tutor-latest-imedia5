"""
resource_sync_service.py — background jobs that mirror the Resource Hub.

Job 1  sync_curriculum()  — keystages → years → subjects → units → topics + the
                            (key_stage, year_group) → subject availability edges.
Job 2  sync_resources()   — resources + per-slide vectorization (implemented in
                            Phase 4; resources are currently unpublished on the hub).

Both jobs open their own AsyncSession (they run outside request scope) and are
idempotent: upsert by the hub's own id, prune rows whose hub id has vanished.
Run on startup + on an interval by app.jobs.scheduler, or on demand via the
admin endpoint POST /api/curriculum/sync.
"""
import asyncio
import hashlib
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import select, delete

from app.core.config import settings
from app.db.session import async_session_factory
from app.models.resource_hub import (
    RHKeyStage, RHYearGroup, RHSubject, RHUnit, RHTopic, RHAvailability,
    RHResource, RHDocument, RHDocumentChunk, RHTopicImage, NON_FILE_RESOURCE_TYPES,
)
from app.services import document_service
from app.services.rag_service import embed_batch
from app.services.resource_hub_client import ResourceHubClient

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


_sync_state: Dict[str, Dict[str, Any]] = {
    "curriculum": {"running": False, "last_run": None, "last_error": None, "counts": {}},
    "resources": {"running": False, "last_run": None, "last_error": None, "counts": {}},
    "topic_images": {"running": False, "last_run": None, "last_error": None, "counts": {}},
}


def get_sync_state() -> Dict[str, Dict[str, Any]]:
    return _sync_state


# ===========================================================================
# Job 1 — curriculum tree
# ===========================================================================

async def sync_curriculum() -> Dict[str, Any]:
    state = _sync_state["curriculum"]
    if state["running"]:
        logger.info("Curriculum sync already running; skipping.")
        return state
    state["running"] = True
    counts = {"keystages": 0, "years": 0, "subjects": 0, "units": 0, "topics": 0, "availability": 0}
    try:
        # ---- 1. Pull the whole tree from the hub (network) ----
        async with ResourceHubClient() as hub:
            keystages = await hub.get_keystages()

            years_by_ks: Dict[str, list] = {}
            for ks in keystages:
                yrs = await hub.get_years(ks)
                years_by_ks[ks] = yrs if isinstance(yrs, list) else []

            # Subjects: global catalog + per-(ks, year) availability.
            global_subs = await hub.get_subjects()
            subjects_by_id: Dict[int, str] = {
                s["id"]: s.get("name", "") for s in global_subs if s.get("id") is not None
            }
            subject_edges = set()  # (key_stage, year_group, subject_hub_id)
            for ks in keystages:
                for y in years_by_ks[ks]:
                    subs = await hub.get_subjects(ks, y)
                    # NO fallback here. If the hub lists no subjects for this exact
                    # (key stage, year), there is genuinely nothing available there —
                    # falling back to the ks-level / global catalogue fabricated
                    # phantom edges (e.g. KS4/KS5 year groups that the hub has no
                    # subjects for) which then showed subjects with no units/resources.
                    # Trust the hub's (ks, year) answer verbatim.
                    for s in (subs or []):
                        sid = s.get("id")
                        if sid is None:
                            continue
                        subjects_by_id[sid] = s.get("name", "")
                        subject_edges.add((ks, y, sid))

            # Units + topics per subject (full catalogue, year-agnostic).
            units_by_id: Dict[int, tuple] = {}   # uid -> (subject_id, title, unit_number)
            topics_by_id: Dict[int, tuple] = {}  # tid -> (unit_id, title, position)
            for sid in list(subjects_by_id.keys()):
                for u in await hub.get_units(sid):
                    uid = u.get("id")
                    if uid is None:
                        continue
                    units_by_id[uid] = (sid, u.get("title", ""), u.get("unitNumber"))
                    for pos, t in enumerate(await hub.get_topics(uid)):
                        tid = t.get("id")
                        if tid is None:
                            continue
                        topics_by_id[tid] = (uid, t.get("title", ""), pos)

            # Unit-level availability edges: which units belong to each
            # (key_stage, year_group). Units link to a subject only, so a
            # subject spans every year; the hub's units endpoint honours the
            # keyStage/yearGroup filters, so we re-query per (ks, year, subject)
            # to learn each unit's year. Powers year-group-scoped unit pickers.
            unit_edges = set()  # (key_stage, year_group, subject_hub_id, unit_hub_id)
            for ks, y, sid in subject_edges:
                for u in await hub.get_units(sid, ks, y):
                    uid = u.get("id")
                    if uid is not None:
                        unit_edges.add((ks, y, sid, uid))

        # ---- 2. Persist idempotently in one transaction ----
        async with async_session_factory() as db:
            # keystages
            existing_ks = {k.code: k for k in (await db.execute(select(RHKeyStage))).scalars()}
            for pos, ks in enumerate(keystages):
                obj = existing_ks.get(ks)
                if obj:
                    obj.position, obj.synced_at = pos, _utcnow()
                else:
                    db.add(RHKeyStage(code=ks, position=pos))
            for code, obj in existing_ks.items():
                if code not in keystages:
                    await db.delete(obj)
            counts["keystages"] = len(keystages)

            # year groups
            seen_years = {(ks, y) for ks in keystages for y in years_by_ks[ks]}
            existing_y = {
                (yg.key_stage_code, yg.name): yg
                for yg in (await db.execute(select(RHYearGroup))).scalars()
            }
            for ks in keystages:
                for pos, y in enumerate(years_by_ks[ks]):
                    obj = existing_y.get((ks, y))
                    if obj:
                        obj.position, obj.synced_at = pos, _utcnow()
                    else:
                        db.add(RHYearGroup(key_stage_code=ks, name=y, position=pos))
            for key, obj in existing_y.items():
                if key not in seen_years:
                    await db.delete(obj)
            counts["years"] = len(seen_years)

            # subjects
            existing_s = {s.hub_id: s for s in (await db.execute(select(RHSubject))).scalars()}
            for sid, name in subjects_by_id.items():
                obj = existing_s.get(sid)
                if obj:
                    obj.name, obj.synced_at = name, _utcnow()
                else:
                    db.add(RHSubject(hub_id=sid, name=name))
            for sid, obj in existing_s.items():
                if sid not in subjects_by_id:
                    await db.delete(obj)
            counts["subjects"] = len(subjects_by_id)

            # units
            existing_u = {u.hub_id: u for u in (await db.execute(select(RHUnit))).scalars()}
            for uid, (sid, title, unum) in units_by_id.items():
                obj = existing_u.get(uid)
                if obj:
                    obj.subject_hub_id, obj.title, obj.unit_number, obj.synced_at = sid, title, unum, _utcnow()
                else:
                    db.add(RHUnit(hub_id=uid, subject_hub_id=sid, title=title, unit_number=unum))
            for uid, obj in existing_u.items():
                if uid not in units_by_id:
                    await db.delete(obj)
            counts["units"] = len(units_by_id)

            # topics
            existing_t = {t.hub_id: t for t in (await db.execute(select(RHTopic))).scalars()}
            for tid, (uid, title, pos) in topics_by_id.items():
                obj = existing_t.get(tid)
                if obj:
                    obj.unit_hub_id, obj.title, obj.position, obj.synced_at = uid, title, pos, _utcnow()
                else:
                    db.add(RHTopic(hub_id=tid, unit_hub_id=uid, title=title, position=pos))
            for tid, obj in existing_t.items():
                if tid not in topics_by_id:
                    await db.delete(obj)
            counts["topics"] = len(topics_by_id)

            # availability — rebuild subject-level AND unit-level edges from
            # scratch. Subject-level edges (unit_hub_id NULL) drive the subject
            # picker; unit-level edges (unit_hub_id set) scope the unit picker
            # to a year group. sync_resources re-adds its derived subject edges
            # on its own run (it checks for existence first).
            await db.execute(delete(RHAvailability))
            for ks, y, sid in subject_edges:
                db.add(RHAvailability(key_stage=ks, year_group=y, subject_hub_id=sid))
            for ks, y, sid, uid in unit_edges:
                db.add(RHAvailability(
                    key_stage=ks, year_group=y, subject_hub_id=sid, unit_hub_id=uid,
                ))
            counts["availability"] = len(subject_edges) + len(unit_edges)

            await db.commit()

        state["last_error"] = None
        state["counts"] = counts
        logger.info("Curriculum sync complete: %s", counts)
        # Chain the topic-image catalog refresh now that the topic list is current.
        # Non-blocking + idempotent (only fills in NEW topics), so it runs after EVERY
        # successful curriculum sync — startup, scheduled interval, or manual trigger.
        try:
            asyncio.create_task(sync_topic_images())
            logger.info("TOPIC_IMAGE sync chained after successful curriculum sync.")
        except RuntimeError:
            logger.debug("No running event loop — skipping chained topic-image sync.")
    except Exception as exc:  # noqa: BLE001 — job must never crash the scheduler
        state["last_error"] = str(exc)
        logger.exception("Curriculum sync failed: %s", exc)
    finally:
        state["running"] = False
        state["last_run"] = _utcnow().isoformat()
    return state


# ===========================================================================
# Job 2 — resources + per-slide vectorization
# ===========================================================================

def _parse_hub_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _content_hash(resource: dict) -> str:
    basis = f"{resource.get('fileUrl')}|{resource.get('createdAt')}|{resource.get('title')}"
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _detect_file_type(url: Optional[str], resource_type: Optional[str]) -> Optional[str]:
    u = (url or "").lower().split("?")[0]
    for ext in ("pdf", "pptx", "docx", "txt"):
        if u.endswith("." + ext):
            return ext
    if u.endswith(".ppt"):
        return "pptx"
    if u.endswith(".doc"):
        return "docx"
    rt = (resource_type or "").lower()
    if "powerpoint" in rt or "slide" in rt or rt in ("ppt", "pptx"):
        return "pptx"
    if rt == "pdf":
        return "pdf"
    if "doc" in rt:
        return "docx"
    # File-based but unknown extension (e.g. a worksheet with no suffix) → try PDF.
    return "pdf" if url else None


def _rh_slides_dir() -> str:
    """uploads/rh_slides/ — sibling of settings.upload_dir, holds rendered slide PDFs."""
    d = Path(settings.upload_dir).resolve().parent / "rh_slides"
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def _render_resource_pdf(src_path: str, hub_id: int) -> Optional[str]:
    """Render an Office file to a navigable PDF stored at uploads/rh_slides/<hub_id>.pdf.

    Returns the app-served URL path the session viewer loads in its iframe
    (/api/curriculum/resources/<hub_id>/slides.pdf), or None if LibreOffice is
    unavailable / conversion fails (the viewer then falls back to the Office embed).
    """
    out_dir = _rh_slides_dir()
    produced = document_service.convert_to_pdf(src_path, out_dir)
    if not produced:
        return None
    final = os.path.join(out_dir, f"{hub_id}.pdf")
    try:
        if os.path.abspath(produced) != os.path.abspath(final):
            os.replace(produced, final)
    except OSError as exc:
        logger.warning("Could not store rendered PDF for resource %s: %s", hub_id, exc)
        return None
    return f"/api/curriculum/resources/{hub_id}/slides.pdf"


async def _download(url: str, dest_path: str) -> None:
    headers = {}
    if settings.resourcehub_api_key:
        headers["Authorization"] = f"Bearer {settings.resourcehub_api_key}"
    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0), follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        with open(dest_path, "wb") as fh:
            fh.write(resp.content)


async def _vectorize_resource(db, resource: RHResource) -> None:
    """Download a file-based resource, extract per-slide text, embed, and store."""
    file_type = _detect_file_type(resource.file_url, resource.resource_type)
    if not resource.file_url or not file_type:
        resource.vectorize_status = "skipped"
        return

    rendered_pdf_url: Optional[str] = None
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_type}")
    tmp.close()
    try:
        await _download(resource.file_url, tmp.name)
        with open(tmp.name, "rb") as fh:
            head = fh.read(512).lstrip().lower()
        if head.startswith(b"<!doctype") or head.startswith(b"<html"):
            raise ValueError(
                "fileUrl returned an HTML page, not a file — the Resource Hub is not "
                "serving this upload (check static serving for /uploads)."
            )
        pages: List[Tuple[int, str]] = await asyncio.to_thread(
            document_service.extract_pages, tmp.name, file_type
        )
        # Office formats (pptx/docx) can't be deep-linked in the Office embed, so
        # render them to a navigable PDF for the in-session viewer (#page=N).
        # Native PDFs are already navigable via their own fileUrl. Non-fatal.
        if file_type in ("pptx", "docx"):
            rendered_pdf_url = await asyncio.to_thread(
                _render_resource_pdf, tmp.name, resource.hub_id
            )
    except Exception as exc:  # noqa: BLE001
        resource.vectorize_status = "failed"
        resource.error_message = str(exc)[:500]
        logger.warning("Resource %s download/extract failed: %s", resource.hub_id, exc)
        return
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    # Record the rendered-PDF URL (None → viewer uses the Office embed fallback).
    resource.rendered_pdf_url = rendered_pdf_url

    # Per-slide chunks: (slide_index, content, token_count)
    slide_chunks: List[Tuple[int, str, int]] = []
    for slide_index, text in pages:
        if not text or not text.strip():
            continue
        for content, tok in document_service.chunk_text(
            text, settings.rag_chunk_size, settings.rag_chunk_overlap
        ):
            slide_chunks.append((slide_index, content, tok))

    if not slide_chunks:
        resource.vectorize_status = "failed"
        resource.error_message = "No extractable text"
        return

    embeddings = await embed_batch([c[1] for c in slide_chunks])

    # Replace any existing document + chunks for this resource.
    existing = (await db.execute(
        select(RHDocument).where(RHDocument.resource_id == resource.id)
    )).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.flush()

    doc = RHDocument(
        resource_id=resource.id, file_url=resource.file_url, file_type=file_type,
        page_count=len(pages), status="ready",
    )
    db.add(doc)
    await db.flush()

    for idx, ((slide_index, content, tok), embedding) in enumerate(zip(slide_chunks, embeddings)):
        db.add(RHDocumentChunk(
            rh_document_id=doc.id, chunk_index=idx, slide_index=slide_index,
            content=content, embedding=embedding, token_count=tok,
        ))

    resource.vectorize_status = "ready"
    resource.page_count = len(pages)
    resource.error_message = None


async def sync_resources() -> Dict[str, Any]:
    state = _sync_state["resources"]
    if state["running"]:
        logger.info("Resource sync already running; skipping.")
        return state
    state["running"] = True
    counts = {"resources": 0, "vectorized": 0, "skipped": 0, "failed": 0, "pruned": 0}
    try:
        # 1. Pull every published resource from the hub.
        items: List[dict] = []
        async with ResourceHubClient() as hub:
            async for r in hub.iter_resources(limit=100):
                items.append(r)

        async with async_session_factory() as db:
            # Lookups to resolve curriculum links by name.
            subjects = {s.name: s.hub_id for s in (await db.execute(select(RHSubject))).scalars()}
            units = {u.title: u.hub_id for u in (await db.execute(select(RHUnit))).scalars()}
            topics = {t.title: t.hub_id for t in (await db.execute(select(RHTopic))).scalars()}
            existing = {r.hub_id: r for r in (await db.execute(select(RHResource))).scalars()}

            seen_ids = set()
            for item in items:
                hub_id = item.get("id")
                if hub_id is None:
                    continue
                seen_ids.add(hub_id)
                counts["resources"] += 1

                new_hash = _content_hash(item)
                resource = existing.get(hub_id)
                is_new = resource is None
                if is_new:
                    resource = RHResource(hub_id=hub_id)
                    db.add(resource)

                # Metadata (always refreshed).
                resource.title = item.get("title") or "Untitled"
                resource.description = item.get("description")
                resource.resource_type = (item.get("resourceType") or "unknown").lower()
                resource.key_stage = item.get("keyStage")
                resource.year_group = item.get("yearGroup")
                resource.subject_name = item.get("subject")
                resource.unit_title = item.get("unitTitle")
                resource.topic_title = item.get("topicTitle")
                resource.subject_hub_id = subjects.get(item.get("subject"))
                resource.unit_hub_id = units.get(item.get("unitTitle"))
                resource.topic_hub_id = topics.get(item.get("topicTitle"))
                resource.file_url = item.get("fileUrl")
                resource.youtube_url = item.get("youtubeUrl")
                resource.external_url = item.get("externalUrl")
                resource.tags = item.get("tags")
                resource.created_at_hub = _parse_hub_dt(item.get("createdAt"))
                resource.raw_json = item
                resource.synced_at = _utcnow()
                await db.flush()  # assign resource.id for new rows

                # Derive a subject-availability edge straight from the resource.
                if resource.key_stage and resource.year_group and resource.subject_hub_id:
                    exists_edge = (await db.execute(
                        select(RHAvailability.id).where(
                            RHAvailability.key_stage == resource.key_stage,
                            RHAvailability.year_group == resource.year_group,
                            RHAvailability.subject_hub_id == resource.subject_hub_id,
                            RHAvailability.unit_hub_id.is_(None),
                        )
                    )).first()
                    if not exists_edge:
                        db.add(RHAvailability(
                            key_stage=resource.key_stage, year_group=resource.year_group,
                            subject_hub_id=resource.subject_hub_id,
                        ))

                # Vectorize file-based resources (skip videos / links / unchanged).
                rtype = resource.resource_type
                # Office decks need a rendered PDF for the slide viewer; if a
                # previously-synced one lacks it, re-process even when unchanged.
                _ftype = _detect_file_type(resource.file_url, rtype)
                _missing_pdf = _ftype in ("pptx", "docx") and not resource.rendered_pdf_url
                if rtype in NON_FILE_RESOURCE_TYPES or not resource.file_url:
                    resource.vectorize_status = "skipped"
                    counts["skipped"] += 1
                elif (
                    not is_new and resource.content_hash == new_hash
                    and resource.vectorize_status == "ready" and not _missing_pdf
                ):
                    pass  # unchanged, already vectorized + rendered
                else:
                    await _vectorize_resource(db, resource)
                    if resource.vectorize_status == "ready":
                        counts["vectorized"] += 1
                    elif resource.vectorize_status == "skipped":
                        counts["skipped"] += 1
                    else:
                        counts["failed"] += 1

                resource.content_hash = new_hash
                await db.flush()

            # Prune resources removed from the hub.
            for hub_id, resource in existing.items():
                if hub_id not in seen_ids:
                    await db.delete(resource)
                    counts["pruned"] += 1

            await db.commit()

        state["last_error"] = None
        state["counts"] = counts
        logger.info("Resource sync complete: %s", counts)
    except Exception as exc:  # noqa: BLE001
        state["last_error"] = str(exc)
        logger.exception("Resource sync failed: %s", exc)
    finally:
        state["running"] = False
        state["last_run"] = _utcnow().isoformat()
    return state


# ===========================================================================
# Job 3 — topic-image catalog (representative image per curriculum topic)
# ===========================================================================

async def _upsert_topic_images(rows: List[dict]) -> None:
    """Persist a batch of resolved topic-image rows (own session + commit) so progress
    survives an interrupt and a re-run resumes where it left off."""
    if not rows:
        return
    async with async_session_factory() as db:
        ids = [r["topic_hub_id"] for r in rows]
        existing = {ti.topic_hub_id: ti for ti in (await db.execute(
            select(RHTopicImage).where(RHTopicImage.topic_hub_id.in_(ids))
        )).scalars()}
        for r in rows:
            row = existing.get(r["topic_hub_id"])
            if row is None:
                row = RHTopicImage(topic_hub_id=r["topic_hub_id"])
                db.add(row)
            row.topic_title = r["topic_title"]
            row.unit_hub_id = r["unit_hub_id"]
            row.subject_name = r["subject_name"]
            row.key_stage = r["key_stage"]
            row.year_group = r["year_group"]
            row.image_url = r["image_url"]
            row.thumb_url = r["thumb_url"]
            row.source = r["source"]
            row.attribution = r["attribution"]
            row.license = r["license"]
            row.status = r["status"]
            row.synced_at = _utcnow()
        await db.commit()


async def sync_topic_images(force: bool = False, limit: Optional[int] = None,
                            batch_size: int = 20, on_progress=None) -> Dict[str, Any]:
    """Resolve a representative image for every curriculum topic (Wikipedia lead image)
    and cache it in RHTopicImage. Idempotent: topics already resolved (status='ok') are
    skipped unless force=True. Rate-limited and resilient — a topic with no confident
    image is recorded status='none', and results are committed in BATCHES so an
    interrupt/crash never loses prior progress and a re-run resumes where it left off.

    on_progress(done, total, counts) is called after each batch (the CLI prints it).
    Runs after curriculum sync so new topics get images; safe to run on demand."""
    from app.services import topic_image_service  # lazy → avoids httpx import at module load

    state = _sync_state["topic_images"]
    if state["running"]:
        logger.info("Topic-image sync already running; skipping.")
        return state
    state["running"] = True
    counts = {"total": 0, "resolved": 0, "none": 0, "error": 0, "skipped": 0}
    try:
        # 1) Read the topic list + coordinate maps (one session, no network).
        async with async_session_factory() as db:
            subjects = {s.hub_id: s.name for s in (await db.execute(select(RHSubject))).scalars()}
            units = {u.hub_id: u for u in (await db.execute(select(RHUnit))).scalars()}
            avail: Dict[int, tuple] = {}  # unit_hub_id -> (key_stage, year_group)
            for a in (await db.execute(
                select(RHAvailability).where(RHAvailability.unit_hub_id.isnot(None))
            )).scalars():
                avail.setdefault(a.unit_hub_id, (a.key_stage, a.year_group))
            topics = (await db.execute(select(RHTopic))).scalars().all()
            existing = {ti.topic_hub_id: ti
                        for ti in (await db.execute(select(RHTopicImage))).scalars()}

        todo = [t for t in topics
                if force or not (existing.get(t.hub_id) and existing[t.hub_id].status == "ok")]
        if limit:
            todo = todo[:limit]
        counts["total"] = len(topics)
        counts["skipped"] = len(topics) - len(todo)
        logger.info("TOPIC_IMAGE sync starting: %s topics, %s to resolve (force=%s)",
                    len(topics), len(todo), force)
        if on_progress:
            on_progress(0, len(todo), counts)

        # 2) Resolve images (network), rate-limited, committing in batches.
        batch: List[dict] = []
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0), follow_redirects=True,
            headers={"User-Agent": topic_image_service._UA},
        ) as client:
            for i, t in enumerate(todo):
                unit = units.get(t.unit_hub_id)
                subject_name = subjects.get(unit.subject_hub_id) if unit else None
                ks, yr = avail.get(t.unit_hub_id, (None, None))
                res = await topic_image_service.resolve_image(t.title, subject_name, client=client)
                batch.append({
                    "topic_hub_id": t.hub_id, "topic_title": t.title,
                    "unit_hub_id": t.unit_hub_id, "subject_name": subject_name,
                    "key_stage": ks, "year_group": yr, **res,
                })
                # resolve_image() returns status 'ok'/'none'/'error'; the progress dict
                # tracks the resolved ('ok') rows under the key 'resolved'.
                _ck = "resolved" if res["status"] == "ok" else res["status"]
                counts[_ck] = counts.get(_ck, 0) + 1
                await asyncio.sleep(0.1)  # be polite to the Wikipedia API
                if len(batch) >= batch_size:
                    await _upsert_topic_images(batch)
                    batch = []
                    logger.info("TOPIC_IMAGE progress: %s/%s (resolved=%s none=%s error=%s)",
                                i + 1, len(todo), counts["resolved"], counts["none"], counts["error"])
                    if on_progress:
                        on_progress(i + 1, len(todo), counts)
        # Final partial batch.
        await _upsert_topic_images(batch)
        if on_progress:
            on_progress(len(todo), len(todo), counts)

        state["last_error"] = None
        state["counts"] = counts
        logger.info(
            "TOPIC_IMAGE sync complete: resolved=%s none=%s error=%s of total=%s (skipped=%s)",
            counts["resolved"], counts["none"], counts["error"], counts["total"], counts["skipped"],
        )
    except Exception as exc:  # noqa: BLE001 — job must never crash the scheduler
        state["last_error"] = str(exc)
        logger.exception("Topic-image sync failed: %s", exc)
    finally:
        state["running"] = False
        state["last_run"] = _utcnow().isoformat()
    return state
