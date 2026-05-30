"""
LangChain LLM factory for SmartAI Tutor.
Provides a singleton ChatGoogleGenerativeAI instance with optional tool binding.
"""
import logging
from typing import Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.language_models import BaseChatModel

from app.core.config import settings

logger = logging.getLogger(__name__)

_llm: Optional[ChatGoogleGenerativeAI] = None


def get_llm(tools: list = None) -> BaseChatModel:
    """
    Return the shared LangChain LLM instance, optionally bound with tools.

    - tools=None  → returns the raw ChatGoogleGenerativeAI singleton (for streaming
                     and structured output via astream / with_structured_output)
    - tools=[...]  → returns a new tool-bound instance (bind_tools creates a new
                     Runnable each call, so no singleton pollution)
    """
    global _llm
    if _llm is None:
        _llm = ChatGoogleGenerativeAI(
            model=settings.gemini_model_fast,
            google_api_key=settings.gemini_api_key,
            temperature=1.0,        # must be 1.0 when thinking is disabled
            max_retries=5,
            # Disable Gemini 2.5 Flash extended thinking — prevents internal
            # reasoning tokens (tool_code / thought) from leaking into the stream
            thinking={"thinking_budget": 0},
        )
        logger.info(
            f"LLM singleton created: model={settings.gemini_model_fast} (thinking=disabled)"
        )
    return _llm.bind_tools(tools) if tools else _llm
