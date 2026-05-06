package com.genai.platform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.genai.platform.entity.ContentPiece;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;
import software.amazon.awssdk.services.sqs.model.SendMessageResponse;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * SQS service for sending messages to FIFO and standard queues.
 * Implements idempotency via message deduplication IDs.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SqsService {

    @Value("${aws.region:us-east-1}")
    private String region;

    @Value("${aws.sqs.endpoint:}")
    private String sqsEndpoint;

    @Value("${aws.sqs.localize-queue:localize.fifo}")
    private String localizeQueueName;

    @Value("${aws.sqs.cms-publish-queue:cms-publish.fifo}")
    private String publishQueueName;

    @Value("${aws.sqs.content-ingest-queue:content-ingest.fifo}")
    private String ingestQueueName;

    private final ObjectMapper objectMapper;
    private SqsClient sqsClient;

    @PostConstruct
    public void init() {
        var builder = SqsClient.builder()
                .region(Region.of(region))
                .credentialsProvider(DefaultCredentialsProvider.create());

        if (sqsEndpoint != null && !sqsEndpoint.isBlank()) {
            builder.endpointOverride(URI.create(sqsEndpoint));
        }

        this.sqsClient = builder.build();
        log.info("SQS client initialized: region={}, endpoint={}", region, sqsEndpoint);
    }

    public String sendLocalizeMessage(ContentPiece piece) {
        try {
            Map<String, Object> body = Map.of(
                    "piece_id", piece.getId().toString(),
                    "workspace_id", piece.getWorkspace().getId().toString(),
                    "target_locales", piece.getTargetLocales(),
                    "content_type", piece.getContentType().name(),
                    "timestamp", Instant.now().toString()
            );

            String queueUrl = getQueueUrl(localizeQueueName);
            String deduplicationId = piece.getId() + "-localize-" + Instant.now().getEpochSecond();

            SendMessageResponse response = sqsClient.sendMessage(SendMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .messageBody(objectMapper.writeValueAsString(body))
                    .messageGroupId("localize-" + piece.getWorkspace().getId())
                    .messageDeduplicationId(deduplicationId)
                    .build());

            log.info("Localize message sent: pieceId={}, messageId={}", piece.getId(), response.messageId());
            return response.messageId();
        } catch (Exception e) {
            log.error("Failed to send localize message: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to queue localization job", e);
        }
    }

    public String sendPublishMessage(ContentPiece piece, String cmsTarget, String locale) {
        try {
            Map<String, Object> body = Map.of(
                    "piece_id", piece.getId().toString(),
                    "workspace_id", piece.getWorkspace().getId().toString(),
                    "cms_target", cmsTarget,
                    "locale", locale != null ? locale : "en",
                    "timestamp", Instant.now().toString()
            );

            String queueUrl = getQueueUrl(publishQueueName);
            String deduplicationId = piece.getId() + "-publish-" + cmsTarget + "-" + Instant.now().getEpochSecond();

            SendMessageResponse response = sqsClient.sendMessage(SendMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .messageBody(objectMapper.writeValueAsString(body))
                    .messageGroupId("publish-" + piece.getWorkspace().getId())
                    .messageDeduplicationId(deduplicationId)
                    .build());

            log.info("Publish message sent: pieceId={}, cms={}, messageId={}", piece.getId(), cmsTarget, response.messageId());
            return response.messageId();
        } catch (Exception e) {
            log.error("Failed to send publish message: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to queue CMS publish job", e);
        }
    }

    public String sendIngestMessage(UUID workspaceId, String s3Key, String documentName) {
        try {
            Map<String, Object> body = Map.of(
                    "workspace_id", workspaceId.toString(),
                    "s3_key", s3Key,
                    "document_name", documentName,
                    "timestamp", Instant.now().toString()
            );

            String queueUrl = getQueueUrl(ingestQueueName);
            String deduplicationId = workspaceId + "-ingest-" + s3Key.hashCode();

            SendMessageResponse response = sqsClient.sendMessage(SendMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .messageBody(objectMapper.writeValueAsString(body))
                    .messageGroupId("ingest-" + workspaceId)
                    .messageDeduplicationId(deduplicationId)
                    .build());

            log.info("Ingest message sent: workspaceId={}, s3Key={}, messageId={}", workspaceId, s3Key, response.messageId());
            return response.messageId();
        } catch (Exception e) {
            log.error("Failed to send ingest message: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to queue brand doc ingestion", e);
        }
    }

    private String getQueueUrl(String queueName) {
        return sqsClient.getQueueUrl(r -> r.queueName(queueName)).queueUrl();
    }
}
