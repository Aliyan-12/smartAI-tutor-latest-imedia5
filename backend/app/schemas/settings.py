from typing import Dict, List, Optional, Any
from pydantic import BaseModel


class LearningPreferencesUpdate(BaseModel):
    """All fields optional — patch only what is sent."""
    learning_style: Optional[List[str]] = None
    teaching_pace: Optional[str] = None  # slower | just_right | faster
    teaching_preferences: Optional[Dict[str, Any]] = None
    learning_goals: Optional[str] = None
    default_session_length: Optional[int] = None
    voice_responses: Optional[bool] = None
    show_hints: Optional[bool] = None
    auto_start_next_topic: Optional[bool] = None
    interests: Optional[List[str]] = None
    preferred_subjects: Optional[List[str]] = None
    # SettingsPage has Key Stage / Year Group fields and PATCHes them here, but they were
    # declared only on LearningPreferencesResponse — so pydantic silently DROPPED them from the
    # request body and the response echoed the unchanged DB value straight back. The save
    # looked like it worked and never wrote anything.
    year_group: Optional[str] = None
    key_stage: Optional[str] = None


class LearningPreferencesResponse(BaseModel):
    model_config = {"from_attributes": True}

    student_id: int
    learning_style: Optional[List[str]] = None
    teaching_pace: str = "just_right"
    teaching_preferences: Optional[Dict[str, Any]] = None
    learning_goals: Optional[str] = None
    default_session_length: int = 60
    voice_responses: bool = True
    show_hints: bool = True
    auto_start_next_topic: bool = False
    interests: Optional[List[str]] = None
    preferred_subjects: Optional[List[str]] = None
    year_group: Optional[str] = None
    key_stage: Optional[str] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    year_group: Optional[str] = None
    key_stage: Optional[str] = None


class ProfileResponse(BaseModel):
    model_config = {"from_attributes": True}

    user_id: int
    name: str
    email: str
    year_group: Optional[str] = None
    key_stage: Optional[str] = None
    xp_total: int = 0
    xp_level: int = 1
    current_streak: int = 0
    longest_streak: int = 0


class NotificationPrefsUpdate(BaseModel):
    assignment_reminders: Optional[bool] = None
    session_reminders: Optional[bool] = None
    messages: Optional[bool] = None
    weekly_progress: Optional[bool] = None


class NotificationPrefsResponse(BaseModel):
    assignment_reminders: bool = True
    session_reminders: bool = True
    messages: bool = True
    weekly_progress: bool = True
