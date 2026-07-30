"""
session_state_service.py — tiny shared helpers over LessonPlan.session_state for
session-lifecycle flags (currently `end_allowed`).

Kept in its own module so the WS handlers + watchdog (session_agent_service) and
the `end_lesson` tool (platform_tools) can all read/write the SAME source of truth
without importing each other (avoids circular imports). The `end_allowed` flag is
what makes "the AI cannot end mid-lesson" a hard, server-enforced rule: it is only
set True when the watchdog fires `lesson.timeout` or the student requests end.
"""
import logging
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def _load_plan(db: AsyncSession, appointment_id: int):
    from app.models.lesson_plan import LessonPlan
    return (await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )).scalar_one_or_none()


async def set_flag(db: AsyncSession, appointment_id: int, key: str, value: Any) -> None:
    plan = await _load_plan(db, appointment_id)
    if plan is None:
        return
    state = dict(plan.session_state) if plan.session_state else {}
    state[key] = value
    plan.session_state = state
    await db.flush()


async def get_flag(db: AsyncSession, appointment_id: int, key: str, default: Any = None) -> Any:
    plan = await _load_plan(db, appointment_id)
    if plan is None or not plan.session_state:
        return default
    return plan.session_state.get(key, default)


async def set_end_allowed(db: AsyncSession, appointment_id: int, value: bool = True) -> None:
    await set_flag(db, appointment_id, "end_allowed", bool(value))
    logger.info("session_state: end_allowed=%s appt=%s", bool(value), appointment_id)


async def is_end_allowed(db: AsyncSession, appointment_id: int) -> bool:
    return bool(await get_flag(db, appointment_id, "end_allowed", False))
