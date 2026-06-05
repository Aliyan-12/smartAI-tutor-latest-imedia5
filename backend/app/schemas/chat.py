from datetime import datetime
from typing import List

from pydantic import BaseModel


class MessageResponse(BaseModel):
    id: int
    chat_id: int
    role: str
    content: str
    timestamp: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    id: int
    session_id: str
    title: str
    created_at: datetime
    messages: List[MessageResponse] = []

    model_config = {"from_attributes": True}


class ChatListItem(BaseModel):
    id: int
    session_id: str
    title: str
    created_at: datetime

    model_config = {"from_attributes": True}
