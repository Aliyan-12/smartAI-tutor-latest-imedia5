"""
llm.py — crewai LLM factory for the tutoring agents (Gemini, streaming).

crewai 1.x has a NATIVE Gemini provider (triggered by the `gemini/` model prefix) that needs
the `crewai[google-genai]` extra. The spike confirmed this streams cleanly and calls tools on
Gemini. We build a FRESH LLM per crew (not a singleton): crewai LLMs carry per-execution state,
and sharing one across concurrent WS sessions is exactly the isolation hazard we must avoid.
"""
from __future__ import annotations

import logging

from crewai import LLM

from app.core.config import settings

logger = logging.getLogger(__name__)


def build_agent_llm(*, stream: bool = True, temperature: float = 0.7) -> LLM:
    """A streaming Gemini LLM for one crew/session. `stream=True` gives per-token chunks the
    runner forwards to the text pump + TTS. Model comes from GEMINI_SESSION_MODEL."""
    model_id = settings.gemini_session_model
    if not model_id.startswith("gemini/"):
        model_id = f"gemini/{model_id}"
    return LLM(
        model=model_id,
        api_key=settings.gemini_api_key,
        stream=stream,
        temperature=temperature,
    )
