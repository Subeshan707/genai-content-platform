package com.genai.platform.controller;

import com.genai.platform.dto.Dtos.*;
import com.genai.platform.entity.Workspace;
import com.genai.platform.repository.WorkspaceRepository;
import com.genai.platform.service.SqsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@RestController
@RequestMapping("/api/workspaces")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Workspaces", description = "Workspace configuration and brand document management")
public class WorkspaceController {

    private final WorkspaceRepository workspaceRepo;
    private final SqsService sqsService;

    @Value("${aws.region:us-east-1}")
    private String awsRegion;

    @Value("${aws.s3.endpoint:}")
    private String s3Endpoint;

    @Value("${aws.s3.brand-docs-bucket:genai-brand-docs}")
    private String brandDocsBucket;

    @GetMapping("/{id}")
    @Operation(summary = "Get workspace configuration")
    public ResponseEntity<WorkspaceResponse> getWorkspace(@PathVariable UUID id) {
        Workspace workspace = workspaceRepo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Workspace not found: " + id));

        return ResponseEntity.ok(new WorkspaceResponse(
                workspace.getId(),
                workspace.getName(),
                workspace.getBrandKbId(),
                workspace.getCreatedAt()
        ));
    }

    @PostMapping("/{id}/brand")
    @Operation(summary = "Upload brand document → triggers SQS ingestion")
    public ResponseEntity<BrandUploadUrlResponse> uploadBrandDoc(
            @PathVariable UUID id,
            @RequestParam String filename
    ) {
        // Validate workspace exists
        workspaceRepo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Workspace not found: " + id));

        // Generate presigned S3 upload URL
        String s3Key = "brand-docs/" + id + "/" + UUID.randomUUID() + "/" + filename;

        var presignerBuilder = S3Presigner.builder().region(Region.of(awsRegion));
        if (s3Endpoint != null && !s3Endpoint.isBlank()) {
            presignerBuilder.endpointOverride(URI.create(s3Endpoint));
        }

        try (S3Presigner presigner = presignerBuilder.build()) {
            PutObjectRequest objectRequest = PutObjectRequest.builder()
                    .bucket(brandDocsBucket)
                    .key(s3Key)
                    .build();

            PutObjectPresignRequest presignRequest = PutObjectPresignRequest.builder()
                    .signatureDuration(Duration.ofMinutes(15))
                    .putObjectRequest(objectRequest)
                    .build();

            String uploadUrl = presigner.presignPutObject(presignRequest).url().toString();
            Instant expiresAt = Instant.now().plus(Duration.ofMinutes(15));

            // Also queue the ingest job (will process after upload)
            sqsService.sendIngestMessage(id, s3Key, filename);

            log.info("Brand doc upload URL generated: workspace={}, key={}", id, s3Key);

            return ResponseEntity.ok(new BrandUploadUrlResponse(uploadUrl, s3Key, expiresAt));
        }
    }
}
