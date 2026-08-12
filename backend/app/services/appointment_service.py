import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.appointment import Appointment
from app.models.user import User
from app.models.student_profile import StudentProfile
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
    learn_mode: str = "ai_recommended",
) -> Appointment:
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
        learn_mode=learn_mode,
    )
    db.add(appointment)
    await db.flush()
    await db.refresh(appointment)
    return appointment


async def update_status(db: AsyncSession, appointment: Appointment, new_status: str) -> Appointment:
    valid_transitions = {
        "booked":     ["confirmed", "cancelled"],
        "confirmed":  ["started", "cancelled"],
        "started":    ["paused", "terminated", "completed"],
        "paused":     ["started", "terminated", "completed"],
        "terminated": [],
        "completed":  [],
        "cancelled":  [],
    }
    allowed = valid_transitions.get(appointment.status, [])
    if new_status not in allowed:
        raise ValueError(
            f"Cannot transition from '{appointment.status}' to '{new_status}'"
        )

    from datetime import datetime, timezone as tz
    now = datetime.now(tz.utc)

    appointment.status = new_status

    if new_status == "paused":
        appointment.paused_at = now
    elif new_status == "started":
        if appointment.paused_at:
            paused_secs = int((now - appointment.paused_at).total_seconds())
            appointment.total_paused_seconds = (appointment.total_paused_seconds or 0) + paused_secs
            appointment.paused_at = None
    elif new_status in ("completed", "terminated"):
        if appointment.paused_at:
            paused_secs = int((now - appointment.paused_at).total_seconds())
            appointment.total_paused_seconds = (appointment.total_paused_seconds or 0) + paused_secs
            appointment.paused_at = None
        appointment.payment_status = "paid"
    elif new_status == "cancelled":
        appointment.payment_status = "refunded"

    await db.flush()
    await db.refresh(appointment)

    if new_status in ("completed", "terminated"):
        await _run_post_session_pipeline(db, appointment)

    return appointment


async def _run_post_session_pipeline(db: AsyncSession, appointment: Appointment) -> None:
    """
    Post-session pipeline: generate report first (committed immediately),
    then run gamification/email in a separate phase so a gamification failure
    never prevents the report from being saved.
    """
    from app.models.lesson_plan import LessonPlan
    from app.models.assessment import Assessment
    from app.models.chat import Chat, Message
    from app.services import platform_service
    from app.services.agent.session import plan as lesson_service

    key_stage = appointment.key_stage or "KS4"

    # ── Phase 1: load data + generate report ────────────────────────────────
    report: Optional[dict] = None
    student = None
    lesson_plan = None
    try:
        lp_result = await db.execute(
            select(LessonPlan).where(LessonPlan.appointment_id == appointment.id)
        )
        lesson_plan = lp_result.scalar_one_or_none()

        # If the AI already generated a report via the generate_session_report tool, skip regeneration
        if lesson_plan and lesson_plan.session_summary:
            import json as _json
            try:
                report = _json.loads(lesson_plan.session_summary)
                logger.info(f"Using AI-generated report for appointment_id={appointment.id}")
            except Exception:
                report = None  # malformed JSON — will regenerate below

        student_result = await db.execute(
            select(User).where(User.id == appointment.student_id)
        )
        student = student_result.scalar_one_or_none()

        if report is None:
            # Load assessments linked to this appointment (by appointment_id first, fallback by subject)
            asmt_result = await db.execute(
                select(Assessment)
                .where(Assessment.appointment_id == appointment.id)
                .order_by(Assessment.created_at.desc())
                .limit(20)
            )
            assessments = list(asmt_result.scalars().all())
            if not assessments:
                # Fallback: recent assessments for this student+subject
                asmt_result = await db.execute(
                    select(Assessment)
                    .where(
                        Assessment.student_id == appointment.student_id,
                        Assessment.subject == appointment.subject,
                    )
                    .order_by(Assessment.created_at.desc())
                    .limit(10)
                )
                assessments = list(asmt_result.scalars().all())

            # Load session messages for the report
            chat_result = await db.execute(
                select(Chat).where(Chat.appointment_id == appointment.id)
            )
            chat = chat_result.scalar_one_or_none()
            session_messages = []
            if chat:
                msg_result = await db.execute(
                    select(Message)
                    .where(Message.chat_id == chat.id)
                    .order_by(Message.timestamp)
                    .limit(100)
                )
                session_messages = list(msg_result.scalars().all())
            logger.info(f"Loaded {len(session_messages)} messages for report (appointment_id={appointment.id})")

            report = await lesson_service.generate_session_report(
                db=db,
                appointment=appointment,
                lesson_plan=lesson_plan,
                assessments=assessments,
                student_name=student.name if student else "Student",
                messages=session_messages,
            )

        if lesson_plan and lesson_plan.status != "completed":
            lesson_plan.status = "completed"
            lesson_plan.updated_at = datetime.now(timezone.utc)
            await db.flush()

        # SOLID snapshot: on completion, copy the finalised coverage ledger into its own durable
        # `coverage` column (out of the live session_state scratchpad) so cross-lesson memory always
        # has a clean per-lesson record — even when the report above came back cached.
        try:
            if lesson_plan is not None and getattr(lesson_plan, "coverage", None) is None:
                _led = (lesson_plan.session_state or {}).get("ledger")
                if _led:
                    lesson_plan.coverage = _led
                    await db.flush()
        except Exception as _cex:  # noqa: BLE001 — never let a snapshot break completion
            logger.warning(f"coverage snapshot skipped for appointment_id={appointment.id}: {_cex}")

        # Commit report immediately so it survives even if gamification fails
        await db.commit()
        logger.info(f"Report saved for appointment_id={appointment.id}")

    except Exception as exc:
        logger.error(
            f"Report generation failed for appointment_id={appointment.id}: {exc}",
            exc_info=True,
        )
        try:
            await db.rollback()
        except Exception:
            pass
        return  # Can't continue without a report

    # ── Phase 2: gamification (XP, mastery, streak) ──────────────────────────
    try:
        score_percent = float(report.get("quiz_score_percent") or 70.0)
        xp_amount = _calculate_session_xp(score_percent, appointment.duration_minutes)
        await platform_service.award_xp(
            db, appointment.student_id, xp_amount, reason="session_completed"
        )
        # Ended the lesson early (before the clock ran out)? Dock some XP so leaving early
        # has a visible cost — the `ended_early` flag is set by _handle_lesson_end_request.
        penalty = 0
        try:
            if lesson_plan and (lesson_plan.session_state or {}).get("ended_early"):
                penalty = -min(30, max(10, xp_amount // 3))
                await platform_service.award_xp(
                    db, appointment.student_id, penalty, reason="ended_early_penalty"
                )
                logger.info(
                    f"Ended-early XP penalty {penalty} applied for appointment_id={appointment.id}"
                )
        except Exception as _pex:
            logger.warning(f"ended_early penalty skipped: {_pex}")

        # Record the REAL XP earned for this session into the report so the report card shows
        # the actual amount (dynamic) instead of the frontend's static fallback. Net of the
        # early-end penalty. Re-persist the enriched report JSON (same authentic report).
        session_xp_earned = max(0, xp_amount + penalty)
        try:
            report["xp_earned"] = session_xp_earned
            if lesson_plan is not None:
                import json as _json
                lesson_plan.session_summary = _json.dumps(report)
                await db.flush()
        except Exception as _xex:
            logger.warning(f"Could not persist xp_earned into report: {_xex}")

        await platform_service.check_and_update_streak(db, appointment.student_id)

        topics_covered = report.get("topics_covered") or []
        if not topics_covered:
            topics_covered = (
                [lesson_plan.unit_name or lesson_plan.subtopic or appointment.subject]
                if lesson_plan else [appointment.subject]
            )
        for topic in topics_covered:
            await platform_service.update_topic_mastery(
                db=db,
                student_id=appointment.student_id,
                subject=appointment.subject,
                key_stage=key_stage,
                topic=topic,
                score=score_percent,
            )

        await db.commit()
        logger.info(
            f"Gamification updated for appointment_id={appointment.id}, xp={xp_amount}"
        )
    except Exception as exc:
        logger.error(
            f"Gamification phase failed for appointment_id={appointment.id}: {exc}",
            exc_info=True,
        )
        try:
            await db.rollback()
        except Exception:
            pass

    # ── Phase 3: email (non-fatal) ───────────────────────────────────────────
    try:
        parent = None
        if student and student.parent_id:
            p_result = await db.execute(select(User).where(User.id == student.parent_id))
            parent = p_result.scalar_one_or_none()
        platform_service.send_session_report(
            to_email=parent.email if parent else None,
            student_name=student.name if student else "Student",
            subject=appointment.subject,
            report_dict=report,
            student_email=student.email if student else None,
        )
    except Exception as exc:
        logger.warning(f"Email failed for appointment_id={appointment.id}: {exc}")


def _calculate_session_xp(score_percent: float, duration_minutes: int) -> int:
    """Calculate XP to award based on session score and duration."""
    base_xp = 50  # Base for completing a session
    score_bonus = int(score_percent * 0.5)  # Up to 50 extra XP for 100% score
    duration_bonus = min(25, duration_minutes // 4)  # Up to 25 extra XP for long sessions
    return base_xp + score_bonus + duration_bonus


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

    # Fetch student's key stage from their profile
    profile_result = await db.execute(
        select(StudentProfile).where(StudentProfile.student_id == student_id)
    )
    profile = profile_result.scalar_one_or_none()
    key_stage = profile.key_stage if profile else None

    return {
        "slots_used": used,
        "slots_remaining": max(0, max_pw - used),
        "max_per_week": max_pw,
        "key_stage": key_stage,
    }
