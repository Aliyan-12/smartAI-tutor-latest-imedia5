import logging
from typing import Optional, List
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db, async_session_factory
from app.middleware.auth import require_teacher
from app.models.user import User
from app.models.documents import KEY_STAGES, SUBJECTS, EXAM_BOARDS, TIERS, Document, DocumentChunk
from app.schemas.documents import DocumentResponse, DocumentListResponse, ScrapeRequest, LinkImportRequest, CurriculumInfo
from app.services import document_service, scraper_service
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED_EXTENSIONS = {"pdf", "docx", "pptx"}


@router.get("/curriculum")
async def get_curriculum_info(current_user: User = Depends(require_teacher)):
    return CurriculumInfo(
        key_stages=KEY_STAGES,
        subjects=SUBJECTS,
        exam_boards=EXAM_BOARDS,
        tiers=TIERS,
    )


@router.post("/upload", response_model=List[DocumentResponse], status_code=status.HTTP_202_ACCEPTED)
async def upload_documents(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    key_stage: str = Form(...),
    subject: str = Form(...),
    exam_board: str = Form("None"),
    tier: str = Form("None"),
    unit_name: Optional[str] = Form(None),
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    created_docs = []

    for file in files:
        ext = Path(file.filename or "").suffix.lstrip(".").lower()
        if ext not in ALLOWED_EXTENSIONS:
            continue

        content = await file.read()
        if len(content) > max_bytes:
            continue

        name = Path(file.filename or "document").stem
        file_path = document_service.save_upload(content, ext)

        doc = await document_service.create_document_record(
            db=db, title=name, key_stage=key_stage, subject=subject,
            exam_board=exam_board, tier=tier, unit_name=unit_name,
            source_type="upload", uploaded_by=current_user.id,
            file_path=file_path, file_type=ext,
        )
        created_docs.append(doc)

    if not created_docs:
        raise HTTPException(status_code=400, detail="No valid files. Allowed: pdf, docx, pptx")

    await db.commit()

    for doc in created_docs:
        doc_id = doc.id
        async def process_bg(did=doc_id):
            async with async_session_factory() as bg_db:
                await document_service.process_document(bg_db, did)
                await bg_db.commit()
        background_tasks.add_task(process_bg)

    return [DocumentResponse.model_validate(d) for d in created_docs]


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
        raise HTTPException(status_code=422, detail="Insufficient content extracted")

    file_path = document_service.save_text_content(scraped_text)

    doc = await document_service.create_document_record(
        db=db, title=payload.title, key_stage=payload.key_stage,
        subject=payload.subject, exam_board=payload.exam_board,
        tier=payload.tier, unit_name=payload.unit_name,
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
        db=db, title=payload.title, key_stage=payload.key_stage,
        subject=payload.subject, exam_board=payload.exam_board,
        tier=payload.tier, unit_name=payload.unit_name,
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
    key_stage: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    exam_board: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    docs, total = await document_service.list_documents(
        db, key_stage=key_stage, subject=subject, exam_board=exam_board,
        status=status_filter, limit=limit, offset=offset,
    )
    return DocumentListResponse(
        documents=[DocumentResponse.model_validate(d) for d in docs],
        total=total,
    )


@router.post("/{document_id}/retry", response_model=DocumentResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_document(
    document_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    doc.status = "pending"
    doc.error_message = None
    await db.execute(
        DocumentChunk.__table__.delete().where(DocumentChunk.document_id == document_id)
    )
    doc.chunk_count = 0
    await db.commit()

    async def process_bg():
        async with async_session_factory() as bg_db:
            await document_service.process_document(bg_db, doc.id)
            await bg_db.commit()

    background_tasks.add_task(process_bg)
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
