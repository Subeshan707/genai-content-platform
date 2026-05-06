/**
 * GenAI Content Platform — Shared TypeScript Types
 * Used by CDK, frontend, and any Node.js Lambda functions.
 */

// ═══════════════════════════════════════════════════════════
// Content Piece Status Machine
// ═══════════════════════════════════════════════════════════

export const CONTENT_STATUSES = [
  'draft', 'generating', 'review', 'approved',
  'localizing', 'localized', 'publishing', 'published',
] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const STATUS_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ['generating'],
  generating: ['review', 'draft'],
  review: ['approved', 'draft'],
  approved: ['localizing', 'publishing'],
  localizing: ['localized'],
  localized: ['publishing'],
  publishing: ['published'],
  published: [],
};

// ═══════════════════════════════════════════════════════════
// RBAC
// ═══════════════════════════════════════════════════════════

export const ROLES = ['CREATOR', 'EDITOR', 'PUBLISHER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  CREATOR: ['content:create', 'content:read', 'content:update:own'],
  EDITOR: ['content:create', 'content:read', 'content:update', 'content:approve', 'content:reject'],
  PUBLISHER: ['content:create', 'content:read', 'content:update', 'content:approve', 'content:publish', 'audit:read'],
  ADMIN: ['*'],
};

// ═══════════════════════════════════════════════════════════
// Content Types
// ═══════════════════════════════════════════════════════════

export const CONTENT_TYPES = ['article', 'script', 'social', 'email', 'ad'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// ═══════════════════════════════════════════════════════════
// Supported Locales
// ═══════════════════════════════════════════════════════════

export const SUPPORTED_LOCALES = [
  'en-US', 'fr-FR', 'es-ES', 'de-DE', 'ja-JP', 'pt-BR',
  'zh-CN', 'ko-KR', 'it-IT', 'nl-NL', 'ar-SA', 'hi-IN', 'ru-RU',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// ═══════════════════════════════════════════════════════════
// AWS Model Config (FREE TIER ONLY)
// ═══════════════════════════════════════════════════════════

export const APPROVED_MODELS = {
  text: {
    modelId: 'meta.llama3-1-8b-instruct-v1:0',
    name: 'Llama 3.1 8B Instruct',
    freeTierLimit: '1000 input / 1000 output units',
  },
  textLite: {
    modelId: 'amazon.titan-text-lite-v1',
    name: 'Amazon Titan Text Lite',
    freeTierLimit: '300M tokens for 12 months',
  },
  embed: {
    modelId: 'amazon.titan-embed-text-v2:0',
    name: 'Amazon Titan Embed Text V2',
    freeTierLimit: '1000 units/month',
  },
  image: {
    modelId: 'amazon.titan-image-generator-v1',
    name: 'Amazon Titan Image Generator',
    freeTierLimit: '500 images/month',
  },
  translate: {
    service: 'Amazon Translate',
    freeTierLimit: '2M chars/month for 12 months',
  },
  transcribe: {
    service: 'Amazon Transcribe',
    freeTierLimit: '60 minutes/month for 12 months',
  },
} as const;

// ═══════════════════════════════════════════════════════════
// SQS Queue Names (shared between services)
// ═══════════════════════════════════════════════════════════

export const QUEUE_NAMES = {
  contentIngest: 'content-ingest.fifo',
  localize: 'localize.fifo',
  imageGenerate: 'image-generate',
  cmsPublish: 'cms-publish.fifo',
} as const;

// ═══════════════════════════════════════════════════════════
// Event Types (EventBridge)
// ═══════════════════════════════════════════════════════════

export const EVENT_TYPES = {
  contentCreated: 'ContentCreated',
  contentGenerated: 'ContentGenerated',
  contentApproved: 'ContentApproved',
  contentPublished: 'ContentPublished',
  localizationComplete: 'LocalizationComplete',
  transcriptionComplete: 'TranscriptionComplete',
  imageGenerated: 'ImageGenerated',
} as const;
