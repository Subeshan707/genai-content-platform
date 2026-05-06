#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# LocalStack Init — Create SQS, SNS, S3, Secrets for local dev
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
ENDPOINT="http://localhost:4566"

echo "🚀 Initializing LocalStack AWS resources..."

# ── S3 Buckets ────────────────────────────────────────────────
echo "📦 Creating S3 buckets..."
awslocal s3 mb s3://genai-brand-docs --region "$REGION" 2>/dev/null || true
awslocal s3 mb s3://genai-media-assets --region "$REGION" 2>/dev/null || true
awslocal s3 mb s3://genai-model-logs --region "$REGION" 2>/dev/null || true
awslocal s3 mb s3://genai-platform-tfstate --region "$REGION" 2>/dev/null || true

# ── SQS FIFO Queues ──────────────────────────────────────────
echo "📬 Creating SQS queues..."

# Content Ingest FIFO + DLQ
awslocal sqs create-queue \
  --queue-name content-ingest-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region "$REGION" 2>/dev/null || true

INGEST_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/content-ingest-dlq.fifo" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text --region "$REGION")

awslocal sqs create-queue \
  --queue-name content-ingest.fifo \
  --attributes "FifoQueue=true,ContentBasedDeduplication=true,RedrivePolicy={\"deadLetterTargetArn\":\"$INGEST_DLQ_ARN\",\"maxReceiveCount\":\"3\"}" \
  --region "$REGION" 2>/dev/null || true

# Localize FIFO + DLQ
awslocal sqs create-queue \
  --queue-name localize-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region "$REGION" 2>/dev/null || true

LOCALIZE_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/localize-dlq.fifo" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text --region "$REGION")

awslocal sqs create-queue \
  --queue-name localize.fifo \
  --attributes "FifoQueue=true,ContentBasedDeduplication=true,RedrivePolicy={\"deadLetterTargetArn\":\"$LOCALIZE_DLQ_ARN\",\"maxReceiveCount\":\"3\"}" \
  --region "$REGION" 2>/dev/null || true

# Image Generate Standard + DLQ
awslocal sqs create-queue \
  --queue-name image-generate-dlq \
  --region "$REGION" 2>/dev/null || true

IMG_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/image-generate-dlq" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text --region "$REGION")

awslocal sqs create-queue \
  --queue-name image-generate \
  --attributes "RedrivePolicy={\"deadLetterTargetArn\":\"$IMG_DLQ_ARN\",\"maxReceiveCount\":\"3\"}" \
  --region "$REGION" 2>/dev/null || true

# CMS Publish FIFO + DLQ
awslocal sqs create-queue \
  --queue-name cms-publish-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region "$REGION" 2>/dev/null || true

CMS_DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$ENDPOINT/000000000000/cms-publish-dlq.fifo" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text --region "$REGION")

awslocal sqs create-queue \
  --queue-name cms-publish.fifo \
  --attributes "FifoQueue=true,ContentBasedDeduplication=true,RedrivePolicy={\"deadLetterTargetArn\":\"$CMS_DLQ_ARN\",\"maxReceiveCount\":\"3\"}" \
  --region "$REGION" 2>/dev/null || true

# ── SNS Topics ────────────────────────────────────────────────
echo "📢 Creating SNS topics..."
awslocal sns create-topic --name content-approved --region "$REGION" 2>/dev/null || true
awslocal sns create-topic --name content-published --region "$REGION" 2>/dev/null || true
awslocal sns create-topic --name genai-alerts --region "$REGION" 2>/dev/null || true

# ── Secrets Manager ───────────────────────────────────────────
echo "🔐 Creating Secrets..."
awslocal secretsmanager create-secret \
  --name "genai/cms/contentful" \
  --secret-string '{"spaceId":"dev","mgmtToken":"dev-token"}' \
  --region "$REGION" 2>/dev/null || true

awslocal secretsmanager create-secret \
  --name "genai/cms/strapi" \
  --secret-string '{"url":"http://localhost:1337","apiToken":"dev-token"}' \
  --region "$REGION" 2>/dev/null || true

awslocal secretsmanager create-secret \
  --name "genai/cms/wordpress" \
  --secret-string '{"url":"http://localhost:8082","user":"admin","appPassword":"dev-password"}' \
  --region "$REGION" 2>/dev/null || true

# ── EventBridge ───────────────────────────────────────────────
echo "🔗 Creating EventBridge event bus..."
awslocal events create-event-bus --name genai-events --region "$REGION" 2>/dev/null || true

echo "✅ LocalStack initialization complete!"
echo "   S3 Buckets: genai-brand-docs, genai-media-assets, genai-model-logs"
echo "   SQS Queues: content-ingest.fifo, localize.fifo, image-generate, cms-publish.fifo (+ DLQs)"
echo "   SNS Topics: content-approved, content-published, genai-alerts"
echo "   Secrets:    genai/cms/contentful, genai/cms/strapi, genai/cms/wordpress"
echo "   EventBridge: genai-events"
