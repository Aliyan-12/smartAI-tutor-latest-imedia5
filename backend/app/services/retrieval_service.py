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

    embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

    subject_clause = "AND d.subject = :subject" if subject else ""

    sql = text(f"""
        SELECT
            dc.id AS chunk_id,
            dc.document_id,
            d.title AS document_title,
            d.subject,
            dc.content,
            1 - (dc.embedding <=> CAST(:embedding AS vector)) AS similarity
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE d.status = 'ready'
          AND dc.embedding IS NOT NULL
          {subject_clause}
        ORDER BY dc.embedding <=> CAST(:embedding AS vector)
        LIMIT :top_k
    """)

    params = {"embedding": embedding_str, "top_k": top_k}
    if subject:
        params["subject"] = subject

    try:
        result = await db.execute(sql, params)
        rows = result.mappings().all()

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
        return chunks

    except Exception as e:
        logger.warning(f"Vector search failed, skipping RAG: {e}")
        return []
