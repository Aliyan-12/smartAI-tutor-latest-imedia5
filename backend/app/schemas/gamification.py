from datetime import datetime, date
from typing import Optional, List, Any, Dict
from pydantic import BaseModel


class StudentProfileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    student_id: int
    xp_total: int
    xp_level: int
    current_streak: int
    longest_streak: int
    last_active_date: Optional[date] = None
    interests: Optional[List[str]] = None
    preferred_subjects: Optional[List[str]] = None


class TopicMasteryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    student_id: int
    subject: str
    key_stage: str
    topic: str
    mastery_level: str
    score_history: Optional[List[Dict[str, Any]]] = None
    attempts: int
    last_practiced_at: Optional[datetime] = None


class DailyPlanResponse(BaseModel):
    weak_spots: List[Dict[str, Any]]
    spaced_review: List[Dict[str, Any]]
    confidence_boost: List[Dict[str, Any]]
    upcoming_sessions: List[Dict[str, Any]]


class DashboardResponse(BaseModel):
    profile: StudentProfileResponse
    mastery_overview: List[TopicMasteryResponse]
    daily_plan: DailyPlanResponse
    continue_learning: Optional[Dict[str, Any]] = None
    xp_to_next_level: int
