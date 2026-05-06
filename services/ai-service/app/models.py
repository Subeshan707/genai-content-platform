"""
GenAI Content Creation Platform — AI Service
Pydantic v2 models for all request/response schemas.
"""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ═══════════════════════════════════════════════════════════════
# Enums
# ═══════════════════════════════════════════════════════════════

class ContentType(str, enum.Enum):
    ARTICLE = "article"
    SCRIPT = "script"
    SOCIAL = "social"
    EMAIL = "email"
    AD = "ad"


class ContentStatus(str, enum.Enum):
    DRAFT = "draft"
    GENERATING = "generating"
    REVIEW = "review"
    APPROVED = "approved"
    LOCALIZING = "localizing"
    LOCALIZED = "localized"
    PUBLISHING = "publishing"
    PUBLISHED = "published"


class LocaleStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    PUBLISHED = "published"


# ═══════════════════════════════════════════════════════════════
# Request Models
# ═══════════════════════════════════════════════════════════════

class GenerateRequest(BaseModel):
    """Request to generate content from a brief."""
    workspace_id: str = Field(..., description="UUID of the workspace")
    piece_id: str = Field(..., description="UUID of the content piece")
    brief: str = Field(..., min_length=10, max_length=10000, description="Content brief/prompt")
    content_type: ContentType = Field(..., description="Type of content to generate")
    tone: Optional[str] = Field(None, description="Optional tone override (e.g., formal, casual)")
    max_tokens: int = Field(2048, ge=100, le=4096, description="Max tokens for generation")
    temperature: float = Field(0.7, ge=0.0, le=1.0, description="Generation temperature")
    use_brand_voice: bool = Field(True, description="Whether to use RAG brand voice context")
    connection_id: Optional[str] = Field(None, description="WebSocket connection ID for streaming")


class IngestRequest(BaseModel):
    """Request to ingest a brand document into pgvector."""
    workspace_id: str = Field(..., description="UUID of the workspace")
    s3_key: str = Field(..., description="S3 key of the brand document")
    document_name: str = Field(..., description="Human-readable document name")
    chunk_size: int = Field(512, ge=100, le=2000, description="Chunk size in tokens")
    chunk_overlap: int = Field(50, ge=0, le=500, description="Overlap between chunks")


class LocalizeRequest(BaseModel):
    """Request to localize content into multiple locales."""
    workspace_id: str = Field(..., description="UUID of the workspace")
    piece_id: str = Field(..., description="UUID of the content piece")
    source_text: str = Field(..., min_length=1, description="Source text to translate")
    source_language: str = Field("en", description="Source language code")
    target_locales: list[str] = Field(
        ..., min_length=1, max_length=20,
        description="List of target locale codes (e.g., ['fr-FR', 'es-ES'])"
    )
    refine_with_llm: bool = Field(True, description="Whether to refine translations with LLM")

    @field_validator("target_locales")
    @classmethod
    def validate_locales(cls, v: list[str]) -> list[str]:
        """Ensure locale codes are valid BCP 47 format."""
        for locale in v:
            parts = locale.split("-")
            if len(parts) < 1 or len(parts[0]) < 2:
                raise ValueError(f"Invalid locale code: {locale}")
        return v


class TranscribeRequest(BaseModel):
    """Request to transcribe audio and generate subtitles."""
    workspace_id: str = Field(..., description="UUID of the workspace")
    piece_id: str = Field(..., description="UUID of the content piece")
    s3_uri: str = Field(..., description="S3 URI of the audio file")
    language_code: str = Field("en-US", description="Audio language code")
    generate_subtitles: bool = Field(True, description="Whether to generate SRT/VTT subtitles")


class ImageGenerateRequest(BaseModel):
    """Request to generate images for content."""
    workspace_id: str = Field(..., description="UUID of the workspace")
    piece_id: str = Field(..., description="UUID of the content piece")
    prompt: str = Field(..., min_length=3, max_length=2000, description="Image generation prompt")
    negative_prompt: Optional[str] = Field(None, description="Negative prompt for image generation")
    locale: Optional[str] = Field(None, description="Target locale for localized images")
    width: int = Field(1024, ge=256, le=2048, description="Image width")
    height: int = Field(1024, ge=256, le=2048, description="Image height")
    num_images: int = Field(1, ge=1, le=4, description="Number of images to generate")


# ═══════════════════════════════════════════════════════════════
# Response Models
# ═══════════════════════════════════════════════════════════════

class GenerateResponse(BaseModel):
    """Response from content generation."""
    piece_id: str
    version_id: str
    version_num: int
    body: str
    model_used: str
    tokens_used: int
    latency_ms: int
    brand_context_count: int = Field(0, description="Number of brand context chunks used")


class IngestResponse(BaseModel):
    """Response from brand document ingestion."""
    workspace_id: str
    document_name: str
    chunks_created: int
    embedding_model: str
    status: str = "completed"


class BrandDocumentSummaryResponse(BaseModel):
    """Summary entry for a workspace brand document."""
    document_name: str
    chunks: int
    status: str = "ingested"
    last_ingested_at: datetime | None = None


class BrandDocumentUploadResponse(BaseModel):
    """Response from direct brand document upload + ingestion."""
    workspace_id: str
    document_name: str
    chunks_created: int
    embedding_model: str
    s3_key: str | None = None
    status: str = "ingested"


class BrandDocumentDeleteResponse(BaseModel):
    """Response from deleting a brand document from vector store."""
    workspace_id: str
    document_name: str
    deleted_chunks: int
    status: str = "deleted"


class BrandWorkspaceResponse(BaseModel):
    """Workspace summary for Brand Voice workspace picker."""
    id: str
    name: str
    created_at: datetime | None = None


class LocaleVariantResponse(BaseModel):
    """Response for a single locale translation."""
    locale: str
    translated_body: str
    model_used: Optional[str] = None
    status: LocaleStatus = LocaleStatus.PENDING


class LocalizeResponse(BaseModel):
    """Response from parallel localization."""
    piece_id: str
    source_language: str
    variants: list[LocaleVariantResponse]
    total_locales: int
    completed_locales: int


class TranscribeResponse(BaseModel):
    """Response from audio transcription."""
    piece_id: str
    job_id: str
    status: str
    transcript: Optional[str] = None
    subtitle_srt: Optional[str] = None
    subtitle_vtt: Optional[str] = None


class ImageGenerateResponse(BaseModel):
    """Response from image generation."""
    piece_id: str
    message_id: Optional[str] = None
    queue_url: Optional[str] = None
    image_urls: Optional[list[str]] = None
    status: str = "queued"


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "healthy"
    service: str = "ai-service"
    version: str = "1.0.0"
    postgres: str = "unknown"
    redis: str = "unknown"
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ═══════════════════════════════════════════════════════════════
# WebSocket Models
# ═══════════════════════════════════════════════════════════════

class StreamToken(BaseModel):
    """A single streamed token from Bedrock."""
    type: str = "token"
    text: str
    piece_id: Optional[str] = None


class StreamComplete(BaseModel):
    """Signal that streaming is complete."""
    type: str = "complete"
    piece_id: str
    version_id: str
    total_tokens: int
    model_used: str


class StreamError(BaseModel):
    """Error during stream."""
    type: str = "error"
    message: str
    piece_id: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
# Audit / Metrics Models
# ═══════════════════════════════════════════════════════════════

class AuditEntry(BaseModel):
    """Audit log entry."""
    piece_id: Optional[str] = None
    action: str
    actor_id: str
    model_used: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class BedrockMetrics(BaseModel):
    """Metrics for a Bedrock invocation."""
    model_id: str
    tokens_input: int
    tokens_output: int
    latency_ms: int
    workspace_id: str
    content_type: Optional[str] = None
