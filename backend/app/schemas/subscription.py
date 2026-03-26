from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class SubscriptionPlan(BaseModel):
    name: str
    credits: float
    price: float
    description: str = ""


class SubscriptionCreate(BaseModel):
    plan_name: str = Field(..., max_length=60)


class SubscriptionResponse(BaseModel):
    id: int
    user_id: int
    plan_name: str
    credits_included: float
    price: float
    status: str
    started_at: datetime
    expires_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CreditTransactionResponse(BaseModel):
    id: int
    user_id: int
    amount: float
    balance_after: float
    tx_type: str
    description: str
    created_at: datetime

    model_config = {"from_attributes": True}
