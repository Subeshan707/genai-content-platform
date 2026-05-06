"""
GenAI Content Platform — Image Queue Worker
Consumes SQS image jobs, generates assets, uploads to S3, and stores metadata.
"""

from __future__ import annotations

import asyncio
import base64
import json
import uuid
from datetime import datetime, timezone
from typing import Any

import boto3
import structlog
from botocore.exceptions import ClientError

from app.bedrock_client import generate_image as bedrock_generate_image
from app.config import settings
from app.database import get_mongo_db

logger = structlog.get_logger(__name__)

_sqs_client: Any = None
_s3_client: Any = None


def _boto_kwargs(endpoint: str | None = None) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"region_name": settings.aws_region}
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        if settings.aws_session_token:
            kwargs["aws_session_token"] = settings.aws_session_token
    return kwargs


def _get_sqs_client() -> Any:
    global _sqs_client
    if _sqs_client is None:
        _sqs_client = boto3.client("sqs", **_boto_kwargs(settings.sqs_endpoint or None))
    return _sqs_client


def _get_s3_client() -> Any:
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", **_boto_kwargs(settings.s3_endpoint or None))
    return _s3_client


async def _run_sync(func, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: func(*args, **kwargs))


def _is_queue_not_found(error: ClientError) -> bool:
    code = error.response.get("Error", {}).get("Code", "")
    return code in {"AWS.SimpleQueueService.NonExistentQueue", "QueueDoesNotExist"}


def _resolve_image_queue_url(sqs: Any) -> tuple[str, str, list[str]]:
    queue_candidates = [settings.sqs_image_generate_queue]
    if not settings.sqs_image_generate_queue.startswith("genai-platform-"):
        queue_candidates.append(f"genai-platform-{settings.sqs_image_generate_queue}")

    for queue_name in queue_candidates:
        try:
            response = sqs.get_queue_url(QueueName=queue_name)
            return response["QueueUrl"], queue_name, queue_candidates
        except ClientError as e:
            if _is_queue_not_found(e):
                continue
            raise

    return "", settings.sqs_image_generate_queue, queue_candidates


def _is_permanent_generation_error(error_text: str) -> bool:
    text = error_text.lower()
    triggers = [
        "end of its life",
        "legacy",
        "not authorized to perform",
        "access denied",
        "validationexception",
        "resourcenotfoundexception",
    ]
    return any(trigger in text for trigger in triggers)


async def _upload_image(workspace_id: str, piece_id: str, idx: int, image_data_b64: str) -> str:
    s3 = _get_s3_client()
    key = f"images/{workspace_id}/{piece_id}/{uuid.uuid4().hex}-{idx}.png"
    image_bytes = base64.b64decode(image_data_b64)

    await _run_sync(
        s3.put_object,
        Bucket=settings.s3_media_assets_bucket,
        Key=key,
        Body=image_bytes,
        ContentType="image/png",
        Metadata={
            "workspace_id": workspace_id,
            "piece_id": piece_id,
        },
    )
    return key


async def _save_completed_assets(
    message_id: str,
    workspace_id: str,
    piece_id: str,
    prompt: str,
    locale: str | None,
    s3_keys: list[str],
) -> None:
    db = get_mongo_db()
    now = datetime.now(timezone.utc)

    docs = [
        {
            "asset_id": str(uuid.uuid4()),
            "message_id": message_id,
            "workspace_id": workspace_id,
            "piece_id": piece_id,
            "locale": locale,
            "prompt": prompt,
            "status": "completed",
            "s3_key": key,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
        for key in s3_keys
    ]

    if docs:
        await db.media_assets.insert_many(docs)


async def _save_failed_job(
    message_id: str,
    workspace_id: str,
    piece_id: str,
    prompt: str,
    locale: str | None,
    error: str,
    attempts: int,
) -> None:
    db = get_mongo_db()
    now = datetime.now(timezone.utc)

    await db.media_assets.update_one(
        {"message_id": message_id, "piece_id": piece_id, "status": "failed"},
        {
            "$set": {
                "workspace_id": workspace_id,
                "piece_id": piece_id,
                "locale": locale,
                "prompt": prompt,
                "status": "failed",
                "error": error,
                "attempts": attempts,
                "updated_at": now,
            },
            "$setOnInsert": {
                "asset_id": str(uuid.uuid4()),
                "created_at": now,
            },
        },
        upsert=True,
    )


async def _process_image_message(sqs: Any, queue_url: str, queue_name: str, message: dict[str, Any]) -> None:
    message_id = message.get("MessageId", "")
    receipt_handle = message.get("ReceiptHandle", "")
    attempts = int(message.get("Attributes", {}).get("ApproximateReceiveCount", "1"))

    try:
        payload = json.loads(message.get("Body", "{}"))
    except json.JSONDecodeError:
        logger.error("image_worker_invalid_message", message_id=message_id, queue=queue_name)
        if receipt_handle:
            await _run_sync(sqs.delete_message, QueueUrl=queue_url, ReceiptHandle=receipt_handle)
        return

    workspace_id = str(payload.get("workspace_id", ""))
    piece_id = str(payload.get("piece_id", ""))
    prompt = str(payload.get("prompt", ""))
    locale = payload.get("locale")

    if not piece_id or not prompt:
        logger.error(
            "image_worker_missing_fields",
            message_id=message_id,
            queue=queue_name,
            has_piece_id=bool(piece_id),
            has_prompt=bool(prompt),
        )
        if receipt_handle:
            await _run_sync(sqs.delete_message, QueueUrl=queue_url, ReceiptHandle=receipt_handle)
        return

    width = int(payload.get("width", 1024))
    height = int(payload.get("height", 1024))
    num_images = int(payload.get("num_images", 1))
    negative_prompt = str(payload.get("negative_prompt", ""))

    try:
        images = await _run_sync(
            bedrock_generate_image,
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_images=num_images,
        )
        if not images:
            raise RuntimeError("Image model returned no images")

        s3_keys: list[str] = []
        for idx, image_data_b64 in enumerate(images):
            key = await _upload_image(workspace_id=workspace_id, piece_id=piece_id, idx=idx, image_data_b64=image_data_b64)
            s3_keys.append(key)

        await _save_completed_assets(
            message_id=message_id,
            workspace_id=workspace_id,
            piece_id=piece_id,
            prompt=prompt,
            locale=locale,
            s3_keys=s3_keys,
        )

        if receipt_handle:
            await _run_sync(sqs.delete_message, QueueUrl=queue_url, ReceiptHandle=receipt_handle)

        logger.info(
            "image_worker_job_completed",
            message_id=message_id,
            piece_id=piece_id,
            queue=queue_name,
            assets_created=len(s3_keys),
        )
    except Exception as e:
        error_text = str(e)
        permanent_error = _is_permanent_generation_error(error_text)

        await _save_failed_job(
            message_id=message_id,
            workspace_id=workspace_id,
            piece_id=piece_id,
            prompt=prompt,
            locale=locale,
            error=error_text,
            attempts=attempts,
        )

        if permanent_error or attempts >= 3:
            if receipt_handle:
                await _run_sync(sqs.delete_message, QueueUrl=queue_url, ReceiptHandle=receipt_handle)
            logger.error(
                "image_worker_job_dropped",
                message_id=message_id,
                piece_id=piece_id,
                queue=queue_name,
                attempts=attempts,
                permanent_error=permanent_error,
                error=error_text,
            )
        else:
            logger.warning(
                "image_worker_job_retry",
                message_id=message_id,
                piece_id=piece_id,
                queue=queue_name,
                attempts=attempts,
                error=error_text,
            )


async def run_image_worker(stop_event: asyncio.Event) -> None:
    """Long-poll image queue and process jobs until stop_event is set."""
    sqs = _get_sqs_client()
    logger.info("image_worker_starting", queue=settings.sqs_image_generate_queue)

    while not stop_event.is_set():
        try:
            queue_url, queue_name, queue_candidates = _resolve_image_queue_url(sqs)
            if not queue_url:
                logger.warning(
                    "image_worker_queue_not_found",
                    configured_queue=settings.sqs_image_generate_queue,
                    tried_queues=queue_candidates,
                )
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=15)
                except asyncio.TimeoutError:
                    continue
                continue

            response = await _run_sync(
                sqs.receive_message,
                QueueUrl=queue_url,
                MaxNumberOfMessages=5,
                WaitTimeSeconds=20,
                VisibilityTimeout=120,
                AttributeNames=["ApproximateReceiveCount"],
            )
            messages = response.get("Messages", [])
            if not messages:
                continue

            for message in messages:
                if stop_event.is_set():
                    break
                await _process_image_message(sqs=sqs, queue_url=queue_url, queue_name=queue_name, message=message)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("image_worker_loop_error", error=str(e))
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=5)
            except asyncio.TimeoutError:
                continue

    logger.info("image_worker_stopped")


async def list_image_assets(piece_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """List generated image assets for a piece, with presigned URLs for completed assets."""
    db = get_mongo_db()
    cursor = db.media_assets.find({"piece_id": piece_id}).sort("created_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)

    s3 = _get_s3_client()
    assets: list[dict[str, Any]] = []

    for doc in docs:
        status = str(doc.get("status", "processing"))
        s3_key = str(doc.get("s3_key", "")) if doc.get("s3_key") else None
        image_url = None

        if status == "completed" and s3_key:
            try:
                image_url = s3.generate_presigned_url(
                    "get_object",
                    Params={
                        "Bucket": settings.s3_media_assets_bucket,
                        "Key": s3_key,
                    },
                    ExpiresIn=3600,
                )
            except Exception as e:
                logger.warning("image_asset_presign_failed", piece_id=piece_id, s3_key=s3_key, error=str(e))

        created_at = doc.get("created_at")
        assets.append(
            {
                "id": str(doc.get("asset_id") or doc.get("_id")),
                "pieceId": str(doc.get("piece_id", "")),
                "locale": doc.get("locale"),
                "prompt": str(doc.get("prompt", "")),
                "status": status,
                "imageUrl": image_url,
                "error": doc.get("error"),
                "createdAt": created_at.isoformat() if created_at else None,
            }
        )

    return assets
