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
    "Given an AI tutor's response and the session subject, extract ONE clear educational concept "
    "that is DIRECTLY related to the stated subject. "
    "If the response is about platform/technical issues, social exchanges, quiz announcements, "
    "or contains no subject-specific educational content, return a JSON object with an empty title string. "
    "If the concept is too similar to an already-covered slide title provided, also return empty title. "
    "Output only valid JSON matching the required schema. No markdown fences."
)

_PROMPT_TEMPLATE = """\
Subject: {subject}

Already covered slide titles this session (do NOT repeat or create very similar slides):
{existing_titles_str}

AI Tutor Response:
{text}

STRICT RULES — READ CAREFULLY:
1. The slide MUST be about a {subject}-specific educational concept. If the response discusses platform issues, quiz logistics, technical problems, or anything not directly about {subject}, return {{"title": "", "emoji": "📄", "bullets": [], "keyTerms": [], "highlight": ""}}.
2. If the concept is already covered by one of the "Already covered" titles above (same topic, same idea), return {{"title": "", "emoji": "📄", "bullets": [], "keyTerms": [], "highlight": ""}}.
3. Title: max 7 words, specific {subject} concept name.
4. Emoji: exactly one emoji relevant to {subject}.
5. Bullets: 3-5 educational bullet points, each 8-15 words, factual and {subject}-focused.
6. KeyTerms: 2-4 {subject} terms with clear definitions (max 20 words each).
7. Highlight: one memorable key takeaway about this {subject} concept, 15-25 words.

Return a single JSON object matching the schema exactly."""

_SHORT_TEXT_THRESHOLD = 40

_SKIP_PATTERNS = [
    "hello", "hi there", "how can i help", "how may i help",
    "welcome", "great to meet", "nice to meet", "good morning",
    "good afternoon", "good evening", "sorry, i",
    "i apologise", "i apologize",
    "check the test tab", "try refreshing", "refresh the page",
    "slight delay", "processing delay", "technical", "i've set up a quick test",
    "check the test", "i've prepared a final test",
]

_client: Optional[genai.Client] = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _should_skip(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < _SHORT_TEXT_THRESHOLD:
        return True
    lower = stripped.lower()
    return any(pattern in lower for pattern in _SKIP_PATTERNS)


def _titles_too_similar(new_title: str, existing_titles: list[str]) -> bool:
    """Return True if new_title overlaps heavily with any existing title."""
    new_words = set(w for w in new_title.lower().split() if len(w) > 3)
    if not new_words:
        return False
    for existing in existing_titles:
        existing_words = set(w for w in existing.lower().split() if len(w) > 3)
        if not existing_words:
            continue
        overlap = new_words & existing_words
        # Reject if ≥60% of meaningful words in the new title match an existing title
        if len(overlap) / len(new_words) >= 0.6:
            logger.info(f"slides_service: '{new_title}' too similar to existing '{existing}' — skipping")
            return True
    return False


def generate_slide(text: str, subject: str = "", existing_titles: list[str] | None = None) -> Optional[dict]:
    """Generate a structured lesson slide dict from an AI tutor response.

    Returns None if the text is off-topic, too short, duplicates an existing slide,
    or if Gemini cannot produce a valid subject-related slide.
    """
    try:
        if _should_skip(text):
            return None

        existing = existing_titles or []
        existing_titles_str = "\n".join(f"- {t}" for t in existing) if existing else "(none yet)"

        prompt = _PROMPT_TEMPLATE.format(
            subject=subject.strip() if subject else "General",
            text=text.strip(),
            existing_titles_str=existing_titles_str,
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

        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        slide = json.loads(raw)

        required = {"title", "emoji", "bullets", "keyTerms", "highlight"}
        if not required.issubset(slide.keys()):
            logger.warning("slides_service: missing required keys in Gemini response")
            return None

        title = (slide.get("title") or "").strip()

        # Empty title = Gemini signalled this response is not slide-worthy
        if len(title) < 3:
            logger.info("slides_service: Gemini returned empty title — response not slide-worthy")
            return None

        if not slide.get("bullets"):
            return None

        # Final deduplication guard
        if _titles_too_similar(title, existing):
            return None

        return slide

    except Exception as exc:
        logger.error(f"slides_service.generate_slide failed: {type(exc).__name__}: {exc}")
        return None
