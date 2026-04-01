from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List

VALID_SUBJECTS = [
    "Math", "Science", "English", "History",
    "Geography", "Computing", "Art", "Music", "General",
]


class ScrapeRequest(BaseModel):
    url: str = Field(..., min_length=5)
    title: str = Field(..., min_length=1, max_length=500)
    subject: str


class LinkImportRequest(BaseModel):
    url: str = Field(..., min_length=5)
    title: str = Field(..., min_length=1, max_length=500)
    subject: str
    source_type: str = Field(..., description="onedrive or gdocs")


class DocumentResponse(BaseModel):
    id: int
    title: str
    subject: str
    source_type: str
    source_url: Optional[str] = None
    file_type: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    chunk_count: int
    uploaded_by: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]
    total: int


class RetrievedChunk(BaseModel):
    chunk_id: int
    document_id: int
    document_title: str
    subject: str
    content: str
    similarity: float
