import logging
from datetime import datetime

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
