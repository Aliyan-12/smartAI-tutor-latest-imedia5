from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.models.user import User
from app.models.subscription import CreditTransaction, Subscription

COST_PER_MESSAGE = 1.0

SUBSCRIPTION_PLANS = {
    "free": {"credits": 50, "price": 0.00, "description": "Free tier with 50 credits"},
    "starter": {"credits": 500, "price": 9.99, "description": "Starter plan with 500 credits"},
    "pro": {"credits": 2000, "price": 29.99, "description": "Pro plan with 2000 credits"},
    "unlimited": {"credits": 10000, "price": 79.99, "description": "Unlimited plan with 10000 credits"},
}


async def check_and_deduct_credit(db: AsyncSession, user: User, cost: float = COST_PER_MESSAGE) -> bool:
    current_balance = float(user.credits)
    if current_balance < cost:
        return False

    user.credits = current_balance - cost
    new_balance = float(user.credits)

    tx = CreditTransaction(
        user_id=user.id,
        amount=-cost,
        balance_after=new_balance,
        tx_type="chat_usage",
        description="AI chat message",
    )
    db.add(tx)
    await db.flush()
    return True


async def add_credits(
    db: AsyncSession, user: User, amount: float, tx_type: str, description: str = ""
) -> CreditTransaction:
    user.credits = float(user.credits) + amount
    new_balance = float(user.credits)

    tx = CreditTransaction(
        user_id=user.id,
        amount=amount,
        balance_after=new_balance,
        tx_type=tx_type,
        description=description,
    )
    db.add(tx)
    await db.flush()
    await db.refresh(tx)
    return tx


async def get_transactions(
    db: AsyncSession, user_id: int, limit: int = 50
) -> List[CreditTransaction]:
    result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == user_id)
        .order_by(desc(CreditTransaction.created_at))
        .limit(limit)
    )
    return list(result.scalars().all())


async def subscribe_user(db: AsyncSession, user: User, plan_name: str) -> Optional[Subscription]:
    plan = SUBSCRIPTION_PLANS.get(plan_name)
    if not plan:
        return None

    sub = Subscription(
        user_id=user.id,
        plan_name=plan_name,
        credits_included=plan["credits"],
        price=plan["price"],
        status="active",
    )
    db.add(sub)

    user.credits = float(user.credits) + plan["credits"]

    tx = CreditTransaction(
        user_id=user.id,
        amount=plan["credits"],
        balance_after=float(user.credits),
        tx_type="subscription",
        description=f"Subscribed to {plan_name} plan",
    )
    db.add(tx)
    await db.flush()
    await db.refresh(sub)
    return sub


async def get_user_subscriptions(db: AsyncSession, user_id: int) -> List[Subscription]:
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user_id)
        .order_by(desc(Subscription.started_at))
    )
    return list(result.scalars().all())
