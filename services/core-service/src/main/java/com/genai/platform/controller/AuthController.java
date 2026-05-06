package com.genai.platform.controller;

import com.genai.platform.dto.Dtos.*;
import com.genai.platform.entity.User;
import com.genai.platform.repository.UserRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Authentication controller — validates Cognito tokens.
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Authentication", description = "Cognito token validation and user info")
public class AuthController {

    private final UserRepository userRepository;

    @PostMapping("/login")
    @Operation(summary = "Validate Cognito ID token and return user info")
    public ResponseEntity<LoginResponse> login(@RequestBody LoginRequest request) {
        // In production, this validates the Cognito ID token
        // For local dev, we create/return a mock user
        log.info("Login attempt with token: {}...", request.idToken().substring(0, Math.min(20, request.idToken().length())));

        // Find or create user from token claims
        // In production, extract claims from JWT:
        //   sub, email, cognito:groups, custom:role
        User user = userRepository.findByCognitoSub("local-dev-user")
                .orElseGet(() -> {
                    User newUser = User.builder()
                            .cognitoSub("local-dev-user")
                            .email("dev@genai-platform.local")
                            .displayName("Dev User")
                            .role(User.Role.ADMIN)
                            .build();
                    return userRepository.save(newUser);
                });

        UserInfo userInfo = new UserInfo(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getRole().name(),
                user.getWorkspace() != null ? user.getWorkspace().getId() : null
        );

        return ResponseEntity.ok(new LoginResponse(
                request.idToken(),
                "refresh-token-placeholder",
                userInfo
        ));
    }

    @GetMapping("/me")
    @Operation(summary = "Get current user info from JWT")
    public ResponseEntity<UserInfo> getCurrentUser() {
        // In production, extract user from SecurityContext JWT
        User user = userRepository.findByCognitoSub("local-dev-user")
                .orElseThrow(() -> new RuntimeException("User not found"));

        return ResponseEntity.ok(new UserInfo(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getRole().name(),
                user.getWorkspace() != null ? user.getWorkspace().getId() : null
        ));
    }
}
