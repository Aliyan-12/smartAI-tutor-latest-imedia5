import time
from typing import AsyncGenerator, List
import logging

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions

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

_configured = False


def _ensure_configured():
    global _configured
    if not _configured:
        genai.configure(api_key=settings.gemini_api_key)
        _configured = True


def _get_model(instruction: str = SYSTEM_PROMPT):
    _ensure_configured()
    return genai.GenerativeModel(
        model_name=settings.gemini_model,
        system_instruction=instruction,
    )


def _build_history(history: List[dict]) -> list:
    gemini_history = []
    for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        gemini_history.append({"role": role, "parts": [msg["content"]]})
    return gemini_history


def _friendly_error(exc: Exception) -> str:
    msg = str(exc).lower()
    if "quota" in msg or "resource_exhausted" in msg or "429" in msg:
        return "The AI service is temporarily at capacity. Please wait a minute and try again."
    if "invalid" in msg and "key" in msg:
        return "AI service configuration error. Please contact support."
    if "timeout" in msg or "deadline" in msg:
        return "The AI took too long to respond. Please try a shorter question."
    return "Something went wrong while generating a response. Please try again."


def generate_response(history: List[dict], user_message: str) -> str:
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            model = _get_model()
            chat = model.start_chat(history=_build_history(history))
            response = chat.send_message(user_message)
            return response.text
        except (google_exceptions.ResourceExhausted, google_exceptions.ServiceUnavailable) as e:
            last_error = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
        except Exception as e:
            last_error = e
            break

    logger.error(f"Gemini generate error after {MAX_RETRIES + 1} attempts: {last_error}")
    return f"[Error: {_friendly_error(last_error)}]"


def stream_response(history: List[dict], user_message: str):
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            model = _get_model()
            chat = model.start_chat(history=_build_history(history))
            response = chat.send_message(user_message, stream=True)

            for chunk in response:
                if chunk.text:
                    yield chunk.text
            return
        except (google_exceptions.ResourceExhausted, google_exceptions.ServiceUnavailable) as e:
            last_error = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * (attempt + 1))
                continue
        except Exception as e:
            last_error = e
            break

    logger.error(f"Gemini stream error after {MAX_RETRIES + 1} attempts: {last_error}")
    yield f"[Error: {_friendly_error(last_error)}]"


async def stream_response_async(history: List[dict], user_message: str) -> AsyncGenerator[str, None]:
    for token in stream_response(history, user_message):
        yield token


def generate_chat_title(user_message: str) -> str:
    try:
        model = _get_model(
            instruction="Generate a short title (max 6 words) for a chat. Return only the title, no quotes or formatting."
        )
        response = model.generate_content(user_message)
        title = response.text.strip()
        return title[:60] if len(title) > 60 else title
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        words = user_message.split()[:5]
        return " ".join(words) + ("..." if len(user_message.split()) > 5 else "")
