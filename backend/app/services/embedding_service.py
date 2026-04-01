import asyncio
import logging
from typing import List

from google import genai

from app.core.config import settings

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _embed_sync(text: str, task_type: str) -> List[float]:
    client = _get_client()
    response = client.models.embed_content(
        model=settings.embedding_model,
        contents=text,
        config={"task_type": task_type},
    )
    return response.embeddings[0].values


def _embed_batch_sync(texts: List[str], task_type: str) -> List[List[float]]:
    client = _get_client()
    response = client.models.embed_content(
        model=settings.embedding_model,
        contents=texts,
        config={"task_type": task_type},
    )
    return [e.values for e in response.embeddings]


async def embed_text(text: str) -> List[float]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _embed_sync, text, "RETRIEVAL_DOCUMENT")


async def embed_query(text: str) -> List[float]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _embed_sync, text, "RETRIEVAL_QUERY")


async def embed_batch(texts: List[str]) -> List[List[float]]:
    if not texts:
        return []

    loop = asyncio.get_event_loop()
    batch_size = 20
    all_embeddings = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        try:
            embeddings = await loop.run_in_executor(None, _embed_batch_sync, batch, "RETRIEVAL_DOCUMENT")
            all_embeddings.extend(embeddings)
        except Exception as e:
            logger.warning(f"Batch embed failed for chunk {i}-{i+len(batch)}: {e}, falling back to sequential")
            for t in batch:
                try:
                    emb = await embed_text(t)
                    all_embeddings.append(emb)
                except Exception as inner_e:
                    logger.error(f"Single embed failed: {inner_e}")
                    all_embeddings.append([0.0] * 768)

    return all_embeddings
