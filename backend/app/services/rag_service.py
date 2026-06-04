"""
rag_service.py — Retrieval-Augmented Generation.

Two responsibilities, one module:
  1. Embeddings  — Gemini text-embedding-001 (768d), single + batch.
  2. Retrieval   — pgvector cosine similarity search over document_chunks
                   (course-material chunks + model-training style examples).

(Merge of the former embedding_service + retrieval_service.)
"""
import asyncio
import logging
from typing import List, Optional

from google import genai

from app.core.config import settings
from app.schemas.documents import RetrievedChunk

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------

_client = None
EMBED_DIM = 768


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
        config={"task_type": task_type, "output_dimensionality": EMBED_DIM},
    )
    return list(response.embeddings[0].values)


def _embed_batch_sync(texts: List[str], task_type: str) -> List[List[float]]:
    client = _get_client()
    response = client.models.embed_content(
        model=settings.embedding_model,
        contents=texts,
        config={"task_type": task_type, "output_dimensionality": EMBED_DIM},
    )
    return [list(e.values) for e in response.embeddings]


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
                    all_embeddings.append([0.0] * EMBED_DIM)

    return all_embeddings


# ---------------------------------------------------------------------------
# Retrieval (pgvector cosine search)
# ---------------------------------------------------------------------------

BASE_SQL = """
    SELECT
        dc.id            AS chunk_id,
        dc.document_id,
        d.title          AS document_title,
        d.subject,
        d.key_stage,
        dc.content,
        1 - (dc.embedding <=> $1::vector) AS similarity
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE d.status = 'ready'
      AND dc.embedding IS NOT NULL
      AND d.kb_type = 'course_material'
"""

TRAINING_SQL = """
    SELECT
        dc.content,
        1 - (dc.embedding <=> $1::vector) AS similarity
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE d.status = 'ready'
      AND dc.embedding IS NOT NULL
      AND d.kb_type = 'model_training'
"""


async def retrieve_relevant_chunks(
    db,
    query: str,
    subject: Optional[str] = None,
    key_stage: Optional[str] = None,
    top_k: Optional[int] = None,
) -> List[RetrievedChunk]:
    if top_k is None:
        top_k = settings.rag_top_k

    try:
        query_embedding = await embed_query(query)
    except Exception as e:
        logger.warning(f"Query embedding failed, skipping RAG: {e}")
        return []

    embedding_literal = "[" + ",".join(str(v) for v in query_embedding) + "]"

    clauses = []
    params = [embedding_literal, top_k]
    param_idx = 3

    if subject:
        clauses.append(f"AND d.subject = ${param_idx}")
        params.append(subject)
        param_idx += 1

    if key_stage:
        clauses.append(f"AND d.key_stage = ${param_idx}")
        params.append(key_stage)
        param_idx += 1

    where_extra = " ".join(clauses)
    sql_str = f"{BASE_SQL} {where_extra} ORDER BY dc.embedding <=> $1::vector LIMIT $2"

    try:
        conn = await db.connection()
        raw_conn = await conn.get_raw_connection()
        asyncpg_conn = raw_conn.dbapi_connection._connection

        rows = await asyncpg_conn.fetch(sql_str, *params)

        chunks = []
        for row in rows:
            sim = float(row["similarity"])
            if sim < settings.rag_min_similarity:
                continue
            chunks.append(RetrievedChunk(
                chunk_id=row["chunk_id"],
                document_id=row["document_id"],
                document_title=row["document_title"],
                subject=row["subject"],
                key_stage=row["key_stage"],
                content=row["content"],
                similarity=sim,
            ))

        if chunks:
            logger.info(f"RAG retrieved {len(chunks)} chunks (top: {chunks[0].similarity:.3f})")

        return chunks

    except Exception as e:
        logger.warning(f"pgvector search failed, skipping RAG: {e}")
        return []


async def retrieve_training_style_examples(
    db,
    query: str,
    subject: Optional[str] = None,
    top_k: int = 3,
) -> List[str]:
    """
    Retrieve teaching style examples from model_training KB.
    Used to inject expert tutor style patterns into the session system prompt.
    Returns list of content strings (truncated to 450 chars each).
    """
    try:
        query_embedding = await embed_query(query)
    except Exception as e:
        logger.warning(f"Training style embed failed: {e}")
        return []

    embedding_literal = "[" + ",".join(str(v) for v in query_embedding) + "]"

    params = [embedding_literal, top_k]
    param_idx = 3
    extra = ""

    if subject:
        extra = f" AND d.subject = ${param_idx}"
        params.append(subject)

    sql_str = f"{TRAINING_SQL}{extra} ORDER BY dc.embedding <=> $1::vector LIMIT $2"

    try:
        conn = await db.connection()
        raw_conn = await conn.get_raw_connection()
        asyncpg_conn = raw_conn.dbapi_connection._connection

        rows = await asyncpg_conn.fetch(sql_str, *params)

        examples = []
        for row in rows:
            sim = float(row["similarity"])
            if sim < 0.2:
                continue
            content = row["content"].strip()
            if len(content) >= 60:
                examples.append(content[:450])

        if examples:
            logger.info(f"Training style: retrieved {len(examples)} examples for query '{query[:50]}'")
        return examples

    except Exception as e:
        logger.warning(f"Training style retrieval failed (non-fatal): {e}")
        return []
