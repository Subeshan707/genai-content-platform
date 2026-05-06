"""
GenAI Content Platform — Localization Service
Amazon Translate + LLM refinement (all free tier).
Parallel async fan-out for multiple locales.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import boto3
import structlog

from app.bedrock_client import converse
from app.config import settings
from app.database import get_mongo_db

logger = structlog.get_logger(__name__)


def _create_translate_client() -> Any:
    """Create Amazon Translate client."""
    kwargs: dict[str, Any] = {"region_name": settings.aws_region}
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("translate", **kwargs)


_translate_client: Any = None


def get_translate_client() -> Any:
    """Get or create Amazon Translate client."""
    global _translate_client
    if _translate_client is None:
        _translate_client = _create_translate_client()
    return _translate_client


async def translate_locale(
    text: str,
    target: str,
    source: str = "en",
    refine_with_llm: bool = True,
) -> dict[str, Any]:
    """
    Translate text to a target locale using Amazon Translate (FREE: 2M chars/month),
    then optionally refine with LLM for marketing tone.
    
    Args:
        text: Source text to translate
        target: Target language code (e.g., 'fr', 'es', 'ja')
        source: Source language code (default: 'en')
        refine_with_llm: Whether to run LLM refinement pass
    
    Returns:
        Dict with locale, translated_body, model_used
    """
    start_time = time.time()
    translate_client = get_translate_client()
    
    # Extract base language code for Translate API
    target_lang = target.split("-")[0] if "-" in target else target
    
    # Step 1: Amazon Translate (FREE TIER: 2M characters/month)
    loop = asyncio.get_event_loop()
    try:
        translate_result = await loop.run_in_executor(
            None,
            lambda: translate_client.translate_text(
                Text=text,
                SourceLanguageCode=source,
                TargetLanguageCode=target_lang,
                TerminologyNames=["brand-terminology"],  # custom glossary
            ),
        )
        raw_translation = translate_result["TranslatedText"]
    except translate_client.exceptions.ResourceNotFoundException:
        # Terminology not found — translate without it
        translate_result = await loop.run_in_executor(
            None,
            lambda: translate_client.translate_text(
                Text=text,
                SourceLanguageCode=source,
                TargetLanguageCode=target_lang,
            ),
        )
        raw_translation = translate_result["TranslatedText"]
    except Exception as e:
        logger.error("translate_error", target=target, error=str(e))
        raise
    
    model_used = None
    final_translation = raw_translation
    
    # Step 2: LLM refinement pass for marketing/creative copy
    if refine_with_llm:
        try:
            refined = converse(
                prompt=(
                    f"Refine this {target} translation for marketing tone.\n"
                    f"Keep meaning exact. Only fix idioms and cultural nuance.\n"
                    f"Translation: {raw_translation}\n"
                    f"Output only the refined text."
                ),
                model_id=settings.bedrock_text_lite_model_id,  # FREE TIER, fast
                max_tokens=1024,
                temperature=0.3,
            )
            final_translation = refined["text"]
            model_used = settings.bedrock_text_lite_model_id
        except Exception as e:
            logger.warning(
                "llm_refine_fallback",
                target=target,
                error=str(e),
                message="Using raw translation without LLM refinement",
            )
            final_translation = raw_translation
    
    latency_ms = int((time.time() - start_time) * 1000)
    
    logger.info(
        "locale_translated",
        target=target,
        source=source,
        refined=refine_with_llm,
        model_used=model_used,
        latency_ms=latency_ms,
        input_length=len(text),
        output_length=len(final_translation),
    )
    
    return {
        "locale": target,
        "translated_body": final_translation,
        "model_used": model_used,
        "latency_ms": latency_ms,
    }


async def localize_all(
    text: str,
    locales: list[str],
    source: str = "en",
    refine_with_llm: bool = True,
) -> list[dict[str, Any]]:
    """
    Translate text into all target locales in parallel using asyncio.gather.
    
    Args:
        text: Source text
        locales: List of target locale codes
        source: Source language code
        refine_with_llm: Whether to refine with LLM
    
    Returns:
        List of translation results
    """
    start_time = time.time()
    
    tasks = [
        translate_locale(text, locale, source, refine_with_llm)
        for locale in locales
    ]
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Process results, handling any exceptions
    processed: list[dict[str, Any]] = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            logger.error(
                "localize_locale_error",
                locale=locales[i],
                error=str(result),
            )
            processed.append({
                "locale": locales[i],
                "translated_body": "",
                "model_used": None,
                "error": str(result),
                "status": "failed",
            })
        else:
            result["status"] = "pending"
            processed.append(result)
    
    latency_ms = int((time.time() - start_time) * 1000)
    logger.info(
        "localize_all_complete",
        total_locales=len(locales),
        successful=sum(1 for r in processed if r.get("status") != "failed"),
        latency_ms=latency_ms,
    )
    
    return processed


async def save_locale_variants(
    piece_id: str,
    source_language: str,
    variants: list[dict[str, Any]],
) -> None:
    """Save translated locale variants to MongoDB (DocumentDB)."""
    db = get_mongo_db()
    collection = db.locale_variants
    
    from datetime import datetime, timezone
    
    for variant in variants:
        if variant.get("status") == "failed":
            continue
        
        doc = {
            "master_id": piece_id,
            "locale": variant["locale"],
            "translated_body": variant["translated_body"],
            "subtitle_srt": None,
            "subtitle_vtt": None,
            "image_urls": [],
            "status": "pending",
            "approved_by": None,
            "published_at": None,
            "translate_job_id": None,
            "source_language": source_language,
            "model_used": variant.get("model_used"),
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        
        # Upsert: update if locale variant already exists
        await collection.update_one(
            {"master_id": piece_id, "locale": variant["locale"]},
            {"$set": doc},
            upsert=True,
        )
    
    logger.info(
        "locale_variants_saved",
        piece_id=piece_id,
        variants_saved=sum(1 for v in variants if v.get("status") != "failed"),
    )
