"""Parent account settings API. Screens: profile, children, notifications,
account/security, privacy, billing. Child mutations are audited (see
parent_settings_service). Payment details never touch this backend as raw card data —
the billing screen is read-only summary; card capture goes through the provider UI
(features 09/10)."""
import logging
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password, hash_password
from app.db.session import get_db
from app.middleware.auth import require_parent
from app.models.user import User
from app.models.subscription import Subscription, CreditTransaction
from app.schemas.user import UserResponse
from app.services import parent_settings_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/parent/settings", tags=["parent-settings"])


# ── schemas ──────────────────────────────────────────────────────────────
class ParentProfileResponse(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    timezone: str = "Europe/London"
    language: str = "en"
    default_child_credits: int = 100


class ParentProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    timezone: Optional[str] = None
    language: Optional[str] = None
    default_child_credits: Optional[int] = None


class NotificationPrefs(BaseModel):
    prefs: Dict[str, bool]


class ChildCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LinkCode(BaseModel):
    code: str = Field(min_length=4, max_length=32)


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


# ── profile ──────────────────────────────────────────────────────────────
@router.get("/profile", response_model=ParentProfileResponse)
async def get_profile(parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    profile = await svc.get_or_create_profile(db, parent.id)
    await db.commit()
    return ParentProfileResponse(
        name=parent.name, email=parent.email, phone=profile.phone,
        timezone=profile.timezone, language=profile.language,
        default_child_credits=profile.default_child_credits,
    )


@router.put("/profile", response_model=ParentProfileResponse)
async def update_profile(payload: ParentProfileUpdate, parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    profile = await svc.update_profile(db, parent, payload.model_dump(exclude_none=True))
    await db.commit()
    return ParentProfileResponse(
        name=parent.name, email=parent.email, phone=profile.phone,
        timezone=profile.timezone, language=profile.language,
        default_child_credits=profile.default_child_credits,
    )


# ── notifications ────────────────────────────────────────────────────────
@router.get("/notifications")
async def get_notifications(parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    profile = await svc.get_or_create_profile(db, parent.id)
    await db.commit()
    return {"prefs": profile.notification_prefs}


@router.put("/notifications")
async def update_notifications(payload: NotificationPrefs, parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    profile = await svc.update_notifications(db, parent.id, payload.prefs)
    await db.commit()
    return {"prefs": profile.notification_prefs}


# ── children ─────────────────────────────────────────────────────────────
@router.get("/children")
async def list_children(parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    return {"children": await svc.children_summary(db, parent.id)}


@router.post("/children", status_code=status.HTTP_201_CREATED)
async def add_child(payload: ChildCreate, parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    child = await svc.create_child(db, parent, payload.name, payload.email, payload.password)
    await db.commit()
    return UserResponse.model_validate(child)


@router.post("/children/link")
async def link_child(payload: LinkCode, parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    child = await svc.link_child_by_code(db, parent, payload.code)
    await db.commit()
    return {"message": f"Linked {child.name}", "student": UserResponse.model_validate(child)}


@router.delete("/children/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_child(student_id: int, parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    await svc.unlink_child(db, parent, student_id)
    await db.commit()


@router.get("/audit")
async def child_audit(parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    events = await svc.list_events(db, parent.id)
    return {"events": [
        {"action": e.action, "student_id": e.student_id, "detail": e.detail, "created_at": e.created_at}
        for e in events
    ]}


# ── account / security ───────────────────────────────────────────────────
@router.post("/account/change-password")
async def change_password(payload: ChangePassword, parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    if not parent.password_hash or not verify_password(payload.current_password, parent.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Your current password is incorrect")
    parent.password_hash = hash_password(payload.new_password)
    # Changing the password ends other sessions too.
    await svc.logout_all_devices(db, parent)
    await db.commit()
    return {"message": "Password updated. Other devices have been signed out."}


@router.post("/account/logout-all")
async def logout_all(parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    version = await svc.logout_all_devices(db, parent)
    await db.commit()
    return {"message": "Signed out of all devices.", "token_version": version}


# ── billing (read-only summary; card capture is provider-side) ────────────
@router.get("/billing")
async def billing_summary(parent: User = Depends(require_parent), db: AsyncSession = Depends(get_db)):
    sub_res = await db.execute(
        select(Subscription).where(Subscription.user_id == parent.id)
        .order_by(desc(Subscription.started_at)).limit(1)
    )
    sub = sub_res.scalar_one_or_none()
    tx_res = await db.execute(
        select(CreditTransaction).where(CreditTransaction.user_id == parent.id)
        .order_by(desc(CreditTransaction.created_at)).limit(10)
    )
    txns = list(tx_res.scalars().all())
    return {
        "credits": float(parent.credits or 0),
        "subscription": None if sub is None else {
            "plan_name": sub.plan_name,
            "status": sub.status,
            "price": float(sub.price),
            "credits_included": float(sub.credits_included),
            "started_at": sub.started_at,
            "renewal_date": sub.expires_at,
        },
        "transactions": [
            {"amount": float(t.amount), "balance_after": float(t.balance_after),
             "type": t.tx_type, "description": t.description, "created_at": t.created_at}
            for t in txns
        ],
    }
