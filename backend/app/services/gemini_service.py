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
        # Gemini sometimes narrates its plan as ordinary text tagged "<thinking …" rather than
        # returning it as a flagged thought part. Catch it here when it opens a chunk; because it
        # is never closed, a leak that starts mid-sentence is cleaned per-sentence downstream by
        # session_agent_service.clean_reasoning_leak.
        s.lower().startswith("<thinking") or
        s.lower().startswith("<think>") or
        s.lower().startswith("</think") or
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
        "show_resource",
        "advance_lesson_slide",
        "retreat_lesson_slide",
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


def _condense_thought(text: str) -> str:
    """Reduce a streamed reasoning summary to ONE short, student-friendly line for the
    thinking strip — first meaningful sentence, markdown stripped, truncated. Returns ""
    when there's nothing worth showing."""
    if not text:
        return ""
    import re as _re2
    t = text.strip()
    # Drop markdown emphasis/headers/bullets the summary sometimes carries.
    t = _re2.sub(r"[*_`#>]+", "", t)
    t = _re2.sub(r"\s+", " ", t).strip()
    if not t:
        return ""
    # First sentence (or first line) only.
    m = _re2.search(r"[.!?]", t)
    line = t[: m.end()] if m else t
    line = line.strip().rstrip(".").strip()
    if len(line) > 120:
        line = line[:117].rstrip() + "…"
    return line


def response_text(response) -> str:
    """Flatten a LangChain response's `.content` to plain text. Gemini 2.5 (thinking mode)
    can return `.content` as a LIST of parts, so calling `.strip()` on it directly crashes
    with "'list' object has no attribute 'strip'" — join the text parts instead. Shared by
    the non-streaming callers (reports, titles)."""
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        out = []
        for p in content:
            if isinstance(p, str):
                out.append(p)
            elif isinstance(p, dict):
                # Skip 'thinking' parts; keep visible text.
                if p.get("type") in (None, "text"):
                    out.append(p.get("text") or p.get("content") or "")
        return "".join(out).strip()
    return str(content or "").strip()


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
    tool_set: str = "session",  # "session" = full session tools, "chat" = /chat subset
    tool_groups=None,  # Optional[set[str]] — per-turn group filter for the session set
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
        if tool_set == "chat":
            from app.tools.chat_tools import make_chat_tools
            tools = make_chat_tools(tool_context)
        else:
            # Per-turn filtered session tools (registry). Defaults to the full set
            # for back-compat when the caller doesn't pass tool_groups.
            from app.tools.registry import make_tools, ALL_SESSION_GROUPS
            groups = tool_groups if tool_groups is not None else ALL_SESSION_GROUPS
            tools = make_tools(tool_context, groups)
    else:
        tools = []

    # Premium session → get_llm (Gemini 3 tier); free /chat → get_chat_llm (lighter).
    if tool_set == "chat":
        from app.services.llm_service import get_chat_llm
        llm = get_chat_llm(tools=tools if tools else None)
    else:
        llm = get_llm(tools=tools if tools else None)
    # DEBUG=true → detailed per-turn tracing (setup, tools bound, each tool result). false → only
    # concise essentials (the NAVIGATOR line + warnings/errors), so normal logs stay readable.
    _dbg = bool(getattr(settings, "debug", False))
    if _dbg:
        logger.info(
            f"stream_response_async: history={len(history)} msgs, "
            f"rag_chunks={len(rag_chunks) if rag_chunks else 0}, "
            f"tools_bound={[t.name for t in tools]}, "
            f"has_system_prompt={bool(system_prompt_override or student_preferences)}"
        )

    _reset_tool_call_state()   # clear paren-tracking state for this stream

    emitted_text = False        # have we yielded any visible answer text yet?
    preamble_text = ""          # last tool-round's text, kept ONLY as a fallback
    _empty_retries = 0          # Gemini occasionally returns an empty completion → nudge + retry
    # Tools that HARD-REFUSED this turn (returned error + suppressed, i.e. nothing changed on
    # screen and retrying cannot succeed because the guard is turn-scoped). They are unbound for
    # the rest of the loop. Without this the model re-called advance_lesson_slide after each
    # refusal and burned every remaining round on it — observed in real lessons as
    # "advance ok → refused → refused → refused → Tool loop completed after 4 round(s)", which
    # left ZERO rounds to draw a diagram or animation, so mermaid/svg/manim were never reached.
    # An instruction not to retry did not work; removing the tool does.
    retired_tools: set = set()
    _tool_err_counts: dict = {}   # per-tool error count this turn → allow ONE self-correction retry

    for _round in range(4):   # max 4 tool-call rounds
        full_response = None
        round_parts: List[str] = []   # buffer THIS round's visible text
        thought_buf = ""              # THIS round's reasoning (thought summary), if any

        try:
            async for chunk in llm.astream(messages):
                # chunk.content can be a list of parts (Gemini multi-part) or a plain string.
                # With thought summaries on, some parts are reasoning ("thought") — those go
                # to the thinking strip, never to the visible answer.
                content = chunk.content
                if isinstance(content, list):
                    visible_bits: List[str] = []
                    for part in content:
                        if isinstance(part, dict):
                            if part.get("thought"):
                                thought_buf += part.get("text", "") or ""
                            else:
                                visible_bits.append(part.get("text", "") or "")
                        else:
                            visible_bits.append(str(part))
                    content = "".join(visible_bits)
                # Some integration versions stash the reasoning summary here instead.
                _rk = getattr(chunk, "additional_kwargs", None)
                if isinstance(_rk, dict) and _rk.get("reasoning_content"):
                    thought_buf += str(_rk["reasoning_content"])
                if content:
                    if _should_suppress(content):
                        logger.debug(f"Suppressed internal token: {content[:80]!r}")
                        # Still accumulate for full_response so tool calls parse correctly
                    else:
                        # Buffer — do NOT yield yet. We only learn whether this round is
                        # the final answer (vs. tool preamble) once the round completes.
                        # Yielding eagerly is exactly what duplicated the reply: the model
                        # writes its answer, calls a tool, then RE-writes the answer next
                        # round, so both copies reached the student.
                        round_parts.append(content)
                full_response = (full_response + chunk) if full_response is not None else chunk
        except Exception as e:
            logger.error(f"LangChain astream error (round {_round}): {e}")
            yield f"[Error: {_friendly_error(e)}]"
            return

        # Surface a short one-line "thinking" summary for this round (best-effort) BEFORE
        # the round's visible text / tool results, so the UI shows it as a leading step.
        _think = _condense_thought(thought_buf)
        if _think:
            yield f"\n[THINK:{_think}]\n"

        round_text = "".join(round_parts)
        tool_calls = getattr(full_response, "tool_calls", None) if full_response is not None else None

        # No tool calls → this round IS the final answer. Emit it now.
        if not tool_calls:
            if round_text:
                yield round_text
                emitted_text = True
            elif preamble_text:
                # Post-tool round was silent → surface the BUFFERED pre-tool substance
                # (the model said everything before the call). We only streamed its first
                # sentence as the lead-in, so yield the full preamble here; the router's
                # sentence dedup drops that already-shown lead-in and shows the rest — the
                # student never gets a lead-in with no answer, and nothing is doubled.
                yield preamble_text
                emitted_text = True
            elif not emitted_text and _empty_retries < 2 and _round < 3:
                # EMPTY completion: Gemini returned no text AND no tool call (an empty candidate —
                # e.g. a safety trim or the thinking budget ate the whole turn). Do NOT end the turn
                # blank — nudge the model to actually answer and RETRY the round (bounded, so it can
                # never loop). This is the source-level guarantee that a turn is never silent.
                _empty_retries += 1
                logger.warning(f"Empty completion (round {_round}) — nudging + retrying "
                               f"({_empty_retries}/2)")
                messages = messages + [HumanMessage(content=(
                    "[SYSTEM] Your previous turn produced no visible reply — you were still working "
                    "(your thinking used up the turn). CONTINUE from where you left off and output "
                    "that reply to the student now. Finish the response you were composing; do not "
                    "send an empty message."))]
                continue
            if _round > 0:
                logger.info(f"Tool loop completed after {_round + 1} round(s)")
            break

        # This round called tools. Buffer its text as a fallback ONLY — do NOT stream it.
        # The model writes its full answer BEFORE calling the tool and then RE-writes it in
        # the next round, so streaming the pre-tool text duplicated the whole reply. Instead
        # the "thinking" strip shows what the tutor is doing while the tool runs, then we
        # stream the FINAL post-tool round as one clean response. If the model falls silent
        # after the tool, this buffer is surfaced (deduped) by the branch above.
        if round_text.strip():
            preamble_text = round_text

        tool_map = {t.name: t for t in tools if t.name not in retired_tools}
        tool_messages = []

        for tc in tool_calls:
            tool_name = tc["name"]
            tool_fn = tool_map.get(tool_name)
            if tool_fn is None:
                # The model asked for a tool that isn't bound this turn. Feed the failure
                # BACK to it (instead of silently dropping the call) so it can recover and
                # does NOT narrate the action as done — that silent drop is exactly what
                # made it say "look at the puzzle" when no show_puzzle ran.
                if tool_name in retired_tools:
                    logger.info(f"Tool '{tool_name}' already refused this turn — call ignored")
                    _msg = (
                        f"'{tool_name}' ALREADY REFUSED this reply and has been switched off for "
                        "the rest of it — calling it again will keep failing and nothing has "
                        "changed on screen. Stop retrying it. Do the useful thing instead: teach "
                        "the slide that IS on screen, and put a visual up with mermaid_diagram, "
                        "draw_svg or animate_concept, then explain it."
                    )
                else:
                    logger.warning(f"Tool '{tool_name}' not found in tool_map (not bound this turn)")
                    _msg = (
                        f"The tool '{tool_name}' is not available this turn, so nothing "
                        "happened on the student's screen. Do NOT tell the student you did "
                        "this (no 'look at the puzzle/slide'). Continue with a normal typed "
                        "response, or call one of the tools that ARE available."
                    )
                tool_messages.append(
                    ToolMessage(
                        content=_json.dumps({"error": "tool_unavailable", "message": _msg}),
                        tool_call_id=tc["id"],
                        name=tool_name,
                    )
                )
                continue
            try:
                result = await tool_fn.ainvoke(tc["args"])
            except Exception as e:
                # RETRY ONCE — most tool errors (image generation, a transient network blip) clear
                # on a second attempt.
                logger.warning(f"Tool '{tool_name}' failed (attempt 1): {type(e).__name__}: {e}")
                try:
                    result = await tool_fn.ainvoke(tc["args"])
                    logger.info(f"Tool '{tool_name}' succeeded on retry")
                except Exception as e2:
                    # Still failing → do NOT surface it. Feed the model a CONTROLLED instruction so
                    # it (a) knows the action did NOT happen and (b) must NOT tell the student — no
                    # "the animation didn't work", no claiming anything is on screen. It carries on
                    # in words or tries a different tool. Appending a ToolMessage (not silently
                    # dropping) keeps the loop going for another round, so the model produces a clean
                    # answer instead of its pre-tool preamble (which may already claim the visual).
                    # Retire it so a failing tool can't burn the rest of the turn's rounds.
                    logger.error(f"Tool '{tool_name}' failed twice: {type(e2).__name__}: {e2}", exc_info=True)
                    retired_tools.add(tool_name)
                    tool_messages.append(ToolMessage(
                        content=_json.dumps({"error": "tool_failed", "message": (
                            f"The tool '{tool_name}' hit an error and did NOT run — NOTHING changed "
                            "on the student's screen. Do NOT mention this to the student (never say a "
                            "tool / animation / diagram 'didn't work', and do NOT claim anything is on "
                            "screen). Simply continue: explain this point clearly in words, or use a "
                            "DIFFERENT tool that fits. Act as if you had chosen to explain it in words.")}),
                        tool_call_id=tc["id"], name=tool_name))
                    continue
            # The tool call returned without raising — but "no exception" is NOT "it worked". Emit
            # the REAL result to the router/frontend (it handles error/suppressed payloads itself).
            yield f"\n[TOOL_RESULT:{_json.dumps({'tool': tool_name, 'data': result})}]\n"
            if _dbg:
                logger.info(f"Tool executed: {tool_name} → action="
                            f"{result.get('action', 'n/a') if isinstance(result, dict) else 'n/a'}")
            # What the MODEL is told back. A tool can return WITHOUT raising yet FAIL to produce
            # anything: an error payload (animate_concept → {error:'bad_code', render:None}), a hard
            # refusal (suppressed), or a soft miss (no_catalog_images). Handing back the raw dict is
            # the bug behind "I've put an animation on your screen" when nothing rendered — its
            # action:"show_puzzle" reads like SUCCESS. So on ANY error, give the model a plain failure
            # note instead, and RETIRE the tool so it can't loop on the same failure this turn.
            _err = result.get("error") if isinstance(result, dict) else None
            if _err:
                _detail = result.get("message") if isinstance(result, dict) else None
                _suppressed = isinstance(result, dict) and result.get("suppressed")
                _tool_err_counts[tool_name] = _tool_err_counts.get(tool_name, 0) + 1
                # Hard refusal (suppressed → retrying can't succeed) OR a 2nd failure of the same
                # tool → retire it. A FIRST recoverable error (bad_code, render_failed) → keep it
                # bound so the model can FIX its input and resend ONCE (it needs the specific reason,
                # so we pass `_detail` through). Either way, never let the failure reach the student.
                if _suppressed or _tool_err_counts[tool_name] >= 2:
                    retired_tools.add(tool_name)
                    _guidance = ("Do NOT tell the student about it — no 'that didn't work', no "
                                 "claiming anything is on screen. Teach this point in words, or use "
                                 "a DIFFERENT tool.")
                    logger.info("Tool retired this turn: %s (%s, fails=%d)",
                                tool_name, _err, _tool_err_counts[tool_name])
                else:
                    _guidance = ("You may FIX the input and call it ONE more time, or use a different "
                                 "tool. Do NOT tell the student anything went wrong.")
                    logger.info("Tool error — self-correction allowed: %s (%s)", tool_name, _err)
                tool_messages.append(ToolMessage(
                    content=_json.dumps({"error": _err, "message": (
                        f"'{tool_name}' did NOT run — NOTHING is on the student's screen. "
                        + (f"Reason: {_detail} " if _detail else "")
                        + _guidance)}),
                    tool_call_id=tc["id"], name=tool_name))
            else:
                tool_messages.append(ToolMessage(
                    content=_json.dumps(result), tool_call_id=tc["id"], name=tool_name))

        if not tool_messages:
            # Couldn't run any tool — fall back to showing the preamble so the turn
            # isn't silent.
            if round_text and not emitted_text:
                yield round_text
                emitted_text = True
            break

        # Append assistant message + tool results, then loop for the next LLM turn — but feed the
        # tool-round message back MINUS its pre-tool prose. Otherwise the model RE-TRANSCRIBES that
        # prose in the next round (the duplicated "That's a perfect way… You're absolutely right!…
        # it looks like the previous message got a bit ahead of itself" reply). We keep the
        # tool_calls (Gemini needs them to pair with the tool results); the prose stays in
        # preamble_text as the silent-round fallback, so nothing is lost.
        _ai_msg = full_response
        try:
            if getattr(full_response, "content", ""):
                _ai_msg = full_response.model_copy(update={"content": ""})
        except Exception:  # noqa: BLE001
            _ai_msg = full_response
        messages = messages + [_ai_msg] + tool_messages
    else:
        # Ran out of rounds while still calling tools — surface the last text we have.
        if not emitted_text and preamble_text:
            yield preamble_text


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
        return response_text(response) or f"Quiz completed with a score of {score_percent:.0f}%."
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
        title = response_text(response)
        return title[:60] if len(title) > 60 else title
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        words = user_message.split()[:5]
        return " ".join(words) + ("..." if len(user_message.split()) > 5 else "")


