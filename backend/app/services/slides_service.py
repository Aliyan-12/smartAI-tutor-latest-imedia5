import json
import logging
from typing import Optional

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)

_SLIDE_MODEL = "gemini-2.5-flash-preview-04-17"


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

Generate a lesson slide for ONE key concept from the above response.
Rules:
- title: short concept name, max 6 words
- emoji: exactly one relevant emoji character
- bullets: 2-4 bullet points, each max 12 words, no bullet prefixes
- keyTerms: 1-3 objects, each definition max 15 words
- highlight: one key takeaway sentence, max 20 words

Return a single JSON object matching the schema exactly."""

_SHORT_TEXT_THRESHOLD = 80

_SKIP_PATTERNS = [
    "hello", "hi there", "how can i help", "how may i help",
    "welcome", "great to meet", "nice to meet", "good morning",
    "good afternoon", "good evening", "error", "sorry, i",
    "i apologise", "i apologize", "i cannot", "i can't",
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
            model=_SLIDE_MODEL,
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
