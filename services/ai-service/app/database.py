"""
GenAI Content Platform — Database Connections
Async PostgreSQL (SQLAlchemy + asyncpg) + MongoDB (motor) + Redis
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import redis.asyncio as aioredis
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

# ═══════════════════════════════════════════════════════════════
# PostgreSQL (Aurora Serverless v2 compatible)
# ═══════════════════════════════════════════════════════════════

_pg_engine: AsyncEngine | None = None
_pg_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_pg_engine() -> AsyncEngine:
    """Get or create PostgreSQL async engine."""
    global _pg_engine
    if _pg_engine is None:
        _pg_engine = create_async_engine(
            settings.postgres_dsn,
            pool_size=20,
            max_overflow=10,
            pool_pre_ping=True,
            pool_recycle=300,
            echo=False,
        )
    return _pg_engine


def get_pg_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get or create PostgreSQL session factory."""
    global _pg_session_factory
    if _pg_session_factory is None:
        _pg_session_factory = async_sessionmaker(
            bind=get_pg_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _pg_session_factory


@asynccontextmanager
async def get_pg_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional async session scope."""
    factory = get_pg_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ═══════════════════════════════════════════════════════════════
# MongoDB (DocumentDB compatible)
# ═══════════════════════════════════════════════════════════════

_mongo_client: AsyncIOMotorClient | None = None


def get_mongo_client() -> AsyncIOMotorClient:
    """Get or create MongoDB client."""
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(settings.mongo_dsn)
    return _mongo_client


def get_mongo_db() -> AsyncIOMotorDatabase:
    """Get the main MongoDB database."""
    return get_mongo_client()[settings.mongo_db]


# ═══════════════════════════════════════════════════════════════
# Redis (ElastiCache compatible)
# ═══════════════════════════════════════════════════════════════

_redis_client: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    """Get or create Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    return _redis_client


# ═══════════════════════════════════════════════════════════════
# Idempotency (SQS message deduplication via Redis)
# ═══════════════════════════════════════════════════════════════

async def check_idempotency(message_id: str, ttl_seconds: int = 86400) -> bool:
    """
    Check if a message has already been processed.
    Returns True if this is a NEW message (not yet processed).
    Returns False if duplicate (already processed).
    Stores dedup ID in Redis with 24hr TTL.
    """
    r = get_redis()
    key = f"dedup:{message_id}"
    result = await r.set(key, "1", ex=ttl_seconds, nx=True)
    return result is not None


# ═══════════════════════════════════════════════════════════════
# Embedding Cache (Redis — to stay within 1000 units/month)
# ═══════════════════════════════════════════════════════════════

async def get_cached_embedding(text_hash: str) -> list[float] | None:
    """Retrieve cached embedding from Redis."""
    r = get_redis()
    cached = await r.get(f"embed:{text_hash}")
    if cached:
        return json.loads(cached)
    return None


async def cache_embedding(text_hash: str, embedding: list[float], ttl: int = 604800) -> None:
    """Cache embedding in Redis (7-day TTL by default)."""
    r = get_redis()
    await r.set(f"embed:{text_hash}", json.dumps(embedding), ex=ttl)


# ═══════════════════════════════════════════════════════════════
# Lifecycle
# ═══════════════════════════════════════════════════════════════

async def close_all_connections() -> None:
    """Close all database connections gracefully."""
    global _pg_engine, _mongo_client, _redis_client

    if _pg_engine:
        await _pg_engine.dispose()
        _pg_engine = None

    if _mongo_client:
        _mongo_client.close()
        _mongo_client = None

    if _redis_client:
        await _redis_client.close()
        _redis_client = None
