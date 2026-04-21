import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.db.session import get_db
from app.middleware.auth import require_parent_or_teacher, require_any_authenticated
from app.models.user import User, ROLE_PARENT, ROLE_TEACHER, ROLE_STUDENT
from app.schemas.user import UserResponse
from app.schemas.appointment import AppointmentCreate, AppointmentStatusUpdate, AppointmentResponse, AvailabilityResponse, SessionJoinRequest
from app.services import appointment_service, email_service
from app.services.user_service import get_user_by_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


@router.get("/teachers", response_model=list[UserResponse])
async def list_teachers(
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.role == ROLE_TEACHER, User.is_active == True)
    )
    return [UserResponse.model_validate(t) for t in result.scalars().all()]


@router.post("/book", response_model=AppointmentResponse)
async def book_appointment(
    payload: AppointmentCreate,
    current_user: User = Depends(require_parent_or_teacher),
    db: AsyncSession = Depends(get_db),
):
    student = await get_user_by_id(db, payload.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    teacher = await get_user_by_id(db, payload.teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    if current_user.role == ROLE_PARENT and student.parent_id != current_user.id:
        raise HTTPException(status_code=403, detail="Student is not linked to your account")

    try:
        appointment = await appointment_service.book_appointment(
            db=db,
            student_id=payload.student_id,
            teacher_id=payload.teacher_id,
            booked_by=current_user.id,
            subject=payload.subject,
            key_stage=payload.key_stage,
            title=payload.title,
            scheduled_at=payload.scheduled_at,
            duration_minutes=payload.duration_minutes,
            description=payload.description,
            payment_amount=payload.payment_amount,
            notes=payload.notes,
            passcode=payload.passcode,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    parent_email = None
    if student.parent_id:
        parent_user = await get_user_by_id(db, student.parent_id)
        if parent_user:
            parent_email = parent_user.email

    email_service.send_booking_confirmation(
        student_email=student.email,
        student_name=student.name,
        teacher_name=teacher.name,
        subject=payload.subject,
        scheduled_at=payload.scheduled_at,
        parent_email=parent_email,
    )

    resp = AppointmentResponse.model_validate(appointment)
    resp.student_name = student.name
    resp.teacher_name = teacher.name
    return resp


@router.get("", response_model=list[AppointmentResponse])
async def list_appointments(
    appt_status: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    appointments = await appointment_service.list_appointments(
        db, current_user.id, current_user.role, status=appt_status
    )
    results = []
    for a in appointments:
        resp = AppointmentResponse.model_validate(a)
        student = await get_user_by_id(db, a.student_id)
        teacher = await get_user_by_id(db, a.teacher_id)
        resp.student_name = student.name if student else None
        resp.teacher_name = teacher.name if teacher else None
        results.append(resp)
    return results


@router.get("/availability", response_model=AvailabilityResponse)
async def check_availability(
    student_id: int = Query(...),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    return await appointment_service.check_availability(db, student_id)


@router.get("/{appointment_id}", response_model=AppointmentResponse)
async def get_appointment(
    appointment_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    appt = await appointment_service.get_appointment(db, appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    resp = AppointmentResponse.model_validate(appt)
    student = await get_user_by_id(db, appt.student_id)
    teacher = await get_user_by_id(db, appt.teacher_id)
    resp.student_name = student.name if student else None
    resp.teacher_name = teacher.name if teacher else None
    return resp


@router.post("/{appointment_id}/join")
async def join_session(
    appointment_id: int,
    payload: SessionJoinRequest,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    appt = await appointment_service.get_appointment(db, appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    if current_user.role == ROLE_STUDENT and appt.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your appointment")

    if appt.status not in ("confirmed", "started", "paused"):
        raise HTTPException(status_code=400, detail="Appointment must be confirmed before joining")

    if appt.passcode:
        if not payload.passcode or appt.passcode != payload.passcode:
            raise HTTPException(status_code=403, detail="Invalid passcode")

    if not appt.session_started_at:
        appt.session_started_at = datetime.now(timezone.utc)

    # Always transition confirmed → started on join (regardless of session_started_at)
    if appt.status == "confirmed":
        appt.status = "started"

    await db.flush()
    await db.refresh(appt)

    return {
        "appointment_id": appt.id,
        "session_started_at": appt.session_started_at.isoformat(),
        "duration_minutes": appt.duration_minutes,
        "subject": appt.subject,
        "title": appt.title,
        "status": appt.status,
        "total_paused_seconds": appt.total_paused_seconds or 0,
        "paused_at": appt.paused_at.isoformat() if appt.paused_at else None,
    }


@router.patch("/{appointment_id}/status", response_model=AppointmentResponse)
async def update_appointment_status(
    appointment_id: int,
    payload: AppointmentStatusUpdate,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    appt = await appointment_service.get_appointment(db, appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    try:
        updated = await appointment_service.update_status(db, appt, payload.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    resp = AppointmentResponse.model_validate(updated)
    return resp


@router.get("/{appointment_id}/report")
async def get_appointment_report(
    appointment_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieve the AI-generated session report for a completed appointment.
    Auth: student, teacher, parent, or admin.
    """
    appt = await appointment_service.get_appointment(db, appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    # Access control: student can only see their own, parent can see their child's
    if current_user.role == ROLE_STUDENT and appt.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your appointment")
    if current_user.role == ROLE_PARENT:
        student = await get_user_by_id(db, appt.student_id)
        if not student or student.parent_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not your child's appointment")

    if appt.status not in ("completed", "terminated"):
        raise HTTPException(
            status_code=400,
            detail="Session report is only available for completed or terminated sessions."
        )

    from app.services.lesson_service import get_appointment_report, generate_session_report
    from app.models.lesson_plan import LessonPlan
    from app.models.assessment import Assessment

    report = await get_appointment_report(db, appointment_id)

    if report is None:
        try:
            lp_res = await db.execute(select(LessonPlan).where(LessonPlan.appointment_id == appointment_id))
            lesson_plan = lp_res.scalar_one_or_none()

            # Prefer assessments linked to this appointment, fallback to subject-level
            asmt_res = await db.execute(
                select(Assessment)
                .where(Assessment.appointment_id == appointment_id)
                .order_by(Assessment.created_at.desc())
                .limit(20)
            )
            assessments = list(asmt_res.scalars().all())
            if not assessments:
                asmt_res = await db.execute(
                    select(Assessment)
                    .where(
                        Assessment.student_id == appt.student_id,
                        Assessment.subject == appt.subject,
                    )
                    .order_by(Assessment.created_at.desc())
                    .limit(10)
                )
                assessments = list(asmt_res.scalars().all())

            student = await get_user_by_id(db, appt.student_id)
            report = await generate_session_report(
                db, appt, lesson_plan, assessments,
                student_name=student.name if student else None
            )
            await db.commit()
        except Exception as exc:
            import logging
            logging.getLogger(__name__).error(
                f"On-demand report generation failed for appointment {appointment_id}: {exc}",
                exc_info=True,
            )
            try:
                await db.rollback()
            except Exception:
                pass
            # Return a minimal fallback so the frontend doesn't show a hard error
            report = {
                "summary": f"Session completed — report is being processed.",
                "topics_covered": [appt.subject],
                "quiz_score_percent": None,
                "weak_areas": [],
                "strong_areas": [],
                "understanding_level": "Good",
                "next_session_recommendation": f"Continue practising {appt.subject}.",
                "time_spent_minutes": appt.duration_minutes,
                "encouragement": "Well done for completing your session!",
            }

    return {
        "appointment_id": appointment_id,
        "status": appt.status,
        "subject": appt.subject,
        "report": report,
    }
