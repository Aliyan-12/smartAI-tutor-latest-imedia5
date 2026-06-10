"""
session_resource_service.py — Resource Hub playlist + slide navigation for sessions.

Builds the per-lesson resource playlist (filtered by the lesson goal's preferred
resource types) and drives slide-by-slide navigation through it. The current
position (resource + slide) is persisted in LessonPlan.session_state["slide_state"]
so it survives across turns. Used by the advance/retreat/show_resource tools.
"""
import logging
import re
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resource_hub import RHResource, RHDocument, RHDocumentChunk

logger = logging.getLogger(__name__)

# goal → preferred resource types in priority order (falls back to all when empty).
_GOAL_TYPES: Dict[str, List[str]] = {
    "homework":            ["worksheet", "homework", "pdf", "powerpoint", "external_link"],
    "help_homework":       ["worksheet", "homework", "pdf", "powerpoint", "external_link"],
    "catch_up":            ["powerpoint", "worksheet", "homework", "pdf", "external_link"],
    "revision":            ["mark_scheme", "markscheme", "powerpoint", "pdf", "external_link", "youtube"],
    "test_prep":           ["mark_scheme", "markscheme", "powerpoint", "pdf", "external_link"],
    "learn_scratch":       ["powerpoint", "pdf", "worksheet", "external_link", "youtube"],
    "teach_from_scratch":  ["powerpoint", "pdf", "worksheet", "external_link", "youtube"],
}
_DEFAULT_TYPES = [
    "powerpoint", "pdf", "worksheet", "homework",
    "mark_scheme", "markscheme", "external_link", "youtube",
]


def goal_resource_types(goal: Optional[str]) -> List[str]:
    return _GOAL_TYPES.get((goal or "").lower(), _DEFAULT_TYPES)


def _parse_description(description: Optional[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"topics": [], "year_group": None}
    if not description:
        return out
    m = re.search(r"Topics?:\s*([^\n]+)", description, re.IGNORECASE)
    if m:
        out["topics"] = [t.strip() for t in m.group(1).split(",") if t.strip()]
    m = re.search(r"Year group:\s*([^\n]+)", description, re.IGNORECASE)
    if m:
        out["year_group"] = m.group(1).strip()
    return out


async def _get_resource(db: AsyncSession, hub_id: int) -> Optional[RHResource]:
    return (await db.execute(
        select(RHResource).where(RHResource.hub_id == hub_id)
    )).scalar_one_or_none()


async def _page_count(db: AsyncSession, resource: RHResource) -> int:
    doc = (await db.execute(
        select(RHDocument).where(RHDocument.resource_id == resource.id)
    )).scalar_one_or_none()
    return (doc.page_count if doc else resource.page_count) or 1


async def build_playlist(db: AsyncSession, appointment) -> List[RHResource]:
    """Ordered list of resources for the lesson, prioritised by the goal's types."""
    info = _parse_description(getattr(appointment, "description", "") or "")
    topics = info["topics"]
    year_group = info["year_group"]

    goal = None
    try:
        from app.models.lesson_plan import LessonPlan
        lp = (await db.execute(
            select(LessonPlan).where(LessonPlan.appointment_id == appointment.id)
        )).scalar_one_or_none()
        if lp:
            goal = lp.goal
    except Exception:  # noqa: BLE001
        pass
    types = goal_resource_types(goal)

    q = select(RHResource).where(
        RHResource.key_stage == appointment.key_stage,
        RHResource.subject_name == appointment.subject,
    )
    if year_group:
        q = q.where(RHResource.year_group == year_group)
    if topics:
        q = q.where(RHResource.unit_title.in_(topics))
    resources = list((await db.execute(q)).scalars().all())

    preferred = [r for r in resources if (r.resource_type or "").lower() in types]
    chosen = preferred if preferred else resources

    def sort_key(r: RHResource):
        t = (r.resource_type or "").lower()
        pri = types.index(t) if t in types else len(types)
        return (pri, r.unit_title or "", r.topic_title or "", r.hub_id)

    chosen.sort(key=sort_key)
    return chosen


async def get_slide_payload(db: AsyncSession, resource: RHResource, slide_index: int) -> Dict[str, Any]:
    """Resource + current-slide info for the viewer, plus the slide text for the AI."""
    doc = (await db.execute(
        select(RHDocument).where(RHDocument.resource_id == resource.id)
    )).scalar_one_or_none()
    page_count = (doc.page_count if doc else resource.page_count) or 1
    slide_index = max(1, min(slide_index, page_count))

    slide_content = ""
    if doc:
        rows = (await db.execute(
            select(RHDocumentChunk.content)
            .where(
                RHDocumentChunk.rh_document_id == doc.id,
                RHDocumentChunk.slide_index == slide_index,
            )
            .order_by(RHDocumentChunk.chunk_index)
        )).all()
        slide_content = "\n".join(r[0] for r in rows)

    def _https(url):
        # Hub stores http:// URLs that 301 to https; upgrade so the browser iframe
        # / Office viewer can load them (http would be blocked as mixed content).
        return url.replace("http://", "https://", 1) if url and url.startswith("http://") else url

    return {
        "resource_hub_id": resource.hub_id,
        "title": resource.title,
        "resource_type": resource.resource_type,
        "file_url": _https(resource.file_url),
        # App-served, slide-navigable PDF for Office decks (None for native
        # PDFs / links → viewer uses file_url / embed instead).
        "pdf_url": resource.rendered_pdf_url,
        "youtube_url": _https(resource.youtube_url),
        "external_url": _https(resource.external_url),
        "slide_index": slide_index,
        "page_count": page_count,
        "slide_content": slide_content,
        "action": "show_resource",
    }


async def get_current_slide(db: AsyncSession, appointment_id: int) -> Optional[Dict[str, Any]]:
    """The slide the lesson is currently on, initialising to the FIRST slide of the
    first resource when the lesson hasn't started navigating yet.

    Returns the same payload as the slide tools (incl. slide_content for the AI), or
    None when the lesson has no teaching resources. Used to anchor every teaching turn
    to the on-screen slide so the viewer never freezes and the AI always teaches the
    slide in view — independent of whether the model remembered to call a tool.
    """
    payload = await slide_action(db, appointment_id, mode="show")
    if not payload or payload.get("error"):
        return None
    return payload


async def slide_action(
    db: AsyncSession,
    appointment_id: int,
    mode: str,  # "show" | "advance" | "retreat"
    resource_hub_id: Optional[int] = None,
    slide_index: int = 1,
) -> Dict[str, Any]:
    """Resolve and persist the new slide position, returning the viewer payload."""
    from app.models.lesson_plan import LessonPlan
    from app.services.appointment_service import get_appointment

    appt = await get_appointment(db, appointment_id)
    if not appt:
        return {"error": "no_appointment", "action": "show_resource"}

    plan = (await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )).scalar_one_or_none()

    state = dict(plan.session_state) if (plan and plan.session_state) else {}
    slide_state = dict(state.get("slide_state") or {})
    playlist: List[int] = list(slide_state.get("playlist") or [])

    if not playlist:
        playlist = [r.hub_id for r in await build_playlist(db, appt)]
        slide_state["playlist"] = playlist

    if not playlist:
        return {
            "error": "no_resources",
            "message": "No teaching resources are available for this lesson yet.",
            "action": "show_resource",
        }

    cur_id = slide_state.get("current_resource_id")
    cur_slide = slide_state.get("current_slide_index", 1)

    if mode == "show" and resource_hub_id is not None:
        cur_id, cur_slide = resource_hub_id, slide_index
        if cur_id not in playlist:
            playlist.append(cur_id)
            slide_state["playlist"] = playlist
    elif mode == "advance":
        if cur_id is None:
            cur_id, cur_slide = playlist[0], 1
        else:
            res = await _get_resource(db, cur_id)
            pages = await _page_count(db, res) if res else 1
            cur_slide += 1
            if cur_slide > pages:
                i = playlist.index(cur_id) if cur_id in playlist else -1
                if 0 <= i < len(playlist) - 1:
                    cur_id, cur_slide = playlist[i + 1], 1
                else:
                    cur_slide = pages  # already at the last slide of the last resource
    elif mode == "retreat":
        if cur_id is None:
            cur_id, cur_slide = playlist[0], 1
        else:
            cur_slide -= 1
            if cur_slide < 1:
                i = playlist.index(cur_id) if cur_id in playlist else 0
                if i - 1 >= 0:
                    cur_id = playlist[i - 1]
                    prev = await _get_resource(db, cur_id)
                    cur_slide = await _page_count(db, prev) if prev else 1
                else:
                    cur_slide = 1
    else:  # "show" with no id, or initial call
        if cur_id is None:
            cur_id, cur_slide = playlist[0], 1

    resource = await _get_resource(db, cur_id)
    if not resource:
        return {"error": "resource_missing", "action": "show_resource"}

    payload = await get_slide_payload(db, resource, cur_slide)

    slide_state["current_resource_id"] = resource.hub_id
    slide_state["current_slide_index"] = payload["slide_index"]
    if plan is not None:
        state["slide_state"] = slide_state
        plan.session_state = state
        await db.flush()

    return payload
