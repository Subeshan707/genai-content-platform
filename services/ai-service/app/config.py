"""
GenAI Content Platform — Application Configuration
All config from environment variables, no hardcoding.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ── AWS ─────────────────────────────────────────────────
    aws_region: str = Field("us-east-1", alias="AWS_REGION")
    aws_access_key_id: str = Field("", alias="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str = Field("", alias="AWS_SECRET_ACCESS_KEY")
    aws_session_token: str = Field("", alias="AWS_SESSION_TOKEN")

    # ── Bedrock Models ───────────────────────────────────────
    # AWS requires cross-region inference profile IDs (us.* prefix) for
    # Llama and Nova models. Direct model IDs are deprecated.
    bedrock_text_model_id: str = Field(
        "us.amazon.nova-micro-v1:0",
        alias="BEDROCK_TEXT_MODEL_ID"
    )
    bedrock_text_lite_model_id: str = Field(
        "us.amazon.nova-micro-v1:0",
        alias="BEDROCK_TEXT_LITE_MODEL_ID"
    )
    bedrock_embed_model_id: str = Field(
        "amazon.titan-embed-text-v2:0",
        alias="BEDROCK_EMBED_MODEL_ID"
    )
    bedrock_image_model_id: str = Field(
        "amazon.titan-image-generator-v2:0",
        alias="BEDROCK_IMAGE_MODEL_ID"
    )
    bedrock_image_region: str = Field(
        "us-west-2",
        alias="BEDROCK_IMAGE_REGION"
    )
    bedrock_guardrail_id: str = Field("", alias="BEDROCK_GUARDRAIL_ID")

    # ── PostgreSQL ──────────────────────────────────────────
    postgres_host: str = Field("localhost", alias="POSTGRES_HOST")
    postgres_port: int = Field(5432, alias="POSTGRES_PORT")
    postgres_db: str = Field("genai_platform", alias="POSTGRES_DB")
    postgres_user: str = Field("genai_admin", alias="POSTGRES_USER")
    postgres_password: str = Field("changeme_postgres_password", alias="POSTGRES_PASSWORD")

    @property
    def postgres_dsn(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def postgres_sync_dsn(self) -> str:
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    # ── MongoDB (DocumentDB) ───────────────────────────────
    mongo_host: str = Field("localhost", alias="MONGO_HOST")
    mongo_port: int = Field(27017, alias="MONGO_PORT")
    mongo_db: str = Field("genai_locales", alias="MONGO_DB")
    mongo_user: str = Field("genai_admin", alias="MONGO_USER")
    mongo_password: str = Field("changeme_mongo_password", alias="MONGO_PASSWORD")

    @property
    def mongo_dsn(self) -> str:
        return (
            f"mongodb://{self.mongo_user}:{self.mongo_password}"
            f"@{self.mongo_host}:{self.mongo_port}/{self.mongo_db}?authSource=admin"
        )

    # ── Redis ──────────────────────────────────────────────
    redis_host: str = Field("localhost", alias="REDIS_HOST")
    redis_port: int = Field(6379, alias="REDIS_PORT")
    redis_password: str = Field("changeme_redis_password", alias="REDIS_PASSWORD")

    @property
    def redis_url(self) -> str:
        return f"redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}/0"

    # ── SQS (LocalStack in dev) ────────────────────────────
    sqs_endpoint: str = Field("", alias="SQS_ENDPOINT")
    sqs_content_ingest_queue: str = Field("content-ingest.fifo", alias="SQS_CONTENT_INGEST_QUEUE")
    sqs_localize_queue: str = Field("localize.fifo", alias="SQS_LOCALIZE_QUEUE")
    sqs_image_generate_queue: str = Field("image-generate", alias="SQS_IMAGE_GENERATE_QUEUE")
    sqs_cms_publish_queue: str = Field("cms-publish.fifo", alias="SQS_CMS_PUBLISH_QUEUE")

    # ── S3 (LocalStack in dev) ─────────────────────────────
    s3_endpoint: str = Field("", alias="S3_ENDPOINT")
    s3_brand_docs_bucket: str = Field("genai-brand-docs", alias="S3_BRAND_DOCS_BUCKET")
    s3_media_assets_bucket: str = Field("genai-media-assets", alias="S3_MEDIA_ASSETS_BUCKET")
    s3_model_logs_bucket: str = Field("genai-model-logs", alias="S3_MODEL_LOGS_BUCKET")

    # ── WebSocket ──────────────────────────────────────────
    websocket_api_id: str = Field("", alias="WEBSOCKET_API_ID")
    websocket_api_stage: str = Field("prod", alias="WEBSOCKET_API_STAGE")
    websocket_endpoint: str = Field("ws://localhost:8000/ws", alias="WEBSOCKET_ENDPOINT")

    # ── Service ────────────────────────────────────────────
    ai_service_host: str = Field("0.0.0.0", alias="AI_SERVICE_HOST")
    ai_service_port: int = Field(8000, alias="AI_SERVICE_PORT")
    ai_service_log_level: str = Field("info", alias="AI_SERVICE_LOG_LEVEL")

    # ── Observability ──────────────────────────────────────
    enable_xray: bool = Field(True, alias="ENABLE_XRAY")
    xray_daemon_address: str = Field("xray:2000", alias="XRAY_DAEMON_ADDRESS")
    cloudwatch_namespace: str = Field("genai-content-platform", alias="CLOUDWATCH_NAMESPACE")

    model_config = {"env_file": ".env", "extra": "ignore"}


# Singleton settings instance
settings = Settings()
