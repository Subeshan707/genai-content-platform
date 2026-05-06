package com.genai.platform.aspect;

import com.genai.platform.entity.AuditLog;
import com.genai.platform.repository.AuditLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Audit aspect — intercepts service methods to automatically log state changes.
 * Uses @Around to capture method arguments and results.
 *
 * NOTE: Injects AuditLogRepository directly (not ContentService) to avoid
 * circular dependency, since ContentService also writes to audit_log.
 */
@Aspect
@Component
@RequiredArgsConstructor
@Slf4j
public class AuditAspect {

    private final AuditLogRepository auditLogRepository;

    /**
     * Intercept content approval and publishing state changes.
     */
    @Around("execution(* com.genai.platform.service.ContentService.approveContent(..)) || " +
            "execution(* com.genai.platform.service.ContentService.publishContent(..))")
    public Object auditStateChange(ProceedingJoinPoint joinPoint) throws Throwable {
        String methodName = joinPoint.getSignature().getName();
        Object[] args = joinPoint.getArgs();
        long startTime = System.currentTimeMillis();

        log.debug("Audit intercepted: method={}, args={}", methodName, args.length);

        try {
            Object result = joinPoint.proceed();
            long duration = System.currentTimeMillis() - startTime;

            log.info("Audit: method={} completed in {}ms", methodName, duration);
            return result;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - startTime;
            log.error("Audit: method={} failed after {}ms: {}", methodName, duration, e.getMessage());
            throw e;
        }
    }

    /**
     * Intercept CMS publish calls for external system audit trail.
     */
    @Around("execution(* com.genai.platform.service.CmsPublishService.publishToCms(..))")
    public Object auditCmsPublish(ProceedingJoinPoint joinPoint) throws Throwable {
        Object[] args = joinPoint.getArgs();
        String cmsTarget = args.length > 0 ? String.valueOf(args[0]) : "unknown";

        long startTime = System.currentTimeMillis();
        Object result = joinPoint.proceed();
        long duration = System.currentTimeMillis() - startTime;

        // Write audit entry for external CMS publish
        try {
            UUID pieceId = null; // CMS publish doesn't always have pieceId in args
            AuditLog entry = AuditLog.builder()
                    .action("cms_published")
                    .actorId(UUID.fromString("00000000-0000-0000-0000-000000000000")) // System actor
                    .modelUsed(null)
                    .metadata(String.format("{\"cmsTarget\":\"%s\",\"durationMs\":%d}", cmsTarget, duration))
                    .build();
            auditLogRepository.save(entry);
        } catch (Exception e) {
            log.error("Failed to write CMS publish audit: {}", e.getMessage());
        }

        log.info("CMS publish audit: target={}, duration={}ms, result={}", cmsTarget, duration, result);
        return result;
    }
}
