import logging
from typing import List, Optional

from app.services.embedding_service import embed_query
from app.schemas.documents import RetrievedChunk
from app.core.config import settings

logger = logging.getLogger(__name__)

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
