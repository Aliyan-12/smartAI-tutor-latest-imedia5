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


# ── Goal × session-length RESOURCE POLICY ────────────────────────────────────────
# Which Resource-Hub material a lesson actually uses, so the four goals FEEL different:
#
#   every goal @ 20 min → NO resources at all (too short to open a deck): pure teaching,
#                         hands-on puzzles and a quiz.
#   learn_scratch 40+   → SLIDES, taught one at a time with short explanations/examples.
#   homework/catch_up   → WORKSHEET-LED: show the worksheet and help the student work
#            40+          through it, plus practice examples, quiz and summary.
#   revision 40+        → QUIZ SHEET first, then worksheet, then practice + quiz + summary.
#
# `style` is handed to the session prompt so the tutor teaches the material the right way.
_POLICY_STYLES = {
    "slides": "Teach the SLIDES one at a time — show a slide, explain it briefly with an example, then move on.",
    "worksheet": "WORKSHEET-LED: put the worksheet on screen and work through it WITH the student, question by question, then practice examples, a quiz and a summary.",
    "quiz_sheet": "EXAM-STYLE: lead with the quiz/exam sheet, then the worksheet, working through questions with the student, then practice, quiz and summary.",
    "none": "NO resources this session — teach directly, with hands-on puzzles and a quiz.",
}


def lesson_resource_policy(goal: Optional[str], duration_minutes: Optional[int]) -> Dict[str, Any]:
    """(use_resources, types, style, style_note) for this goal + length."""
    g = (goal or "").lower()
    mins = int(duration_minutes or 60)

    # A 20-minute lesson never opens the deck — there isn't time to teach from it.
    if mins <= 25:
        return {"use_resources": False, "types": [], "style": "none",
                "style_note": _POLICY_STYLES["none"]}

    if g in ("learn_scratch", "teach_from_scratch"):
        return {"use_resources": True, "types": ["powerpoint", "pdf"], "style": "slides",
                "style_note": _POLICY_STYLES["slides"]}

    if g in ("revision", "test_prep"):
        return {"use_resources": True,
                "types": ["quiz", "mark_scheme", "markscheme", "worksheet", "homework", "pdf"],
                "style": "quiz_sheet", "style_note": _POLICY_STYLES["quiz_sheet"]}

    # homework (Practice & Improve) / catch_up → worksheet-led
    return {"use_resources": True, "types": ["worksheet", "homework", "pdf"],
            "style": "worksheet", "style_note": _POLICY_STYLES["worksheet"]}


def _parse_description(description: Optional[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"topics": [], "year_group": None, "subtopic": None}
    if not description:
        return out
    m = re.search(r"Topics?:\s*([^\n]+)", description, re.IGNORECASE)
    if m:
        out["topics"] = [t.strip() for t in m.group(1).split(",") if t.strip()]
    m = re.search(r"Year group:\s*([^\n]+)", description, re.IGNORECASE)
    if m:
        out["year_group"] = m.group(1).strip()
    m = re.search(r"Subtopic:\s*([^\n]+)", description, re.IGNORECASE)
    if m:
        out["subtopic"] = m.group(1).strip()
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


async def _studied_subtopics(db: AsyncSession, student_id: int, subject: str,
                             unit_title: str, exclude_appointment_id) -> set:
    """Subtopic titles this student has ALREADY had a lesson on for this unit.

    Read from LessonPlan.subtopic of their earlier appointments — which is why the auto-picked
    subtopic is written back to the plan below: without that, an auto-scoped lesson would leave
    no trace and every future booking would restart at subtopic 1.
    """
    from app.models.lesson_plan import LessonPlan
    from app.models.appointment import Appointment
    try:
        rows = (await db.execute(
            select(LessonPlan.subtopic)
            .join(Appointment, Appointment.id == LessonPlan.appointment_id)
            .where(
                LessonPlan.student_id == student_id,
                LessonPlan.subtopic.isnot(None),
                LessonPlan.unit_name == unit_title,
                Appointment.subject == subject,
                Appointment.id != exclude_appointment_id,
            )
        )).all()
    except Exception:  # noqa: BLE001 — progression is a nicety, never break the lesson
        logger.warning("studied-subtopic lookup failed", exc_info=True)
        return set()
    return {(r[0] or "").strip().lower() for r in rows if r[0]}


async def _next_unstudied_subtopic(db: AsyncSession, appointment, unit_title: str):
    """The first subtopic of this unit the student hasn't covered yet (curriculum order),
    restricted to subtopics that actually HAVE resources. None when the unit has no subtopics —
    the caller then keeps the whole-unit behaviour."""
    from app.models.resource_hub import RHTopic, RHUnit

    unit = (await db.execute(
        select(RHUnit).where(RHUnit.title == unit_title)
    )).scalars().first()
    if not unit:
        return None
    subs = (await db.execute(
        select(RHTopic).where(RHTopic.unit_hub_id == unit.hub_id)
        .order_by(RHTopic.position, RHTopic.id)
    )).scalars().all()
    if not subs:
        return None

    # Only offer subtopics that have material to teach, in curriculum order, de-duplicated
    # (the hub carries repeated titles under one unit).
    with_res = {
        (r[0] or "").strip().lower()
        for r in (await db.execute(
            select(RHResource.topic_title).where(
                RHResource.unit_title == unit_title,
                RHResource.topic_title.isnot(None),
            )
        )).all()
    }
    ordered, seen = [], set()
    for t in subs:
        key = (t.title or "").strip().lower()
        if not key or key in seen or (with_res and key not in with_res):
            continue
        seen.add(key)
        ordered.append(t.title)
    if not ordered:
        return None

    studied = await _studied_subtopics(
        db, appointment.student_id, appointment.subject, unit_title, appointment.id,
    )
    nxt = next((t for t in ordered if t.strip().lower() not in studied), None)
    if nxt is None:
        # Whole unit already covered — start the cycle again rather than showing nothing.
        nxt = ordered[0]
        logger.info("PROGRESSION unit %r fully studied — restarting at %r", unit_title, nxt)
    return nxt


async def build_playlist(db: AsyncSession, appointment) -> List[RHResource]:
    """The ordered material for this lesson.

    Three things decide it:
      1. SCOPE — resources hang off SUBTOPICS in the hub (each sub-unit has its own PPT/worksheet).
         If the student picked a subtopic we teach THAT subtopic's material; otherwise the whole
         unit, in curriculum order.
      2. POLICY — the goal × length matrix (see `lesson_resource_policy`): a 20-minute lesson uses
         no resources at all, Learn-from-Scratch uses slides, Practice/Catch-up are worksheet-led,
         Exam Revision leads with the quiz sheet.
      3. ORDER — curriculum order (subtopic position, then type), NOT grouped by type. Grouping by
         type made the tutor walk every PowerPoint of every subtopic before any worksheet.
    """
    from app.models.resource_hub import RHTopic, RHUnit

    info = _parse_description(getattr(appointment, "description", "") or "")
    topics = info["topics"]
    year_group = info["year_group"]
    subtopic = info["subtopic"]

    goal = None
    lp = None
    try:
        from app.models.lesson_plan import LessonPlan
        lp = (await db.execute(
            select(LessonPlan).where(LessonPlan.appointment_id == appointment.id)
        )).scalar_one_or_none()
        if lp:
            goal = lp.goal
            subtopic = (lp.subtopic or subtopic) or None
    except Exception:  # noqa: BLE001
        pass

    # NO SUBTOPIC CHOSEN → teach ONE subtopic, starting at the first and advancing each time the
    # student comes back to this unit. Previously this pulled the WHOLE unit's material into one
    # lesson, so a 7-subtopic unit tried to cover everything at once. When a subtopic IS chosen we
    # never touch it — that lesson uses exactly that sub-unit's slides.
    auto_subtopic = None
    if not subtopic and topics:
        auto_subtopic = await _next_unstudied_subtopic(
            db, appointment, topics[0],
        )
        if auto_subtopic:
            subtopic = auto_subtopic

    policy = lesson_resource_policy(goal, getattr(appointment, "duration_minutes", None))
    if not policy["use_resources"]:
        return []                      # short lesson → teach directly, no deck
    types = policy["types"]

    q = select(RHResource).where(
        RHResource.key_stage == appointment.key_stage,
        RHResource.subject_name == appointment.subject,
    )
    if year_group:
        q = q.where(RHResource.year_group == year_group)
    if topics:
        q = q.where(RHResource.unit_title.in_(topics))
    resources = list((await db.execute(q)).scalars().all())

    # 1. Subtopic scope — one sub-unit's material, whether the student chose it or we advanced
    #    to it automatically.
    if subtopic:
        scoped = [r for r in resources
                  if (r.topic_title or "").strip().lower() == subtopic.strip().lower()]
        if scoped:
            resources = scoped
            # Record an AUTO-picked subtopic on the plan the first time we resolve it, so the
            # student's NEXT booking on this unit starts at the following subtopic instead of
            # repeating this one. Only ever fills a blank — an explicit choice is never touched.
            if auto_subtopic and lp is not None and not lp.subtopic:
                try:
                    lp.subtopic = auto_subtopic
                    if not lp.unit_name and topics:
                        lp.unit_name = topics[0]
                    await db.flush()
                    logger.info("PROGRESSION appt=%s auto-selected subtopic %r for unit %r",
                                appointment.id, auto_subtopic, topics[0] if topics else None)
                except Exception:  # noqa: BLE001
                    logger.warning("failed to persist auto subtopic", exc_info=True)

    # 2. Policy types (fall back to whatever exists rather than showing nothing).
    preferred = [r for r in resources if (r.resource_type or "").lower() in types]
    chosen = preferred if preferred else resources
    if not chosen:
        return []

    # 3. Curriculum order: subtopic position within the unit, then the policy's type priority.
    positions: Dict[str, int] = {}
    try:
        unit_ids = {r.unit_hub_id for r in chosen if r.unit_hub_id is not None}
        if unit_ids:
            rows = (await db.execute(
                select(RHTopic.title, RHTopic.position).where(RHTopic.unit_hub_id.in_(unit_ids))
            )).all()
            for title, pos in rows:
                key = (title or "").strip().lower()
                if key not in positions:
                    positions[key] = pos or 0
    except Exception:  # noqa: BLE001 — ordering is a nicety, never break the lesson
        positions = {}

    def sort_key(r: RHResource):
        t = (r.resource_type or "").lower()
        pri = types.index(t) if t in types else len(types)
        pos = positions.get((r.topic_title or "").strip().lower(), 10_000)
        return (r.unit_title or "", pos, pri, r.hub_id)

    chosen.sort(key=sort_key)
    logger.info(
        "PLAYLIST appt=%s goal=%s dur=%s style=%s subtopic=%r -> %d resources",
        getattr(appointment, "id", None), goal,
        getattr(appointment, "duration_minutes", None), policy["style"], subtopic, len(chosen),
    )
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
