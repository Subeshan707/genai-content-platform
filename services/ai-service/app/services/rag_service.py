"""
GenAI Content Platform — Brand RAG Service
Retrieves brand voice context from pgvector for prompt augmentation.
Embedding model: amazon.titan-embed-text-v2:0 (FREE TIER: 1000 units/month)
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

import structlog
from sqlalchemy import text

from app.bedrock_client import compute_embedding, text_hash
from app.config import settings
from app.database import cache_embedding, get_cached_embedding, get_pg_session

logger = structlog.get_logger(__name__)


async def get_embedding_with_cache(input_text: str, dimensions: int = 1024) -> list[float]:
    """
    Get embedding for text, using Redis cache to stay within
    the 1,000 units/month free tier limit.
    """
    cache_key = text_hash(input_text)
    
    # Check cache first
    cached = await get_cached_embedding(cache_key)
    if cached:
        logger.debug("embedding_cache_hit", text_length=len(input_text))
        return cached
    
    # Compute embedding via Bedrock
    embedding = compute_embedding(input_text, dimensions=dimensions)
    
    # Cache for 7 days
    await cache_embedding(cache_key, embedding, ttl=604800)
    logger.info("embedding_computed_and_cached", text_length=len(input_text), dimensions=dimensions)
    
    return embedding


async def retrieve_brand_context(
    workspace_id: str,
    query_text: str,
    top_k: int = 5,
) -> str:
    """
    Retrieve brand voice context from pgvector using cosine similarity.
    
    1. Embed the query with Titan Embed V2 (cached)
    2. Query pgvector for top-K brand examples (cosine similarity)
    3. Return concatenated brand context
    """
    start_time = time.time()
    
    # Get query embedding (with cache)
    query_vec = await get_embedding_with_cache(query_text)
    
    # Query pgvector for similar brand voice examples
    async with get_pg_session() as session:
        result = await session.execute(
            text("""
                SELECT chunk_text, source_doc,
                       1 - (embedding <=> CAST(:query_vec AS vector)) AS similarity
                FROM brand_embeddings
                WHERE workspace_id = :workspace_id
                ORDER BY embedding <=> CAST(:query_vec AS vector)
                LIMIT :top_k
            """),
            {
                "workspace_id": workspace_id,
                "query_vec": str(query_vec),
                "top_k": top_k,
            },
        )
        rows = result.fetchall()
    
    latency_ms = int((time.time() - start_time) * 1000)
    
    if not rows:
        logger.info(
            "brand_context_empty",
            workspace_id=workspace_id,
            latency_ms=latency_ms,
        )
        return ""
    
    # Build context string with source attribution
    context_parts = []
    for i, row in enumerate(rows, 1):
        source = row.source_doc or "unknown"
        similarity = f"{row.similarity:.3f}" if row.similarity else "N/A"
        context_parts.append(
            f"[Brand Example {i} | Source: {source} | Similarity: {similarity}]\n{row.chunk_text}"
        )
    
    brand_context = "\n\n---\n\n".join(context_parts)
    
    logger.info(
        "brand_context_retrieved",
        workspace_id=workspace_id,
        chunks_found=len(rows),
        latency_ms=latency_ms,
    )
    
    return brand_context


async def ingest_brand_document(
    workspace_id: str,
    document_text: str,
    source_doc: str,
    chunk_size: int = 512,
    chunk_overlap: int = 50,
) -> int:
    """
    Ingest a brand document into pgvector:
    1. Split document into chunks
    2. Compute embeddings for each chunk (Titan Embed V2)
    3. Store chunks + embeddings in brand_embeddings table
    
    Returns the number of chunks created.
    """
    start_time = time.time()
    
    # Split document into chunks
    chunks = _split_text_into_chunks(document_text, chunk_size, chunk_overlap)
    
    if not chunks:
        logger.warning("ingest_no_chunks", source_doc=source_doc)
        return 0
    
    # Compute embeddings and store
    chunks_created = 0
    async with get_pg_session() as session:
        for i, chunk in enumerate(chunks):
            try:
                # Compute embedding (with cache)
                embedding = await get_embedding_with_cache(chunk)
                
                # Insert into pgvector
                await session.execute(
                    text("""
                        INSERT INTO brand_embeddings
                            (workspace_id, chunk_text, embedding, source_doc, chunk_index)
                        VALUES
                            (:workspace_id, :chunk_text, CAST(:embedding AS vector), :source_doc, :chunk_index)
                    """),
                    {
                        "workspace_id": workspace_id,
                        "chunk_text": chunk,
                        "embedding": str(embedding),
                        "source_doc": source_doc,
                        "chunk_index": i,
                    },
                )
                chunks_created += 1
                
            except Exception as e:
                logger.error(
                    "ingest_chunk_error",
                    chunk_index=i,
                    source_doc=source_doc,
                    error=str(e),
                )
                continue
    
    latency_ms = int((time.time() - start_time) * 1000)
    logger.info(
        "brand_document_ingested",
        workspace_id=workspace_id,
        source_doc=source_doc,
        total_chunks=len(chunks),
        chunks_created=chunks_created,
        latency_ms=latency_ms,
    )
    
    return chunks_created


def _split_text_into_chunks(
    text: str,
    chunk_size: int = 512,
    overlap: int = 50,
) -> list[str]:
    """
    Split text into overlapping chunks by sentence boundaries.
    Falls back to word-level splitting if sentences are too long.
    """
    # Split by sentences (rough heuristic)
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    
    chunks: list[str] = []
    current_chunk: list[str] = []
    current_length = 0
    
    for sentence in sentences:
        sentence_words = len(sentence.split())
        
        if current_length + sentence_words > chunk_size and current_chunk:
            # Save current chunk
            chunks.append(" ".join(current_chunk))
            
            # Keep overlap words for next chunk
            overlap_words = " ".join(current_chunk).split()[-overlap:]
            current_chunk = overlap_words + [sentence]
            current_length = len(overlap_words) + sentence_words
        else:
            current_chunk.append(sentence)
            current_length += sentence_words
    
    # Don't forget the last chunk
    if current_chunk:
        chunks.append(" ".join(current_chunk))
    
    return chunks
