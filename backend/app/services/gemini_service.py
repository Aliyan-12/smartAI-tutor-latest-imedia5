import time
from typing import AsyncGenerator, List
import logging

from google import genai
from google.genai import types

from app.core.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are SmartAI Tutor, a friendly and knowledgeable AI tutor designed for K-12 students. "
    "You explain concepts clearly using age-appropriate language, provide step-by-step solutions, "
    "and encourage students to think critically. You adapt your responses based on the student's "
    "level and ask follow-up questions to check understanding. Keep your tone warm, supportive, "
    "and patient. Use examples and analogies when helpful. If a question is outside the educational "
    "scope, gently redirect the student back to learning topics."
)

MAX_RETRIES = 2
RETRY_DELAY = 1.5

_client = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _build_contents(history: List[dict], user_message: str) -> list:
    contents = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part(text=msg["content"])]))
    contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))
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


def generate_response(history: List[dict], user_message: str) -> str:
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            client = _get_client()
            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=_build_contents(history, user_message),
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                ),
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


def stream_response(history: List[dict], user_message: str):
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            client = _get_client()
            response = client.models.generate_content_stream(
                model=settings.gemini_model,
                contents=_build_contents(history, user_message),
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                ),
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


async def stream_response_async(history: List[dict], user_message: str) -> AsyncGenerator[str, None]:
    for token in stream_response(history, user_message):
        yield token


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
