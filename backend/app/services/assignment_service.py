"""
Assignment service: homework creation, assignment to students, progress tracking.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.assignment import Homework, HomeworkAssignment

logger = logging.getLogger(__name__)


async def create_homework(
    db: AsyncSession,
    teacher_id: int,
    data: Dict[str, Any],
) -> Homework:
    """Create a new Homework record created by a teacher."""
    hw = Homework(
        teacher_id=teacher_id,
        title=data["title"],
        subject=data["subject"],
        key_stage=data["key_stage"],
        topic=data["topic"],
        instructions=data.get("instructions"),
        due_date=data.get("due_date"),
        estimated_minutes=data.get("estimated_minutes", 60),
        assignment_type=data.get("assignment_type", "homework"),
        status="active",
    )
    db.add(hw)
    await db.flush()
    await db.refresh(hw)
    logger.info(f"Created homework id={hw.id} by teacher_id={teacher_id}")
    return hw


async def assign_to_student(
    db: AsyncSession,
    homework_id: int,
    student_id: int,
) -> HomeworkAssignment:
    """Assign a Homework to a student. Prevents duplicate assignments."""
    # Check if already assigned
    existing = await db.execute(
        select(HomeworkAssignment).where(
            HomeworkAssignment.homework_id == homework_id,
            HomeworkAssignment.student_id == student_id,
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError(f"Homework {homework_id} is already assigned to student {student_id}")

    # Verify homework exists
    hw_result = await db.execute(select(Homework).where(Homework.id == homework_id))
    if hw_result.scalar_one_or_none() is None:
        raise ValueError(f"Homework id={homework_id} not found")

    ha = HomeworkAssignment(
        homework_id=homework_id,
        student_id=student_id,
        status="assigned",
    )
    db.add(ha)
    await db.flush()
    await db.refresh(ha)
    logger.info(f"Assigned homework_id={homework_id} to student_id={student_id}")
    return ha


async def get_my_assignments(
    db: AsyncSession,
    student_id: int,
) -> List[HomeworkAssignment]:
    """Get all HomeworkAssignments for a student, with homework details eagerly loaded."""
    result = await db.execute(
        select(HomeworkAssignment)
        .options(selectinload(HomeworkAssignment.homework))
        .where(HomeworkAssignment.student_id == student_id)
        .order_by(HomeworkAssignment.id.desc())
    )
    return list(result.scalars().all())


async def start_assignment(
    db: AsyncSession,
    student_id: int,
    homework_id: int,
) -> HomeworkAssignment:
    """Mark a student's assignment as started."""
    result = await db.execute(
        select(HomeworkAssignment).where(
            HomeworkAssignment.homework_id == homework_id,
            HomeworkAssignment.student_id == student_id,
        )
    )
    ha = result.scalar_one_or_none()
    if ha is None:
        raise ValueError(f"Assignment not found for student_id={student_id}, homework_id={homework_id}")
    if ha.status == "completed":
        raise ValueError("Assignment is already completed")

    ha.status = "started"
    if ha.started_at is None:
        ha.started_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(ha)
    return ha


async def complete_assignment(
    db: AsyncSession,
    student_id: int,
    homework_id: int,
) -> HomeworkAssignment:
    """Mark a student's assignment as completed."""
    result = await db.execute(
        select(HomeworkAssignment).where(
            HomeworkAssignment.homework_id == homework_id,
            HomeworkAssignment.student_id == student_id,
        )
    )
    ha = result.scalar_one_or_none()
    if ha is None:
        raise ValueError(f"Assignment not found for student_id={student_id}, homework_id={homework_id}")
    if ha.status == "completed":
        raise ValueError("Assignment is already completed")

    ha.status = "completed"
    ha.completed_at = datetime.now(timezone.utc)
    if ha.started_at is None:
        ha.started_at = ha.completed_at  # auto-set started if jumped straight to complete
    await db.flush()
    await db.refresh(ha)
    return ha


async def get_teacher_homework(
    db: AsyncSession,
    teacher_id: int,
) -> List[Dict[str, Any]]:
    """
    Get all homework created by a teacher with assignment count statistics.
    Returns dicts with homework fields + total_assigned, total_started, total_completed.
    """
    hw_result = await db.execute(
        select(Homework)
        .where(Homework.teacher_id == teacher_id)
        .order_by(Homework.created_at.desc())
    )
    homeworks = hw_result.scalars().all()

    output = []
    for hw in homeworks:
        # Count assignments by status
        counts_result = await db.execute(
            select(
                HomeworkAssignment.status,
                func.count(HomeworkAssignment.id).label("cnt"),
            )
            .where(HomeworkAssignment.homework_id == hw.id)
            .group_by(HomeworkAssignment.status)
        )
        counts = {row.status: row.cnt for row in counts_result.all()}

        output.append({
            "id": hw.id,
            "teacher_id": hw.teacher_id,
            "title": hw.title,
            "subject": hw.subject,
            "key_stage": hw.key_stage,
            "topic": hw.topic,
            "instructions": hw.instructions,
            "due_date": hw.due_date,
            "estimated_minutes": hw.estimated_minutes,
            "assignment_type": hw.assignment_type,
            "status": hw.status,
            "created_at": hw.created_at,
            "total_assigned": sum(counts.values()),
            "total_started": counts.get("started", 0),
            "total_completed": counts.get("completed", 0),
        })

    return output
