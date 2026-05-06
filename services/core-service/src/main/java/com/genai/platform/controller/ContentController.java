package com.genai.platform.controller;

import com.genai.platform.dto.Dtos.*;
import com.genai.platform.entity.AuditLog;
import com.genai.platform.entity.User;
import com.genai.platform.repository.AuditLogRepository;
import com.genai.platform.repository.UserRepository;
import com.genai.platform.service.ContentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Content", description = "Content piece CRUD, approval, and publishing")
public class ContentController {

    private final ContentService contentService;
    private final AuditLogRepository auditLogRepo;
    private final UserRepository userRepo;

    private UUID getActorId(Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof Jwt jwt) {
            String sub = jwt.getClaimAsString("sub");
            return userRepo.findByCognitoSub(sub)
                .map(User::getId)
                .orElseGet(() -> {
                    User newUser = User.builder()
                        .cognitoSub(sub)
                        .email(jwt.getClaimAsString("email") != null ? jwt.getClaimAsString("email") : "user@genai.local")
                        .displayName("Platform User")
                        .role(User.Role.ADMIN)
                        .build();
                    return userRepo.save(newUser).getId();
                });
        }
        return userRepo.findByCognitoSub("local-dev-user")
            .map(User::getId)
            .orElseGet(() -> {
                User newUser = User.builder()
                    .cognitoSub("local-dev-user")
                    .email("dev@genai-platform.local")
                    .displayName("Dev User")
                    .role(User.Role.ADMIN)
                    .build();
                return userRepo.save(newUser).getId();
            });
    }

    // ── Content CRUD ─────────────────────────────────────────

    @GetMapping("/content")
    @Operation(summary = "List content pieces (paginated)")
    public ResponseEntity<ContentListResponse> listContent(
            @RequestParam UUID workspaceId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return ResponseEntity.ok(contentService.listContent(workspaceId, page, size));
    }

    @PostMapping("/content")
    @Operation(summary = "Create a new content piece")
    public ResponseEntity<ContentResponse> createContent(@Valid @RequestBody CreateContentRequest request, Authentication authentication) {
        UUID actorId = getActorId(authentication);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(contentService.createContent(request, actorId));
    }

    @GetMapping("/content/{id}")
    @Operation(summary = "Get a content piece by ID")
    public ResponseEntity<ContentResponse> getContent(@PathVariable UUID id) {
        return ResponseEntity.ok(contentService.getContent(id));
    }

    // ── Approval ─────────────────────────────────────────────

    @PatchMapping("/content/{id}/approve")
    @PreAuthorize("hasAnyRole('EDITOR', 'ADMIN')")
    @Operation(summary = "Approve content piece → triggers localization if locales configured")
    public ResponseEntity<ContentResponse> approveContent(
            @PathVariable UUID id,
            @RequestBody(required = false) ApproveRequest request,
            Authentication authentication
    ) {
        UUID actorId = getActorId(authentication);
        String comment = request != null ? request.comment() : null;
        return ResponseEntity.ok(contentService.approveContent(id, actorId, comment));
    }

    // ── Publishing ───────────────────────────────────────────

    @PostMapping("/content/{id}/publish")
    @PreAuthorize("hasAnyRole('PUBLISHER', 'ADMIN')")
    @Operation(summary = "Publish content to CMS (Contentful, Strapi, or WordPress)")
    public ResponseEntity<PublishResponse> publishContent(
            @PathVariable UUID id,
            @Valid @RequestBody PublishRequest request,
            Authentication authentication
    ) {
        UUID actorId = getActorId(authentication);
        return ResponseEntity.ok(
                contentService.publishContent(id, request.cmsTarget(), request.locale(), actorId)
        );
    }

    // ── Audit Trail ──────────────────────────────────────────

    @GetMapping("/audit/{pieceId}")
    @Operation(summary = "Get audit trail for a content piece")
    public ResponseEntity<List<AuditResponse>> getAuditTrail(
            @PathVariable UUID pieceId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size
    ) {
        Page<AuditLog> entries = auditLogRepo.findByPieceIdOrderByCreatedAtDesc(
                pieceId, PageRequest.of(page, size));

        List<AuditResponse> responses = entries.getContent().stream()
                .map(e -> new AuditResponse(
                        e.getId(),
                        e.getPieceId(),
                        e.getAction(),
                        e.getActorId(),
                        e.getModelUsed(),
                        e.getMetadata(),
                        e.getCreatedAt()
                ))
                .toList();

        return ResponseEntity.ok(responses);
    }
}
