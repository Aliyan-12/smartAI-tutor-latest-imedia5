"""
image_gen_service.py — live puzzle/explanatory images via Gemini "Nano Banana".

The AI never free-draws with markup; it hands us a natural-language *image prompt* and
we render a real PNG with `gemini-2.5-flash-image`, write it to the served media dir, and
return a URL the frontend loads. Blocking SDK calls run in a thread; a batch of prompts
(labelling/matching's 3–4 images) is generated CONCURRENTLY so the student waits ~one
image, not N.

Caching: explanatory images pass a stable `cache_key` (same concept → reuse the file, so
repeats are instant and free). Practice puzzles omit it → a fresh image every call.
"""
import asyncio
import hashlib
import logging
import time
import uuid
from pathlib import Path
from typing import List, Optional

from google import genai

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: Optional[genai.Client] = None

# A concise style suffix so generated images look like clean classroom diagrams rather
# than photoreal / cluttered art — keeps them legible for young students.
_STYLE = (
    " Clean flat educational illustration, simple bold shapes, high contrast, white "
    "background, no watermark, suitable for a school lesson."
)


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _media_dir() -> Path:
    d = Path(settings.puzzle_media_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def media_url(name: str) -> str:
    return f"/api/puzzles/media/{name}"


def _extract_png(resp) -> Optional[bytes]:
    """Pull the first inline image payload out of a generate_content response."""
    try:
        for cand in resp.candidates or []:
            for part in (cand.content.parts or []):
                inline = getattr(part, "inline_data", None)
                if inline is not None and inline.data:
                    return inline.data
    except Exception:  # noqa: BLE001
        return None
    return None


def _generate_sync(prompt: str) -> Optional[bytes]:
    client = _get_client()
    resp = client.models.generate_content(
        model=settings.gemini_image_model,
        contents=(prompt or "").strip() + _STYLE,
    )
    return _extract_png(resp)


async def generate_image(prompt: str, *, cache_key: Optional[str] = None) -> Optional[str]:
    """Generate ONE image for `prompt` and return its served URL (or None on failure).

    When `cache_key` is given, an existing file for that key is reused (explanatory
    images); otherwise a unique file is written every call (fresh practice puzzles).
    """
    prompt = (prompt or "").strip()
    if not prompt:
        return None
    d = _media_dir()

    if cache_key:
        digest = hashlib.sha1(f"{cache_key}|{prompt}".encode("utf-8")).hexdigest()[:16]
        name = f"c_{digest}.png"
        path = d / name
        if path.exists() and path.stat().st_size > 0:
            logger.info("IMAGE cache hit %s", name)
            return media_url(name)
    else:
        name = f"p_{uuid.uuid4().hex[:16]}.png"
        path = d / name

    try:
        t0 = time.monotonic()
        data = await asyncio.to_thread(_generate_sync, prompt)
        if not data:
            logger.warning("IMAGE gen returned no image for prompt=%r", prompt[:80])
            return None
        path.write_bytes(data)
        logger.info("IMAGE gen %s (%d bytes, %.1fs) prompt=%r",
                    name, len(data), time.monotonic() - t0, prompt[:80])
        return media_url(name)
    except Exception as e:  # noqa: BLE001
        logger.warning("IMAGE gen failed: %s: %s", type(e).__name__, e)
        return None


async def generate_images(prompts: List[str]) -> List[Optional[str]]:
    """Generate several fresh images CONCURRENTLY (labelling/matching). Order preserved;
    a failed prompt yields None in its slot."""
    return list(await asyncio.gather(*[generate_image(p) for p in prompts]))
