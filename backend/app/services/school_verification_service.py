"""
School verification workflow (feature 04).

A production-grade state machine on top of the existing tenancy/RBAC:
  draft → submitted → under_review → verified | rejected | changes_requested → (resubmit)
  verified → suspended → (re-review)

Every transition is audited (SchoolVerificationEvent). Verifying/rejecting/suspending a school
syncs the owning admin's login gate (`approval_status`) so the existing auth block enforces
access. An email domain alone never proves legitimacy — evidence + administrator review are
required.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.school import School, VERIFICATION_TRANSITIONS
from app.models.school_verification import SchoolVerificationEvent, SchoolVerificationDocument
from app.models.user import User, APPROVAL_APPROVED, APPROVAL_PENDING, APPROVAL_REJECTED

logger = logging.getLogger(__name__)

REQUIRED_FOR_SUBMIT = ("legal_name", "country", "school_type", "contact_email")
_EVIDENCE_DIR = os.path.join(settings.upload_dir, "verification")  # PRIVATE — never served publicly
_MAX_EVIDENCE_BYTES = 10 * 1024 * 1024
_ALLOWED_EVIDENCE = {"application/pdf", "image/png", "image/jpeg", "image/webp"}


class VerificationError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(detail)


def is_verified(school: School) -> bool:
    return school.is_default or school.verification_status == "verified"


def scan_file(path: str) -> str:
    """Malware-scan hook interface. Returns 'clean' | 'flagged'. Wire a real scanner
    (e.g. ClamAV / a cloud scanning API) here before launch."""
    return "clean"


async def _audit(db: AsyncSession, school_id: int, from_status: Optional[str], to_status: str,
                 actor_user_id: Optional[int], note: Optional[str]) -> None:
    db.add(SchoolVerificationEvent(
        school_id=school_id, from_status=from_status, to_status=to_status,
        actor_user_id=actor_user_id, note=note,
    ))


def _notify(school: School, to_status: str) -> None:
    """Email hook for the applicant. Best-effort — logs in dev (EMAIL_ENABLED=false)."""
    subj = {
        "submitted": "We've received your school verification",
        "under_review": "Your school verification is under review",
        "verified": "Your school has been verified",
        "rejected": "Your school verification was not approved",
        "changes_requested": "We need more information to verify your school",
        "suspended": "Your school account has been suspended",
    }.get(to_status)
    if not subj:
        return
    if not settings.email_enabled:
        logger.info("[verification email — dev] school=%s -> %s (%s)", school.id, to_status, subj)
        return
    try:
        from app.services import platform_service
        if hasattr(platform_service, "send_email") and school.contact_email:
            platform_service.send_email(school.contact_email, subj, subj)  # template TBD
    except Exception as e:  # noqa: BLE001
        logger.warning("verification email failed: %s", e)


async def _sync_admin_approval(db: AsyncSession, school: School, to_status: str) -> None:
    """Keep the school admin's login gate in step with the school's verification outcome."""
    if not school.superadmin_user_id:
        return
    admin = await db.get(User, school.superadmin_user_id)
    if admin is None:
        return
    if to_status == "verified":
        admin.approval_status = APPROVAL_APPROVED
    elif to_status == "rejected":
        admin.approval_status = APPROVAL_REJECTED
    elif to_status == "suspended":
        admin.approval_status = APPROVAL_PENDING


async def transition(db: AsyncSession, school: School, to_status: str, actor_user_id: Optional[int],
                     note: Optional[str] = None) -> None:
    frm = school.verification_status
    allowed = VERIFICATION_TRANSITIONS.get(frm, set())
    if to_status not in allowed:
        raise VerificationError("invalid_transition", f"Cannot move from '{frm}' to '{to_status}'.")

    now = datetime.now(timezone.utc)
    school.verification_status = to_status
    if to_status == "submitted":
        school.submitted_at = now
        school.verification_notes = None
    elif to_status in ("verified", "rejected", "changes_requested"):
        school.reviewed_at = now
        school.reviewed_by = actor_user_id
        if note is not None:
            school.verification_notes = note
    elif to_status == "suspended":
        school.suspended_reason = note

    await _audit(db, school.id, frm, to_status, actor_user_id, note)
    await _sync_admin_approval(db, school, to_status)
    await db.flush()
    _notify(school, to_status)
    # In-app notification to the school admin (best-effort). No sensitive data in the title.
    if school.superadmin_user_id:
        try:
            from app.services import notification_service
            _titles = {
                "verified": "Your school is verified", "rejected": "School application rejected",
                "changes_requested": "Changes requested on your application",
                "suspended": "Your school has been suspended", "under_review": "Your application is under review",
            }
            title = _titles.get(to_status, f"School status: {to_status.replace('_', ' ')}")
            await notification_service.notify(
                db, user_id=school.superadmin_user_id, category="school_notices",
                type=f"verification_{to_status}", title=title,
                body=note or "", dedup_key=f"verif:{school.id}:{to_status}:{school.reviewed_at or school.submitted_at}",
                link="/school/verification")
        except Exception:
            logger.exception("verification notification failed (non-fatal)")
    logger.info("School %s verification %s -> %s by %s", school.id, frm, to_status, actor_user_id)


async def duplicate_checks(db: AsyncSession, school: School) -> list[str]:
    """Automated duplicate detection. Returns human-readable warnings (does NOT auto-reject —
    a domain match is a flag for manual review, not proof)."""
    warnings: list[str] = []
    if school.domain:
        dup = (await db.execute(
            select(func.count(School.id)).where(School.domain == school.domain, School.id != school.id)
        )).scalar() or 0
        if dup:
            warnings.append(f"Domain '{school.domain}' is already used by {dup} other school(s).")
    if school.identifier:
        dup = (await db.execute(
            select(func.count(School.id)).where(School.identifier == school.identifier, School.id != school.id)
        )).scalar() or 0
        if dup:
            warnings.append(f"Identifier '{school.identifier}' is already used by {dup} other school(s).")
    return warnings


async def submit(db: AsyncSession, school: School, actor_user_id: int) -> list[str]:
    missing = [f for f in REQUIRED_FOR_SUBMIT if not getattr(school, f, None)]
    if missing:
        raise VerificationError("missing_fields", f"Please complete: {', '.join(missing)}.")
    if school.verification_status not in ("draft", "changes_requested", "rejected"):
        raise VerificationError("not_submittable", f"Cannot submit from '{school.verification_status}'.")
    warnings = await duplicate_checks(db, school)
    await transition(db, school, "submitted", actor_user_id)
    return warnings


async def save_evidence(db: AsyncSession, school: School, filename: str, content_type: str,
                        data: bytes, uploaded_by: int) -> SchoolVerificationDocument:
    if content_type not in _ALLOWED_EVIDENCE:
        raise VerificationError("bad_type", "Only PDF, PNG, JPEG or WebP evidence is allowed.")
    if len(data) > _MAX_EVIDENCE_BYTES:
        raise VerificationError("too_large", "Evidence must be 10MB or smaller.")
    school_dir = os.path.join(_EVIDENCE_DIR, str(school.id))
    os.makedirs(school_dir, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename)[:120] or "evidence"
    stored = os.path.join(school_dir, f"{uuid.uuid4().hex}_{safe}")
    with open(stored, "wb") as fh:
        fh.write(data)
    status = scan_file(stored)
    doc = SchoolVerificationDocument(
        school_id=school.id, filename=safe, content_type=content_type, size=len(data),
        storage_path=stored, scan_status=status, uploaded_by=uploaded_by,
    )
    db.add(doc)
    await db.flush()
    return doc
