import time
from typing import AsyncGenerator, List, Optional, TYPE_CHECKING
import logging

from google import genai
from google.genai import types

from app.core.config import settings

if TYPE_CHECKING:
    from app.schemas.documents import RetrievedChunk

logger = logging.getLogger(__name__)

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
    "question, supplement with your general knowledge and say so.\n\n"
    "After you have finished explaining a concept clearly and the student seems to understand, "
    "offer a short quiz by including this exact marker on its own line at the END of your response:\n"
    '[QUIZ_OFFER: topic="<specific topic name>"]\n'
    "Only include this marker once per explanation. The topic should be specific. "
    "Do not include the marker if you have already offered a quiz recently in this conversation."
)


def build_personalised_system_prompt(student_preferences: dict) -> str:
    """
    Build a personalised system prompt by injecting the student's learning preferences
    on top of the base SYSTEM_PROMPT.
    """
    if not student_preferences:
        return SYSTEM_PROMPT

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
        return SYSTEM_PROMPT

    preference_block = "\n\nSTUDENT PREFERENCES (follow these carefully):\n" + "\n".join(
        f"- {a}" for a in additions
    )
    return SYSTEM_PROMPT + preference_block

MAX_RETRIES = 2
RETRY_DELAY = 1.5

_client = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


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


def _build_contents(
    history: List[dict],
    user_message: str,
    rag_chunks: Optional[List["RetrievedChunk"]] = None,
) -> list:
    contents = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part(text=msg["content"])]))

    context_block = _format_rag_context(rag_chunks) if rag_chunks else ""
    if context_block:
        full_message = f"{context_block}\n\n{user_message}"
    else:
        full_message = user_message

    contents.append(types.Content(role="user", parts=[types.Part(text=full_message)]))
    return contents


def _friendly_error(exc: Exception) -> str:
    msg = str(exc).lower()
    if "quota" in msg or "resource_exhausted" in msg or "429" in msg:
        return "The AI service is temporarily at capacity. Please wait a minute and try again."
    if "invalid" in msg and "key" in msg:
        return "AI service configuration error. Please contact support."
    if "timeout" in msg or "deadline" in msg:
        return "The AI took too long to respond. Please try a shorter question."
    return "Something went wrong while generating a response. Please try again."


def _is_retryable(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "resource_exhausted" in msg or "unavailable" in msg


def generate_response(
    history: List[dict],
    user_message: str,
    rag_chunks: Optional[List["RetrievedChunk"]] = None,
    student_preferences: Optional[dict] = None,
) -> str:
    system_prompt = (
        build_personalised_system_prompt(student_preferences)
        if student_preferences
        else SYSTEM_PROMPT
    )
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            client = _get_client()
            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=_build_contents(history, user_message, rag_chunks),
                config=types.GenerateContentConfig(system_instruction=system_prompt),
            )
            return response.text
        except Exception as e:
            last_error = e
            if _is_retryable(e) and attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            break

    logger.error(f"Gemini generate error after {MAX_RETRIES + 1} attempts: {last_error}")
    return f"[Error: {_friendly_error(last_error)}]"


def stream_response(
    history: List[dict],
    user_message: str,
    rag_chunks: Optional[List["RetrievedChunk"]] = None,
    student_preferences: Optional[dict] = None,
    system_prompt_override: Optional[str] = None,
):
    if system_prompt_override:
        system_prompt = system_prompt_override
    elif student_preferences:
        system_prompt = build_personalised_system_prompt(student_preferences)
    else:
        system_prompt = SYSTEM_PROMPT

    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            client = _get_client()
            response = client.models.generate_content_stream(
                model=settings.gemini_model,
                contents=_build_contents(history, user_message, rag_chunks),
                config=types.GenerateContentConfig(system_instruction=system_prompt),
            )
            for chunk in response:
                if chunk.text:
                    yield chunk.text
            return
        except Exception as e:
            last_error = e
            if _is_retryable(e) and attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
            break

    logger.error(f"Gemini stream error after {MAX_RETRIES + 1} attempts: {last_error}")
    yield f"[Error: {_friendly_error(last_error)}]"


async def stream_response_async(
    history: List[dict],
    user_message: str,
    rag_chunks: Optional[List["RetrievedChunk"]] = None,
    student_preferences: Optional[dict] = None,
    system_prompt_override: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    for token in stream_response(
        history, user_message, rag_chunks, student_preferences, system_prompt_override
    ):
        yield token


import re
import json as json_module

QUIZ_OFFER_RE = re.compile(r'\[QUIZ_OFFER:\s*topic="([^"]+)"\]')


def extract_quiz_offer(text: str) -> Optional[str]:
    match = QUIZ_OFFER_RE.search(text)
    return match.group(1) if match else None


def strip_quiz_offer(text: str) -> str:
    return QUIZ_OFFER_RE.sub("", text).rstrip()


def _extract_json_array(raw: str) -> str:
    """Extract the first complete JSON array from raw text, ignoring trailing content."""
    start = raw.find("[")
    if start == -1:
        return raw
    depth = 0
    in_string = False
    escape_next = False
    for i, ch in enumerate(raw[start:], start):
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return raw[start : i + 1]
    return raw[start:]


def generate_mcq_questions(
    topic: str,
    subject: str,
    key_stage: str,
    chat_history_summary: str = "",
    num_questions: int = 5,
    kb_content: str = "",
    unit_names: Optional[List[str]] = None,
) -> List[dict]:
    item_schema = (
        '{"question_index": 0, "question_text": "...", '
        '"options": ["A) ...", "B) ...", "C) ...", "D) ..."], '
        '"correct_answer": 0, "explanation": "...", "topic_tag": "..."}'
    )

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
            f"CURRICULUM MATERIAL — use ONLY this content to write questions:\n"
            f"{kb_content[:4500]}\n\n"
            f"Generate exactly {num_questions} multiple-choice questions for a "
            f"{key_stage} {subject} student on the topic: \"{topic}\".\n"
            f"{units_line}"
            f"Every question MUST be directly answerable from the curriculum material above. "
            f"Do NOT draw on outside knowledge.\n\n"
            f"Return ONLY a valid JSON array — no markdown, no explanation, no text after the closing ].\n"
            f"Each item: {item_schema}\n"
            f"Rules: correct_answer is 0-based index; topic_tag is a sub-topic from the material; "
            f"explanation cites the material; all 4 options plausible."
        )
        system_instruction = (
            "You generate quiz questions exclusively from the provided curriculum text. "
            "Output only a valid JSON array. No text before or after the array."
        )
    elif unit_names:
        # No KB text available but we know exactly which topics to test
        units_str = ", ".join(unit_names)
        prompt = (
            f"Generate exactly {num_questions} multiple-choice questions for a "
            f"{key_stage} {subject} student.\n"
            f"MANDATORY SCOPE: Questions MUST cover ONLY these specific topics: {units_str}.\n"
            f"Do NOT write questions about AI, technology, advanced research, or any topic "
            f"not explicitly listed above. Every question must be clearly about one of the "
            f"listed topics.\n\n"
            f"Return ONLY a valid JSON array — no markdown, no explanation, no text after ].\n"
            f"Each item: {item_schema}\n"
            f"Rules: correct_answer is 0-based index; topic_tag must be one of the listed "
            f"topics; explanation is 1-2 sentences; all 4 options plausible."
        )
        system_instruction = (
            f"You are a quiz generator for {key_stage} {subject}. "
            f"Output only a valid JSON array. "
            f"Every question MUST be about the explicitly listed topics only. "
            f"No text before or after the array."
        )
    else:
        prompt = (
            f'Generate exactly {num_questions} multiple-choice questions for a '
            f'{key_stage} {subject} student on the topic: "{topic}".\n'
            + (f"Recent context: {chat_history_summary}\n\n" if chat_history_summary else "\n")
            + f"Return ONLY a valid JSON array. No markdown fences, no explanation, no text after ].\n"
            f"Each item: {item_schema}\n"
            f"Rules: correct_answer is 0-based index; topic_tag is a short sub-topic label; "
            f"explanation is 1-2 sentences; all 4 options plausible."
        )
        system_instruction = (
            "You are a quiz generator. Output only a valid JSON array. "
            "No text before or after the array."
        )

    client = _get_client()
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system_instruction),
    )

    raw = response.text.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    raw = _extract_json_array(raw)
    return json_module.loads(raw)


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

    client = _get_client()
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction="You are a supportive tutor writing a student progress report.",
        ),
    )
    return response.text.strip()


def generate_chat_title(user_message: str) -> str:
    try:
        client = _get_client()
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction="Generate a short title (max 6 words) for a chat. Return only the title, no quotes or formatting.",
            ),
        )
        title = response.text.strip()
        return title[:60] if len(title) > 60 else title
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        words = user_message.split()[:5]
        return " ".join(words) + ("..." if len(user_message.split()) > 5 else "")
