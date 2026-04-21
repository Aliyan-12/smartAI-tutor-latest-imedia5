import logging
from datetime import datetime
from typing import Dict, Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def send_email(to_address: str, subject: str, body: str) -> bool:
    if settings.email_enabled:
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            msg = MIMEMultipart()
            msg["From"] = settings.email_from_address
            msg["To"] = to_address
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "html"))

            with smtplib.SMTP(settings.email_smtp_host, settings.email_smtp_port) as server:
                server.starttls()
                server.login(settings.email_smtp_user, settings.email_smtp_password)
                server.send_message(msg)

            logger.info(f"Email sent to {to_address}: {subject}")
            return True
        except Exception as e:
            logger.error(f"Email send failed: {e}")
            return False
    else:
        logger.info(f"[DUMMY EMAIL] To: {to_address} | Subject: {subject}")
        logger.info(f"[DUMMY EMAIL] Body: {body[:200]}...")
        return True


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
    score = report_dict.get("quiz_score_percent", 0)
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

    # Score colour coding
    if score >= 80:
        score_colour = "#22c55e"  # green
    elif score >= 60:
        score_colour = "#f59e0b"  # amber
    else:
        score_colour = "#ef4444"  # red

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
            <div style="font-size: 32px; font-weight: bold; color: {score_colour};">{score:.0f}%</div>
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

    email_subject = f"Session Report: {subject} — {student_name} scored {score:.0f}%"

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
