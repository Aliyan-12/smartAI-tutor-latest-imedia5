from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class HomeworkCreate(BaseModel):
    title: str
    subject: str
    key_stage: str
    topic: str
    instructions: Optional[str] = None
    due_date: Optional[datetime] = None
    estimated_minutes: int = 60
    assignment_type: str = "homework"  # homework | reading | prep | revision


class HomeworkResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    teacher_id: int
    title: str
    subject: str
    key_stage: str
    topic: str
    instructions: Optional[str] = None
    due_date: Optional[datetime] = None
    estimated_minutes: int
    assignment_type: str
    status: str
    created_at: datetime


class HomeworkWithStats(HomeworkResponse):
    """Homework response with assignment counts — for teacher dashboard."""
    total_assigned: int = 0
    total_started: int = 0
    total_completed: int = 0


class HomeworkAssignmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    homework_id: int
    student_id: int
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class MyAssignmentResponse(BaseModel):
    """Full assignment view for a student — includes homework details."""
    model_config = {"from_attributes": True}

    id: int
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    homework: HomeworkResponse


class AssignToStudentRequest(BaseModel):
    student_id: int
