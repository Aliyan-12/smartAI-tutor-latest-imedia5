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
    notes: Optional[str] = None


class AppointmentStatusUpdate(BaseModel):
    status: Literal["booked", "confirmed", "completed", "cancelled"]


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
    meeting_link: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    student_name: Optional[str] = None
    teacher_name: Optional[str] = None

    model_config = {"from_attributes": True}


class AvailabilityResponse(BaseModel):
    slots_used: int
    slots_remaining: int
    max_per_week: int
