"""
chat_tools.py — tools bound to the LLM for the standalone /chat (free chat).

A small, general-purpose set (web search + deep research). The premium session's
richer tool suite (quiz, homework, mastery, lesson-phase, report, ...) lives in
session_tools.py and is never available here.

All tools are created via make_chat_tools(ctx) which captures the request context
in closures — ctx is never exposed to the model as a parameter.
"""
import logging
from typing import List, Optional

from langchain_core.tools import tool

from app.tools.session_tools import ToolContext  # shared request-context dataclass

logger = logging.getLogger(__name__)

# Names of the tools /chat exposes — used by gemini_service to pick this set.
CHAT_TOOL_NAMES = {"web_search", "deep_research"}


def make_chat_tools(ctx: ToolContext) -> list:
    """General-purpose tools for /chat: web_search + deep_research."""

    @tool
    async def web_search(query: str, num_results: int = 5) -> dict:
        """
        Search the web for current information to answer the user's question.
        Use for recent events, news, or facts that benefit from up-to-date results.
        query: a specific search query. num_results: how many results (default 5).
        """
        import asyncio
        from app.services.llm_service import get_chat_llm
        from langchain_core.messages import HumanMessage

        try:
            from langchain_google_genai import GoogleSearchRetrieval
            search_llm = get_chat_llm(tools=[GoogleSearchRetrieval()])
            response = await asyncio.to_thread(
                search_llm.invoke,
                [HumanMessage(content=(
                    f"Search the web and answer this concisely with key facts, dates, "
                    f"and figures where relevant: {query}"
                ))],
            )
            content = response.content if hasattr(response, "content") else str(response)
            if isinstance(content, list):
                content = " ".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
            return {"query": query, "results": content, "action": "show_search_results"}
        except Exception as e:  # noqa: BLE001
            logger.warning(f"chat web_search failed: {e}")
            return {"query": query, "results": "Web search is unavailable right now.", "action": "show_search_results"}

    @tool
    async def deep_research(topic: str, research_questions: Optional[List[str]] = None) -> dict:
        """
        Research a topic in depth across multiple angles and synthesise the findings.
        Use when the user wants comprehensive background on a complex topic.
        topic: the main subject. research_questions: optional specific questions.
        """
        import asyncio
        from app.services.llm_service import get_chat_llm
        from langchain_core.messages import HumanMessage, SystemMessage

        questions = research_questions or [
            f"What are the key concepts of {topic}?",
            f"What are common misconceptions about {topic}?",
            f"What are real-world applications of {topic}?",
        ]
        try:
            from langchain_google_genai import GoogleSearchRetrieval
            research_llm = get_chat_llm(tools=[GoogleSearchRetrieval()])
            prompt = (
                f"Research '{topic}' thoroughly, covering:\n"
                + "\n".join(f"- {q}" for q in questions)
                + "\n\nSynthesise into a clear, well-structured explanation with key facts, "
                "examples, and any recent developments. Use clear sections."
            )
            response = await asyncio.to_thread(
                research_llm.invoke,
                [SystemMessage(content="You are a thorough research assistant."),
                 HumanMessage(content=prompt)],
            )
            content = response.content if hasattr(response, "content") else str(response)
            if isinstance(content, list):
                content = " ".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
            return {"topic": topic, "research": content, "action": "show_research"}
        except Exception as e:  # noqa: BLE001
            logger.warning(f"chat deep_research failed: {e}")
            return {"topic": topic, "research": f"Research is unavailable for {topic} right now.", "action": "show_research"}

    return [web_search, deep_research]
