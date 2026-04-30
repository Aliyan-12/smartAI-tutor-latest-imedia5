import json
import logging
from typing import Optional

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)



class KeyTerm(BaseModel):
    term: str
    definition: str


class SlideOutput(BaseModel):
    title: str
    emoji: str
    bullets: list[str]
    keyTerms: list[KeyTerm]
    highlight: str

_SYSTEM_INSTRUCTION = (
    "You are a lesson slide generator for a UK K-12 AI tutoring platform. "
    "Given an AI tutor's response, extract ONE clear key concept and produce a "
    "structured lesson slide. Output only valid JSON matching the required schema. "
    "No markdown fences. No text before or after the JSON object."
)

_PROMPT_TEMPLATE = """\
Subject: {subject}

AI Tutor Response:
{text}

Generate a comprehensive lesson slide for the main concept from the above tutor response.
Rules:
- title: clear concept name, max 7 words, specific and descriptive
- emoji: exactly one highly relevant subject emoji
- bullets: 3-5 bullet points, each 8-15 words, educational and factual, no bullet prefixes
- keyTerms: 2-4 objects, each with a concise term and a clear definition (max 20 words)
- highlight: one memorable key takeaway or insight sentence, 15-25 words

Return a single JSON object matching the schema exactly."""

_SHORT_TEXT_THRESHOLD = 40

_SKIP_PATTERNS = [
    "hello", "hi there", "how can i help", "how may i help",
    "welcome", "great to meet", "nice to meet", "good morning",
    "good afternoon", "good evening", "sorry, i",
    "i apologise", "i apologize",
]

_client: Optional[genai.Client] = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _should_skip(text: str) -> bool:
    """Return True if the text is too short or is a greeting/error that has no
    teachable concept worth turning into a slide."""
    stripped = text.strip()
    if len(stripped) < _SHORT_TEXT_THRESHOLD:
        return True
    lower = stripped.lower()
    return any(pattern in lower for pattern in _SKIP_PATTERNS)


def generate_slide(text: str, subject: str = "") -> Optional[dict]:
    """Generate a structured lesson slide dict from an AI tutor response.

    Returns a dict with keys: title, emoji, bullets, keyTerms, highlight.
    Returns None if the text is too short, is a greeting/error, or if Gemini
    fails for any reason.
    """
    try:
        if _should_skip(text):
            return None

        prompt = _PROMPT_TEMPLATE.format(
            subject=subject.strip() if subject else "General",
            text=text.strip(),
        )

        client = _get_client()
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=SlideOutput,
            ),
        )

        raw = response.text.strip() if response.text else ""
        if not raw:
            logger.warning("slides_service: Gemini returned empty response")
            return None

        # Strip accidental markdown fences just in case
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        slide = json.loads(raw)

        # Validate required keys are present and non-empty
        required = {"title", "emoji", "bullets", "keyTerms", "highlight"}
        if not required.issubset(slide.keys()):
            logger.warning("slides_service: missing required keys in Gemini response")
            return None
        if not slide.get("title") or not slide.get("bullets"):
            return None

        return slide

    except Exception as exc:
        logger.error(f"slides_service.generate_slide failed: {type(exc).__name__}: {exc}")
        return None
