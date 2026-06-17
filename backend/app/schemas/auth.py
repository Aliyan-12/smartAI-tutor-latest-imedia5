from typing import Optional, List, Literal

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    account_type: Literal["school", "individual"] = "individual"
    # For individual signups: which kind of individual. Ignored for school
    # signups (the registrant becomes the school superadmin).
    role: Literal["student", "parent"] = "student"
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    # School signups only:
    school_name: Optional[str] = Field(None, max_length=255)
    country: Optional[str] = Field(None, max_length=60)


class RegisterResponse(BaseModel):
    status: str  # "verification_sent"
    email: EmailStr
    # Only populated when EMAIL_ENABLED is false (dev) so the flow stays testable.
    dev_verify_token: Optional[str] = None


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(..., min_length=6, max_length=128)


class OnboardingProfileRequest(BaseModel):
    # student
    key_stage: Optional[str] = None
    year_group: Optional[str] = None
    subjects: Optional[List[str]] = None
    # school superadmin
    school_name: Optional[str] = None
    country: Optional[str] = None
    # parent linking a child
    invite_code: Optional[str] = None


class OnboardingPreferencesRequest(BaseModel):
    learning_style: Optional[List[str]] = None
    teaching_pace: Optional[str] = None
    teaching_preferences: Optional[dict] = None
    learning_goals: Optional[str] = None
    voice_responses: Optional[bool] = None
