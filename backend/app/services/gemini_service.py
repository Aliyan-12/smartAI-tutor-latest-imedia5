"""
Gemini service — LangChain-backed text generation for SmartAI Tutor.

Public API (unchanged):
  generate_response(history, user_message, rag_chunks=None, student_preferences=None)
  stream_response(history, user_message, rag_chunks=None, student_preferences=None, system_prompt_override=None)
  stream_response_async(history, user_message, rag_chunks=None, student_preferences=None, system_prompt_override=None, tool_context=None)
  generate_mcq_questions(topic, subject, key_stage, ...)
  generate_assessment_report(topic, subject, score_percent, weak_topics, strong_topics)
  generate_chat_title(user_message)
  build_personalised_system_prompt(student_preferences, base_prompt=None)
  SYSTEM_PROMPT  (constant)
  SIMPLE_CHAT_SYSTEM_PROMPT  (constant)
"""

import json as _json
import logging
from typing import AsyncGenerator, List, Optional, TYPE_CHECKING

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, ToolMessage
from pydantic import BaseModel

from app.core.config import settings
from app.services.llm_service import get_llm

if TYPE_CHECKING:
    from app.schemas.documents import RetrievedChunk

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompts (unchanged constants)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are SmartAI Tutor, a friendly and knowledgeable AI tutor designed for K-12 students. "
    "You explain concepts clearly using age-appropriate language, provide step-by-step solutions, "
    "and encourage students to think critically. You adapt your responses based on the student's "
    "level and ask follow-up questions to check understanding. Keep your tone warm, supportive, "
    "and patient. Use examples and analogies when helpful. If a question is outside the educational "
    "scope, gently redirect the student back to learning topics.\n\n"
    "When KNOWLEDGE BASE CONTEXT is provided in a message, use it as your primary reference material "
    "to answer the student's question. Synthesise the information naturally and accurately. "
    "Do not mention chunk boundaries or source labels. If the context does not fully answer the "
    "question, supplement with your general knowledge and say so."
)

SIMPLE_CHAT_SYSTEM_PROMPT = (
    "You are SmartAI Tutor, a friendly and knowledgeable AI tutor designed for K-12 students. "
    "You explain concepts clearly using age-appropriate language, provide step-by-step solutions, "
    "and encourage students to think critically. You adapt your responses based on the student's "
    "level and ask follow-up questions to check understanding. Keep your tone warm, supportive, "
    "and patient. Use examples and analogies when helpful. If a question is outside the educational "
    "scope, gently redirect the student back to learning topics.\n\n"
    "When KNOWLEDGE BASE CONTEXT is provided in a message, use it as your primary reference material "
    "to answer the student's question. Synthesise the information naturally and accurately. "
    "Do not mention chunk boundaries or source labels. If the context does not fully answer the "
    "question, supplement with your general knowledge and say so.\n\n"
    "Focus purely on explaining topics clearly. When [KNOWLEDGE BASE CONTEXT] is provided, use it as your primary reference and cite specific facts from it. Do not include any special markers or control sequences in your responses. Keep responses concise — maximum 4 sentences for a direct question, maximum 6 sentences for a concept explanation."
)


# ---------------------------------------------------------------------------
# Personalised prompt builder (unchanged)
# ---------------------------------------------------------------------------

def build_personalised_system_prompt(student_preferences: dict, base_prompt: str = None) -> str:
    """
    Build a personalised system prompt by injecting the student's learning preferences
    on top of the base prompt (defaults to SYSTEM_PROMPT).
    """
    _base = base_prompt or SYSTEM_PROMPT
    if not student_preferences:
        return _base

    additions = []

    teaching_pace = student_preferences.get("teaching_pace", "just_right")
    if teaching_pace == "slower":
        additions.append(
            "PACE: Explain concepts slowly and simply. "
            "Break every idea into small, easy steps. Check understanding frequently."
        )
    elif teaching_pace == "faster":
        additions.append(
            "PACE: This student prefers a faster pace. Be concise and move on once a concept is understood."
        )

    learning_style = student_preferences.get("learning_style") or []
    if "visual" in learning_style:
        additions.append(
            "STYLE: Use visual examples — describe diagrams, tables, and charts in words. "
            "Use ASCII representations when helpful."
        )
    if "step_by_step" in learning_style:
        additions.append("STYLE: Always structure explanations as numbered steps.")

    teaching_prefs = student_preferences.get("teaching_preferences") or {}
    if teaching_prefs.get("real_life_examples"):
        additions.append("Always use real-world examples to illustrate concepts.")
    if teaching_prefs.get("step_by_step"):
        additions.append("Always break explanations into numbered, sequential steps.")
    if teaching_prefs.get("practice_as_we_go"):
        additions.append(
            "After explaining each concept, immediately give a small practice problem "
            "before moving on."
        )
    if teaching_prefs.get("short_summaries"):
        additions.append("End each explanation with a 1-2 sentence summary in bold.")
    if teaching_prefs.get("analogies"):
        additions.append("Use analogies and comparisons to familiar concepts whenever possible.")

    interests = student_preferences.get("interests") or []
    if interests:
        interests_str = ", ".join(interests)
        additions.append(
            f"PERSONALISATION: When giving examples, relate them to the student's interests: {interests_str}."
        )

    if not additions:
        return _base

    preference_block = "\n\nSTUDENT PREFERENCES (follow these carefully):\n" + "\n".join(
        f"- {a}" for a in additions
    )
    return _base + preference_block


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_thinking_token(text: str) -> bool:
    """
    Detect internal tokens that must never reach the frontend:
    - Gemini 2.5 Flash reasoning/thinking traces
    - Tool call text: Gemini sometimes echoes function call signatures as plain text
      alongside the actual structured tool call. Both forms must be suppressed.
    """
    s = text.strip()
    # Thinking / reasoning traces
    if (
        s.startswith("tool_code") or
        s.startswith("```tool_code") or
        s.startswith("thought ") or
        s.startswith(" thought ") or
        "print(default_api." in s or
        "default_api." in s
    ):
        return True
    # Tool call text signatures — Gemini writes these as plain text in addition to
    # (or instead of) emitting a structured tool_call. Suppress all of them.
    _TOOL_NAMES = (
        "generate_quiz",
        "set_homework",
        "get_student_mastery",
        "update_topic_mastery",
        "advance_lesson_phase",
        "evaluate_answer",
        "generate_session_report",
        "web_search",
        "deep_research",
    )
    for name in _TOOL_NAMES:
        if f"{name}(" in s:
            return True
    return False


# Track whether we are currently inside a multi-chunk tool call text block.
# This is module-level so it persists across generator yields within one stream.
# Using a simple threading.local() is safe because each SSE request is a separate
# async task; we reset it at the start of each stream_response_async call.
import threading as _threading
_tl = _threading.local()


def _reset_tool_call_state():
    _tl.in_tool_call_text = False
    _tl.paren_depth = 0


def _should_suppress(content: str) -> bool:
    """
    Returns True if this content chunk should be suppressed (not sent to frontend).
    Handles multi-chunk tool call text blocks by tracking open/close parentheses.
    """
    if _is_thinking_token(content):
        return True
    # Already inside a tool call text block — keep suppressing until parens close
    if getattr(_tl, "in_tool_call_text", False):
        _tl.paren_depth += content.count("(") - content.count(")")
        if _tl.paren_depth <= 0:
            _tl.in_tool_call_text = False
            _tl.paren_depth = 0
        return True
    return False


def _friendly_error(exc: Exception) -> str:
    msg = str(exc).lower()
    if "quota" in msg or "resource_exhausted" in msg or "429" in msg:
        return "The AI service is temporarily at capacity. Please wait a minute and try again."
    if "invalid" in msg and "key" in msg:
        return "AI service configuration error. Please contact support."
    if "timeout" in msg or "deadline" in msg:
        return "The AI took too long to respond. Please try a shorter question."
    return "Something went wrong while generating a response. Please try again."


def _format_rag_context(rag_chunks: List["RetrievedChunk"]) -> str:
    if not rag_chunks:
        return ""
    lines = ["[KNOWLEDGE BASE CONTEXT]"]
    for i, chunk in enumerate(rag_chunks, 1):
        lines.append(f"--- Source {i}: {chunk.document_title} ({chunk.subject}) ---")
        lines.append(chunk.content.strip())
        lines.append("")
    lines.append("[END OF CONTEXT]")
    return "\n".join(lines)


def _build_lc_messages(
    history: List[dict],
    user_message: str,
    rag_chunks: Optional[List["RetrievedChunk"]] = None,
    system_prompt: Optional[str] = None,
    image_data: Optional[str] = None,
    image_mime: str = "image/jpeg",
) -> list:
    """Build a LangChain message list from chat history, RAG context, and the user message.

    When image_data is supplied (raw base64, no data URI prefix) the final HumanMessage
    is built as a multimodal content list so Gemini receives both the text and the image.
    """
    messages = []
    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    for msg in history:
        cls = HumanMessage if msg["role"] == "user" else AIMessage
        messages.append(cls(content=msg["content"]))
    rag_prefix = (_format_rag_context(rag_chunks) + "\n\n") if rag_chunks else ""
    text_content = rag_prefix + user_message

    if image_data:
        # LangChain multimodal format understood by ChatGoogleGenerativeAI
        human_content = [
            {"type": "text", "text": text_content},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{image_mime};base64,{image_data}"},
            },
        ]
        messages.append(HumanMessage(content=human_content))
    else:
        messages.append(HumanMessage(content=text_content))
    return messages


# ---------------------------------------------------------------------------
# MCQ structured output schema
# ---------------------------------------------------------------------------

class MCQQuestion(BaseModel):
    question_index: int
    question_text: str
    options: List[str]       # ["A) ...", "B) ...", "C) ...", "D) ..."]
    correct_answer: int      # 0-based index
    explanation: str
    topic_tag: str


class MCQQuestionList(BaseModel):
    # Wrapper required: langchain-google-genai>=4.0.0 rejects List[Model] directly
    questions: List[MCQQuestion]


# ---------------------------------------------------------------------------
# Public: generate_response
# Supports both the legacy positional signature AND the keyword-argument variant
# used by session_agent_service (system_prompt=, messages=, model=, stream=).
# ---------------------------------------------------------------------------

def generate_response(
    history: List[dict] = None,
    user_message: str = "",
    rag_chunks: Optional[List["RetrievedChunk"]] = None,
    student_preferences: Optional[dict] = None,
    # --- keyword-only args used by session_agent_service ---
    system_prompt: Optional[str] = None,
    messages: Optional[List[dict]] = None,
    model: Optional[str] = None,   # accepted but ignored — LangChain singleton handles model
    stream: bool = False,           # accepted but ignored — this function always returns str
) -> str:
    """
    Non-streaming single-turn generation.

    Two calling conventions are supported:
      1. Original: generate_response(history, user_message, rag_chunks, student_preferences)
      2. session_agent_service style: generate_response(system_prompt=..., messages=[...], model=None, stream=False)
    """
    # Normalise calling convention (2) into (1)
    if messages is not None and not history:
        history = messages
    if history is None:
        history = []

    # When messages=[{"role":"user","content":"..."}] is passed without a separate
    # user_message (as session_agent_service does), extract the last message's content
    # so we don't append a redundant empty HumanMessage.
    if not user_message and history:
        last = history[-1]
        if isinstance(last, dict) and last.get("role") == "user":
            user_message = last["content"]
            history = history[:-1]

    if system_prompt:
        _system = system_prompt
    elif student_preferences:
        _system = build_personalised_system_prompt(student_preferences)
    else:
        _system = SYSTEM_PROMPT

    lc_messages = _build_lc_messages(history, user_message, rag_chunks, _system)
    try:
        response = get_llm().invoke(lc_messages)
        return response.content if hasattr(response, "content") else str(response)
    except Exception as e:
        logger.error(f"generate_response failed: {e}")
        return f"[Error: {_friendly_error(e)}]"


# ---------------------------------------------------------------------------
# Public: stream_response (sync generator — kept for WebSocket handler)
# ---------------------------------------------------------------------------

def stream_response(
    history: List[dict],
    user_message: str,
    rag_chunks: Optional[List["RetrievedChunk"]] = None,
    student_preferences: Optional[dict] = None,
    system_prompt_override: Optional[str] = None,
):
    """
    Synchronous streaming generator.
    NOTE: This is a blocking generator. Prefer stream_response_async in async contexts.
    Used only by the WebSocket handler in chat.py.
    """
    if system_prompt_override:
        _system = system_prompt_override
    elif student_preferences:
        _system = build_personalised_system_prompt(student_preferences)
    else:
        _system = SYSTEM_PROMPT

    lc_messages = _build_lc_messages(history, user_message, rag_chunks, _system)
    try:
        for chunk in get_llm().stream(lc_messages):
            if chunk.content:
                yield chunk.content
    except Exception as e:
        logger.error(f"stream_response failed: {e}")
        yield f"[Error: {_friendly_error(e)}]"


# ---------------------------------------------------------------------------
# Public: stream_response_async (true async generator with tool executor loop)
# ---------------------------------------------------------------------------

async def stream_response_async(
    history: List[dict],
    user_message: str,
    rag_chunks: Optional[List["RetrievedChunk"]] = None,
    student_preferences: Optional[dict] = None,
    system_prompt_override: Optional[str] = None,
    tool_context=None,  # ToolContext | None  — avoids circular import at module level
    image_data: Optional[str] = None,
    image_mime: str = "image/jpeg",
) -> AsyncGenerator[str, None]:
    """
    True async streaming generator backed by LangChain astream().
    Includes a tool executor loop: up to 3 rounds of tool calling before final answer.
    tool_context is a ToolContext dataclass from app.tools.session_tools.
    image_data: raw base64-encoded image (no data URI prefix).
    image_mime: MIME type such as "image/jpeg" or "image/png".
    """
    if system_prompt_override:
        _system = system_prompt_override
    elif student_preferences:
        _system = build_personalised_system_prompt(student_preferences)
    else:
        _system = SYSTEM_PROMPT

    messages = _build_lc_messages(history, user_message, rag_chunks, _system, image_data, image_mime)

    if tool_context is not None:
        from app.tools.session_tools import make_session_tools
        tools = make_session_tools(tool_context)
    else:
        tools = []

    llm = get_llm(tools=tools if tools else None)
    logger.info(
        f"stream_response_async: history={len(history)} msgs, "
        f"rag_chunks={len(rag_chunks) if rag_chunks else 0}, "
        f"tools_bound={[t.name for t in tools]}, "
        f"has_system_prompt={bool(system_prompt_override or student_preferences)}"
    )

    _reset_tool_call_state()   # clear paren-tracking state for this stream

    for _round in range(3):   # max 3 tool-call rounds
        full_response = None

        try:
            async for chunk in llm.astream(messages):
                # chunk.content can be a list of parts (Gemini multi-part) or a plain string
                content = chunk.content
                if isinstance(content, list):
                    content = "".join(
                        part.get("text", "") if isinstance(part, dict) else str(part)
                        for part in content
                    )
                if content:
                    if _should_suppress(content):
                        logger.debug(f"Suppressed internal token: {content[:80]!r}")
                        # Still accumulate for full_response so tool calls parse correctly
                    else:
                        yield content
                full_response = (full_response + chunk) if full_response is not None else chunk
        except Exception as e:
            logger.error(f"LangChain astream error (round {_round}): {e}")
            yield f"[Error: {_friendly_error(e)}]"
            return

        # If no tool calls in the response, we are done
        tool_calls = getattr(full_response, "tool_calls", None) if full_response is not None else None
        if not tool_calls:
            if _round > 0:
                logger.info(f"Tool loop completed after {_round + 1} round(s)")
            break

        tool_map = {t.name: t for t in tools}
        tool_messages = []

        for tc in tool_calls:
            tool_name = tc["name"]
            tool_fn = tool_map.get(tool_name)
            if tool_fn is None:
                logger.warning(f"Tool '{tool_name}' not found in tool_map")
                continue
            try:
                result = await tool_fn.ainvoke(tc["args"])
                tool_messages.append(
                    ToolMessage(
                        content=_json.dumps(result),
                        tool_call_id=tc["id"],
                        name=tool_name,
                    )
                )
                # Emit a structured tool-result token for the router to intercept
                yield f"\n[TOOL_RESULT:{_json.dumps({'tool': tool_name, 'data': result})}]\n"
                logger.info(f"Tool executed: {tool_name} → action={result.get('action', 'n/a')}")
            except Exception as e:
                logger.error(f"Tool '{tool_name}' execution failed: {type(e).__name__}: {e}", exc_info=True)

        if not tool_messages:
            break

        # Append assistant message + tool results, then loop for the next LLM turn
        messages = messages + [full_response] + tool_messages


# ---------------------------------------------------------------------------
# Public: generate_mcq_questions — structured output (no JSON repair needed)
# ---------------------------------------------------------------------------

def generate_mcq_questions(
    topic: str,
    subject: str,
    key_stage: str,
    chat_history_summary: str = "",
    num_questions: int = 5,
    kb_content: str = "",
    unit_names: Optional[List[str]] = None,
) -> List[dict]:
    """
    Generate multiple-choice questions using LangChain structured output.
    Always returns List[dict] (compatible with assessment_service.create_assessment).
    """
    units_line = ""
    if unit_names:
        quoted = ", ".join(f'"{u}"' for u in unit_names)
        units_line = (
            f"\nSTRICT SCOPE: Questions MUST be about these specific biology topics "
            f"ONLY: {quoted}. "
            f"Do NOT include questions about AI, technology, or any topic not listed above.\n"
        )

    if kb_content:
        prompt = (
            f"CURRICULUM MATERIAL (reference only):\n"
            f"{kb_content[:4500]}\n\n"
            f"Generate exactly {num_questions} multiple-choice questions for a "
            f"{key_stage} {subject} student.\n"
            f"STRICT TOPIC SCOPE: Questions MUST be about \"{topic}\" ONLY.\n"
            f"Do NOT write questions about other topics even if they appear in the curriculum material above.\n"
            f"For example: if topic is 'eukaryotic vs prokaryotic cells', do NOT ask about mitochondria, "
            f"chloroplasts, tissues, specialised cells, or any other topic not in the scope.\n"
            f"{units_line}"
            f"Every question must test ONLY the concepts within \"{topic}\".\n\n"
            f"Generate exactly {num_questions} questions as a structured list."
        )
        system_instruction = (
            f"You generate quiz questions STRICTLY about '{topic}'. "
            "Never write questions about topics outside the specified scope, even if curriculum material mentions them. "
            "Return exactly the number of questions requested."
        )
    elif unit_names:
        units_str = ", ".join(unit_names)
        prompt = (
            f"Generate exactly {num_questions} multiple-choice questions for a "
            f"{key_stage} {subject} student.\n"
            f"MANDATORY SCOPE: Questions MUST cover ONLY these specific topics: {units_str}.\n"
            f"Do NOT write questions about AI, technology, advanced research, or any topic "
            f"not explicitly listed above. Every question must be clearly about one of the "
            f"listed topics.\n\n"
            f"Generate exactly {num_questions} questions as a structured list."
        )
        system_instruction = (
            f"You are a quiz generator for {key_stage} {subject}. "
            f"Every question MUST be about the explicitly listed topics only."
        )
    else:
        prompt = (
            f'Generate exactly {num_questions} multiple-choice questions for a '
            f'{key_stage} {subject} student on the topic: "{topic}".\n'
            + (f"Recent context: {chat_history_summary}\n\n" if chat_history_summary else "\n")
            + f"Generate exactly {num_questions} questions as a structured list."
        )
        system_instruction = (
            "You are a quiz generator. Generate exactly the number of questions requested."
        )

    # Use MCQQuestionList wrapper — langchain-google-genai>=4.0.0 rejects List[Model] directly
    structured_llm = get_llm().with_structured_output(MCQQuestionList)
    lc_messages = [
        SystemMessage(content=system_instruction),
        HumanMessage(content=prompt),
    ]
    try:
        result: MCQQuestionList = structured_llm.invoke(lc_messages)
        # Convert Pydantic models to plain dicts for downstream callers
        return [q.model_dump() for q in result.questions]
    except Exception as e:
        logger.error(f"generate_mcq_questions structured output failed: {e}")
        raise RuntimeError(f"MCQ generation error: {e}") from e


# ---------------------------------------------------------------------------
# Public: generate_assessment_report
# ---------------------------------------------------------------------------

def generate_assessment_report(
    topic: str,
    subject: str,
    score_percent: float,
    weak_topics: List[str],
    strong_topics: List[str],
) -> str:
    prompt = f"""A student just completed a quiz on "{topic}" ({subject}).
Score: {score_percent:.0f}%
Strong areas: {', '.join(strong_topics) if strong_topics else 'None'}
Weak areas: {', '.join(weak_topics) if weak_topics else 'None'}

Write a brief, encouraging report (3-4 sentences) summarizing their performance.
Mention specific strong and weak areas. Suggest what to review next. Keep it warm and motivating."""

    lc_messages = [
        SystemMessage(content="You are a supportive tutor writing a student progress report."),
        HumanMessage(content=prompt),
    ]
    try:
        response = get_llm().invoke(lc_messages)
        return (response.content if hasattr(response, "content") else str(response)).strip()
    except Exception as e:
        logger.error(f"generate_assessment_report failed: {e}")
        return f"Quiz completed with a score of {score_percent:.0f}%."


# ---------------------------------------------------------------------------
# Public: generate_chat_title
# ---------------------------------------------------------------------------

def generate_chat_title(user_message: str) -> str:
    lc_messages = [
        SystemMessage(content="Generate a short title (max 6 words) for a chat. Return only the title, no quotes or formatting."),
        HumanMessage(content=user_message),
    ]
    try:
        response = get_llm().invoke(lc_messages)
        title = (response.content if hasattr(response, "content") else str(response)).strip()
        return title[:60] if len(title) > 60 else title
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        words = user_message.split()[:5]
        return " ".join(words) + ("..." if len(user_message.split()) > 5 else "")


