from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel


class LessonPlanCreate(BaseModel):
    student_id: int
    subject: str
    key_stage: str
    exam_board: Optional[str] = "None"
    tier: Optional[str] = "None"
    unit_name: Optional[str] = None
    subtopic: Optional[str] = None
    ability_level: str
    goal: str
    teacher_notes: Optional[str] = None
    appointment_id: Optional[int] = None


class LessonPlanResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    appointment_id: Optional[int] = None
    student_id: int
    created_by: int
    subject: str
    key_stage: str
    exam_board: str
    tier: str
    unit_name: Optional[str] = None
    subtopic: Optional[str] = None
    ability_level: str
    goal: str
    teacher_notes: Optional[str] = None
    status: str
    session_summary: Optional[str] = None
    materials_uploaded: Optional[List[Any]] = None
    created_at: datetime
    updated_at: datetime


class TopicListResponse(BaseModel):
    topics: List[Dict[str, Any]]
