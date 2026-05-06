"""
GenAI Content Creation Platform — FastAPI AI Service
Main application with all endpoints:
  POST /ingest          — ingest brand document into pgvector
  POST /generate        — trigger Strand scripting agent (streaming)
  POST /localize        — trigger parallel Strand localization agent
  POST /transcribe      — submit audio to Amazon Transcribe
  POST /image/generate  — queue image generation to SQS
  GET  /health          — health check
  WS   /ws/{conn_id}    — WebSocket for real-time streaming
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from typing import Any

import boto3
import structlog
from botocore.exceptions import ClientError
from fastapi import File, FastAPI, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from app.agents.orchestrator import generate_content, score_content
from app.bedrock_client import (
    converse,
    converse_stream,
    generate_image as bedrock_generate_image,
    prompt_hash,
)
from app.config import settings
from app.database import (
    close_all_connections,
    get_mongo_db,
    get_pg_session,
    get_redis,
)
from app.models import (
    BrandDocumentDeleteResponse,
    BrandDocumentSummaryResponse,
    BrandDocumentUploadResponse,
    BrandWorkspaceResponse,
    GenerateRequest,
    GenerateResponse,
    HealthResponse,
    ImageGenerateRequest,
    ImageGenerateResponse,
    IngestRequest,
    IngestResponse,
    LocaleVariantResponse,
    LocalizeRequest,
    LocalizeResponse,
    StreamComplete,
    StreamError,
    StreamToken,
    TranscribeRequest,
    TranscribeResponse,
)
from app.services.localization_service import localize_all, save_locale_variants
from app.services.image_worker import list_image_assets, run_image_worker
from app.services.rag_service import ingest_brand_document, retrieve_brand_context
from app.services.transcription_service import submit_transcription_job

logger = structlog.get_logger(__name__)

# ═══════════════════════════════════════════════════════════════
# WebSocket Connection Manager
# ═══════════════════════════════════════════════════════════════


class ConnectionManager:
    """Manages active WebSocket connections."""

    def __init__(self) -> None:
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, connection_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections[connection_id] = websocket
        logger.info("ws_connected", connection_id=connection_id)

    def disconnect(self, connection_id: str) -> None:
        self.active_connections.pop(connection_id, None)
        logger.info("ws_disconnected", connection_id=connection_id)

    async def send_token(self, connection_id: str, token: StreamToken) -> None:
        if ws := self.active_connections.get(connection_id):
            await ws.send_json(token.model_dump())

    async def send_complete(self, connection_id: str, complete: StreamComplete) -> None:
        if ws := self.active_connections.get(connection_id):
            await ws.send_json(complete.model_dump())

    async def send_error(self, connection_id: str, error: StreamError) -> None:
        if ws := self.active_connections.get(connection_id):
            await ws.send_json(error.model_dump())


ws_manager = ConnectionManager()
_image_worker_task: asyncio.Task[None] | None = None
_image_worker_stop_event: asyncio.Event | None = None

# ═══════════════════════════════════════════════════════════════
# Application Lifecycle
# ═══════════════════════════════════════════════════════════════


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    global _image_worker_task, _image_worker_stop_event

    logger.info("ai_service_starting", port=settings.ai_service_port)

    # Initialize X-Ray if enabled
    if settings.enable_xray:
        try:
            from aws_xray_sdk.core import xray_recorder, patch_all
            xray_recorder.configure(
                service="genai-ai-service",
                daemon_address=settings.xray_daemon_address,
            )
            patch_all()
            logger.info("xray_initialized")
        except Exception as e:
            logger.warning("xray_init_failed", error=str(e))

    # Start background SQS image worker so queued image jobs are actually processed.
    _image_worker_stop_event = asyncio.Event()
    _image_worker_task = asyncio.create_task(run_image_worker(_image_worker_stop_event))

    yield

    # Stop background workers
    if _image_worker_stop_event is not None:
        _image_worker_stop_event.set()
    if _image_worker_task is not None:
        _image_worker_task.cancel()
        with suppress(asyncio.CancelledError):
            await _image_worker_task

    # Cleanup
    await close_all_connections()
    logger.info("ai_service_stopped")


# ═══════════════════════════════════════════════════════════════
# FastAPI App
# ═══════════════════════════════════════════════════════════════

app = FastAPI(
    title="GenAI Content Platform — AI Service",
    description="AI-powered content creation, localization, and asset generation",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════
# Health Check
# ═══════════════════════════════════════════════════════════════


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check() -> HealthResponse:
    """Health check endpoint — verifies all dependencies."""
    pg_status = "unknown"
    redis_status = "unknown"

    # Check PostgreSQL
    try:
        async with get_pg_session() as session:
            await session.execute(text("SELECT 1"))
        pg_status = "healthy"
    except Exception as e:
        pg_status = f"unhealthy: {str(e)[:100]}"

    # Check Redis
    try:
        redis = get_redis()
        await redis.ping()
        redis_status = "healthy"
    except Exception as e:
        redis_status = f"unhealthy: {str(e)[:100]}"

    return HealthResponse(
        status="healthy" if pg_status == "healthy" and redis_status == "healthy" else "degraded",
        service="ai-service",
        version="1.0.0",
        postgres=pg_status,
        redis=redis_status,
        timestamp=datetime.now(timezone.utc),
    )


# ═══════════════════════════════════════════════════════════════
# POST /generate — Content Generation with Streaming
# ═══════════════════════════════════════════════════════════════


@app.post("/generate", response_model=GenerateResponse, tags=["Generation"])
async def generate(request: GenerateRequest) -> GenerateResponse:
    """
    Generate content using Strand scripting agent with brand RAG context.

    Workflow:
    1. Retrieve brand voice context from pgvector (if enabled)
    2. Call scripting agent via Strand orchestrator
    3. Score content quality with review agent
    4. Store content version in PostgreSQL
    5. Stream tokens via WebSocket (if connection_id provided)
    6. Return generated content + metadata
    """
    start_time = time.time()

    # Step 1: Retrieve brand context via RAG
    brand_context = ""
    brand_chunk_count = 0
    if request.use_brand_voice:
        try:
            brand_context = await retrieve_brand_context(
                workspace_id=request.workspace_id,
                query_text=request.brief,
                top_k=5,
            )
            brand_chunk_count = len(brand_context.split("---")) if brand_context else 0
        except Exception as e:
            logger.warning("brand_rag_fallback", error=str(e))

    # Step 2: Generate content
    if request.connection_id:
        # Streaming mode via WebSocket
        generated_text, tokens_used, model_used = await _generate_streaming(
            request, brand_context
        )
    else:
        # Non-streaming mode
        result = await generate_content(
            brief=request.brief,
            content_type=request.content_type.value,
            brand_context=brand_context,
            user_id=request.workspace_id,
            session_id=str(uuid.uuid4()),
            tone=request.tone,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
        )
        generated_text = result["text"]
        tokens_used = 0  # Strand doesn't expose token count directly
        model_used = result["model_id"]

    latency_ms = int((time.time() - start_time) * 1000)

    # Step 3: Store content version
    version_id = str(uuid.uuid4())
    version_num = 1

    try:
        async with get_pg_session() as session:
            # Get current max version
            max_ver = await session.execute(
                text("SELECT COALESCE(MAX(version_num), 0) FROM content_versions WHERE piece_id = :pid"),
                {"pid": request.piece_id},
            )
            version_num = max_ver.scalar() + 1

            # Insert new version
            await session.execute(
                text("""
                    INSERT INTO content_versions (id, piece_id, version_num, body, model_used, prompt_hash, tokens_used, latency_ms)
                    VALUES (:id, :piece_id, :version_num, :body, :model_used, :prompt_hash, :tokens_used, :latency_ms)
                """),
                {
                    "id": version_id,
                    "piece_id": request.piece_id,
                    "version_num": version_num,
                    "body": generated_text,
                    "model_used": model_used,
                    "prompt_hash": prompt_hash(request.brief, brand_context[:500], model_used),
                    "tokens_used": tokens_used,
                    "latency_ms": latency_ms,
                },
            )

            # Update content piece status
            await session.execute(
                text("UPDATE content_pieces SET status = 'review', updated_at = NOW() WHERE id = :pid"),
                {"pid": request.piece_id},
            )

            # Audit log
            await session.execute(
                text("""
                    INSERT INTO audit_log (piece_id, action, actor_id, model_used, metadata)
                    VALUES (:piece_id, 'content_generated', :actor_id, :model_used, :metadata)
                """),
                {
                    "piece_id": request.piece_id,
                    "actor_id": request.workspace_id,
                    "model_used": model_used,
                    "metadata": json.dumps({
                        "version_num": version_num,
                        "content_type": request.content_type.value,
                        "tokens_used": tokens_used,
                        "latency_ms": latency_ms,
                        "brand_chunks_used": brand_chunk_count,
                    }),
                },
            )
    except Exception as e:
        logger.error("version_store_error", error=str(e))

    logger.info(
        "content_generated_complete",
        piece_id=request.piece_id,
        model_used=model_used,
        tokens_used=tokens_used,
        latency_ms=latency_ms,
    )

    return GenerateResponse(
        piece_id=request.piece_id,
        version_id=version_id,
        version_num=version_num,
        body=generated_text,
        model_used=model_used,
        tokens_used=tokens_used,
        latency_ms=latency_ms,
        brand_context_count=brand_chunk_count,
    )


async def _generate_streaming(
    request: GenerateRequest,
    brand_context: str,
) -> tuple[str, int, str]:
    """Generate content with streaming tokens via WebSocket."""
    from app.agents.orchestrator import (
        SCRIPTING_SYSTEM_PROMPT,
        get_format_rules,
        get_output_template,
    )

    system_prompt = SCRIPTING_SYSTEM_PROMPT.format(
        brand_context=brand_context or "No brand context available.",
        content_type=request.content_type.value,
        format_rules=get_format_rules(request.content_type.value),
        output_template=get_output_template(request.content_type.value),
    )

    full_brief = (
        f"Create a {request.content_type.value} based on this brief and follow the exact structure requirements.\n\n"
        f"{request.brief}\n\n"
        "Important: Keep the content comprehensive and detailed. Do not reduce it to a short summary."
    )

    # Use Bedrock Converse Stream API directly for token streaming
    stream_result = converse_stream(
        prompt=full_brief,
        system_prompt=system_prompt,
        model_id=settings.bedrock_text_model_id,
        max_tokens=request.max_tokens,
        temperature=request.temperature,
    )

    generated_text = ""
    total_tokens = 0
    model_used = stream_result["model_id"]

    try:
        for event in stream_result["stream"]:
            if "contentBlockDelta" in event:
                token_text = event["contentBlockDelta"]["delta"]["text"]
                generated_text += token_text

                # Send token via WebSocket
                await ws_manager.send_token(
                    request.connection_id,
                    StreamToken(text=token_text, piece_id=request.piece_id),
                )

            elif "metadata" in event:
                usage = event["metadata"].get("usage", {})
                total_tokens = usage.get("outputTokens", 0)

        # Send completion signal
        await ws_manager.send_complete(
            request.connection_id,
            StreamComplete(
                piece_id=request.piece_id,
                version_id=str(uuid.uuid4()),
                total_tokens=total_tokens,
                model_used=model_used,
            ),
        )
    except Exception as e:
        await ws_manager.send_error(
            request.connection_id,
            StreamError(message=str(e), piece_id=request.piece_id),
        )
        raise

    return generated_text, total_tokens, model_used


# ═══════════════════════════════════════════════════════════════
# POST /ingest — Brand Document Ingestion
# ═══════════════════════════════════════════════════════════════


def _build_s3_client() -> Any:
    """Create an S3 client honoring environment overrides (AWS/LocalStack)."""
    s3_kwargs: dict[str, Any] = {"region_name": settings.aws_region}
    if settings.s3_endpoint:
        s3_kwargs["endpoint_url"] = settings.s3_endpoint
    if settings.aws_access_key_id:
        s3_kwargs["aws_access_key_id"] = settings.aws_access_key_id
        s3_kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        if settings.aws_session_token:
            s3_kwargs["aws_session_token"] = settings.aws_session_token
    return boto3.client("s3", **s3_kwargs)


def _validate_workspace_id(workspace_id: str) -> str:
    """Validate workspace UUID format for brand endpoints."""
    try:
        uuid.UUID(workspace_id)
    except Exception:
        raise HTTPException(status_code=422, detail="workspace_id must be a valid UUID")
    return workspace_id


@app.get(
    "/brand/workspaces",
    response_model=list[BrandWorkspaceResponse],
    tags=["Brand RAG"],
)
async def list_brand_workspaces() -> list[BrandWorkspaceResponse]:
    """List workspaces available for Brand Voice ingestion."""
    async with get_pg_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, name, created_at
                FROM workspaces
                ORDER BY created_at DESC
                LIMIT 100
                """
            )
        )
        rows = result.fetchall()

    return [
        BrandWorkspaceResponse(
            id=str(row.id),
            name=row.name,
            created_at=row.created_at,
        )
        for row in rows
    ]


@app.get(
    "/brand/documents/{workspace_id}",
    response_model=list[BrandDocumentSummaryResponse],
    tags=["Brand RAG"],
)
async def list_brand_documents(workspace_id: str) -> list[BrandDocumentSummaryResponse]:
    """List ingested brand documents for a workspace with chunk counts."""
    workspace_id = _validate_workspace_id(workspace_id)

    async with get_pg_session() as session:
        result = await session.execute(
            text(
                """
                SELECT source_doc,
                       COUNT(*) AS chunks,
                       MAX(created_at) AS last_ingested_at
                FROM brand_embeddings
                WHERE workspace_id = :workspace_id
                GROUP BY source_doc
                ORDER BY MAX(created_at) DESC
                """
            ),
            {"workspace_id": workspace_id},
        )
        rows = result.fetchall()

    docs: list[BrandDocumentSummaryResponse] = []
    for row in rows:
        docs.append(
            BrandDocumentSummaryResponse(
                document_name=row.source_doc or "untitled",
                chunks=int(row.chunks or 0),
                last_ingested_at=row.last_ingested_at,
            )
        )
    return docs


@app.post(
    "/brand/documents/upload",
    response_model=BrandDocumentUploadResponse,
    tags=["Brand RAG"],
)
async def upload_brand_document(
    workspace_id: str = Form(...),
    file: UploadFile = File(...),
    chunk_size: int = Form(512),
    chunk_overlap: int = Form(50),
) -> BrandDocumentUploadResponse:
    """Upload a brand document, ingest to pgvector, and optionally archive to S3."""
    workspace_id = _validate_workspace_id(workspace_id)

    filename = (file.filename or "document.txt").strip()
    allowed_ext = {".txt", ".md", ".pdf", ".docx"}
    filename_lower = filename.lower()
    if not any(filename_lower.endswith(ext) for ext in allowed_ext):
        raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF, DOCX, TXT, or MD")

    if chunk_size < 100 or chunk_size > 2000:
        raise HTTPException(status_code=400, detail="chunk_size must be between 100 and 2000")
    if chunk_overlap < 0 or chunk_overlap > 500:
        raise HTTPException(status_code=400, detail="chunk_overlap must be between 0 and 500")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    if len(file_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is too large. Max size is 25 MB")

    async with get_pg_session() as session:
        workspace_exists = await session.execute(
            text("SELECT 1 FROM workspaces WHERE id = :workspace_id LIMIT 1"),
            {"workspace_id": workspace_id},
        )
        if workspace_exists.scalar() is None:
            raise HTTPException(status_code=404, detail="Workspace not found")

    document_text = _extract_text(filename, file_bytes)
    if not document_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from document")

    s3_key: str | None = None
    try:
        safe_name = filename.replace(" ", "_")
        s3_key = f"brand/{workspace_id}/{uuid.uuid4()}-{safe_name}"
        _build_s3_client().put_object(
            Bucket=settings.s3_brand_docs_bucket,
            Key=s3_key,
            Body=file_bytes,
            ContentType=file.content_type or "application/octet-stream",
        )
    except Exception as e:
        logger.warning("brand_doc_archive_failed", workspace_id=workspace_id, file=filename, error=str(e))
        s3_key = None

    async with get_pg_session() as session:
        await session.execute(
            text(
                """
                DELETE FROM brand_embeddings
                WHERE workspace_id = :workspace_id
                  AND source_doc = :source_doc
                """
            ),
            {"workspace_id": workspace_id, "source_doc": filename},
        )

    chunks_created = await ingest_brand_document(
        workspace_id=workspace_id,
        document_text=document_text,
        source_doc=filename,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    if chunks_created == 0:
        raise HTTPException(
            status_code=400,
            detail="No chunks were ingested from this file. Verify workspace and document content.",
        )

    return BrandDocumentUploadResponse(
        workspace_id=workspace_id,
        document_name=filename,
        chunks_created=chunks_created,
        embedding_model=settings.bedrock_embed_model_id,
        s3_key=s3_key,
    )


@app.delete(
    "/brand/documents/{workspace_id}",
    response_model=BrandDocumentDeleteResponse,
    tags=["Brand RAG"],
)
async def delete_brand_document(
    workspace_id: str,
    document_name: str = Query(..., min_length=1),
) -> BrandDocumentDeleteResponse:
    """Delete all chunk embeddings for a brand document in a workspace."""
    workspace_id = _validate_workspace_id(workspace_id)

    async with get_pg_session() as session:
        count_result = await session.execute(
            text(
                """
                SELECT COUNT(*) AS chunks
                FROM brand_embeddings
                WHERE workspace_id = :workspace_id
                  AND source_doc = :source_doc
                """
            ),
            {"workspace_id": workspace_id, "source_doc": document_name},
        )
        row = count_result.fetchone()
        chunks = int(row.chunks or 0) if row else 0
        if chunks == 0:
            raise HTTPException(status_code=404, detail="Document not found")

        await session.execute(
            text(
                """
                DELETE FROM brand_embeddings
                WHERE workspace_id = :workspace_id
                  AND source_doc = :source_doc
                """
            ),
            {"workspace_id": workspace_id, "source_doc": document_name},
        )

    return BrandDocumentDeleteResponse(
        workspace_id=workspace_id,
        document_name=document_name,
        deleted_chunks=chunks,
    )


@app.post("/ingest", response_model=IngestResponse, tags=["Brand RAG"])
async def ingest(request: IngestRequest) -> IngestResponse:
    """
    Ingest a brand document from S3 into pgvector for RAG.

    1. Download document from S3
    2. Extract text (PDF/DOCX/TXT)
    3. Split into chunks
    4. Compute embeddings (Titan Embed V2 — cached)
    5. Store in brand_embeddings table
    """
    # Download from S3
    try:
        s3 = _build_s3_client()
        obj = s3.get_object(Bucket=settings.s3_brand_docs_bucket, Key=request.s3_key)
        file_bytes = obj["Body"].read()
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Document not found in S3: {e}")

    # Extract text based on file type
    document_text = _extract_text(request.s3_key, file_bytes)

    if not document_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from document")

    # Ingest into pgvector
    chunks_created = await ingest_brand_document(
        workspace_id=request.workspace_id,
        document_text=document_text,
        source_doc=request.document_name,
        chunk_size=request.chunk_size,
        chunk_overlap=request.chunk_overlap,
    )

    return IngestResponse(
        workspace_id=request.workspace_id,
        document_name=request.document_name,
        chunks_created=chunks_created,
        embedding_model=settings.bedrock_embed_model_id,
    )


def _extract_text(key: str, file_bytes: bytes) -> str:
    """Extract text from document based on file extension."""
    key_lower = key.lower()

    if key_lower.endswith(".txt") or key_lower.endswith(".md"):
        return file_bytes.decode("utf-8", errors="replace")

    elif key_lower.endswith(".pdf"):
        from pypdf import PdfReader
        import io
        reader = PdfReader(io.BytesIO(file_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    elif key_lower.endswith(".docx"):
        from docx import Document
        import io
        doc = Document(io.BytesIO(file_bytes))
        return "\n".join(para.text for para in doc.paragraphs)

    else:
        # Try as plain text
        return file_bytes.decode("utf-8", errors="replace")


# ═══════════════════════════════════════════════════════════════
# POST /localize — Parallel Localization
# ═══════════════════════════════════════════════════════════════


@app.post("/localize", response_model=LocalizeResponse, tags=["Localization"])
async def localize(request: LocalizeRequest) -> LocalizeResponse:
    """
    Localize content into multiple locales in parallel.

    1. Fan out to Amazon Translate for each locale
    2. Refine each translation with LLM (optional)
    3. Store locale variants in MongoDB (DocumentDB)
    """
    # Run parallel localization
    variants = await localize_all(
        text=request.source_text,
        locales=request.target_locales,
        source=request.source_language,
        refine_with_llm=request.refine_with_llm,
    )

    # Save to MongoDB
    await save_locale_variants(
        piece_id=request.piece_id,
        source_language=request.source_language,
        variants=variants,
    )

    # Update content piece status
    try:
        async with get_pg_session() as session:
            await session.execute(
                text("UPDATE content_pieces SET status = 'localized', updated_at = NOW() WHERE id = :pid"),
                {"pid": request.piece_id},
            )
            await session.execute(
                text("""
                    INSERT INTO audit_log (piece_id, action, actor_id, model_used, metadata)
                    VALUES (:piece_id, 'content_localized', :actor_id, :model_used, :metadata)
                """),
                {
                    "piece_id": request.piece_id,
                    "actor_id": request.workspace_id,
                    "model_used": settings.bedrock_text_lite_model_id,
                    "metadata": json.dumps({
                        "locales": request.target_locales,
                        "source_language": request.source_language,
                        "refined": request.refine_with_llm,
                    }),
                },
            )
    except Exception as e:
        logger.error("localize_status_update_error", error=str(e))

    # Build response
    variant_responses = [
        LocaleVariantResponse(
            locale=v["locale"],
            translated_body=v["translated_body"],
            model_used=v.get("model_used"),
        )
        for v in variants
        if v.get("status") != "failed"
    ]

    return LocalizeResponse(
        piece_id=request.piece_id,
        source_language=request.source_language,
        variants=variant_responses,
        total_locales=len(request.target_locales),
        completed_locales=len(variant_responses),
    )


# ═══════════════════════════════════════════════════════════════
# POST /transcribe — Audio Transcription
# ═══════════════════════════════════════════════════════════════


@app.post("/transcribe", response_model=TranscribeResponse, tags=["Transcription"])
async def transcribe(request: TranscribeRequest) -> TranscribeResponse:
    """
    Submit audio file for transcription via Amazon Transcribe.
    FREE TIER: 60 min/month for 12 months.
    Generates SRT + VTT subtitles automatically.
    """
    result = await submit_transcription_job(
        s3_uri=request.s3_uri,
        language_code=request.language_code,
        generate_subtitles=request.generate_subtitles,
        workspace_id=request.workspace_id,
        piece_id=request.piece_id,
    )

    # Audit log
    try:
        async with get_pg_session() as session:
            await session.execute(
                text("""
                    INSERT INTO audit_log (piece_id, action, actor_id, metadata)
                    VALUES (:piece_id, 'transcription_submitted', :actor_id, :metadata)
                """),
                {
                    "piece_id": request.piece_id,
                    "actor_id": request.workspace_id,
                    "metadata": json.dumps({
                        "job_id": result["job_id"],
                        "language": request.language_code,
                        "s3_uri": request.s3_uri,
                    }),
                },
            )
    except Exception as e:
        logger.error("transcribe_audit_error", error=str(e))

    return TranscribeResponse(
        piece_id=request.piece_id,
        job_id=result["job_id"],
        status=result["status"],
    )


# ═══════════════════════════════════════════════════════════════
# POST /image/generate — Queue Image Generation
# ═══════════════════════════════════════════════════════════════


@app.post("/image/generate", response_model=ImageGenerateResponse, tags=["Image Generation"])
async def image_generate(request: ImageGenerateRequest) -> ImageGenerateResponse:
    """
    Queue image generation to SQS Standard queue.
    Images are generated by Amazon Titan Image Generator (500/month free).
    """
    # Try immediate generation for local/dev UX. Fallback to queue on any error.
    try:
        images = bedrock_generate_image(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt or "",
            width=request.width,
            height=request.height,
            num_images=request.num_images,
        )
        if images:
            image_urls = [f"data:image/png;base64,{img}" for img in images]
            logger.info(
                "image_generation_completed_sync",
                piece_id=request.piece_id,
                count=len(image_urls),
            )
            return ImageGenerateResponse(
                piece_id=request.piece_id,
                status="generated",
                image_urls=image_urls,
            )
    except Exception as e:
        logger.warning("image_generation_sync_fallback_to_queue", error=str(e))

    # Send to SQS Standard queue for async processing
    sqs_kwargs: dict[str, Any] = {"region_name": settings.aws_region}
    if settings.sqs_endpoint:
        sqs_kwargs["endpoint_url"] = settings.sqs_endpoint
    if settings.aws_access_key_id:
        sqs_kwargs["aws_access_key_id"] = settings.aws_access_key_id
        sqs_kwargs["aws_secret_access_key"] = settings.aws_secret_access_key

    sqs = boto3.client("sqs", **sqs_kwargs)

    message_body = {
        "workspace_id": request.workspace_id,
        "piece_id": request.piece_id,
        "prompt": request.prompt,
        "negative_prompt": request.negative_prompt or "",
        "locale": request.locale,
        "width": request.width,
        "height": request.height,
        "num_images": request.num_images,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Resolve queue URL. In deployed environments, queue names are often prefixed with project name.
    queue_candidates = [settings.sqs_image_generate_queue]
    if not settings.sqs_image_generate_queue.startswith("genai-platform-"):
        queue_candidates.append(f"genai-platform-{settings.sqs_image_generate_queue}")

    queue_url = ""
    selected_queue = settings.sqs_image_generate_queue
    last_error: Exception | None = None

    for queue_name in queue_candidates:
        try:
            queue_url_response = sqs.get_queue_url(QueueName=queue_name)
            queue_url = queue_url_response["QueueUrl"]
            selected_queue = queue_name
            break
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in {"AWS.SimpleQueueService.NonExistentQueue", "QueueDoesNotExist"}:
                last_error = e
                continue
            raise

    # Auto-create only for local/dev resiliency if none of the candidate queue names exist.
    if not queue_url:
        try:
            create_attrs: dict[str, str] = {}
            if settings.sqs_image_generate_queue.endswith(".fifo"):
                create_attrs["FifoQueue"] = "true"
                create_attrs["ContentBasedDeduplication"] = "true"

            sqs.create_queue(
                QueueName=settings.sqs_image_generate_queue,
                Attributes=create_attrs,
            )
            logger.warning(
                "image_queue_auto_created",
                queue=settings.sqs_image_generate_queue,
                reason="queue_missing",
            )
            queue_url_response = sqs.get_queue_url(QueueName=settings.sqs_image_generate_queue)
            queue_url = queue_url_response["QueueUrl"]
            selected_queue = settings.sqs_image_generate_queue
        except ClientError as create_err:
            logger.error(
                "image_queue_unavailable",
                configured_queue=settings.sqs_image_generate_queue,
                tried_queues=queue_candidates,
                lookup_error=str(last_error) if last_error else "",
                create_error=str(create_err),
            )
            raise HTTPException(
                status_code=503,
                detail="Image queue is unavailable. Contact support to configure SQS queue access.",
            )

    # Send message
    response = sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(message_body),
    )

    message_id = response["MessageId"]

    logger.info(
        "image_generation_queued",
        piece_id=request.piece_id,
        message_id=message_id,
        queue=selected_queue,
    )

    return ImageGenerateResponse(
        piece_id=request.piece_id,
        message_id=message_id,
        queue_url=queue_url,
        status="queued",
    )


@app.get("/image/{piece_id}", tags=["Image Generation"])
async def get_image_assets(piece_id: str) -> list[dict[str, Any]]:
    """List image assets (completed/failed) for a content piece."""
    return await list_image_assets(piece_id)


# ═══════════════════════════════════════════════════════════════
# WebSocket — Real-time Token Streaming
# ═══════════════════════════════════════════════════════════════


@app.websocket("/ws/{connection_id}")
async def websocket_endpoint(websocket: WebSocket, connection_id: str) -> None:
    """
    WebSocket endpoint for real-time token streaming.
    Frontend connects on /editor/:id mount, receives streaming tokens.
    Auto-reconnects on disconnect.
    """
    await ws_manager.connect(connection_id, websocket)
    try:
        while True:
            # Keep connection alive, receive any client messages
            data = await websocket.receive_text()
            # Handle ping/pong for keepalive
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(connection_id)
    except Exception as e:
        logger.error("ws_error", connection_id=connection_id, error=str(e))
        ws_manager.disconnect(connection_id)


# ═══════════════════════════════════════════════════════════════
# Utility Endpoints
# ═══════════════════════════════════════════════════════════════


@app.get("/locales/{piece_id}", tags=["Localization"])
async def get_locale_variants(piece_id: str) -> list[dict[str, Any]]:
    """Get all locale variants for a content piece from MongoDB."""
    db = get_mongo_db()
    cursor = db.locale_variants.find(
        {"master_id": piece_id},
        {"_id": 0},
    )
    variants = await cursor.to_list(length=50)
    # Convert datetime objects for JSON serialization
    for v in variants:
        for key in ("created_at", "updated_at", "published_at"):
            if key in v and v[key]:
                v[key] = v[key].isoformat()
    return variants


@app.get("/versions/{piece_id}", tags=["Generation"])
async def get_content_versions(piece_id: str) -> list[dict[str, Any]]:
    """Get all content versions for a piece."""
    async with get_pg_session() as session:
        result = await session.execute(
            text("""
                SELECT id, piece_id, version_num, body, model_used,
                       prompt_hash, tokens_used, latency_ms, created_at
                FROM content_versions
                WHERE piece_id = :piece_id
                ORDER BY version_num DESC
            """),
            {"piece_id": piece_id},
        )
        rows = result.fetchall()

    return [
        {
            "id": str(row.id),
            "piece_id": str(row.piece_id),
            "version_num": row.version_num,
            "body": row.body,
            "model_used": row.model_used,
            "prompt_hash": row.prompt_hash,
            "tokens_used": row.tokens_used,
            "latency_ms": row.latency_ms,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]
