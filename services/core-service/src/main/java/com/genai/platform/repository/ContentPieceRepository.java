package com.genai.platform.repository;

import com.genai.platform.entity.ContentPiece;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ContentPieceRepository extends JpaRepository<ContentPiece, UUID> {

    Page<ContentPiece> findByWorkspaceIdOrderByCreatedAtDesc(UUID workspaceId, Pageable pageable);

    Page<ContentPiece> findByWorkspaceIdAndStatusOrderByCreatedAtDesc(
            UUID workspaceId, ContentPiece.Status status, Pageable pageable);

    List<ContentPiece> findByCreatedByIdOrderByCreatedAtDesc(UUID createdById);

    long countByWorkspaceIdAndStatus(UUID workspaceId, ContentPiece.Status status);
}
