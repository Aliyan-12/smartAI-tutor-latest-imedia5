"""
Presenton-based slide generation service.

Auth flow: POST /api/v1/auth/login → presenton_session cookie (30-day JWT).
           Cookie is cached module-level and refreshed automatically.

Generation flow per AI message (triggered by [SLIDE_TRIGGER]):
  1. extract_topic()          — fast Gemini call to get a short topic title
  2. generate_presenton_slide() — calls Presenton API (background task) to produce a
                                  1-slide PPTX with Pexels imagery; may take 30-120 s
  3. Caller polls GET /api/slides/<id> until status == "ready"
"""
import logging
import time
from typing import Optional

import httpx
from google import genai
from google.genai import types

from app.core.config import settings

logger = logging.getLogger(__name__)

PRESENTON_TIMEOUT = 180.0

# ── Session cookie cache ──────────────────────────────────────────────────────
_session_cookie: Optional[str] = None
_session_cookie_expires: float = 0.0  # Unix timestamp; refresh 1 h before expiry

# ── Topic extraction ──────────────────────────────────────────────────────────
_TOPIC_SYSTEM = (
    "You are a lesson slide topic extractor for a UK K-12 AI tutoring platform. "
    "Given an AI tutor's response and the session subject, return ONLY a short topic "
    "title (max 7 words) if the response teaches a specific educational concept directly "
    "related to the subject. Return an empty string if the response is a greeting, "
    "quiz announcement, social exchange, platform instruction, or contains no new "
    "subject-specific educational content. Output only the title string — no quotes, "
    "no explanation, no punctuation."
)

_TOPIC_PROMPT = """\
Subject: {subject}
Already covered titles (do NOT repeat): {existing}

AI Tutor Response:
{text}

Return the topic title or empty string:"""

_SHORT_THRESHOLD = 60

_SKIP_PATTERNS = [
    "hi there", "hello", "how can i help", "welcome",
    "check the test", "try refreshing", "technical issue",
    "i've set up", "i've prepared", "let me set you",
    "[quiz_offer", "[slide_trigger]",
]

_genai_client: Optional[genai.Client] = None


def _get_genai_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client(api_key=settings.gemini_api_key)
    return _genai_client


def _should_skip(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < _SHORT_THRESHOLD:
        return True
    lower = stripped.lower()
    return any(p in lower for p in _SKIP_PATTERNS)


def _titles_too_similar(new_title: str, existing: list[str]) -> bool:
    new_words = {w for w in new_title.lower().split() if len(w) > 3}
    if not new_words:
        return False
    for ex in existing:
        ex_words = {w for w in ex.lower().split() if len(w) > 3}
        if not ex_words:
            continue
        if len(new_words & ex_words) / len(new_words) >= 0.6:
            return True
    return False


def _extract_topic_sync(text: str, subject: str, existing_titles: list[str]) -> str:
    existing_str = ", ".join(f'"{t}"' for t in existing_titles) if existing_titles else "none"
    prompt = _TOPIC_PROMPT.format(
        subject=subject or "General",
        existing=existing_str,
        text=text.strip()[:2000],
    )
    try:
        client = _get_genai_client()
        resp = client.models.generate_content(
            model=settings.gemini_model_fast,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=_TOPIC_SYSTEM,
                max_output_tokens=30,
                temperature=0.0,
            ),
        )
        title = (resp.text or "").strip().strip('"').strip("'")
        return title if len(title) >= 3 else ""
    except Exception as exc:
        logger.warning(f"slides_service: topic extraction failed: {exc}")
        return ""


# ── Presenton session management ──────────────────────────────────────────────

async def _get_session_cookie() -> Optional[str]:
    """Return a valid presenton_session cookie, logging in if expired or absent."""
    global _session_cookie, _session_cookie_expires

    if _session_cookie and time.time() < _session_cookie_expires - 3600:
        return _session_cookie

    if not settings.presenton_user or not settings.presenton_password:
        logger.warning("slides_service: PRESENTON_USER/PASSWORD not configured")
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.presenton_url}/api/v1/auth/login",
                json={
                    "username": settings.presenton_user,
                    "password": settings.presenton_password,
                },
            )
            resp.raise_for_status()

            # httpx stores cookies in resp.cookies; find presenton_session
            raw = resp.headers.get("set-cookie", "")
            for part in raw.split(";"):
                part = part.strip()
                if part.startswith("presenton_session="):
                    _session_cookie = part.split(";")[0]  # just name=value
                    # Max-Age is 2 592 000 s (30 days)
                    _session_cookie_expires = time.time() + 2_592_000
                    logger.info("slides_service: Presenton login successful")
                    return _session_cookie

            logger.error("slides_service: presenton_session cookie not found in login response")
            return None

    except Exception as exc:
        logger.error(f"slides_service: Presenton login failed: {exc}")
        return None


# ── Presenton API call ────────────────────────────────────────────────────────

def _build_presenton_content(topic: str, subject: str, key_stage: str, ai_text: str) -> str:
    ctx = subject
    if key_stage:
        ctx += f" ({key_stage})"

    clean_text = (
        ai_text
        .replace("[SLIDE_TRIGGER]", "")
        .replace("[QUIZ_OFFER:", "")
        .strip()
    )

    return (
        f"Topic: {topic}\n"
        f"Subject: {ctx}\n\n"
        f"Educational context:\n{clean_text[:1500]}\n\n"
        "Create ONE clear, visually engaging educational slide for UK GCSE students. "
        "Include a striking relevant image, a clear concept title, "
        "3-4 essential bullet points, and a memorable key takeaway. "
        "Make it exam-focused and age-appropriate."
    )


async def _call_presenton(content: str) -> Optional[dict]:
    """
    Call Presenton self-hosted API to generate a 1-slide PPTX.
    Uses the async endpoint (POST .../generate/async) then polls status
    until the task completes — safe to run inside a FastAPI BackgroundTask.
    """
    cookie = await _get_session_cookie()
    if not cookie:
        logger.warning("slides_service: cannot obtain Presenton session — slide skipped")
        return None

    payload = {
        "content": content,
        "n_slides": 1,
        "language": "English",
        "export_as": "pptx",
        "include_title_slide": False,
    }
    headers = {"Cookie": cookie}

    # ── Step 1: submit async task ──────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.presenton_url}/api/v1/ppt/presentation/generate/async",
                json=payload,
                headers=headers,
            )
            if resp.status_code == 401:
                global _session_cookie, _session_cookie_expires
                _session_cookie = None
                _session_cookie_expires = 0.0
            resp.raise_for_status()
            task = resp.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"slides_service: Presenton submit HTTP {e.response.status_code}: {e.response.text[:300]}")
        return None
    except Exception as e:
        logger.error(f"slides_service: Presenton submit error: {type(e).__name__}: {e}")
        return None

    task_id = task.get("id")
    if not task_id:
        logger.error(f"slides_service: no task id in async response: {task}")
        return None

    logger.info(f"slides_service: Presenton task queued — id={task_id}")

    # ── Step 2: poll status ────────────────────────────────────────────────────
    import asyncio
    deadline = 160  # seconds
    poll_interval = 5
    elapsed = 0

    while elapsed < deadline:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                sr = await client.get(
                    f"{settings.presenton_url}/api/v1/ppt/presentation/status/{task_id}",
                    headers=headers,
                )
                sr.raise_for_status()
                status_data = sr.json()
        except Exception as e:
            logger.warning(f"slides_service: status poll error: {e}")
            continue

        status = status_data.get("status", "")
        if status == "completed":
            break
        if status == "error":
            logger.error(f"slides_service: Presenton task failed: {status_data.get('error')}")
            return None

    else:
        logger.error(f"slides_service: Presenton task timed out after {deadline} s")
        return None

    # ── Step 3: extract result ─────────────────────────────────────────────────
    data = status_data.get("data") or {}
    presentation_id = data.get("presentation_id")
    if not presentation_id:
        logger.error(f"slides_service: no presentation_id in completed task: {status_data}")
        return None

    raw_path = data.get("path", "")
    pptx_url = (
        raw_path if raw_path.startswith("http")
        else f"{settings.presenton_url}{raw_path}"
    )
    viewer_url = f"{settings.presenton_url}/presentation?id={presentation_id}"

    logger.info(f"slides_service: Presenton slide ready — id={presentation_id}")
    return {
        "presentation_id": presentation_id,
        "pptx_url": pptx_url,
        "viewer_url": viewer_url,
    }


# ── Public API ────────────────────────────────────────────────────────────────

def extract_topic(text: str, subject: str, existing_titles: list[str]) -> Optional[str]:
    """
    Extract a slide-worthy topic from AI response text (synchronous).
    Returns None if the text should be skipped.
    """
    if _should_skip(text):
        return None

    topic = _extract_topic_sync(text, subject, existing_titles)
    if not topic:
        return None

    if _titles_too_similar(topic, existing_titles):
        logger.info(f"slides_service: '{topic}' too similar to existing — skipped")
        return None

    return topic


async def generate_presenton_slide(
    topic: str,
    subject: str,
    key_stage: str,
    ai_text: str,
) -> Optional[dict]:
    """
    Generate a Presenton 1-slide presentation for a lesson concept.
    Designed to run as a background task — takes 30-120 seconds.

    Returns {presentation_id, viewer_url, pptx_url} or None on failure.
    """
    content = _build_presenton_content(topic, subject, key_stage, ai_text)
    return await _call_presenton(content)
