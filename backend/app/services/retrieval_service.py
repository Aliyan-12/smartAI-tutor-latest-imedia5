import logging
from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.services.embedding_service import embed_query
from app.schemas.documents import RetrievedChunk
from app.core.config import settings

logger = logging.getLogger(__name__)


async def retrieve_relevant_chunks(
    db: AsyncSession,
    query: str,
    subject: Optional[str] = None,
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

    subject_clause = "AND d.subject = $3" if subject else ""

    # Use dollar-sign params ($1, $2...) to avoid conflict with pgvector's :: cast
    if subject:
        sql_str = f"""
            SELECT
                dc.id            AS chunk_id,
                dc.document_id,
                d.title          AS document_title,
                d.subject,
                dc.content,
                1 - (dc.embedding <=> $1::vector) AS similarity
            FROM document_chunks dc
            JOIN documents d ON d.id = dc.document_id
            WHERE d.status = 'ready'
              AND dc.embedding IS NOT NULL
              AND d.subject = $3
            ORDER BY dc.embedding <=> $1::vector
            LIMIT $2
        """
    else:
        sql_str = """
            SELECT
                dc.id            AS chunk_id,
                dc.document_id,
                d.title          AS document_title,
                d.subject,
                dc.content,
                1 - (dc.embedding <=> $1::vector) AS similarity
            FROM document_chunks dc
            JOIN documents d ON d.id = dc.document_id
            WHERE d.status = 'ready'
              AND dc.embedding IS NOT NULL
            ORDER BY dc.embedding <=> $1::vector
            LIMIT $2
        """

    try:
        conn = await db.connection()
        raw_conn = await conn.get_raw_connection()
        asyncpg_conn = raw_conn.dbapi_connection._connection

        if subject:
            rows = await asyncpg_conn.fetch(sql_str, embedding_literal, top_k, subject)
        else:
            rows = await asyncpg_conn.fetch(sql_str, embedding_literal, top_k)

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
                content=row["content"],
                similarity=sim,
            ))

        if chunks:
            logger.info(f"RAG retrieved {len(chunks)} chunks (top similarity: {chunks[0].similarity:.3f})")

        return chunks

    except Exception as e:
        logger.warning(f"pgvector search failed, skipping RAG: {e}")
        return []
