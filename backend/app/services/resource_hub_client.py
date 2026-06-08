"""
resource_hub_client.py — async client for the external Resource Hub API.

Base URL (`settings.resourcehub_api_url`) already includes the `/api` prefix;
this client appends `/v1/...`. Auth is sent as a Bearer token (the hub also
accepts `?api_key=`, which we include as a fallback). Used by the sync jobs in
resource_sync_service.py.

Usage:
    async with ResourceHubClient() as hub:
        keystages = await hub.get_keystages()
        async for resource in hub.iter_resources(keyStage="KS1"):
            ...
"""
import asyncio
import logging
from typing import Any, AsyncIterator, Dict, List, Optional, Union

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_RESOURCE_FILTER_KEYS = ("keyStage", "yearGroup", "subjectId", "unitId", "topicId", "resourceType")


class ResourceHubClient:
    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None):
        self._base = (base_url or settings.resourcehub_api_url).rstrip("/")
        self._key = api_key if api_key is not None else settings.resourcehub_api_key
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self) -> "ResourceHubClient":
        headers = {"Accept": "application/json"}
        if self._key:
            headers["Authorization"] = f"Bearer {self._key}"
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0), headers=headers)
        return self

    async def __aexit__(self, *_exc) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get(self, path: str, params: Optional[dict] = None, retries: int = 3) -> dict:
        if self._client is None:
            raise RuntimeError("ResourceHubClient must be used as an async context manager")
        url = f"{self._base}/v1/{path.lstrip('/')}"
        params = {k: v for k, v in (params or {}).items() if v is not None}
        if self._key and "api_key" not in params:
            params["api_key"] = self._key  # belt-and-suspenders alongside the Bearer header

        last_err: Optional[Exception] = None
        for attempt in range(retries):
            try:
                resp = await self._client.get(url, params=params)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:  # noqa: BLE001 — retry on any transport/HTTP error
                last_err = exc
                if attempt < retries - 1:
                    await asyncio.sleep(0.5 * (attempt + 1))
        logger.warning("Resource Hub GET %s failed after %d tries: %s", path, retries, last_err)
        raise last_err  # type: ignore[misc]

    # ---- Curriculum ----

    async def get_keystages(self) -> List[str]:
        data = (await self._get("curriculum/keystages")).get("data")
        return data if isinstance(data, list) else []

    async def get_years(self, key_stage: Optional[str] = None) -> Union[List[str], Dict[str, List[str]]]:
        """List form when key_stage given; grouped dict when omitted."""
        data = (await self._get("curriculum/years", {"keyStage": key_stage})).get("data")
        return data if data is not None else ([] if key_stage else {})

    async def get_subjects(self, key_stage: Optional[str] = None,
                           year_group: Optional[str] = None) -> List[Dict[str, Any]]:
        data = (await self._get(
            "curriculum/subjects", {"keyStage": key_stage, "yearGroup": year_group}
        )).get("data")
        return data if isinstance(data, list) else []

    async def get_units(self, subject_id: int, key_stage: Optional[str] = None,
                        year_group: Optional[str] = None) -> List[Dict[str, Any]]:
        data = (await self._get(
            "curriculum/units",
            {"subjectId": subject_id, "keyStage": key_stage, "yearGroup": year_group},
        )).get("data")
        return data if isinstance(data, list) else []

    async def get_topics(self, unit_id: int) -> List[Dict[str, Any]]:
        data = (await self._get("curriculum/topics", {"unitId": unit_id})).get("data")
        return data if isinstance(data, list) else []

    # ---- Resources ----

    async def get_resources_page(self, *, page: int = 1, limit: int = 100, **filters) -> dict:
        params: Dict[str, Any] = {"page": page, "limit": limit}
        for k in _RESOURCE_FILTER_KEYS:
            if filters.get(k) is not None:
                params[k] = filters[k]
        return await self._get("resources", params)

    async def iter_resources(self, *, limit: int = 100, **filters) -> AsyncIterator[Dict[str, Any]]:
        """Yield every resource across all pages for the given filters."""
        page = 1
        while True:
            payload = await self.get_resources_page(page=page, limit=limit, **filters)
            data = payload.get("data") or []
            for item in data:
                yield item
            total_pages = int(payload.get("totalPages") or 0)
            if not data or page >= total_pages:
                break
            page += 1

    async def ping(self) -> bool:
        """Lightweight connectivity check used at startup."""
        try:
            await self.get_keystages()
            return True
        except Exception:
            return False
