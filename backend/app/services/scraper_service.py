import base64
import logging
import re
import tempfile
from typing import Optional, Tuple
from urllib.parse import urlparse, quote

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

ALLOWED_DOMAINS = {
    "thenational.academy",
    "resourcefullearning.co.uk",
    "bbc.co.uk",
    "khanacademy.org",
    "sparknotes.com",
}

SCRAPE_TIMEOUT = 30.0


async def scrape_url(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc.lower().removeprefix("www.")

    if not any(domain == d or domain.endswith("." + d) for d in ALLOWED_DOMAINS):
        raise ValueError(
            f"Domain '{domain}' is not allowed. "
            f"Allowed: {', '.join(sorted(ALLOWED_DOMAINS))}"
        )

    async with httpx.AsyncClient(
        timeout=SCRAPE_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": "SmartAI-Tutor/1.0 (educational)"},
    ) as client:
        response = await client.get(url)
        response.raise_for_status()

    return _extract_text_from_html(response.text)


def _extract_text_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                     "form", "noscript", "iframe", "svg", "button"]):
        tag.decompose()

    main = soup.find("main") or soup.find("article") or soup.find(id="content") or soup.body
    if not main:
        return ""

    lines = []
    for el in main.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"]):
        text = el.get_text(separator=" ", strip=True)
        if text and len(text) > 10:
            lines.append(text)

    raw = "\n\n".join(lines)
    raw = re.sub(r"[ \t]{2,}", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


async def download_onedrive_link(share_url: str) -> Tuple[bytes, str]:
    encoded = base64.b64encode(share_url.encode("utf-8")).decode("utf-8")
    encoded = encoded.rstrip("=").replace("/", "_").replace("+", "-")
    api_url = f"https://api.onedrive.com/v1.0/shares/u!{encoded}/root/content"

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        response = await client.get(api_url)
        response.raise_for_status()

    content_type = response.headers.get("content-type", "")
    if "pdf" in content_type:
        ext = "pdf"
    elif "presentation" in content_type or "pptx" in content_type:
        ext = "pptx"
    elif "wordprocessing" in content_type or "docx" in content_type:
        ext = "docx"
    else:
        ext = "pdf"

    return response.content, ext


async def download_gdocs_link(share_url: str) -> Tuple[bytes, str]:
    parsed = urlparse(share_url)
    path = parsed.path

    if "/document/" in path:
        doc_id = _extract_gdocs_id(path, "document")
        export_url = f"https://docs.google.com/document/d/{doc_id}/export?format=pdf"
        ext = "pdf"
    elif "/presentation/" in path:
        doc_id = _extract_gdocs_id(path, "presentation")
        export_url = f"https://docs.google.com/presentation/d/{doc_id}/export/pptx"
        ext = "pptx"
    elif "/spreadsheets/" in path:
        doc_id = _extract_gdocs_id(path, "spreadsheets")
        export_url = f"https://docs.google.com/spreadsheets/d/{doc_id}/export?format=pdf"
        ext = "pdf"
    else:
        raise ValueError("Could not determine Google Docs type from URL")

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        response = await client.get(export_url)
        response.raise_for_status()

    return response.content, ext


def _extract_gdocs_id(path: str, doc_type: str) -> str:
    parts = path.split("/")
    try:
        idx = parts.index("d")
        return parts[idx + 1]
    except (ValueError, IndexError):
        raise ValueError(f"Could not extract document ID from path: {path}")
