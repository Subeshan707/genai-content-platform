"""
GenAI Content Platform — AWS Bedrock Client
ALWAYS uses Converse API — never InvokeModel directly.
All models are from the AWS free tier / Bedrock trial.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any, AsyncGenerator

import boto3
import structlog

from app.config import settings

logger = structlog.get_logger(__name__)

PREFERRED_TEXT_FALLBACK_MODELS = [
    "us.amazon.nova-micro-v1:0",
    "us.amazon.nova-lite-v1:0",
]

PREFERRED_IMAGE_FALLBACK_MODELS = [
    "stability.stable-image-core-v1:1",
    "stability.stable-image-ultra-v1:1",
    "amazon.titan-image-generator-v2:0",
]


def _should_try_model_fallback(error_text: str) -> bool:
    text = error_text.lower()
    triggers = [
        "on-demand throughput",
        "inference profile",
        "end of its life",
        "resourcenotfoundexception",
        "accessdeniedexception",
        "not authorized to perform",
    ]
    return any(trigger in text for trigger in triggers)


def _get_fallback_candidates(primary_model: str) -> list[str]:
    candidates: list[str] = []
    for model in [settings.bedrock_text_lite_model_id, *PREFERRED_TEXT_FALLBACK_MODELS]:
        if model and model != primary_model and model not in candidates:
            candidates.append(model)
    return candidates


def _should_try_image_model_fallback(error_text: str) -> bool:
    text = error_text.lower()
    triggers = [
        "end of its life",
        "resourcenotfoundexception",
        "validationexception",
        "accessdeniedexception",
        "not authorized to perform",
    ]
    return any(trigger in text for trigger in triggers)


def _get_image_fallback_candidates(primary_model: str) -> list[str]:
    candidates: list[str] = []
    for model in [*PREFERRED_IMAGE_FALLBACK_MODELS]:
        if model and model != primary_model and model not in candidates:
            candidates.append(model)
    return candidates

# ═══════════════════════════════════════════════════════════════
# Bedrock Client Singleton
# ═══════════════════════════════════════════════════════════════


def _build_bedrock_kwargs(region_name: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"region_name": region_name}
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        if settings.aws_session_token:
            kwargs["aws_session_token"] = settings.aws_session_token
    return kwargs


def _create_bedrock_client() -> Any:
    """Create Bedrock Runtime client for text/embed models."""
    kwargs = _build_bedrock_kwargs(settings.aws_region)
    return boto3.client("bedrock-runtime", **kwargs)


def _create_bedrock_image_client() -> Any:
    """Create Bedrock Runtime client for image models (often region-specific)."""
    kwargs = _build_bedrock_kwargs(settings.bedrock_image_region)
    return boto3.client("bedrock-runtime", **kwargs)


_bedrock_client: Any = None
_bedrock_image_client: Any = None


def get_bedrock_client() -> Any:
    """Get or create Bedrock Runtime client."""
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = _create_bedrock_client()
    return _bedrock_client


def get_bedrock_image_client() -> Any:
    """Get or create Bedrock Runtime client for image models."""
    global _bedrock_image_client
    if _bedrock_image_client is None:
        _bedrock_image_client = _create_bedrock_image_client()
    return _bedrock_image_client


# ═══════════════════════════════════════════════════════════════
# Converse API — Text Generation (Synchronous)
# ═══════════════════════════════════════════════════════════════


def converse(
    prompt: str,
    system_prompt: str = "",
    model_id: str | None = None,
    max_tokens: int = 2048,
    temperature: float = 0.7,
) -> dict[str, Any]:
    """
    Call Bedrock Converse API for text generation.
    ALWAYS use Converse API — never InvokeModel.
    
    Returns dict with keys: text, model_id, tokens_input, tokens_output, latency_ms
    """
    client = get_bedrock_client()
    model = model_id or settings.bedrock_text_model_id  # FREE TIER default

    messages = [{"role": "user", "content": [{"text": prompt}]}]
    system = [{"text": system_prompt}] if system_prompt else []

    inference_config = {
        "maxTokens": max_tokens,
        "temperature": temperature,
    }

    start_time = time.time()

    try:
        response = client.converse(
            modelId=model,
            messages=messages,
            system=system,
            inferenceConfig=inference_config,
        )

    except Exception as e:
        err = str(e)
        if _should_try_model_fallback(err):
            fallback_error = None
            for fallback_model in _get_fallback_candidates(model):
                try:
                    logger.warning(
                        "bedrock_model_fallback",
                        from_model=model,
                        to_model=fallback_model,
                        reason="primary_model_unavailable_or_denied",
                    )
                    response = client.converse(
                        modelId=fallback_model,
                        messages=messages,
                        system=system,
                        inferenceConfig=inference_config,
                    )
                    model = fallback_model
                    fallback_error = None
                    break
                except Exception as inner_e:
                    fallback_error = str(inner_e)

            if fallback_error:
                latency_ms = int((time.time() - start_time) * 1000)
                logger.error(
                    "bedrock_converse_error",
                    model_id=model,
                    error=err,
                    fallback_error=fallback_error,
                    latency_ms=latency_ms,
                )
                raise
        else:
            latency_ms = int((time.time() - start_time) * 1000)
            logger.error("bedrock_converse_error", model_id=model, error=err, latency_ms=latency_ms)
            raise

        latency_ms = int((time.time() - start_time) * 1000)
        output_text = response["output"]["message"]["content"][0]["text"]
        usage = response.get("usage", {})

        result = {
            "text": output_text,
            "model_id": model,
            "tokens_input": usage.get("inputTokens", 0),
            "tokens_output": usage.get("outputTokens", 0),
            "latency_ms": latency_ms,
        }

        # Log every Bedrock call for cost attribution
        logger.info(
            "bedrock_converse",
            model_id=model,
            tokens_input=result["tokens_input"],
            tokens_output=result["tokens_output"],
            latency_ms=latency_ms,
        )

        return result


# ═══════════════════════════════════════════════════════════════
# Converse API — Streaming Text Generation
# ═══════════════════════════════════════════════════════════════


def converse_stream(
    prompt: str,
    system_prompt: str = "",
    model_id: str | None = None,
    max_tokens: int = 2048,
    temperature: float = 0.7,
) -> dict[str, Any]:
    """
    Call Bedrock Converse API with streaming enabled.
    Returns the raw stream response for token-by-token processing.
    """
    client = get_bedrock_client()
    model = model_id or settings.bedrock_text_model_id  # FREE TIER

    messages = [{"role": "user", "content": [{"text": prompt}]}]
    system = [{"text": system_prompt}] if system_prompt else []

    inference_config = {
        "maxTokens": max_tokens,
        "temperature": temperature,
    }

    try:
        response = client.converse_stream(
            modelId=model,
            messages=messages,
            system=system,
            inferenceConfig=inference_config,
        )
    except Exception as e:
        err = str(e)
        if _should_try_model_fallback(err):
            fallback_error = None
            for fallback_model in _get_fallback_candidates(model):
                try:
                    logger.warning(
                        "bedrock_stream_model_fallback",
                        from_model=model,
                        to_model=fallback_model,
                        reason="primary_model_unavailable_or_denied",
                    )
                    response = client.converse_stream(
                        modelId=fallback_model,
                        messages=messages,
                        system=system,
                        inferenceConfig=inference_config,
                    )
                    model = fallback_model
                    fallback_error = None
                    break
                except Exception as inner_e:
                    fallback_error = str(inner_e)

            if fallback_error:
                logger.error(
                    "bedrock_converse_stream_error",
                    model_id=model,
                    error=err,
                    fallback_error=fallback_error,
                )
                raise
        else:
            logger.error("bedrock_converse_stream_error", model_id=model, error=err)
            raise

    logger.info("bedrock_converse_stream_started", model_id=model)
    return {"stream": response["stream"], "model_id": model}


# ═══════════════════════════════════════════════════════════════
# Embedding — Titan Embed V2 (FREE TIER: 1000 units/month)
# Cache aggressively to stay within limits!
# ═══════════════════════════════════════════════════════════════


def compute_embedding(text: str, dimensions: int = 1024) -> list[float]:
    """
    Compute text embedding using Amazon Titan Embed V2.
    FREE TIER: 1,000 units/month — cache aggressively!
    """
    client = get_bedrock_client()
    model = settings.bedrock_embed_model_id

    start_time = time.time()

    response = client.invoke_model(
        modelId=model,
        body=json.dumps({
            "inputText": text,
            "dimensions": dimensions,
        }),
    )

    latency_ms = int((time.time() - start_time) * 1000)
    result = json.loads(response["body"].read())
    embedding = result["embedding"]

    logger.info(
        "bedrock_embedding",
        model_id=model,
        text_length=len(text),
        dimensions=dimensions,
        latency_ms=latency_ms,
    )

    return embedding


def text_hash(text: str) -> str:
    """Generate a hash for embedding cache key."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]


# ═══════════════════════════════════════════════════════════════
# Image Generation — Titan Image Generator (500 images/month)
# ═══════════════════════════════════════════════════════════════


def generate_image(
    prompt: str,
    negative_prompt: str = "",
    width: int = 1024,
    height: int = 1024,
    num_images: int = 1,
) -> list[str]:
    """
    Generate images using Bedrock image models (Titan / Stability).
    Returns list of base64-encoded image strings.
    """
    client = get_bedrock_image_client()
    model = settings.bedrock_image_model_id

    start_time = time.time()

    def _aspect_ratio(w: int, h: int) -> str:
        if h <= 0:
            return "1:1"
        ratio = w / h
        if ratio >= 1.65:
            return "16:9"
        if ratio >= 1.25:
            return "4:3"
        if ratio <= 0.6:
            return "9:16"
        if ratio <= 0.85:
            return "3:4"
        return "1:1"

    def _build_image_request_body(model_id: str) -> dict[str, Any]:
        if model_id.startswith("stability.stable-image-core") or model_id.startswith("stability.stable-image-ultra"):
            body: dict[str, Any] = {
                "prompt": prompt,
                "output_format": "png",
                "aspect_ratio": _aspect_ratio(width, height),
            }
            if negative_prompt:
                body["negative_prompt"] = negative_prompt
            return body

        # Titan schema
        body = {
            "taskType": "TEXT_IMAGE",
            "textToImageParams": {
                "text": prompt,
            },
            "imageGenerationConfig": {
                "numberOfImages": num_images,
                "width": width,
                "height": height,
                "cfgScale": 8.0,
            },
        }
        if negative_prompt:
            body["textToImageParams"]["negativeText"] = negative_prompt
        return body

    def _extract_images_from_response(result: dict[str, Any]) -> list[str]:
        images: list[str] = []

        direct_images = result.get("images")
        if isinstance(direct_images, list):
            images.extend([img for img in direct_images if isinstance(img, str)])

        single_image = result.get("image")
        if isinstance(single_image, str):
            images.append(single_image)

        artifacts = result.get("artifacts")
        if isinstance(artifacts, list):
            for artifact in artifacts:
                if isinstance(artifact, dict):
                    maybe_b64 = artifact.get("base64") or artifact.get("image")
                    if isinstance(maybe_b64, str):
                        images.append(maybe_b64)

        return images

    try:
        response = client.invoke_model(
            modelId=model,
            body=json.dumps(_build_image_request_body(model)),
        )
    except Exception as e:
        err = str(e)
        if _should_try_image_model_fallback(err):
            fallback_error = None
            for fallback_model in _get_image_fallback_candidates(model):
                try:
                    logger.warning(
                        "bedrock_image_model_fallback",
                        from_model=model,
                        to_model=fallback_model,
                        reason="primary_image_model_unavailable_or_denied",
                    )
                    response = client.invoke_model(
                        modelId=fallback_model,
                        body=json.dumps(_build_image_request_body(fallback_model)),
                    )
                    model = fallback_model
                    fallback_error = None
                    break
                except Exception as inner_e:
                    fallback_error = str(inner_e)

            if fallback_error:
                logger.error(
                    "bedrock_image_generation_error",
                    model_id=model,
                    error=err,
                    fallback_error=fallback_error,
                )
                raise
        else:
            logger.error("bedrock_image_generation_error", model_id=model, error=err)
            raise

    latency_ms = int((time.time() - start_time) * 1000)
    result = json.loads(response["body"].read())
    images = _extract_images_from_response(result)

    logger.info(
        "bedrock_image_generation",
        model_id=model,
        model_region=settings.bedrock_image_region,
        num_images=len(images),
        width=width,
        height=height,
        latency_ms=latency_ms,
    )

    return images


# ═══════════════════════════════════════════════════════════════
# Prompt Hash (for content versioning)
# ═══════════════════════════════════════════════════════════════


def prompt_hash(brief: str, system_prompt: str, model_id: str) -> str:
    """Generate deterministic hash of the full prompt for version tracking."""
    combined = f"{model_id}::{system_prompt}::{brief}"
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()
