"""
Legal / privacy / compliance endpoints (`/api/legal`).

Public: legal document listing + content (no login — the pages must be readable by anyone).
Authenticated: versioned consent (accept / pending / mine) + the data-subject request workflow.
Admin: manage data requests.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.middleware.auth import get_current_user, require_admin
from app.models.user import User, ROLE_ADMINISTRATOR
from app.models.legal import LegalDocument, LegalAcceptance, DataRequest, DATA_REQUEST_TYPES
from app.services import legal_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/legal", tags=["legal"])


# ── public legal documents ───────────────────────────────────────────────────────────
@router.get("/documents")
async def list_documents(db: AsyncSession = Depends(get_db)):
    docs = await legal_service.current_documents(db)
    await db.commit()
    return {"documents": [
        {"doc_key": d.doc_key, "title": d.title, "summary": d.summary, "version": d.version,
         "requires_consent": d.requires_consent, "is_draft": d.is_draft,
         "published_at": d.published_at.isoformat() if d.published_at else None}
        for d in docs
    ]}


@router.get("/documents/{doc_key}")
async def get_document(doc_key: str, db: AsyncSession = Depends(get_db)):
    doc = await legal_service.get_document(db, doc_key)
    await db.commit()
    if doc is None:
        raise HTTPException(404, "document_not_found")
    return {
        "doc_key": doc.doc_key, "title": doc.title, "summary": doc.summary, "version": doc.version,
        "content": doc.content, "is_draft": doc.is_draft, "requires_consent": doc.requires_consent,
        "effective_at": doc.effective_at.isoformat() if doc.effective_at else None,
        "published_at": doc.published_at.isoformat() if doc.published_at else None,
    }


# ── consent (versioned + auditable) ──────────────────────────────────────────────────
@router.get("/consents/pending")
async def pending_consents(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    pending = await legal_service.pending_consents(db, current_user.id)
    await db.commit()
    return {"pending": pending}


class AcceptBody(BaseModel):
    doc_key: str
    version: str


@router.post("/consents/accept")
async def accept(body: AcceptBody, request: Request, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else None
    await legal_service.record_acceptance(db, current_user.id, body.doc_key, body.version, ip)
    await db.commit()
    return {"ok": True}


class AcceptManyBody(BaseModel):
    items: list[AcceptBody]


@router.post("/consents/accept-all")
async def accept_all(body: AcceptManyBody, request: Request, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else None
    for it in body.items:
        await legal_service.record_acceptance(db, current_user.id, it.doc_key, it.version, ip)
    await db.commit()
    return {"ok": True, "count": len(body.items)}


@router.get("/consents/mine")
async def my_consents(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(LegalAcceptance).where(LegalAcceptance.user_id == current_user.id).order_by(LegalAcceptance.accepted_at.desc())
    )).scalars().all()
    return {"acceptances": [
        {"doc_key": a.doc_key, "version": a.version, "accepted_at": a.accepted_at.isoformat()} for a in rows
    ]}


# ── data-subject requests ────────────────────────────────────────────────────────────
class DataRequestBody(BaseModel):
    request_type: str
    details: Optional[str] = None
    subject_user_id: Optional[int] = None


@router.post("/data-requests")
async def create_data_request(body: DataRequestBody, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.request_type not in DATA_REQUEST_TYPES:
        raise HTTPException(400, f"invalid_type: one of {', '.join(DATA_REQUEST_TYPES)}")
    req = DataRequest(user_id=current_user.id, subject_user_id=body.subject_user_id,
                      request_type=body.request_type, details=body.details, status="pending")
    db.add(req)
    await db.commit()
    return {"id": req.id, "status": req.status}


def _ser_request(r: DataRequest) -> dict:
    return {"id": r.id, "user_id": r.user_id, "subject_user_id": r.subject_user_id,
            "request_type": r.request_type, "status": r.status, "details": r.details,
            "resolution_note": r.resolution_note, "created_at": r.created_at.isoformat(),
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None}


@router.get("/data-requests")
async def list_data_requests(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(DataRequest).where(DataRequest.user_id == current_user.id).order_by(DataRequest.created_at.desc())
    )).scalars().all()
    return {"requests": [_ser_request(r) for r in rows]}


@router.get("/admin/data-requests")
async def admin_list_data_requests(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(DataRequest).order_by(DataRequest.created_at.desc()))).scalars().all()
    return {"requests": [_ser_request(r) for r in rows]}


class DataRequestUpdate(BaseModel):
    status: str
    resolution_note: Optional[str] = None


@router.patch("/admin/data-requests/{req_id}")
async def admin_update_data_request(req_id: int, body: DataRequestUpdate, current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    req = await db.get(DataRequest, req_id)
    if req is None:
        raise HTTPException(404, "not_found")
    req.status = body.status
    if body.resolution_note is not None:
        req.resolution_note = body.resolution_note
    if body.status in ("completed", "rejected"):
        from datetime import datetime, timezone
        req.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}
