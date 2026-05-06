package com.genai.platform.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.genai.platform.dto.Dtos.*;
import com.genai.platform.entity.AuditLog;
import com.genai.platform.entity.ContentPiece;
import com.genai.platform.entity.User;
import com.genai.platform.entity.Workspace;
import com.genai.platform.repository.AuditLogRepository;
import com.genai.platform.repository.ContentPieceRepository;
import com.genai.platform.repository.UserRepository;
import com.genai.platform.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class ContentService {

    private final ContentPieceRepository contentPieceRepo;
    private final AuditLogRepository auditLogRepo;
    private final UserRepository userRepo;
    private final WorkspaceRepository workspaceRepo;
    private final SqsService sqsService;
    private final ObjectMapper objectMapper;

    @Transactional
    public ContentResponse createContent(CreateContentRequest request, UUID actorId) {
        User creator = userRepo.findById(actorId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + actorId));
        Workspace workspace = workspaceRepo.findById(request.workspaceId())
                .orElseGet(() -> {
                    Workspace newWorkspace = new Workspace();
                    newWorkspace.setId(request.workspaceId());
                    newWorkspace.setName("Default Workspace");
                    return workspaceRepo.save(newWorkspace);
                });

        ContentPiece piece = ContentPiece.builder()
                .workspace(workspace)
                .title(request.title())
                .brief(request.brief())
                .contentType(ContentPiece.ContentType.valueOf(request.contentType()))
                .status(ContentPiece.Status.draft)
                .targetLocales(request.targetLocales() != null ? String.join(",", request.targetLocales()) : "")
                .createdBy(creator)
                .build();

        piece = contentPieceRepo.save(piece);

        // Audit log
        writeAudit(piece.getId(), "content_created", actorId, null,
                Map.of("title", request.title(), "contentType", request.contentType()));

        log.info("Content piece created: id={}, type={}", piece.getId(), request.contentType());
        return toResponse(piece);
    }

    @Transactional(readOnly = true)
    public ContentListResponse listContent(UUID workspaceId, int page, int size) {
        Page<ContentPiece> pieces = contentPieceRepo
                .findByWorkspaceIdOrderByCreatedAtDesc(workspaceId, PageRequest.of(page, size));

        List<ContentResponse> items = pieces.getContent().stream()
                .map(this::toResponse)
                .toList();

        return new ContentListResponse(items, (int) pieces.getTotalElements(), page, size);
    }

    @Transactional(readOnly = true)
    public ContentResponse getContent(UUID pieceId) {
        ContentPiece piece = contentPieceRepo.findById(pieceId)
                .orElseThrow(() -> new IllegalArgumentException("Content not found: " + pieceId));
        return toResponse(piece);
    }

    @Transactional
    public ContentResponse approveContent(UUID pieceId, UUID actorId, String comment) {
        ContentPiece piece = contentPieceRepo.findById(pieceId)
                .orElseThrow(() -> new IllegalArgumentException("Content not found: " + pieceId));

        piece.setStatus(ContentPiece.Status.approved);
        User updater = userRepo.findById(actorId).orElse(null);
        piece.setUpdatedBy(updater);
        piece = contentPieceRepo.save(piece);

        // Audit
        writeAudit(pieceId, "content_approved", actorId, null,
                Map.of("comment", comment != null ? comment : ""));

        // Trigger localization via SQS if target locales configured
        if (piece.getTargetLocales() != null && !piece.getTargetLocales().isBlank()) {
            sqsService.sendLocalizeMessage(piece);
            piece.setStatus(ContentPiece.Status.localizing);
            contentPieceRepo.save(piece);
        }

        log.info("Content approved: id={}, actor={}", pieceId, actorId);
        return toResponse(piece);
    }

    @Transactional
    public PublishResponse publishContent(UUID pieceId, String cmsTarget, String locale, UUID actorId) {
        ContentPiece piece = contentPieceRepo.findById(pieceId)
                .orElseThrow(() -> new IllegalArgumentException("Content not found: " + pieceId));

        piece.setStatus(ContentPiece.Status.publishing);
        contentPieceRepo.save(piece);

        // Send to CMS publish queue
        String messageId = sqsService.sendPublishMessage(piece, cmsTarget, locale);

        writeAudit(pieceId, "content_publish_queued", actorId, null,
                Map.of("cmsTarget", cmsTarget, "locale", locale != null ? locale : "en"));

        log.info("Content publish queued: id={}, cms={}", pieceId, cmsTarget);
        return new PublishResponse(pieceId, cmsTarget, locale, "queued", messageId);
    }

    public void writeAudit(UUID pieceId, String action, UUID actorId, String modelUsed, Map<String, String> meta) {
        try {
            AuditLog entry = AuditLog.builder()
                    .pieceId(pieceId)
                    .action(action)
                    .actorId(actorId)
                    .modelUsed(modelUsed)
                    .metadata(objectMapper.writeValueAsString(meta))
                    .build();
            auditLogRepo.save(entry);
        } catch (Exception e) {
            log.error("Failed to write audit log: {}", e.getMessage(), e);
        }
    }

    private ContentResponse toResponse(ContentPiece piece) {
        List<String> locales = piece.getTargetLocales() != null && !piece.getTargetLocales().isBlank()
                ? Arrays.asList(piece.getTargetLocales().split(","))
                : List.of();

        return new ContentResponse(
                piece.getId(),
                piece.getWorkspace().getId(),
                piece.getTitle(),
                piece.getBrief(),
                piece.getContentType().name(),
                piece.getStatus().name(),
                locales,
                piece.getCreatedBy().getId(),
                piece.getCreatedAt(),
                piece.getUpdatedAt()
        );
    }
}
