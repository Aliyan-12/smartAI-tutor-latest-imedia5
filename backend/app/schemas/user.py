from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
from typing import Optional, Literal


class UserCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    is_active: bool
    credits: float
    parent_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class AdminUserCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    role: Literal["admin", "teacher", "student", "parent"] = "student"
    credits: float = 100


class AdminUserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    email: Optional[EmailStr] = None
    role: Optional[Literal["admin", "teacher", "student", "parent"]] = None
    is_active: Optional[bool] = None
    credits: Optional[float] = None


class CreditAdjust(BaseModel):
    amount: float = Field(..., description="Positive to add, negative to deduct")
    description: str = Field(default="Manual adjustment", max_length=500)
