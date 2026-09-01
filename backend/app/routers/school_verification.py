"""
School verification endpoints (`/api/school-verification`).

School admin: view/edit their application, upload private evidence, submit.
Platform administrator: review applications, download evidence, drive the state machine.
Evidence is stored privately and only downloadable by the owning admin or the administrator.
"""
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import get_current_user, require_admin, require_administrator
from app.models.user import User, ROLE_ADMIN, ROLE_ADMINISTRATOR
from app.models.school import School
from app.models.school_verification import SchoolVerificationEvent, SchoolVerificationDocument
from app.services import school_verification_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/school-verification", tags=["school-verification"])

_EDITABLE = ("legal_name", "name", "website", "domain", "school_type", "identifier",
             "address", "contact_email", "contact_phone", "country")


def _school_public(s: School) -> dict:
    return {
        "id": s.id, "name": s.name, "legal_name": s.legal_name, "country": s.country,
        "website": s.website, "domain": s.domain, "school_type": s.school_type,
        "identifier": s.identifier, "address": s.address, "contact_email": s.contact_email,
        "contact_phone": s.contact_phone, "verification_status": s.verification_status,
        "verification_notes": s.verification_notes, "suspended_reason": s.suspended_reason,
        "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
        "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
    }


async def _events(db: AsyncSession, school_id: int) -> list[dict]:
    rows = (await db.execute(
        select(SchoolVerificationEvent).where(SchoolVerificationEvent.school_id == school_id)
        .order_by(SchoolVerificationEvent.created_at.desc())
    )).scalars().all()
    return [{"from": e.from_status, "to": e.to_status, "note": e.note,
             "actor_user_id": e.actor_user_id, "created_at": e.created_at.isoformat()} for e in rows]


async def _evidence(db: AsyncSession, school_id: int) -> list[dict]:
    rows = (await db.execute(
        select(SchoolVerificationDocument).where(SchoolVerificationDocument.school_id == school_id)
        .order_by(SchoolVerificationDocument.uploaded_at.desc())
    )).scalars().all()
    return [{"id": d.id, "filename": d.filename, "content_type": d.content_type, "size": d.size,
             "scan_status": d.scan_status, "uploaded_at": d.uploaded_at.isoformat()} for d in rows]


# ── school admin self-service ────────────────────────────────────────────────────────
async def _my_school(current_user: User, db: AsyncSession) -> School:
    if current_user.role not in (ROLE_ADMIN,):
        raise HTTPException(403, "school_admin_only")
    if current_user.school_id is None:
        raise HTTPException(400, "no_school")
    school = await db.get(School, current_user.school_id)
    if school is None:
        raise HTTPException(404, "school_not_found")
    return school


@router.get("/me")
async def my_verification(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    school = await _my_school(current_user, db)
    return {"school": _school_public(school), "events": await _events(db, school.id),
            "evidence": await _evidence(db, school.id),
            "editable": school.verification_status in ("draft", "changes_requested", "rejected")}


class UpdateBody(BaseModel):
    legal_name: Optional[str] = None
    name: Optional[str] = None
    website: Optional[str] = None
    domain: Optional[str] = None
    school_type: Optional[str] = None
    identifier: Optional[str] = None
    address: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    country: Optional[str] = None


@router.put("/me")
async def update_verification(body: UpdateBody, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    school = await _my_school(current_user, db)
    if school.verification_status not in ("draft", "changes_requested", "rejected"):
        raise HTTPException(409, "not_editable_in_current_status")
    for f in _EDITABLE:
        v = getattr(body, f, None)
        if v is not None:
            setattr(school, f, v)
    await db.commit()
    return {"ok": True}


@router.post("/me/submit")
async def submit_verification(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    school = await _my_school(current_user, db)
    try:
        warnings = await svc.submit(db, school, current_user.id)
    except svc.VerificationError as e:
        raise HTTPException(400, {"code": e.code, "message": e.detail})
    await db.commit()
    return {"status": school.verification_status, "warnings": warnings}


@router.post("/me/evidence")
async def upload_evidence(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    school = await _my_school(current_user, db)
    data = await file.read()
    try:
        doc = await svc.save_evidence(db, school, file.filename or "evidence",
                                      file.content_type or "application/octet-stream", data, current_user.id)
    except svc.VerificationError as e:
        raise HTTPException(400, {"code": e.code, "message": e.detail})
    await db.commit()
    return {"id": doc.id, "scan_status": doc.scan_status}


def _can_access_school(user: User, school_id: int) -> bool:
    return user.role == ROLE_ADMINISTRATOR or (user.role == ROLE_ADMIN and user.school_id == school_id)


@router.get("/evidence/{doc_id}/download")
async def download_evidence(doc_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    doc = await db.get(SchoolVerificationDocument, doc_id)
    if doc is None:
        raise HTTPException(404, "not_found")
    if not _can_access_school(current_user, doc.school_id):
        raise HTTPException(403, "forbidden")   # evidence is private
    if not os.path.exists(doc.storage_path):
        raise HTTPException(404, "file_missing")
    return FileResponse(doc.storage_path, media_type=doc.content_type, filename=doc.filename)


# ── platform administrator review ────────────────────────────────────────────────────
@router.get("/applications")
async def list_applications(status: Optional[str] = Query(None), current_user: User = Depends(require_administrator), db: AsyncSession = Depends(get_db)):
    q = select(School).where(School.is_default == False).order_by(School.submitted_at.desc().nullslast(), School.created_at.desc())
    if status:
        q = q.where(School.verification_status == status)
    rows = (await db.execute(q)).scalars().all()
    return {"applications": [_school_public(s) for s in rows]}


@router.get("/applications/{school_id}")
async def application_detail(school_id: int, current_user: User = Depends(require_administrator), db: AsyncSession = Depends(get_db)):
    school = await db.get(School, school_id)
    if school is None:
        raise HTTPException(404, "not_found")
    return {"school": _school_public(school), "events": await _events(db, school_id),
            "evidence": await _evidence(db, school_id), "duplicate_warnings": await svc.duplicate_checks(db, school)}


class TransitionBody(BaseModel):
    to_status: str
    note: Optional[str] = None


@router.post("/applications/{school_id}/transition")
async def transition_application(school_id: int, body: TransitionBody, current_user: User = Depends(require_administrator), db: AsyncSession = Depends(get_db)):
    school = await db.get(School, school_id)
    if school is None:
        raise HTTPException(404, "not_found")
    try:
        await svc.transition(db, school, body.to_status, current_user.id, body.note)
    except svc.VerificationError as e:
        raise HTTPException(400, {"code": e.code, "message": e.detail})
    await db.commit()
    return {"status": school.verification_status}
