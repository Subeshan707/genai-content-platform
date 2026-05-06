"""
GenAI Content Platform — Transcription Service
Amazon Transcribe (FREE: 60 min/month for 12 months)
"""

from __future__ import annotations

import time
import uuid
from typing import Any

import boto3
import structlog

from app.config import settings

logger = structlog.get_logger(__name__)


def _create_transcribe_client() -> Any:
    """Create Amazon Transcribe client."""
    kwargs: dict[str, Any] = {"region_name": settings.aws_region}
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("transcribe", **kwargs)


_transcribe_client: Any = None


def get_transcribe_client() -> Any:
    """Get or create Amazon Transcribe client."""
    global _transcribe_client
    if _transcribe_client is None:
        _transcribe_client = _create_transcribe_client()
    return _transcribe_client


async def submit_transcription_job(
    s3_uri: str,
    language_code: str = "en-US",
    generate_subtitles: bool = True,
    workspace_id: str = "",
    piece_id: str = "",
) -> dict[str, Any]:
    """
    Submit an audio file for transcription via Amazon Transcribe.
    FREE TIER: 60 minutes/month for 12 months.
    
    Subtitles are generated in both SRT and VTT formats.
    """
    import asyncio
    
    client = get_transcribe_client()
    job_name = f"genai-{piece_id}-{uuid.uuid4().hex[:8]}"

    start_time = time.time()

    settings_config: dict[str, Any] = {
        "ShowSpeakerLabels": True,
        "MaxSpeakerLabels": 5,
    }

    subtitle_config = {}
    if generate_subtitles:
        subtitle_config = {
            "Subtitles": {
                "Formats": ["srt", "vtt"],
                "OutputStartIndex": 1,
            }
        }

    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.start_transcription_job(
                TranscriptionJobName=job_name,
                Media={"MediaFileUri": s3_uri},
                MediaFormat=_detect_media_format(s3_uri),
                LanguageCode=language_code,
                Settings=settings_config,
                OutputBucketName=settings.s3_media_assets_bucket,
                OutputKey=f"transcriptions/{workspace_id}/{piece_id}/",
                Tags=[
                    {"Key": "workspace_id", "Value": workspace_id},
                    {"Key": "piece_id", "Value": piece_id},
                    {"Key": "Project", "Value": "genai-content-platform"},
                ],
                **subtitle_config,
            ),
        )

        latency_ms = int((time.time() - start_time) * 1000)
        job = response["TranscriptionJob"]

        logger.info(
            "transcription_job_submitted",
            job_name=job_name,
            status=job["TranscriptionJobStatus"],
            language=language_code,
            latency_ms=latency_ms,
        )

        return {
            "job_id": job_name,
            "status": job["TranscriptionJobStatus"],
            "s3_uri": s3_uri,
            "language_code": language_code,
        }

    except Exception as e:
        logger.error("transcription_submit_error", job_name=job_name, error=str(e))
        raise


async def get_transcription_status(job_name: str) -> dict[str, Any]:
    """Check the status of a transcription job."""
    import asyncio
    
    client = get_transcribe_client()
    loop = asyncio.get_event_loop()
    
    response = await loop.run_in_executor(
        None,
        lambda: client.get_transcription_job(TranscriptionJobName=job_name),
    )
    
    job = response["TranscriptionJob"]
    status = job["TranscriptionJobStatus"]
    
    result: dict[str, Any] = {
        "job_id": job_name,
        "status": status,
    }
    
    if status == "COMPLETED":
        result["transcript_uri"] = job["Transcript"]["TranscriptFileUri"]
        if "SubtitleFileUris" in job.get("Subtitles", {}):
            result["subtitle_uris"] = job["Subtitles"]["SubtitleFileUris"]
    elif status == "FAILED":
        result["failure_reason"] = job.get("FailureReason", "Unknown")
    
    return result


def _detect_media_format(s3_uri: str) -> str:
    """Detect media format from S3 URI extension."""
    uri_lower = s3_uri.lower()
    if uri_lower.endswith(".mp3"):
        return "mp3"
    elif uri_lower.endswith(".mp4"):
        return "mp4"
    elif uri_lower.endswith(".wav"):
        return "wav"
    elif uri_lower.endswith(".flac"):
        return "flac"
    elif uri_lower.endswith(".ogg"):
        return "ogg"
    elif uri_lower.endswith(".webm"):
        return "webm"
    return "mp3"  # default
