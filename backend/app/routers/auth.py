import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import RedirectResponse

from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.core.tokens import create_token, consume_token
from app.db.session import get_db
from app.middleware.auth import get_current_user
from app.models.auth_tokens import PURPOSE_VERIFY, PURPOSE_RESET, OAuthIdentity
from app.models.user import (
    User, ROLE_STUDENT, ROLE_PARENT, ROLE_ADMIN, DEFAULT_CREDITS,
    ACCOUNT_SCHOOL, ACCOUNT_INDIVIDUAL, APPROVAL_PENDING, APPROVAL_REJECTED,
)
from app.schemas.auth import (
    RegisterRequest, RegisterResponse, VerifyEmailRequest, VerifyEmailResponse,
    ResendVerificationRequest, ForgotPasswordRequest, ResetPasswordRequest,
    OnboardingProfileRequest, OnboardingPreferencesRequest,
)
from app.schemas.user import UserLogin, UserResponse, TokenResponse
from app.services import school_service, platform_service
from app.services.user_service import (
    create_user, authenticate_user, get_user_by_email, get_user_by_id,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Registration (dual-mode: school | individual) ──────────────────────────────
@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    if payload.account_type == "school":
        # School name + country are collected during onboarding, not at signup, so
        # start with a placeholder the admin renames on their first run.
        school_name = (payload.school_name or "").strip() or f"{payload.name}'s School"
        school = await school_service.create_school(
            db, name=school_name, country=payload.country, account_type="school",
        )
        # A school's registrant is its ADMIN (school-scoped). They verify their email
        # like everyone else, but ALSO need an administrator to approve them before
        # they can sign in — so they start as approval_status="pending".
        user = await create_user(
            db, name=payload.name, email=payload.email, password=payload.password,
            role=ROLE_ADMIN, credits=0, school_id=school.id,
            account_type=ACCOUNT_SCHOOL, auth_provider="password",
            approval_status=APPROVAL_PENDING,
        )
        school.superadmin_user_id = user.id
    else:
        default_school = await school_service.get_or_create_default_school(db)
        role = payload.role if payload.role in (ROLE_STUDENT, ROLE_PARENT) else ROLE_STUDENT
        # Starting credits are configurable by the administrator (feature 08).
        from app.services import platform_settings_service
        starting_credits = 0
        if role == ROLE_STUDENT:
            try:
                starting_credits = int(await platform_settings_service.value(db, "default_credits"))
            except Exception:
                starting_credits = DEFAULT_CREDITS
        user = await create_user(
            db, name=payload.name, email=payload.email, password=payload.password,
            role=role, credits=starting_credits,
            school_id=default_school.id, account_type=ACCOUNT_INDIVIDUAL, auth_provider="password",
        )

    token = await create_token(db, user.id, purpose=PURPOSE_VERIFY)
    await db.commit()

    await platform_service.send_verification_email(user.email, user.name, token)
    return RegisterResponse(status="verification_sent", email=user.email)


@router.post("/verify-email", response_model=VerifyEmailResponse)
async def verify_email(payload: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    user_id = await consume_token(db, payload.token, PURPOSE_VERIFY)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_verified = True
    await db.commit()
    await db.refresh(user)

    # A school admin awaiting approval is NOT logged in yet — show the pending message.
    if user.approval_status == APPROVAL_PENDING:
        return VerifyEmailResponse(
            status="pending_approval",
            user=UserResponse.model_validate(user),
            message=(
                "Your email is verified. Your school account will be reviewed by an "
                "administrator — we'll email you once it's approved."
            ),
        )

    token = create_access_token({"sub": str(user.id), "role": user.role, "tv": user.token_version})
    return VerifyEmailResponse(
        status="verified", access_token=token, user=UserResponse.model_validate(user),
    )


@router.post("/resend-verification")
async def resend_verification(payload: ResendVerificationRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, payload.email)
    if user and not user.is_verified:
        token = await create_token(db, user.id, purpose=PURPOSE_VERIFY)
        await db.commit()
        await platform_service.send_verification_email(user.email, user.name, token)
    # Never leak whether the email exists.
    return {"status": "ok"}


# ── Password login ──────────────────────────────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not user.is_verified:
        # Frontend detects this code to offer "resend verification".
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="email_unverified")
    # A pending SCHOOL ADMIN may sign in, but only reaches the verification workflow — their
    # school's protected features stay gated on verification_status (see require_verified_school).
    # Other pending roles remain blocked; rejected accounts are always blocked.
    if user.approval_status == APPROVAL_PENDING and user.role != ROLE_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account_pending_approval")
    if user.approval_status == APPROVAL_REJECTED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account_rejected")

    token = create_access_token({"sub": str(user.id), "role": user.role, "tv": user.token_version})
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))


# ── Password reset ──────────────────────────────────────────────────────────────
@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, payload.email)
    if user and user.password_hash:
        token = await create_token(db, user.id, purpose=PURPOSE_RESET)
        await db.commit()
        await platform_service.send_password_reset(user.email, user.name, token)
    return {"status": "ok"}


@router.post("/reset-password", response_model=TokenResponse)
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    user_id = await consume_token(db, payload.token, PURPOSE_RESET)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(payload.password)
    user.is_verified = True
    await db.commit()
    await db.refresh(user)
    token = create_access_token({"sub": str(user.id), "role": user.role, "tv": user.token_version})
    return TokenResponse(access_token=token, user=UserResponse.model_validate(user))


# ── Google OAuth ────────────────────────────────────────────────────────────────
@router.get("/oauth/google/login")
async def google_login(request: Request):
    from app.services.oauth_service import oauth, google_configured, google_callback_url
    if not google_configured():
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    return await oauth.google.authorize_redirect(request, google_callback_url())


@router.get("/oauth/google/callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)):
    from app.services.oauth_service import oauth
    fe = settings.frontend_base_url.rstrip("/")
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as e:  # noqa: BLE001
        logger.warning("Google OAuth callback failed: %s", e)
        return RedirectResponse(f"{fe}/login?error=oauth_failed")

    info = token.get("userinfo") or {}
    sub = info.get("sub")
    email = info.get("email")
    name = info.get("name") or (email.split("@")[0] if email else "Student")
    if not sub or not email:
        return RedirectResponse(f"{fe}/login?error=oauth_failed")

    user = await _upsert_google_user(db, sub, email, name)
    await db.commit()
    jwt = create_access_token({"sub": str(user.id), "role": user.role, "tv": user.token_version})
    # Hand the JWT to the SPA via the OAuth callback page (URL fragment, not query,
    # so it isn't sent to servers/logs).
    return RedirectResponse(f"{fe}/oauth/callback#token={jwt}")


async def _upsert_google_user(db: AsyncSession, sub: str, email: str, name: str) -> User:
    # 1) Existing federated identity → that user.
    res = await db.execute(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == "google", OAuthIdentity.provider_user_id == sub
        )
    )
    identity = res.scalar_one_or_none()
    if identity:
        user = await get_user_by_id(db, identity.user_id)
        if user:
            return user

    # 2) Existing local account with this email → link Google to it.
    user = await get_user_by_email(db, email)
    if user:
        user.is_verified = True
        db.add(OAuthIdentity(user_id=user.id, provider="google", provider_user_id=sub, email=email))
        await db.flush()
        return user

    # 3) New individual student in the default school (Google verifies the email).
    default_school = await school_service.get_or_create_default_school(db)
    user = await create_user(
        db, name=name, email=email, password=None, role=ROLE_STUDENT,
        credits=DEFAULT_CREDITS, school_id=default_school.id,
        account_type=ACCOUNT_INDIVIDUAL, auth_provider="google", is_verified=True,
    )
    db.add(OAuthIdentity(user_id=user.id, provider="google", provider_user_id=sub, email=email))
    await db.flush()
    return user


# ── Current user ────────────────────────────────────────────────────────────────
@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


# ── Onboarding (post-verification multi-step) ───────────────────────────────────
async def _get_or_create_student_profile(db: AsyncSession, student_id: int):
    from app.models.student_profile import StudentProfile
    res = await db.execute(
        select(StudentProfile).where(StudentProfile.student_id == student_id)
    )
    profile = res.scalar_one_or_none()
    if not profile:
        profile = StudentProfile(student_id=student_id)
        db.add(profile)
        await db.flush()
    return profile


@router.post("/onboarding/profile", response_model=UserResponse)
async def onboarding_profile(
    payload: OnboardingProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == ROLE_STUDENT:
        profile = await _get_or_create_student_profile(db, current_user.id)
        if payload.key_stage is not None:
            profile.key_stage = payload.key_stage
        if payload.year_group is not None:
            profile.year_group = payload.year_group
        if payload.subjects is not None:
            profile.preferred_subjects = payload.subjects
    elif current_user.role == ROLE_PARENT and payload.invite_code:
        from app.models.parent_student import InviteCode
        res = await db.execute(
            select(InviteCode).where(InviteCode.code == payload.invite_code.strip().upper())
        )
        code = res.scalar_one_or_none()
        if not code:
            raise HTTPException(status_code=404, detail="Invalid invite code")
        child = await get_user_by_id(db, code.student_id)
        if child:
            child.parent_id = current_user.id
            code.used = True
    elif current_user.role == ROLE_ADMIN and current_user.school_id:
        school = await school_service.get_school(db, current_user.school_id)
        if school:
            if payload.school_name:
                school.name = payload.school_name
            if payload.country:
                school.country = payload.country

    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.post("/onboarding/preferences", response_model=UserResponse)
async def onboarding_preferences(
    payload: OnboardingPreferencesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == ROLE_STUDENT:
        profile = await _get_or_create_student_profile(db, current_user.id)
        if payload.learning_style is not None:
            profile.learning_style = payload.learning_style
        if payload.teaching_pace is not None:
            profile.teaching_pace = payload.teaching_pace
        if payload.teaching_preferences is not None:
            profile.teaching_preferences = payload.teaching_preferences
        if payload.learning_goals is not None:
            profile.learning_goals = payload.learning_goals
        if payload.voice_responses is not None:
            profile.voice_responses = payload.voice_responses
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.post("/onboarding/complete", response_model=UserResponse)
async def onboarding_complete(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.onboarding_completed = True
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)
