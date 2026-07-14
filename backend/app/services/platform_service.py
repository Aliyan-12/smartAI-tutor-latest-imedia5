"""
platform_service.py — unified platform/utility service.

Merges five small services into one (each section keeps its full functionality):
  - credit / subscriptions            (was credit_service)
  - email notifications               (was email_service)
  - gamification: XP, streaks, topic mastery, next-topic recommendations (was gamification_service)
  - student settings + preferences    (was settings_service)
  - web scraping / link imports       (was scraper_service)
"""
import base64
import logging
import re
import tempfile
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse, quote

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User
from app.models.subscription import CreditTransaction, Subscription
from app.models.student_profile import StudentProfile, TopicMastery
from app.models.lesson_plan import LessonPlan

logger = logging.getLogger(__name__)


# ===========================================================================
# credit / subscriptions
# ===========================================================================

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


# ===========================================================================
# email notifications
# ===========================================================================

def send_email(to_address: str, subject: str, body: str) -> bool:
    if not settings.email_enabled:
        logger.info(f"[DUMMY EMAIL] To: {to_address} | Subject: {subject}")
        logger.info(f"[DUMMY EMAIL] Body: {body[:200]}...")
        return True

    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    # Most providers (incl. Gmail) require the From to be the authenticated user;
    # fall back to the SMTP user when the From is unset/placeholder.
    from_addr = settings.email_from_address
    if not from_addr or from_addr == "noreply@smartai.com":
        from_addr = settings.email_smtp_user or from_addr

    msg = MIMEMultipart()
    msg["From"] = from_addr
    msg["To"] = to_address
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "html"))

    host, port = settings.email_smtp_host, settings.email_smtp_port
    try:
        if port == 465:
            # Implicit TLS
            with smtplib.SMTP_SSL(host, port, timeout=20) as server:
                if settings.email_smtp_user:
                    server.login(settings.email_smtp_user, settings.email_smtp_password)
                server.send_message(msg)
        else:
            # STARTTLS (587)
            with smtplib.SMTP(host, port, timeout=20) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                if settings.email_smtp_user:
                    server.login(settings.email_smtp_user, settings.email_smtp_password)
                server.send_message(msg)
        logger.info(f"Email sent to {to_address}: {subject}")
        return True
    except Exception as e:
        # Surface the real SMTP error (auth failure, bad app password, blocked port…)
        logger.error(
            "Email send to %s FAILED via %s:%s as %r — %s: %s",
            to_address, host, port, settings.email_smtp_user, type(e).__name__, e,
        )
        return False


# ── Auth emails (verification + password reset) ────────────────────────────────
def _frontend_link(path: str, token: str) -> str:
    return f"{settings.frontend_base_url.rstrip('/')}/{path}?token={token}"


async def send_verification_email(to: str, name: str, token: str) -> None:
    import asyncio
    link = _frontend_link("verify-email", token)
    if not settings.email_enabled:
        logger.info("[email disabled] verify link for %s: %s", to, link)
    subject = "Verify your AI Tutor 4 Schools account"
    body = (
        f"<p>Hi {name},</p>"
        "<p>Welcome to <strong>AI Tutor 4 Schools</strong>! Please verify your email "
        "to activate your account:</p>"
        f'<p><a href="{link}" style="background:#1a73e8;color:#fff;padding:10px 18px;'
        'border-radius:8px;text-decoration:none;font-weight:600">Verify my email</a></p>'
        f'<p>Or paste this link:<br><a href="{link}">{link}</a></p>'
        "<p style='color:#64748b;font-size:13px'>This link expires in 24 hours.</p>"
    )
    await asyncio.to_thread(send_email, to, subject, body)


async def send_password_reset(to: str, name: str, token: str) -> None:
    import asyncio
    link = _frontend_link("reset-password", token)
    if not settings.email_enabled:
        logger.info("[email disabled] reset link for %s: %s", to, link)
    subject = "Reset your AI Tutor 4 Schools password"
    body = (
        f"<p>Hi {name},</p><p>Reset your password using the link below:</p>"
        f'<p><a href="{link}">{link}</a></p>'
        "<p style='color:#64748b;font-size:13px'>This link expires in 24 hours.</p>"
    )
    await asyncio.to_thread(send_email, to, subject, body)


async def send_school_approved(to: str, name: str) -> None:
    import asyncio
    login_url = f"{settings.frontend_base_url.rstrip('/')}/login"
    subject = "Your AI Tutor 4 Schools account is approved 🎉"
    body = (
        f"<p>Hi {name},</p>"
        "<p>Good news — your school account has been <strong>approved</strong> by an "
        "administrator. You can now sign in and start setting up your school.</p>"
        f'<p><a href="{login_url}" style="background:#1a73e8;color:#fff;padding:10px 18px;'
        'border-radius:8px;text-decoration:none;font-weight:600">Sign in</a></p>'
    )
    await asyncio.to_thread(send_email, to, subject, body)


async def send_school_rejected(to: str, name: str) -> None:
    import asyncio
    subject = "Update on your AI Tutor 4 Schools account"
    body = (
        f"<p>Hi {name},</p>"
        "<p>Thank you for registering. After review, your school account was "
        "<strong>not approved</strong> at this time. If you think this is a mistake, "
        "please reply to this email or contact support.</p>"
    )
    await asyncio.to_thread(send_email, to, subject, body)


def send_booking_confirmation(
    student_email: str,
    student_name: str,
    teacher_name: str,
    subject: str,
    scheduled_at: datetime,
    parent_email: str = None,
):
    time_str = scheduled_at.strftime("%A, %d %B %Y at %I:%M %p")
    body = f"""
    <h2>Class Booking Confirmed</h2>
    <p>Hello {student_name},</p>
    <p>Your <strong>{subject}</strong> class with <strong>{teacher_name}</strong> has been booked.</p>
    <p><strong>Date & Time:</strong> {time_str}</p>
    <p>Please be ready 5 minutes before the scheduled time.</p>
    <br>
    <p>SmartAI Tutor Team</p>
    """
    send_email(student_email, f"Class Booked: {subject} with {teacher_name}", body)

    if parent_email:
        parent_body = f"""
        <h2>Class Booking Notification</h2>
        <p>A <strong>{subject}</strong> class has been booked for <strong>{student_name}</strong>
        with <strong>{teacher_name}</strong>.</p>
        <p><strong>Date & Time:</strong> {time_str}</p>
        <br>
        <p>SmartAI Tutor Team</p>
        """
        send_email(parent_email, f"Class Booked for {student_name}: {subject}", parent_body)


def send_booking_reminder(
    student_email: str,
    student_name: str,
    teacher_name: str,
    subject: str,
    scheduled_at: datetime,
):
    time_str = scheduled_at.strftime("%I:%M %p")
    body = f"""
    <h2>Class Reminder</h2>
    <p>Hello {student_name},</p>
    <p>Reminder: Your <strong>{subject}</strong> class with <strong>{teacher_name}</strong>
    is scheduled for today at <strong>{time_str}</strong>.</p>
    <br>
    <p>SmartAI Tutor Team</p>
    """
    send_email(student_email, f"Reminder: {subject} class today at {time_str}", body)


def send_assessment_report(
    student_email: str,
    student_name: str,
    topic: str,
    score_percent: float,
    parent_email: str = None,
    teacher_email: str = None,
):
    body = f"""
    <h2>Assessment Report</h2>
    <p>Hello {student_name},</p>
    <p>You completed an assessment on <strong>{topic}</strong>.</p>
    <p><strong>Score:</strong> {score_percent:.0f}%</p>
    <p>Check your dashboard for detailed results and recommendations.</p>
    <br>
    <p>SmartAI Tutor Team</p>
    """
    send_email(student_email, f"Assessment Complete: {topic} - {score_percent:.0f}%", body)

    notification = f"""
    <h2>Student Assessment Notification</h2>
    <p><strong>{student_name}</strong> completed an assessment on <strong>{topic}</strong>.</p>
    <p><strong>Score:</strong> {score_percent:.0f}%</p>
    <p>View full details on your dashboard.</p>
    <br>
    <p>SmartAI Tutor Team</p>
    """

    if parent_email:
        send_email(parent_email, f"{student_name} Assessment: {topic} - {score_percent:.0f}%", notification)
    if teacher_email:
        send_email(teacher_email, f"Student Assessment: {student_name} - {topic}", notification)


def send_session_report(
    to_email: Optional[str],
    student_name: str,
    subject: str,
    report_dict: Dict[str, Any],
    student_email: Optional[str] = None,
) -> None:
    """
    Send a formatted HTML session report email to a parent (and optionally the student).
    Handles None email gracefully — logs a warning instead of crashing.
    """
    score = report_dict.get("quiz_score_percent")
    understanding = report_dict.get("understanding_level", "N/A")
    summary = report_dict.get("summary", "Session completed.")
    next_rec = report_dict.get("next_session_recommendation", "")
    encouragement = report_dict.get("encouragement", "")
    topics = report_dict.get("topics_covered", [])
    weak_areas = report_dict.get("weak_areas", [])
    strong_areas = report_dict.get("strong_areas", [])
    time_spent = report_dict.get("time_spent_minutes", "N/A")

    topics_html = "".join(f"<li>{t}</li>" for t in topics) if topics else "<li>General session</li>"
    weak_html = "".join(f"<li>{w}</li>" for w in weak_areas) if weak_areas else "<li>None identified</li>"
    strong_html = "".join(f"<li>{s}</li>" for s in strong_areas) if strong_areas else "<li>None identified</li>"

    # Score colour coding — score is None when no quiz was taken (e.g. a lesson ended
    # before any quiz), so guard against None before comparing / formatting.
    if score is None:
        score_colour = "#6b7280"  # grey — no quiz
        score_display = "N/A"
    else:
        if score >= 80:
            score_colour = "#22c55e"  # green
        elif score >= 60:
            score_colour = "#f59e0b"  # amber
        else:
            score_colour = "#ef4444"  # red
        score_display = f"{score:.0f}%"

    body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 8px;">
      <div style="background: #1e3a5f; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="margin: 0; font-size: 22px;">SmartAI Tutor</h1>
        <p style="margin: 4px 0 0; opacity: 0.85;">Session Report — {subject}</p>
      </div>

      <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb;">
        <h2 style="color: #1e3a5f;">Session Summary for {student_name}</h2>
        <p style="color: #374151; line-height: 1.6;">{summary}</p>

        <div style="display: flex; gap: 16px; margin: 20px 0;">
          <div style="flex: 1; background: #f0f9ff; border-radius: 8px; padding: 16px; text-align: center;">
            <div style="font-size: 32px; font-weight: bold; color: {score_colour};">{score_display}</div>
            <div style="color: #6b7280; font-size: 14px;">Quiz Score</div>
          </div>
          <div style="flex: 1; background: #f0f9ff; border-radius: 8px; padding: 16px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold; color: #1e3a5f;">{understanding}</div>
            <div style="color: #6b7280; font-size: 14px;">Understanding Level</div>
          </div>
          <div style="flex: 1; background: #f0f9ff; border-radius: 8px; padding: 16px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold; color: #1e3a5f;">{time_spent} min</div>
            <div style="color: #6b7280; font-size: 14px;">Time Spent</div>
          </div>
        </div>

        <h3 style="color: #1e3a5f;">Topics Covered</h3>
        <ul style="color: #374151; padding-left: 20px; line-height: 1.8;">{topics_html}</ul>

        <div style="display: flex; gap: 16px; margin: 16px 0;">
          <div style="flex: 1;">
            <h3 style="color: #22c55e; margin-bottom: 8px;">Strong Areas</h3>
            <ul style="color: #374151; padding-left: 20px; line-height: 1.8;">{strong_html}</ul>
          </div>
          <div style="flex: 1;">
            <h3 style="color: #ef4444; margin-bottom: 8px;">Areas to Improve</h3>
            <ul style="color: #374151; padding-left: 20px; line-height: 1.8;">{weak_html}</ul>
          </div>
        </div>

        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 16px 0;">
          <strong>Next Session Recommendation:</strong>
          <p style="margin: 4px 0 0; color: #374151;">{next_rec}</p>
        </div>

        {f'<div style="background: #ecfdf5; border-left: 4px solid #22c55e; padding: 12px 16px; border-radius: 4px; margin: 16px 0;"><p style="margin: 0; color: #374151; font-style: italic;">{encouragement}</p></div>' if encouragement else ''}

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="color: #9ca3af; font-size: 13px; text-align: center;">
          This report was automatically generated by SmartAI Tutor after the AI tutoring session.<br>
          Log in to your dashboard to view full details and book the next session.
        </p>
      </div>
    </div>
    """

    email_subject = (
        f"Session Report: {subject} — {student_name} scored {score:.0f}%"
        if score is not None
        else f"Session Report: {subject} — {student_name} completed their session"
    )

    if to_email:
        send_email(to_email, email_subject, body)
    else:
        logger.warning(
            f"send_session_report: no parent email available for student '{student_name}' — skipping parent email"
        )

    # Also send to the student themselves if we have their email
    if student_email and student_email != to_email:
        student_body = body.replace(
            f"Session Report for {student_name}",
            "Your Session Report",
        )
        send_email(student_email, email_subject, student_body)


# ===========================================================================
# gamification
# ===========================================================================

XP_LEVELS: List[int] = [0, 200, 500, 1000, 2000, 4000, 7000, 11000, 16000, 22000]


def _calculate_level(xp: int) -> int:
    """Return the level that corresponds to the given total XP amount."""
    level = 1
    for threshold in XP_LEVELS:
        if xp >= threshold:
            level = XP_LEVELS.index(threshold) + 1
        else:
            break
    return level


def _xp_to_next_level(xp: int, current_level: int) -> int:
    """Return the XP needed to reach the next level, or 0 if at max level."""
    next_level_index = current_level  # current_level is 1-based; next threshold is at index current_level
    if next_level_index >= len(XP_LEVELS):
        return 0
    return XP_LEVELS[next_level_index] - xp


# ---------------------------------------------------------------------------
# Profile helpers
# ---------------------------------------------------------------------------

async def get_or_create_profile(db: AsyncSession, student_id: int) -> StudentProfile:
    """Fetch the StudentProfile for *student_id*, creating one if it does not exist."""
    result = await db.execute(
        select(StudentProfile).where(StudentProfile.student_id == student_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = StudentProfile(
            student_id=student_id,
            xp_total=0,
            xp_level=1,
            current_streak=0,
            longest_streak=0,
            last_active_date=None,
            interests=[],
            preferred_subjects=[],
        )
        db.add(profile)
        await db.flush()
        await db.refresh(profile)
        logger.info(f"Created StudentProfile for student_id={student_id}")
    return profile


async def award_xp(db: AsyncSession, student_id: int, amount: int, reason: str = "") -> StudentProfile:
    """Add *amount* XP to the student's profile and recalculate their level."""
    profile = await get_or_create_profile(db, student_id)
    # amount may be negative (e.g. an ended-early penalty) — never let the total go below 0.
    profile.xp_total = max(0, (profile.xp_total or 0) + amount)
    profile.xp_level = _calculate_level(profile.xp_total)
    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    logger.info(
        f"Awarded {amount} XP to student_id={student_id} (reason={reason!r}). "
        f"New total={profile.xp_total}, level={profile.xp_level}"
    )
    return profile


async def check_and_update_streak(db: AsyncSession, student_id: int) -> StudentProfile:
    """
    Compare last_active_date to today UTC and update the streak accordingly.

    - Same day → no change (already counted today).
    - Yesterday → increment streak.
    - Older (or None) → reset streak to 1.

    Also updates longest_streak when the current streak surpasses it.
    """
    profile = await get_or_create_profile(db, student_id)
    today = datetime.now(timezone.utc).date()

    if profile.last_active_date is None:
        profile.current_streak = 1
        profile.longest_streak = max(profile.longest_streak or 0, 1)
    elif profile.last_active_date == today:
        # Already recorded today – nothing to do
        return profile
    elif profile.last_active_date == today - timedelta(days=1):
        profile.current_streak = (profile.current_streak or 0) + 1
        if profile.current_streak > (profile.longest_streak or 0):
            profile.longest_streak = profile.current_streak
    else:
        # Streak broken
        profile.current_streak = 1

    profile.last_active_date = today
    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    return profile


# ---------------------------------------------------------------------------
# Topic mastery
# ---------------------------------------------------------------------------

def _compute_mastery_level(average_score: float) -> str:
    """Derive a mastery label from the student's average score on a topic."""
    if average_score < 40:
        return "learning"
    if average_score < 70:
        return "practicing"
    return "mastered"


async def update_topic_mastery(
    db: AsyncSession,
    student_id: int,
    subject: str,
    key_stage: str,
    topic: str,
    score: float,
) -> TopicMastery:
    """
    Update (or create) a TopicMastery record for the given student/subject/topic.
    Appends the new score to score_history and recalculates mastery_level from
    the average of all recorded scores.
    """
    result = await db.execute(
        select(TopicMastery).where(
            TopicMastery.student_id == student_id,
            TopicMastery.subject == subject,
            TopicMastery.topic == topic,
        )
    )
    mastery = result.scalar_one_or_none()

    score_entry = {"score": score, "date": datetime.now(timezone.utc).isoformat()}

    if mastery is None:
        mastery = TopicMastery(
            student_id=student_id,
            subject=subject,
            key_stage=key_stage,
            topic=topic,
            mastery_level="not_started",
            score_history=[score_entry],
            attempts=1,
            last_practiced_at=datetime.now(timezone.utc),
        )
        db.add(mastery)
    else:
        history: List[Dict[str, Any]] = list(mastery.score_history or [])
        history.append(score_entry)
        mastery.score_history = history
        mastery.attempts = (mastery.attempts or 0) + 1
        mastery.last_practiced_at = datetime.now(timezone.utc)

    # Recalculate mastery level from average score
    all_scores = [entry["score"] for entry in (mastery.score_history or []) if "score" in entry]
    avg = sum(all_scores) / len(all_scores) if all_scores else 0.0
    mastery.mastery_level = _compute_mastery_level(avg)

    await db.flush()
    await db.refresh(mastery)
    return mastery


async def get_mastery_overview(db: AsyncSession, student_id: int) -> List[TopicMastery]:
    """Return all TopicMastery records for a student."""
    result = await db.execute(
        select(TopicMastery).where(TopicMastery.student_id == student_id)
    )
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Daily plan
# ---------------------------------------------------------------------------

async def generate_daily_plan(db: AsyncSession, student_id: int) -> Dict[str, Any]:
    """
    Build a daily learning plan for the student.

    - weak_spots: mastery_level is 'learning' or 'practicing' with avg score < 70, limited to 3.
    - spaced_review: topics not practiced in the last 5 days, limited to 3.
    - confidence_boost: mastered topics to reinforce confidence, limited to 2.
    - upcoming_sessions: planned lesson plans for the student, limited to 3.
    """
    all_mastery = await get_mastery_overview(db, student_id)
    now_utc = datetime.now(timezone.utc)
    five_days_ago = now_utc - timedelta(days=5)

    weak_spots: List[Dict[str, Any]] = []
    spaced_review: List[Dict[str, Any]] = []
    confidence_boost: List[Dict[str, Any]] = []

    for m in all_mastery:
        entry: Dict[str, Any] = {
            "id": m.id,
            "subject": m.subject,
            "key_stage": m.key_stage,
            "topic": m.topic,
            "mastery_level": m.mastery_level,
            "attempts": m.attempts,
        }

        # Weak spots: still in learning or practicing
        if m.mastery_level in ("learning", "practicing", "not_started") and len(weak_spots) < 3:
            weak_spots.append(entry)

        # Spaced review: mastered or practicing but not touched recently
        if m.last_practiced_at is not None:
            last_practiced = m.last_practiced_at
            if last_practiced.tzinfo is None:
                last_practiced = last_practiced.replace(tzinfo=timezone.utc)
            if last_practiced < five_days_ago and len(spaced_review) < 3:
                spaced_review.append(entry)

        # Confidence boost: mastered topics
        if m.mastery_level == "mastered" and len(confidence_boost) < 2:
            confidence_boost.append(entry)

    # Upcoming sessions
    sessions_result = await db.execute(
        select(LessonPlan)
        .where(
            LessonPlan.student_id == student_id,
            LessonPlan.status == "planned",
        )
        .order_by(LessonPlan.created_at.asc())
        .limit(3)
    )
    upcoming_lesson_plans = sessions_result.scalars().all()
    upcoming_sessions: List[Dict[str, Any]] = [
        {
            "id": lp.id,
            "subject": lp.subject,
            "key_stage": lp.key_stage,
            "unit_name": lp.unit_name,
            "subtopic": lp.subtopic,
            "goal": lp.goal,
            "status": lp.status,
        }
        for lp in upcoming_lesson_plans
    ]

    return {
        "weak_spots": weak_spots,
        "spaced_review": spaced_review,
        "confidence_boost": confidence_boost,
        "upcoming_sessions": upcoming_sessions,
    }


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

async def get_dashboard_data(db: AsyncSession, student_id: int) -> Dict[str, Any]:
    """
    Assemble the full gamified dashboard payload for a student.

    Returns a dict with:
      - profile: StudentProfile ORM instance
      - mastery_overview: list of TopicMastery ORM instances
      - daily_plan: dict from generate_daily_plan()
      - continue_learning: the last incomplete lesson plan or the weakest topic
      - xp_to_next_level: XP remaining to reach the next level
    """
    profile = await get_or_create_profile(db, student_id)
    mastery_list = await get_mastery_overview(db, student_id)
    daily_plan = await generate_daily_plan(db, student_id)

    # continue_learning: find last in_progress lesson plan, else last planned, else weakest topic
    continue_learning: Optional[Dict[str, Any]] = None

    in_progress_result = await db.execute(
        select(LessonPlan)
        .where(
            LessonPlan.student_id == student_id,
            LessonPlan.status == "in_progress",
        )
        .order_by(LessonPlan.updated_at.desc())
        .limit(1)
    )
    in_progress_plan = in_progress_result.scalar_one_or_none()

    if in_progress_plan:
        continue_learning = {
            "type": "lesson_plan",
            "id": in_progress_plan.id,
            "subject": in_progress_plan.subject,
            "key_stage": in_progress_plan.key_stage,
            "unit_name": in_progress_plan.unit_name,
            "subtopic": in_progress_plan.subtopic,
            "status": in_progress_plan.status,
        }
    else:
        # Fall back to the weakest topic (lowest average score)
        weakest: Optional[TopicMastery] = None
        lowest_avg = float("inf")
        for m in mastery_list:
            if m.mastery_level in ("learning", "not_started"):
                scores = [e["score"] for e in (m.score_history or []) if "score" in e]
                avg = sum(scores) / len(scores) if scores else 0.0
                if avg < lowest_avg:
                    lowest_avg = avg
                    weakest = m
        if weakest:
            continue_learning = {
                "type": "topic",
                "subject": weakest.subject,
                "key_stage": weakest.key_stage,
                "topic": weakest.topic,
                "mastery_level": weakest.mastery_level,
            }

    xp_remaining = _xp_to_next_level(profile.xp_total, profile.xp_level)

    return {
        "profile": profile,
        "mastery_overview": mastery_list,
        "daily_plan": daily_plan,
        "continue_learning": continue_learning,
        "xp_to_next_level": xp_remaining,
    }


async def get_next_topic_recommendations(
    db: AsyncSession,
    student_id: int,
    subject: Optional[str] = None,
    key_stage: Optional[str] = None,
) -> Dict[str, Any]:
    """Use RAG to suggest topics the student should study next."""
    mastery_list = await get_mastery_overview(db, student_id)

    relevant = [m for m in mastery_list if not subject or m.subject == subject]
    mastered = [m for m in relevant if m.mastery_level in ("mastered", "practicing")]
    studied_topics = {m.topic.lower() for m in relevant}

    if not mastered:
        return {"recommendations": []}

    query = "Next topics to learn after mastering: " + ", ".join(m.topic for m in mastered[:6])

    from app.services.rag_service import retrieve_hub_chunks
    chunks = await retrieve_hub_chunks(
        db, query, subject=subject, key_stage=key_stage, top_k=15
    )

    seen: set[str] = set()
    recommendations: List[Dict[str, Any]] = []
    for chunk in chunks:
        title = chunk.document_title
        key = title.lower()
        if key not in seen and key not in studied_topics:
            seen.add(key)
            preview = chunk.content.strip()
            recommendations.append({
                "topic": title,
                "subject": chunk.subject,
                "key_stage": chunk.key_stage,
                "preview": preview[:120] + "…" if len(preview) > 120 else preview,
            })
        if len(recommendations) >= 4:
            break

    return {"recommendations": recommendations}


# ===========================================================================
# student settings
# ===========================================================================

async def get_student_settings(db: AsyncSession, student_id: int) -> StudentProfile:
    """Fetch or create a StudentProfile for the given student."""
    result = await db.execute(
        select(StudentProfile).where(StudentProfile.student_id == student_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = StudentProfile(
            student_id=student_id,
            xp_total=0,
            xp_level=1,
            current_streak=0,
            longest_streak=0,
            teaching_pace="just_right",
            default_session_length=60,
            voice_responses=True,
            show_hints=True,
            auto_start_next_topic=False,
        )
        db.add(profile)
        await db.flush()
        await db.refresh(profile)
        logger.info(f"Created StudentProfile for student_id={student_id} via settings")
    return profile


async def update_learning_preferences(
    db: AsyncSession,
    student_id: int,
    data: Dict[str, Any],
) -> StudentProfile:
    """
    Update learning preferences on a student's profile.
    Only sets fields that are present and non-None in data.
    """
    profile = await get_student_settings(db, student_id)

    updatable_fields = [
        "learning_style",
        "teaching_pace",
        "teaching_preferences",
        "learning_goals",
        "default_session_length",
        "voice_responses",
        "show_hints",
        "auto_start_next_topic",
        "interests",
        "preferred_subjects",
        # Both are echoed back in the response but were missing from this list — so a student
        # changing their key stage or year group in Settings got a cheerful 200 and no write.
        "year_group",
        "key_stage",
    ]
    for field in updatable_fields:
        if field in data and data[field] is not None:
            setattr(profile, field, data[field])

    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    logger.info(f"Updated learning preferences for student_id={student_id}")
    return profile


async def update_profile(
    db: AsyncSession,
    user_id: int,
    student_id: int,
    name: Optional[str] = None,
    year_group: Optional[str] = None,
    key_stage: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update the user's display name and/or year_group and/or key_stage.
    Returns a combined profile dict.
    """
    # Update User.name if provided
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user and name is not None:
        user.name = name
        await db.flush()

    # Update year_group on StudentProfile
    profile = await get_student_settings(db, student_id)
    if year_group is not None:
        profile.year_group = year_group
        profile.updated_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(profile)

    if key_stage is not None:
        profile.key_stage = key_stage
        profile.updated_at = datetime.now(timezone.utc)
        await db.flush()
        await db.refresh(profile)

    return {
        "user_id": user_id,
        "name": user.name if user else "",
        "email": user.email if user else "",
        "year_group": profile.year_group,
        "key_stage": profile.key_stage,
        "xp_total": profile.xp_total,
        "xp_level": profile.xp_level,
        "current_streak": profile.current_streak,
        "longest_streak": profile.longest_streak,
    }


async def update_notifications(
    db: AsyncSession,
    student_id: int,
    prefs: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Update notification preferences. Merges with existing prefs (partial update).
    Returns the updated prefs dict.
    """
    profile = await get_student_settings(db, student_id)

    existing: Dict[str, Any] = profile.notification_prefs or {
        "assignment_reminders": True,
        "session_reminders": True,
        "messages": True,
        "weekly_progress": True,
    }
    # Merge — only update keys that are provided
    for key, value in prefs.items():
        if value is not None:
            existing[key] = value

    profile.notification_prefs = existing
    profile.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(profile)
    logger.info(f"Updated notification prefs for student_id={student_id}")
    return existing


# ===========================================================================
# web scraping / link imports
# ===========================================================================

ALLOWED_DOMAINS = {
    "thenational.academy",
    "resourcefullearning.co.uk",
    "bbc.co.uk",
    "khanacademy.org",
    "sparknotes.com",
}

SCRAPE_TIMEOUT = 30.0


async def scrape_url(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc.lower().removeprefix("www.")

    if not any(domain == d or domain.endswith("." + d) for d in ALLOWED_DOMAINS):
        raise ValueError(
            f"Domain '{domain}' is not allowed. "
            f"Allowed: {', '.join(sorted(ALLOWED_DOMAINS))}"
        )

    async with httpx.AsyncClient(
        timeout=SCRAPE_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": "SmartAI-Tutor/1.0 (educational)"},
    ) as client:
        response = await client.get(url)
        response.raise_for_status()

    return _extract_text_from_html(response.text)


def _extract_text_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                     "form", "noscript", "iframe", "svg", "button"]):
        tag.decompose()

    main = soup.find("main") or soup.find("article") or soup.find(id="content") or soup.body
    if not main:
        return ""

    lines = []
    for el in main.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"]):
        text = el.get_text(separator=" ", strip=True)
        if text and len(text) > 10:
            lines.append(text)

    raw = "\n\n".join(lines)
    raw = re.sub(r"[ \t]{2,}", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


async def download_onedrive_link(share_url: str) -> Tuple[bytes, str]:
    encoded = base64.b64encode(share_url.encode("utf-8")).decode("utf-8")
    encoded = encoded.rstrip("=").replace("/", "_").replace("+", "-")
    api_url = f"https://api.onedrive.com/v1.0/shares/u!{encoded}/root/content"

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        response = await client.get(api_url)
        response.raise_for_status()

    content_type = response.headers.get("content-type", "")
    if "pdf" in content_type:
        ext = "pdf"
    elif "presentation" in content_type or "pptx" in content_type:
        ext = "pptx"
    elif "wordprocessing" in content_type or "docx" in content_type:
        ext = "docx"
    else:
        ext = "pdf"

    return response.content, ext


async def download_gdocs_link(share_url: str) -> Tuple[bytes, str]:
    parsed = urlparse(share_url)
    path = parsed.path

    if "/document/" in path:
        doc_id = _extract_gdocs_id(path, "document")
        export_url = f"https://docs.google.com/document/d/{doc_id}/export?format=pdf"
        ext = "pdf"
    elif "/presentation/" in path:
        doc_id = _extract_gdocs_id(path, "presentation")
        export_url = f"https://docs.google.com/presentation/d/{doc_id}/export/pptx"
        ext = "pptx"
    elif "/spreadsheets/" in path:
        doc_id = _extract_gdocs_id(path, "spreadsheets")
        export_url = f"https://docs.google.com/spreadsheets/d/{doc_id}/export?format=pdf"
        ext = "pdf"
    else:
        raise ValueError("Could not determine Google Docs type from URL")

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        response = await client.get(export_url)
        response.raise_for_status()

    return response.content, ext


def _extract_gdocs_id(path: str, doc_type: str) -> str:
    parts = path.split("/")
    try:
        idx = parts.index("d")
        return parts[idx + 1]
    except (ValueError, IndexError):
        raise ValueError(f"Could not extract document ID from path: {path}")
