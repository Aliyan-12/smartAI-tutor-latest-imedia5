import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.appointment import Appointment
from app.models.user import User
from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_week_bounds(dt: datetime) -> tuple:
    monday = dt - timedelta(days=dt.weekday())
    start = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    return start, end


async def count_weekly_appointments(db: AsyncSession, student_id: int, target_date: datetime) -> int:
    start, end = _get_week_bounds(target_date)
    result = await db.execute(
        select(func.count(Appointment.id))
        .where(
            Appointment.student_id == student_id,
            Appointment.scheduled_at >= start,
            Appointment.scheduled_at < end,
            Appointment.status != "cancelled",
        )
    )
    return result.scalar() or 0


async def book_appointment(
    db: AsyncSession,
    student_id: int,
    teacher_id: int,
    booked_by: int,
    subject: str,
    key_stage: str,
    title: str,
    scheduled_at: datetime,
    duration_minutes: int = 60,
    description: Optional[str] = None,
    payment_amount: Optional[float] = 25.00,
    notes: Optional[str] = None,
    passcode: Optional[str] = None,
) -> Appointment:
    weekly_count = await count_weekly_appointments(db, student_id, scheduled_at)
    max_per_week = settings.max_appointments_per_week

    if weekly_count >= max_per_week:
        raise ValueError(
            f"Student already has {weekly_count} classes this week (max {max_per_week})"
        )

    appointment = Appointment(
        student_id=student_id,
        teacher_id=teacher_id,
        booked_by=booked_by,
        subject=subject,
        key_stage=key_stage,
        title=title,
        scheduled_at=scheduled_at,
        duration_minutes=duration_minutes,
        description=description,
        payment_amount=payment_amount,
        notes=notes,
        passcode=passcode or None,
        status="booked",
        payment_status="pending",
    )
    db.add(appointment)
    await db.flush()
    await db.refresh(appointment)
    return appointment


async def update_status(db: AsyncSession, appointment: Appointment, new_status: str) -> Appointment:
    valid_transitions = {
        "booked": ["confirmed", "cancelled"],
        "confirmed": ["completed", "cancelled"],
        "completed": [],
        "cancelled": [],
    }
    allowed = valid_transitions.get(appointment.status, [])
    if new_status not in allowed:
        raise ValueError(
            f"Cannot transition from '{appointment.status}' to '{new_status}'"
        )

    appointment.status = new_status
    if new_status == "completed":
        appointment.payment_status = "paid"
    elif new_status == "cancelled":
        appointment.payment_status = "refunded"

    await db.flush()
    await db.refresh(appointment)
    return appointment


async def list_appointments(
    db: AsyncSession,
    user_id: int,
    role: str,
    status: Optional[str] = None,
) -> List[Appointment]:
    query = select(Appointment)

    if role == "student":
        query = query.where(Appointment.student_id == user_id)
    elif role == "teacher":
        query = query.where(Appointment.teacher_id == user_id)
    elif role == "parent":
        query = query.where(
            Appointment.student_id.in_(
                select(User.id).where(User.parent_id == user_id)
            )
        )
    # admin sees all

    if status:
        query = query.where(Appointment.status == status)

    query = query.order_by(Appointment.scheduled_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_appointment(db: AsyncSession, appointment_id: int) -> Optional[Appointment]:
    result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id)
    )
    return result.scalar_one_or_none()


async def check_availability(db: AsyncSession, student_id: int) -> dict:
    now = datetime.now(timezone.utc)
    used = await count_weekly_appointments(db, student_id, now)
    max_pw = settings.max_appointments_per_week
    return {
        "slots_used": used,
        "slots_remaining": max(0, max_pw - used),
        "max_per_week": max_pw,
    }
