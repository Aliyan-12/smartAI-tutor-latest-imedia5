"""
image_gen_service.py — live puzzle/explanatory images via Gemini "Nano Banana".

The AI never free-draws with markup; it hands us a natural-language *image prompt* and
we render a real PNG with `gemini-2.5-flash-image`, write it to the served media dir, and
return a URL the frontend loads. Blocking SDK calls run in a thread; a batch of prompts
(labelling/matching's 3–4 images) is generated CONCURRENTLY so the student waits ~one
image, not N.

Caching: explanatory images pass a stable `cache_key` (same concept → reuse the file, so
repeats are instant and free). Practice puzzles omit it → a fresh image every call.

TOPIC IMAGES (the pre-seeded set, bottom of this file): `cache_key` is hashed together with the
PROMPT, and the tutor words its prompt differently every lesson, so that cache almost never hit —
every session paid for a fresh ~5-10 s generation whose labelling varied each time. The topic
helpers below key the filename on the CURRICULUM COORDINATES ONLY (subject + key stage + unit +
subtopic), so one good image is generated once by `python -m app.seed_explanatory_images` and
reused by every lesson on that topic.
"""
import asyncio
import hashlib
import logging
import re
import time
import uuid
from pathlib import Path
from typing import List, Optional, Tuple

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


# =================================================================================
# PRE-SEEDED TOPIC IMAGES
# =================================================================================
# Keyed on curriculum coordinates only (NOT the tutor's wording), so a lesson serves an image
# that was generated and checked once, instantly, instead of paying for a fresh generation whose
# quality varies. Selection mirrors how resources are scoped:
#     subtopic chosen → that subtopic's image; otherwise → the unit's image; else live generation.

def topic_key(subject: Optional[str], key_stage: Optional[str],
              unit: Optional[str], subtopic: Optional[str] = None) -> str:
    raw = "|".join((p or "").strip().lower()
                   for p in (subject or "", key_stage or "", unit or "", subtopic or ""))
    return f"t_{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:18]}"


def topic_image_exists(subject: Optional[str], key_stage: Optional[str],
                       unit: Optional[str], subtopic: Optional[str] = None) -> bool:
    """Is THIS exact topic/subtopic image on disk? Unlike `topic_image_url` this does NOT fall
    back subtopic → unit — the seeder needs to know whether this specific image still has to be
    generated, and the fallback would make every unseeded subtopic look done because its unit
    image exists."""
    p = _media_dir() / f"{topic_key(subject, key_stage, unit, subtopic)}.png"
    return p.exists() and p.stat().st_size > 0


def topic_image_url(subject: Optional[str], key_stage: Optional[str],
                    unit: Optional[str], subtopic: Optional[str] = None) -> Optional[str]:
    """Served URL of the pre-seeded image for this topic/subtopic, or None if not seeded.
    Falls back subtopic → unit, so an unseeded subtopic still gets its unit's image."""
    d = _media_dir()
    for st in ([subtopic, None] if subtopic else [None]):
        name = f"{topic_key(subject, key_stage, unit, st)}.png"
        p = d / name
        if p.exists() and p.stat().st_size > 0:
            return media_url(name)
    return None


# The images must TEACH, not decorate — a confusing diagram mid-lesson is worse than none.
_AGE_BY_KS = {
    "KS1": "5-7 year olds — very simple, bold and friendly, only 3-4 labels",
    "KS2": "7-11 year olds — clear and colourful, 4-6 labels, plain words",
    "KS3": "11-14 year olds — a proper labelled school textbook diagram, 5-8 labels",
    "KS4": "14-16 year olds — GCSE-level labelled diagram, accurate terminology",
    "KS5": "16-18 year olds — A-Level standard, precise and detailed",
}
_SUBJECT_STYLE = {
    "biology": "a clean biological diagram with every structure clearly labelled",
    "chemistry": "a clear chemistry diagram (apparatus, particles or reaction) with labels",
    "physics": "a clear physics diagram with labelled arrows for forces/energy/direction",
    "science": "a clear, friendly science diagram with simple labels",
    "maths": "a clear mathematical diagram with the numbers, parts and steps labelled",
}


def _clean_unit(title: Optional[str]) -> str:
    """'UNIT 3: Heredity and DNA' → 'Heredity and DNA'; '2. The sine ratio' → 'The sine ratio'."""
    t = (title or "").strip()
    t = re.sub(r"^\s*unit\s*\d+\s*[:.\-]\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"^\s*\d+\s*[.)]\s*", "", t)
    return t.strip() or (title or "").strip()


# Worksheet/slide furniture that carries no teaching content. Matched ANYWHERE in a line, not
# just at its start: the extracted chunks are littered with zero-width spaces, so "Name: ​ ​ Date:"
# arrives glued to real text rather than on a line of its own.
_FURNITURE = re.compile(
    r"(name\s*:|date\s*:|class\s*:|teacher\s*:|student\s*:|page \d+|part [a-e]\s*:|"
    r"answers?\s*:|mark scheme|learning objectives?|success criteria|starter|plenary|"
    r"homework|©|www\.|http\S+)",
    re.IGNORECASE,
)
_INVISIBLE = re.compile(r"[​-‏  ﻿\xa0]")


def clean_source_text(text: Optional[str], limit: int = 700) -> str:
    """Condense real PPT/worksheet text into something an image model can use.

    The raw chunks are full of worksheet furniture ("Name: ___ Date:", "Part A", answer keys) and
    invisible characters, which would only confuse the picture. Keep the substantive sentences —
    that is what tells the model WHICH structures and labels this lesson actually cares about.
    """
    if not text:
        return ""
    text = _INVISIBLE.sub(" ", text)
    out, seen = [], set()
    for line in re.split(r"[\n\r]+|(?<=[.!?])\s+|\s{3,}", text):
        s = " ".join(line.split()).strip(" ·•-–—|_")
        if len(s) < 15 or _FURNITURE.search(s):
            continue
        letters = sum(c.isalpha() for c in s)
        if letters < len(s) * 0.6:      # mostly digits/punctuation → answer blanks, equations
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
        if sum(len(x) for x in out) >= limit:
            break
    return " ".join(out)[:limit]


_STOPWORDS = {
    "the", "and", "for", "with", "their", "his", "her", "its", "unit", "lesson", "part",
    "using", "use", "uses", "into", "from", "that", "this", "these", "those", "what", "how",
    "why", "who", "are", "is", "was", "were", "will", "can", "our", "your", "about", "more",
    "than", "when", "where", "which", "them", "they", "you", "not", "but", "all", "any",
}


def _content_words(text: Optional[str]) -> set:
    return {w for w in re.findall(r"[a-z]{4,}", (text or "").lower()) if w not in _STOPWORDS}


def _text_matches_topic(src: str, unit: Optional[str], subtopic: Optional[str]) -> bool:
    """Does this resource text actually belong to this topic?

    The hub can hold a mis-filed upload (a KS1 "Everyday Materials" slot once contained a
    software infrastructure document). Grounding a diagram prompt on that produces a
    self-contradictory instruction which the image model refuses outright, so we require at
    least ONE substantive word of the topic title to appear in the text. Stemmed loosely so
    "materials" matches "material". When the title has no substantive words we allow it
    through — that's the pre-existing behaviour and not worth blocking on.
    """
    topic_words = _content_words(f"{_clean_unit(unit)} {_clean_unit(subtopic) if subtopic else ''}")
    if not topic_words:
        return True
    src_words = _content_words(src)
    if not src_words:
        return False
    # ONE-DIRECTIONAL on purpose: the source word must begin with the topic stem, so
    # "material" → "materials" still matches while an unrelated document can't sneak through on
    # a coincidental prefix. (A reverse check let the topic word "everyday" match the word
    # "every" in "every week", which is exactly how the mis-filed roadmap slipped past.)
    for tw in topic_words:
        stem = tw[:-1] if tw.endswith("s") else tw
        if any(sw.startswith(stem) for sw in src_words):
            return True
    return False


def topic_prompt(subject: Optional[str], key_stage: Optional[str],
                 unit: Optional[str], subtopic: Optional[str] = None,
                 source_text: Optional[str] = None) -> str:
    subj = (subject or "").strip().lower()
    style = next((v for k, v in _SUBJECT_STYLE.items() if k in subj),
                 "a clear, well-labelled educational diagram")
    audience = _AGE_BY_KS.get((key_stage or "").upper().replace(" ", ""),
                              "school students — clear and well labelled")
    focus = _clean_unit(subtopic) if subtopic else _clean_unit(unit)
    context = f" (part of the topic '{_clean_unit(unit)}')" if subtopic and unit else ""

    # Ground the picture in what the lesson ACTUALLY teaches. A bare title like "How fossils are
    # formed (Mary Anning link)" leaves the model guessing; the real slide/worksheet text tells it
    # which stages and labels matter, so the diagram matches the deck the student will be shown.
    grounding = ""
    src = clean_source_text(source_text)
    if src and not _text_matches_topic(src, unit, subtopic):
        # The attached resource is not about this topic — a mis-filed upload in the hub (a KS1
        # "Everyday Materials" slot once held a software roadmap). Grounding on it produces a
        # self-contradictory prompt that the image model REFUSES outright, so drop it and fall
        # back to the title, which still yields a usable diagram.
        logger.warning("topic image: resource text looks unrelated to %r/%r — ignoring it",
                       unit, subtopic)
        src = ""
    if src:
        grounding = (
            " Base the diagram on what this lesson actually teaches, summarised from its "
            f"slides/worksheet: \"{src}\". Use that to decide WHICH parts, stages and labels to "
            "draw — do NOT copy sentences into the image or reproduce worksheet questions."
        )

    return (
        f"Create {style} that TEACHES the concept: \"{focus}\"{context}. "
        f"Subject: {subject or 'Science'}. Audience: {audience}.{grounding} "
        "Requirements: ONE clear diagram on a plain white background; label every important part "
        "with short, correct text labels and thin leader lines; distinct flat colours; an "
        "uncluttered layout with generous spacing so nothing overlaps; all text large and legible. "
        "Do NOT include a title banner, watermark, border, cartoon characters, photographic "
        "background or decorative elements. It must be scientifically and mathematically accurate; "
        "where exact counts or values would be needed, prefer a general labelled structure over "
        "specific numbers."
    )


async def ensure_topic_image(subject: Optional[str], key_stage: Optional[str],
                             unit: Optional[str], subtopic: Optional[str] = None,
                             overwrite: bool = False,
                             source_text: Optional[str] = None) -> Tuple[str, Optional[str]]:
    """Generate + store this topic/subtopic's image if missing. `source_text` is the real
    slide/worksheet text for this topic, which makes the diagram match what is actually taught.
    Returns (status, url) with status 'cached' | 'created' | 'failed'."""
    d = _media_dir()
    name = f"{topic_key(subject, key_stage, unit, subtopic)}.png"
    path = d / name
    if path.exists() and path.stat().st_size > 0 and not overwrite:
        return "cached", media_url(name)
    prompt = topic_prompt(subject, key_stage, unit, subtopic, source_text)
    try:
        data = await asyncio.to_thread(_generate_sync, prompt)
    except Exception as e:  # noqa: BLE001
        logger.warning("topic image gen failed (%r / %r): %s: %s", unit, subtopic, type(e).__name__, e)
        return "failed", None
    if not data:
        return "failed", None
    try:
        path.write_bytes(data)
    except Exception as e:  # noqa: BLE001
        logger.warning("topic image write failed %s: %s", name, e)
        return "failed", None
    logger.info("TOPIC IMAGE created %s (%d bytes) for %r / %r", name, len(data), unit, subtopic)
    return "created", media_url(name)
