from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import get_current_user
from app.models.user import User, ROLE_STUDENT
from app.schemas.subscription import (
    SubscriptionPlan, SubscriptionCreate, SubscriptionResponse, CreditTransactionResponse,
)
from app.services.platform_service import (
    SUBSCRIPTION_PLANS, subscribe_user, get_user_subscriptions, get_transactions,
)

router = APIRouter(prefix="/api/subscription", tags=["subscription"])


@router.get("/plans", response_model=List[SubscriptionPlan])
async def list_plans():
    return [
        SubscriptionPlan(name=name, credits=plan["credits"], price=plan["price"], description=plan["description"])
        for name, plan in SUBSCRIPTION_PLANS.items()
    ]


@router.post("/subscribe", response_model=SubscriptionResponse)
async def subscribe(
    payload: SubscriptionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != ROLE_STUDENT:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can subscribe")

    sub = await subscribe_user(db, current_user, payload.plan_name)
    if not sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid plan name")

    return SubscriptionResponse.model_validate(sub)


@router.get("/history", response_model=List[SubscriptionResponse])
async def subscription_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    subs = await get_user_subscriptions(db, current_user.id)
    return [SubscriptionResponse.model_validate(s) for s in subs]


@router.get("/transactions", response_model=List[CreditTransactionResponse])
async def transaction_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    txs = await get_transactions(db, current_user.id)
    return [CreditTransactionResponse.model_validate(t) for t in txs]
