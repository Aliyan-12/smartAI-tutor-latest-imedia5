"""
topic_image_service.py — resolve + cache a representative image per curriculum topic.

Images come from Wikipedia's public REST/Action APIs (CORS-enabled, license-clean
lead images) and are cached in `RHTopicImage` so puzzles never hit the network at
play time. They power image-driven puzzles (match / identify, and curated labelling)
across most Resource Hub topics without hand-curating hundreds of URLs.

Resolution is best-effort: a topic with no confident, education-appropriate image is
recorded as status="none" and simply falls back to a typed / hand-drawn puzzle.
"""
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.resource_hub import RHTopicImage

logger = logging.getLogger(__name__)

_WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"
_WIKI_API = "https://en.wikipedia.org/w/api.php"
_UA = "SmartAITutor/1.0 (educational topic-image catalog; contact admin@smartaitutor.online)"

# Leading instructional verbs/articles stripped so the search matches the concept noun
# ("Recognise and name common 2D shapes" → "common 2D shapes").
_LEAD = re.compile(
    r"^(recognise|recognize|identify|name|understand|understanding|describe|explain|"
    r"use|using|apply|applying|introduction to|intro to|add|adding|subtract|subtracting|"
    r"multiply|multiplying|divide|dividing|compare|comparing|order|ordering|read|reading|"
    r"write|writing|draw|drawing|label|labelling|calculate|calculating|find|finding|"
    r"solve|solving|the|an|a)\b[:\s]*",
    re.IGNORECASE,
)
# Leading enumeration prefix ("2. ", "Lesson 3: ", "Unit 4 - ") — these bias the search
# toward number pages ("1", "0"), so strip them before querying.
_ENUM = re.compile(r"^\s*(?:lesson|unit|topic|week|step|part)?\s*\d+\s*[.):\-]+\s*", re.IGNORECASE)
# Trailing qualifier in parentheses ("Adding fractions (same denominator)") — drop it so
# the search finds the core concept.
_PAREN_TAIL = re.compile(r"\s*\([^)]*\)\s*$")


def _clean_query(title: str) -> str:
    t = (title or "").strip()
    t = _ENUM.sub("", t).strip()        # drop "2." / "Lesson 3:" enumeration
    t = _PAREN_TAIL.sub("", t).strip()  # drop a trailing (parenthetical)
    for _ in range(3):                  # peel a few leading verbs ("recognise and name …")
        nxt = _LEAD.sub("", t).strip()
        if nxt == t:
            break
        t = nxt
    return t or (title or "").strip()


def _is_junk_title(summary: dict) -> bool:
    """Reject obviously-irrelevant matches — a bare number / very short page title
    (e.g. "1", "0", "1,000"), which the search returns for numbered topic titles."""
    t = (summary.get("title") or "").strip()
    if len(t) < 3:
        return True
    if re.fullmatch(r"[\d\s.,]+", t):  # "1", "0", "1,000,000"
        return True
    return False


async def _summary(client: httpx.AsyncClient, page_title: str) -> Optional[dict]:
    try:
        r = await client.get(_WIKI_REST + quote(page_title, safe=""))
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


async def _search_title(client: httpx.AsyncClient, query: str) -> Optional[str]:
    try:
        r = await client.get(_WIKI_API, params={
            "action": "query", "list": "search", "srsearch": query,
            "srlimit": 1, "srnamespace": 0, "format": "json",
        })
        if r.status_code != 200:
            return None
        hits = r.json().get("query", {}).get("search", [])
        return hits[0]["title"] if hits else None
    except Exception:
        return None


def _pick_image(summary: Optional[dict]) -> Optional[Dict[str, Any]]:
    if not summary or (summary.get("type") or "").endswith("disambiguation"):
        return None
    if _is_junk_title(summary):
        return None
    thumb = (summary.get("thumbnail") or {}).get("source")
    orig = (summary.get("originalimage") or {}).get("source")
    img = thumb or orig            # thumbnail is plenty for a puzzle card
    if not img:
        return None
    page = ((summary.get("content_urls") or {}).get("desktop") or {}).get("page")
    return {
        "image_url": img,
        "thumb_url": thumb or img,
        "source": "wikipedia",
        "attribution": page or summary.get("title"),
        "license": "Wikipedia / Wikimedia Commons",
    }


_NONE = {"status": "none", "image_url": None, "thumb_url": None,
         "source": None, "attribution": None, "license": None}


async def resolve_image(title: str, subject: Optional[str] = None,
                        client: Optional[httpx.AsyncClient] = None) -> Dict[str, Any]:
    """Best-effort representative image for a topic. Returns {status:'ok', image_url, …}
    or a {status:'none'} sentinel. Reuses a shared httpx client when given (sync job)."""
    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=httpx.Timeout(15.0), follow_redirects=True,
                                   headers={"User-Agent": _UA})
    try:
        q = _clean_query(title)
        pick = _pick_image(await _summary(client, q))         # 1) direct page summary
        if not pick:                                          # 2) search → summary
            page = await _search_title(client, f"{q} {subject}".strip() if subject else q)
            if page:
                pick = _pick_image(await _summary(client, page))
        return {"status": "ok", **pick} if pick else dict(_NONE)
    except Exception as e:  # noqa: BLE001
        logger.debug("resolve_image(%r) failed: %s", title, e)
        return {"status": "error", **{k: v for k, v in _NONE.items() if k != "status"}}
    finally:
        if own:
            await client.aclose()


def _row_dict(r: RHTopicImage) -> dict:
    return {"topic_title": r.topic_title, "image_url": r.image_url,
            "thumb_url": r.thumb_url or r.image_url}


async def get_for(
    db: AsyncSession, *, subject: Optional[str] = None, key_stage: Optional[str] = None,
    year_group: Optional[str] = None, topic_title: Optional[str] = None, limit: int = 12,
) -> List[dict]:
    """Resolved catalog rows (status='ok') for the lesson's coordinates — each is
    {topic_title, image_url, thumb_url}, for building match/identify puzzles. Tries the
    most specific scope that yields rows: subject+ks+year → subject+ks → subject. When a
    target topic_title is given, its row (if present) is moved to the front so identify
    puzzles use the lesson's actual topic."""
    scopes = []
    if subject and key_stage and year_group:
        scopes.append([RHTopicImage.subject_name == subject,
                       RHTopicImage.key_stage == key_stage,
                       RHTopicImage.year_group == year_group])
    if subject and key_stage:
        scopes.append([RHTopicImage.subject_name == subject,
                       RHTopicImage.key_stage == key_stage])
    if subject:
        scopes.append([RHTopicImage.subject_name == subject])
    for conds in scopes:
        q = select(RHTopicImage).where(RHTopicImage.status == "ok", *conds).limit(limit)
        rows = (await db.execute(q)).scalars().all()
        if len(rows) >= 1:
            out = [_row_dict(r) for r in rows]
            if topic_title:
                tt = topic_title.strip().lower()
                out.sort(key=lambda d: 0 if d["topic_title"].strip().lower() == tt else 1)
            return out
    return []
