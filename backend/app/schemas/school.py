from typing import Optional, List, Literal
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class SchoolResponse(BaseModel):
    id: int
    name: str
    slug: str
    country: Optional[str] = None
    account_type: str
    is_default: bool
    superadmin_user_id: Optional[int] = None
    created_at: datetime
    model_config = {"from_attributes": True}


class SchoolStats(BaseModel):
    school: SchoolResponse
    teachers: int
    students: int
    parents: int
    total: int


class SchoolUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    country: Optional[str] = Field(None, max_length=60)


class SchoolUserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    is_active: bool
    is_verified: bool
    onboarding_completed: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class SchoolUserCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    role: Literal["teacher", "student", "parent"] = "student"


class SchoolUsersList(BaseModel):
    users: List[SchoolUserResponse]
    total: int
