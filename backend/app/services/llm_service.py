"""
LangChain LLM factory for SmartAI Tutor.

Two pipelines, two models:
  - get_llm()      → premium SESSION model (Gemini 3 tier) — session pipeline, tools, MCQ.
  - get_chat_llm() → free /chat model (lighter)           — simple-chat pipeline.

Both return a shared singleton, optionally bound with tools (bind_tools makes a new
Runnable each call, so binding never pollutes the singleton).
"""
import logging
from typing import Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.language_models import BaseChatModel

from app.core.config import settings

logger = logging.getLogger(__name__)

_llm: Optional[ChatGoogleGenerativeAI] = None       # premium session
_chat_llm: Optional[ChatGoogleGenerativeAI] = None  # free /chat


def _build_session_llm() -> ChatGoogleGenerativeAI:
    """Construct the session model, asking Gemini for short *thought summaries* so the
    UI can show a Claude-style "thinking" strip. The thinking kwargs are best-effort:
    older `langchain-google-genai` builds may not accept them, so we fall back cleanly
    (the thinking strip then runs on tool-step labels alone)."""
    base = dict(
        model=settings.gemini_session_model,
        google_api_key=settings.gemini_api_key,
        temperature=1.0,
        max_retries=5,
    )
    # `include_thoughts` surfaces a brief reasoning summary for the thinking strip, but every
    # thinking token is generated BEFORE the answer, so the budget is pure added latency. It's
    # now config-driven (GEMINI_THINKING_BUDGET, default 256) instead of a hard-coded 2048 that
    # cost several seconds per round. 0 → thinking off entirely (fastest); the strip then runs on
    # tool-step labels alone.
    budget = max(0, int(getattr(settings, "gemini_thinking_budget", 256)))
    if budget > 0:
        try:
            llm = ChatGoogleGenerativeAI(**base, include_thoughts=True, thinking_budget=budget)
            logger.info("Session LLM created: model=%s thinking_budget=%d",
                        settings.gemini_session_model, budget)
            return llm
        except Exception as e:  # noqa: BLE001 - unknown kwargs / unsupported model → plain LLM
            logger.warning("Thinking config unsupported (%s); creating plain session LLM", e)
    try:
        llm = ChatGoogleGenerativeAI(**base, thinking_budget=0)
    except Exception:  # noqa: BLE001 — model may not accept thinking_budget at all
        llm = ChatGoogleGenerativeAI(**base)
    logger.info("Session LLM created (thinking OFF): model=%s", settings.gemini_session_model)
    return llm


def get_llm(tools: list = None) -> BaseChatModel:
    """
    Premium SESSION LLM (Gemini 3 tier). Used by the session pipeline, session tools,
    and structured MCQ generation.

    - tools=None  → raw ChatGoogleGenerativeAI singleton (astream / with_structured_output)
    - tools=[...] → a new tool-bound Runnable (no singleton pollution)
    """
    global _llm
    if _llm is None:
        _llm = _build_session_llm()
    return _llm.bind_tools(tools) if tools else _llm


def get_chat_llm(tools: list = None) -> BaseChatModel:
    """
    Free /chat LLM (lighter model). Used by the standalone simple-chat pipeline.

    - tools=None  → raw ChatGoogleGenerativeAI singleton (astream)
    - tools=[...] → a new tool-bound Runnable (no singleton pollution)
    """
    global _chat_llm
    if _chat_llm is None:
        _chat_llm = ChatGoogleGenerativeAI(
            model=settings.gemini_chat_model,
            google_api_key=settings.gemini_api_key,
            temperature=1.0,
            max_retries=5,
        )
        logger.info(f"Chat LLM singleton created: model={settings.gemini_chat_model}")
    return _chat_llm.bind_tools(tools) if tools else _chat_llm
