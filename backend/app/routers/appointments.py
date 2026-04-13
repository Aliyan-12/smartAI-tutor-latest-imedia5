import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_parent_or_teacher, require_any_authenticated
from app.models.user import User, ROLE_PARENT
from app.schemas.appointment import AppointmentCreate, AppointmentStatusUpdate, AppointmentResponse, AvailabilityResponse
from app.services import appointment_service, email_service
from app.services.user_service import get_user_by_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


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
