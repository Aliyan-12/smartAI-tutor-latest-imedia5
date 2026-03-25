from typing import AsyncGenerator, List
import logging

from openai import OpenAI

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


def _get_client() -> OpenAI:
    return OpenAI(
        api_key=settings.gemini_api_key,
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    )


def build_messages(history: List[dict], user_message: str) -> List[dict]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    return messages


def generate_response(history: List[dict], user_message: str) -> str:
    client = _get_client()
    messages = build_messages(history, user_message)

    response = client.chat.completions.create(
        model=settings.gemini_model,
        messages=messages,
    )
    return response.choices[0].message.content


def stream_response(history: List[dict], user_message: str):
    client = _get_client()
    messages = build_messages(history, user_message)

    response = client.chat.completions.create(
        model=settings.gemini_model,
        messages=messages,
        stream=True,
    )

    for chunk in response:
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield delta.content


async def stream_response_async(history: List[dict], user_message: str) -> AsyncGenerator[str, None]:
    try:
        for token in stream_response(history, user_message):
            yield token
    except Exception as e:
        logger.error(f"Gemini streaming error: {e}")
        yield f"[Error: Could not generate response. Please try again.]"


def generate_chat_title(user_message: str) -> str:
    client = _get_client()
    response = client.chat.completions.create(
        model=settings.gemini_model,
        messages=[
            {
                "role": "system",
                "content": "Generate a short title (max 6 words) for a chat that starts with the following message. Return only the title, no quotes.",
            },
            {"role": "user", "content": user_message},
        ],
    )
    title = response.choices[0].message.content.strip()
    return title[:60] if len(title) > 60 else title
