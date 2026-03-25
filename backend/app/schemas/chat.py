from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List


class MessageCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    chat_id: Optional[int] = None


class MessageResponse(BaseModel):
    id: int
    chat_id: int
    role: str
    content: str
    timestamp: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    id: int
    title: str
    created_at: datetime
    messages: List[MessageResponse] = []

    model_config = {"from_attributes": True}


class ChatListItem(BaseModel):
    id: int
    title: str
    created_at: datetime
    last_message: Optional[str] = None

    model_config = {"from_attributes": True}


class StreamChunk(BaseModel):
    type: str
    content: str
    chat_id: Optional[int] = None
