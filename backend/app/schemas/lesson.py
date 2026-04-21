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
    plan_blocks: Optional[Dict[str, Any]] = None
    session_state: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class TopicListResponse(BaseModel):
    topics: List[Dict[str, Any]]


# Task 1: Generate lesson plan request/response
class GenerateLessonPlanRequest(BaseModel):
    subject: str
    topic: str
    subtopic: Optional[str] = None
    goal: str  # teach_from_scratch | practice | test_prep | help_homework | revise_quickly
    duration_minutes: int
    appointment_id: Optional[int] = None


class LessonBlock(BaseModel):
    type: str  # intro | teach | practice | check | summary
    title: str
    duration_minutes: int
    description: str
    subtopics: Optional[List[str]] = None


class GeneratedLessonPlanResponse(BaseModel):
    lesson_title: str
    preview_summary: str
    blocks: List[LessonBlock]
    personalisation_notes: str
    continuation_point: Optional[str] = None


# Task 2: Checkpoint request/response
class CheckpointSaveRequest(BaseModel):
    current_block_index: int
    completed_blocks: List[str]
    topic_progress_percent: int
    weak_subtopics: Optional[List[str]] = None
    strong_subtopics: Optional[List[str]] = None
    confidence_level: str  # low | medium | high
    last_checkpoint_at: Optional[str] = None


class ContinuationResponse(BaseModel):
    found: bool
    lesson_plan_id: Optional[int] = None
    subject: Optional[str] = None
    topic: Optional[str] = None
    session_state: Optional[Dict[str, Any]] = None
