import logging
import uuid
from typing import Optional
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, async_session_factory
from app.middleware.auth import require_teacher
from app.models.user import User
from app.models.documents import SUPPORTED_SUBJECTS
from app.schemas.documents import DocumentResponse, DocumentListResponse, ScrapeRequest, LinkImportRequest
from app.services import document_service, scraper_service
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED_EXTENSIONS = {"pdf", "docx", "pptx"}


@router.get("/subjects")
async def list_subjects(current_user: User = Depends(require_teacher)):
    return SUPPORTED_SUBJECTS


@router.post("/upload", response_model=DocumentResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    subject: str = Form(...),
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    ext = Path(file.filename or "").suffix.lstrip(".").lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    content = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large. Max {settings.max_upload_size_mb}MB")

    file_path = document_service.save_upload(content, ext)

    doc = await document_service.create_document_record(
        db=db, title=title, subject=subject,
        source_type="upload", uploaded_by=current_user.id,
        file_path=file_path, file_type=ext,
    )
    await db.commit()

    async def process_bg():
        async with async_session_factory() as bg_db:
            await document_service.process_document(bg_db, doc.id)
            await bg_db.commit()

    background_tasks.add_task(process_bg)
    return DocumentResponse.model_validate(doc)


@router.post("/scrape", response_model=DocumentResponse, status_code=status.HTTP_202_ACCEPTED)
async def scrape_document(
    background_tasks: BackgroundTasks,
    payload: ScrapeRequest,
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    try:
        scraped_text = await scraper_service.scrape_url(payload.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch URL: {e}")

    if not scraped_text or len(scraped_text) < 50:
        raise HTTPException(status_code=422, detail="Insufficient content extracted from URL")

    file_path = document_service.save_text_content(scraped_text)

    doc = await document_service.create_document_record(
        db=db, title=payload.title, subject=payload.subject,
        source_type="scrape", uploaded_by=current_user.id,
        source_url=payload.url, file_path=file_path, file_type="txt",
    )
    await db.commit()

    async def process_bg():
        async with async_session_factory() as bg_db:
            await document_service.process_document(bg_db, doc.id)
            await bg_db.commit()

    background_tasks.add_task(process_bg)
    return DocumentResponse.model_validate(doc)


@router.post("/import-link", response_model=DocumentResponse, status_code=status.HTTP_202_ACCEPTED)
async def import_link(
    background_tasks: BackgroundTasks,
    payload: LinkImportRequest,
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    try:
        if payload.source_type == "onedrive":
            file_bytes, ext = await scraper_service.download_onedrive_link(payload.url)
        elif payload.source_type == "gdocs":
            file_bytes, ext = await scraper_service.download_gdocs_link(payload.url)
        else:
            raise ValueError(f"Unknown source type: {payload.source_type}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to download: {e}")

    file_path = document_service.save_upload(file_bytes, ext)

    doc = await document_service.create_document_record(
        db=db, title=payload.title, subject=payload.subject,
        source_type=payload.source_type, uploaded_by=current_user.id,
        source_url=payload.url, file_path=file_path, file_type=ext,
    )
    await db.commit()

    async def process_bg():
        async with async_session_factory() as bg_db:
            await document_service.process_document(bg_db, doc.id)
            await bg_db.commit()

    background_tasks.add_task(process_bg)
    return DocumentResponse.model_validate(doc)


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    subject: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    docs, total = await document_service.list_documents(
        db, subject=subject, status=status_filter, limit=limit, offset=offset
    )
    return DocumentListResponse(
        documents=[DocumentResponse.model_validate(d) for d in docs],
        total=total,
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: int,
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    from app.models.documents import Document
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentResponse.model_validate(doc)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: int,
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    deleted = await document_service.delete_document(db, document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
