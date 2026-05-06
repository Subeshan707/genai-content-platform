package com.genai.platform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * GenAI Content Platform — Core Service
 * Handles auth, RBAC, CMS integrations, and audit logging.
 */
@SpringBootApplication
@EnableJpaAuditing
@EnableAsync
public class CoreServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(CoreServiceApplication.class, args);
    }
}
