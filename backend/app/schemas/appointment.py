from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, Literal


class AppointmentCreate(BaseModel):
    student_id: int
    teacher_id: int
    subject: str
    key_stage: str
    title: str
    scheduled_at: datetime
    duration_minutes: int = Field(default=60, ge=15, le=180)
    description: Optional[str] = None
    payment_amount: Optional[float] = 25.00
    passcode: Optional[str] = Field(None, max_length=16)
    notes: Optional[str] = None
    learn_mode: str = Field(default="ai_recommended")
    # Optional Resource-Hub subtopic (an rh_topics row within the chosen unit/topic). Empty =
    # start from the beginning of the topic. Carried through to the LessonPlan.subtopic so the
    # session, its RAG scope and the manipulative topic-matcher can focus on it.
    subtopic: Optional[str] = Field(None, max_length=300)


class AppointmentStatusUpdate(BaseModel):
    status: Literal["booked", "confirmed", "started", "paused", "terminated", "completed", "cancelled"]


class SessionJoinRequest(BaseModel):
    passcode: Optional[str] = ""


class AppointmentResponse(BaseModel):
    id: int
    student_id: int
    teacher_id: int
    booked_by: int
    subject: str
    key_stage: str
    title: str
    description: Optional[str] = None
    scheduled_at: datetime
    duration_minutes: int
    status: str
    payment_status: str
    payment_amount: Optional[float] = None
    passcode: Optional[str] = None
    session_started_at: Optional[datetime] = None
    meeting_link: Optional[str] = None
    notes: Optional[str] = None
    learn_mode: str = "ai_recommended"
    created_at: datetime
    updated_at: datetime
    student_name: Optional[str] = None
    teacher_name: Optional[str] = None

    model_config = {"from_attributes": True}


class AvailabilityResponse(BaseModel):
    slots_used: int
    slots_remaining: int
    max_per_week: int
    key_stage: Optional[str] = None
    year_group: Optional[str] = None
