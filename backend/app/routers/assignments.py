import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import require_student, require_teacher, require_any_authenticated
from app.models.user import User
from app.schemas.assignment import (
    HomeworkCreate,
    HomeworkResponse,
    HomeworkWithStats,
    HomeworkAssignmentResponse,
    MyAssignmentResponse,
    AssignToStudentRequest,
)
from app.services import assignment_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


@router.get("/my", response_model=list[MyAssignmentResponse])
async def get_my_assignments(
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: get all their homework assignments with full details."""
    assignments = await assignment_service.get_my_assignments(db, current_user.id)
    result = []
    for ha in assignments:
        result.append(
            MyAssignmentResponse(
                id=ha.id,
                status=ha.status,
                started_at=ha.started_at,
                completed_at=ha.completed_at,
                homework=HomeworkResponse.model_validate(ha.homework),
            )
        )
    return result


@router.get("/teacher", response_model=list[HomeworkWithStats])
async def get_teacher_homework(
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Teacher: get all created homework with assignment counts."""
    data = await assignment_service.get_teacher_homework(db, current_user.id)
    return [HomeworkWithStats(**item) for item in data]


@router.post("", response_model=HomeworkResponse, status_code=201)
async def create_homework(
    payload: HomeworkCreate,
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Teacher: create a new homework assignment."""
    hw = await assignment_service.create_homework(
        db, current_user.id, payload.model_dump()
    )
    await db.commit()
    return HomeworkResponse.model_validate(hw)


@router.post("/{homework_id}/assign", response_model=HomeworkAssignmentResponse, status_code=201)
async def assign_to_student(
    homework_id: int,
    payload: AssignToStudentRequest,
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Teacher: assign a homework to a specific student."""
    # Verify the homework belongs to this teacher
    from sqlalchemy import select
    from app.models.assignment import Homework

    hw_result = await db.execute(select(Homework).where(Homework.id == homework_id))
    hw = hw_result.scalar_one_or_none()
    if hw is None:
        raise HTTPException(status_code=404, detail="Homework not found")
    if hw.teacher_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="You can only assign your own homework")

    try:
        ha = await assignment_service.assign_to_student(db, homework_id, payload.student_id)
        await db.commit()
        return HomeworkAssignmentResponse.model_validate(ha)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.patch("/my/{homework_id}/start", response_model=HomeworkAssignmentResponse)
async def start_assignment(
    homework_id: int,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: mark an assignment as started."""
    try:
        ha = await assignment_service.start_assignment(db, current_user.id, homework_id)
        await db.commit()
        return HomeworkAssignmentResponse.model_validate(ha)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/my/{homework_id}/complete", response_model=HomeworkAssignmentResponse)
async def complete_assignment(
    homework_id: int,
    current_user: User = Depends(require_student),
    db: AsyncSession = Depends(get_db),
):
    """Student: mark an assignment as completed."""
    try:
        ha = await assignment_service.complete_assignment(db, current_user.id, homework_id)
        await db.commit()
        return HomeworkAssignmentResponse.model_validate(ha)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
