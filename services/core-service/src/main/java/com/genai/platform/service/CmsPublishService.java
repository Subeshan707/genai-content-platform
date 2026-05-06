package com.genai.platform.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.util.Base64;
import java.util.Map;

/**
 * CMS integration service — publishes content to Contentful, Strapi, and WordPress.
 * All credentials retrieved from AWS Secrets Manager — never hardcoded.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CmsPublishService {

    @Value("${aws.region:us-east-1}")
    private String region;

    private final ObjectMapper objectMapper;
    private SecretsManagerClient secretsManagerClient;
    private WebClient webClient;

    @PostConstruct
    public void init() {
        this.secretsManagerClient = SecretsManagerClient.builder()
                .region(Region.of(region))
                .build();
        this.webClient = WebClient.builder().build();
        log.info("CMS Publish Service initialized");
    }

    /**
     * Publish content to the specified CMS target.
     *
     * @return External ID from the CMS
     */
    public String publishToCms(String cmsTarget, String title, String body, String locale) {
        return switch (cmsTarget.toLowerCase()) {
            case "contentful" -> publishToContentful(title, body, locale);
            case "strapi" -> publishToStrapi(title, body, locale);
            case "wordpress" -> publishToWordPress(title, body, locale);
            default -> throw new IllegalArgumentException("Unknown CMS target: " + cmsTarget);
        };
    }

    // ── Contentful ───────────────────────────────────────────

    private String publishToContentful(String title, String body, String locale) {
        JsonNode secret = getSecret("genai/cms/contentful");
        String spaceId = secret.get("spaceId").asText();
        String mgmtToken = secret.get("mgmtToken").asText();

        String url = "https://api.contentful.com/spaces/" + spaceId + "/entries";

        Map<String, Object> fields = Map.of(
                "fields", Map.of(
                        "title", Map.of(locale != null ? locale : "en-US", title),
                        "body", Map.of(locale != null ? locale : "en-US", body)
                )
        );

        try {
            String response = webClient.post()
                    .uri(url)
                    .header("Authorization", "Bearer " + mgmtToken)
                    .header("Content-Type", "application/vnd.contentful.management.v1+json")
                    .header("X-Contentful-Content-Type", "genaiContent")
                    .bodyValue(objectMapper.writeValueAsString(fields))
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            JsonNode result = objectMapper.readTree(response);
            String entryId = result.path("sys").path("id").asText();
            log.info("Published to Contentful: entryId={}", entryId);
            return entryId;
        } catch (Exception e) {
            log.error("Contentful publish error: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to publish to Contentful", e);
        }
    }

    // ── Strapi ───────────────────────────────────────────────

    private String publishToStrapi(String title, String body, String locale) {
        JsonNode secret = getSecret("genai/cms/strapi");
        String strapiUrl = secret.get("url").asText();
        String apiToken = secret.get("apiToken").asText();

        String url = strapiUrl + "/api/content-pieces";

        Map<String, Object> payload = Map.of(
                "data", Map.of(
                        "title", title,
                        "body", body,
                        "locale", locale != null ? locale : "en"
                )
        );

        try {
            String response = webClient.post()
                    .uri(url)
                    .header("Authorization", "Bearer " + apiToken)
                    .header("Content-Type", "application/json")
                    .bodyValue(objectMapper.writeValueAsString(payload))
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            JsonNode result = objectMapper.readTree(response);
            String entryId = result.path("data").path("id").asText();
            log.info("Published to Strapi: entryId={}", entryId);
            return entryId;
        } catch (Exception e) {
            log.error("Strapi publish error: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to publish to Strapi", e);
        }
    }

    // ── WordPress ────────────────────────────────────────────

    private String publishToWordPress(String title, String body, String locale) {
        JsonNode secret = getSecret("genai/cms/wordpress");
        String wpUrl = secret.get("url").asText();
        String wpUser = secret.get("user").asText();
        String appPassword = secret.get("appPassword").asText();

        String url = wpUrl + "/wp-json/wp/v2/posts";
        String basicAuth = Base64.getEncoder().encodeToString((wpUser + ":" + appPassword).getBytes());

        Map<String, Object> payload = Map.of(
                "title", title,
                "content", body,
                "status", "publish",
                "meta", Map.of("locale", locale != null ? locale : "en")
        );

        try {
            String response = webClient.post()
                    .uri(url)
                    .header("Authorization", "Basic " + basicAuth)
                    .header("Content-Type", "application/json")
                    .bodyValue(objectMapper.writeValueAsString(payload))
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();

            JsonNode result = objectMapper.readTree(response);
            String postId = result.path("id").asText();
            log.info("Published to WordPress: postId={}", postId);
            return postId;
        } catch (Exception e) {
            log.error("WordPress publish error: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to publish to WordPress", e);
        }
    }

    // ── Secrets Manager ──────────────────────────────────────

    private JsonNode getSecret(String secretName) {
        try {
            String secretString = secretsManagerClient.getSecretValue(
                    GetSecretValueRequest.builder().secretId(secretName).build()
            ).secretString();
            return objectMapper.readTree(secretString);
        } catch (Exception e) {
            log.error("Failed to retrieve secret {}: {}", secretName, e.getMessage());
            throw new RuntimeException("Secrets Manager error: " + secretName, e);
        }
    }
}
