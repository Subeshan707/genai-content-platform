package com.genai.platform.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * DTO records for the Core Service API.
 * Using Java records for immutable DTOs.
 */
public class Dtos {

    // ── Auth ─────────────────────────────────────────────
    public record LoginRequest(String idToken) {}

    public record LoginResponse(String accessToken, String refreshToken, UserInfo user) {}

    public record UserInfo(UUID id, String email, String displayName, String role, UUID workspaceId) {}

    // ── Workspace ────────────────────────────────────────
    public record WorkspaceResponse(UUID id, String name, String brandKbId, Instant createdAt) {}

    public record BrandUploadUrlResponse(String uploadUrl, String s3Key, Instant expiresAt) {}

    // ── Content ──────────────────────────────────────────
    public record CreateContentRequest(
            UUID workspaceId,
            String title,
            String brief,
            String contentType,
            List<String> targetLocales
    ) {}

    public record ContentResponse(
            UUID id,
            UUID workspaceId,
            String title,
            String brief,
            String contentType,
            String status,
            List<String> targetLocales,
            UUID createdBy,
            Instant createdAt,
            Instant updatedAt
    ) {}

    public record ContentListResponse(List<ContentResponse> items, int total, int page, int size) {}

    public record ApproveRequest(String comment) {}

    // ── Publish ──────────────────────────────────────────
    public record PublishRequest(String cmsTarget, String locale) {}

    public record PublishResponse(UUID pieceId, String cmsTarget, String locale, String status, String externalId) {}

    // ── Audit ────────────────────────────────────────────
    public record AuditResponse(Long id, UUID pieceId, String action, UUID actorId,
                                String modelUsed, String metadata, Instant createdAt) {}
}
