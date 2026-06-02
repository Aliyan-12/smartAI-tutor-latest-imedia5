"""
filler_service.py
=================

Backend support for the "thinking filler" player. When a student sends a message,
the frontend asks this service which short pre-recorded filler phrase to play
(and show) during the brief gap before the real answer's TTS begins.

Pairs with:
  - app/seed_voice_fillers.py   (generates uploads/voices/*.wav + manifest.json)
  - routers/voice.py            (exposes /fillers/manifest, /fillers/audio, /fillers/pick)

The model only ever sees the SITUATION categories + their "when" hints and picks
one — it never decides student IDs or anything sensitive. We then pick a random
phrase from that bucket (for variety) and return its text + audio URL.
"""
import json
import logging
import random
from pathlib import Path
from typing import Optional

from langchain_core.messages import SystemMessage, HumanMessage
from pydantic import BaseModel

from app.core.config import settings
from app.services.llm_service import get_llm

logger = logging.getLogger(__name__)

# Only these buckets make sense the instant a student sends a message (before we
# know if an answer was right/wrong). praise / gentle_correct / transition are
# kept in the manifest for later use but are NOT offered to the send-time picker.
WAITING_CATEGORIES = ["acknowledge", "thinking", "checking", "encourage"]
_DEFAULT_CATEGORY = "thinking"

_manifest_cache: Optional[dict] = None


def voices_dir() -> Path:
    """uploads/voices/ — sibling of settings.upload_dir, matches the seeder."""
    return Path(settings.upload_dir).resolve().parent / "voices"


def get_manifest(force_reload: bool = False) -> dict:
    """Load (and cache) uploads/voices/manifest.json produced by the seeder."""
    global _manifest_cache
    if _manifest_cache is not None and not force_reload:
        return _manifest_cache

    path = voices_dir() / "manifest.json"
    if not path.exists():
        logger.warning(
            "Filler manifest not found at %s — run: python -m app.seed_voice_fillers",
            path,
        )
        _manifest_cache = {"categories": {}, "count": 0}
    else:
        try:
            _manifest_cache = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            logger.error("Failed to read filler manifest: %s", e)
            _manifest_cache = {"categories": {}, "count": 0}
    return _manifest_cache


def _random_phrase(category: str) -> Optional[dict]:
    bucket = get_manifest().get("categories", {}).get(category)
    if not bucket or not bucket.get("phrases"):
        return None
    return random.choice(bucket["phrases"])


def _any_phrase() -> Optional[dict]:
    for bucket in get_manifest().get("categories", {}).values():
        if bucket.get("phrases"):
            return random.choice(bucket["phrases"])
    return None


class FillerPick(BaseModel):
    """Structured output: the single best situational category for this message."""
    category: str


def _classify(message: str, available: list[str]) -> str:
    """Ask the fast LLM which waiting-category best fits the student's message."""
    cat_lines = "\n".join(
        f"- {c}: {get_manifest()['categories'][c]['when']}" for c in available
    )
    system = (
        "You pick a short 'filler' phrase a tutor says the instant a student sends a "
        "message, to fill the brief moment before the full answer is ready. "
        "Choose the ONE category that best fits the student's message.\n\n"
        f"Categories:\n{cat_lines}\n\n"
        f"Respond with category set to exactly one of: {', '.join(available)}."
    )
    result: FillerPick = get_llm().with_structured_output(FillerPick).invoke([
        SystemMessage(content=system),
        HumanMessage(content=f'Student just said: "{message[:500]}". Pick the best category.'),
    ])
    return result.category


def pick_filler(message: str) -> Optional[dict]:
    """
    Decide which filler to play for a just-sent student message.

    Returns {category, slug, text, file, duration_ms, audio_url} or None if no
    fillers have been generated yet. Always degrades gracefully — a failed LLM
    call falls back to the default category, never an error.
    """
    manifest = get_manifest()
    if not manifest.get("categories"):
        return None

    available = [c for c in WAITING_CATEGORIES if c in manifest["categories"]]
    category = _DEFAULT_CATEGORY
    if available:
        try:
            chosen = _classify(message, available)
            if chosen in available:
                category = chosen
            else:
                logger.info("filler-pick returned unknown category %r, using default", chosen)
        except Exception as e:  # noqa: BLE001 - never let classification break the wait UX
            logger.warning("filler-pick classification failed, using default: %s", e)

    phrase = _random_phrase(category) or _random_phrase(_DEFAULT_CATEGORY) or _any_phrase()
    if not phrase:
        return None

    return {
        "category": category,
        "slug": phrase["slug"],
        "text": phrase["text"],
        "file": phrase["file"],
        "duration_ms": phrase.get("duration_ms"),
        "audio_url": f"/api/voice/fillers/audio/{phrase['slug']}",
    }
