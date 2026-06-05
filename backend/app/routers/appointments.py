import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.db.session import get_db
from app.middleware.auth import require_parent_or_teacher, require_any_authenticated
from app.models.user import User, ROLE_PARENT, ROLE_TEACHER, ROLE_STUDENT
from app.models.appointment import Appointment
from app.schemas.user import UserResponse
from app.schemas.appointment import AppointmentCreate, AppointmentStatusUpdate, AppointmentResponse, AvailabilityResponse, SessionJoinRequest
from app.services import appointment_service, platform_service
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
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    is_self_booking = current_user.role == ROLE_STUDENT

    # Students can only book AI sessions for themselves
    if is_self_booking and payload.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Students can only book sessions for themselves")

    student = await get_user_by_id(db, payload.student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # For parent/teacher bookings validate the teacher exists; for student AI sessions skip it
    if not is_self_booking:
        teacher = await get_user_by_id(db, payload.teacher_id)
        if not teacher:
            raise HTTPException(status_code=404, detail="Teacher not found")
    else:
        teacher = student  # AI session — student acts as their own booking owner

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
            learn_mode=payload.learn_mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    # Auto-confirm AI sessions booked by students so they can join immediately
    if is_self_booking:
        appointment.status = "confirmed"
        await db.flush()
        await db.refresh(appointment)
        try:
            from app.services import lesson_service
            await lesson_service.auto_create_lesson_plan(
                db=db,
                appointment=appointment,
                student_id=current_user.id,
            )
        except Exception as _e:
            logger.warning(f"Auto lesson plan generation failed (non-fatal): {_e}")
    else:
        parent_email = None
        if student.parent_id:
            parent_user = await get_user_by_id(db, student.parent_id)
            if parent_user:
                parent_email = parent_user.email

        platform_service.send_booking_confirmation(
            student_email=student.email,
            student_name=student.name,
            teacher_name=teacher.name,
            subject=payload.subject,
            scheduled_at=payload.scheduled_at,
            parent_email=parent_email,
        )

    await db.commit()
    await db.refresh(appointment)

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


@router.post("/{appointment_id}/lesson-files")
async def upload_lesson_file(
    appointment_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Accept a student-uploaded file and store its text content in the LessonPlan."""
    import io

    # Load appointment
    result = await db.execute(select(Appointment).where(Appointment.id == appointment_id))
    appointment = result.scalar_one_or_none()
    if not appointment or appointment.student_id != current_user.id:
        raise HTTPException(status_code=404, detail="Appointment not found")

    # Extract text content
    content_bytes = await file.read()
    text_content = ""
    fname = file.filename or "upload"
    ct = (file.content_type or "").lower()

    try:
        if ct == "application/pdf" or fname.lower().endswith(".pdf"):
            try:
                import pdfplumber
                with pdfplumber.open(io.BytesIO(content_bytes)) as pdf:
                    text_content = "\n".join(p.extract_text() or "" for p in pdf.pages[:20])
            except ImportError:
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(content_bytes))
                text_content = "\n".join(
                    page.extract_text() or "" for page in reader.pages[:20]
                )
        elif (
            ct == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            or fname.lower().endswith(".docx")
        ):
            from docx import Document
            doc = Document(io.BytesIO(content_bytes))
            text_content = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        elif ct.startswith("text/") or fname.lower().endswith(".txt"):
            text_content = content_bytes.decode("utf-8", errors="replace")
        else:
            text_content = f"[{fname} uploaded — binary file, no text content]"
    except Exception as e:
        text_content = f"[Error reading {fname}: {e}]"

    # Store in LessonPlan.materials_uploaded
    from app.models.lesson_plan import LessonPlan
    lp_result = await db.execute(
        select(LessonPlan).where(LessonPlan.appointment_id == appointment_id)
    )
    lesson_plan = lp_result.scalar_one_or_none()
    if not lesson_plan:
        lesson_plan = LessonPlan(
            appointment_id=appointment_id,
            student_id=current_user.id,
            created_by=current_user.id,
            subject=appointment.subject,
            key_stage=appointment.key_stage,
            goal="learn_scratch",
            status="planned",
        )
        db.add(lesson_plan)

    existing_materials = list(lesson_plan.materials_uploaded or [])
    existing_materials.append({
        "filename": fname,
        "content_type": ct,
        "text_content": text_content[:5000],  # cap at 5000 chars
    })
    lesson_plan.materials_uploaded = existing_materials
    await db.commit()
    return {"ok": True, "filename": fname}


@router.get("/{appointment_id}/briefing")
async def get_session_briefing(
    appointment_id: int,
    current_user: User = Depends(require_any_authenticated),
    db: AsyncSession = Depends(get_db),
):
    """Return (and cache) an AI-generated session briefing for the pre-lesson page."""
    from app.services.session_agent_service import generate_session_briefing
    return await generate_session_briefing(db, appointment_id)


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

    await db.refresh(updated)
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
        # Session not yet ended — return pending so the frontend retries gracefully (no 400 spam)
        return {
            "appointment_id": appointment_id,
            "status": appt.status,
            "pending": True,
            "report": None,
        }

    from app.services.lesson_service import get_appointment_report, generate_session_report
    from app.models.lesson_plan import LessonPlan
    from app.models.assessment import Assessment
    from app.models.chat import Chat, Message

    report = await get_appointment_report(db, appointment_id)

    if report is None:
        try:
            lp_res = await db.execute(select(LessonPlan).where(LessonPlan.appointment_id == appointment_id))
            lesson_plan = lp_res.scalar_one_or_none()

            # Only use assessments actually linked to THIS appointment — no subject-level fallback
            asmt_res = await db.execute(
                select(Assessment)
                .where(Assessment.appointment_id == appointment_id)
                .order_by(Assessment.created_at.asc())
                .limit(20)
            )
            assessments = list(asmt_res.scalars().all())

            # Load the session chat messages for conversation-based report generation
            chat_res = await db.execute(
                select(Chat).where(Chat.appointment_id == appointment_id)
            )
            chat = chat_res.scalar_one_or_none()
            messages: list = []
            if chat:
                msg_res = await db.execute(
                    select(Message)
                    .where(Message.chat_id == chat.id)
                    .order_by(Message.timestamp.asc())
                )
                messages = list(msg_res.scalars().all())

            student = await get_user_by_id(db, appt.student_id)
            report = await generate_session_report(
                db, appt, lesson_plan, assessments,
                student_name=student.name if student else None,
                messages=messages,
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
            report = {
                "summary": "Session completed — report is being processed.",
                "phases": [],
                "topics_covered": [appt.subject],
                "student_messages_count": 0,
                "ai_messages_count": 0,
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
