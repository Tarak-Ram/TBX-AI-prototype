from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field
from app.finance.schemas import FinancialIntent, ResponsePayload

class Message(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    payload: ResponsePayload | None = None

class ConversationState(BaseModel):
    conversation_id: str
    messages: list[Message] = Field(default_factory=list)
    active_vendor: str | None = None
    active_category: str | None = None
    active_period: str | None = None
    active_start_date: str | None = None
    active_end_date: str | None = None
    active_domain: str | None = None
    last_intent: FinancialIntent | None = None
    last_query_id: str | None = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
