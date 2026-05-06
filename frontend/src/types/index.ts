/**
 * GenAI Content Platform — TypeScript Types
 * Runtime validation via Zod, type inference via z.infer
 */
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════

export const ContentTypeEnum = z.enum(['article', 'script', 'social', 'email', 'ad']);
export type ContentType = z.infer<typeof ContentTypeEnum>;

export const StatusEnum = z.enum([
  'draft', 'generating', 'review', 'approved',
  'localizing', 'localized', 'publishing', 'published',
]);
export type Status = z.infer<typeof StatusEnum>;

export const RoleEnum = z.enum(['CREATOR', 'EDITOR', 'PUBLISHER', 'ADMIN']);
export type Role = z.infer<typeof RoleEnum>;

export const LocaleStatusEnum = z.enum(['pending', 'approved', 'published']);
export type LocaleStatus = z.infer<typeof LocaleStatusEnum>;

// ═══════════════════════════════════════════════════════════
// API Response Schemas (Zod runtime validation)
// ═══════════════════════════════════════════════════════════

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: RoleEnum,
  workspaceId: z.string().uuid().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  brandKbId: z.string().nullable(),
  createdAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const ContentPieceSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  brief: z.string(),
  contentType: ContentTypeEnum,
  status: StatusEnum,
  targetLocales: z.array(z.string()),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentPiece = z.infer<typeof ContentPieceSchema>;

export const ContentVersionSchema = z.object({
  id: z.string().uuid(),
  pieceId: z.string().uuid(),
  versionNum: z.number(),
  body: z.string(),
  modelUsed: z.string(),
  promptHash: z.string(),
  tokensUsed: z.number().nullable(),
  latencyMs: z.number().nullable(),
  createdAt: z.string(),
});
export type ContentVersion = z.infer<typeof ContentVersionSchema>;

export const LocaleVariantSchema = z.object({
  locale: z.string(),
  translatedBody: z.string(),
  status: LocaleStatusEnum,
  modelUsed: z.string().nullable().optional(),
  subtitleSrt: z.string().nullable().optional(),
  subtitleVtt: z.string().nullable().optional(),
  imageUrls: z.array(z.string()).optional(),
  approvedBy: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export type LocaleVariant = z.infer<typeof LocaleVariantSchema>;

export const AuditEntrySchema = z.object({
  id: z.number(),
  pieceId: z.string().uuid().nullable(),
  action: z.string(),
  actorId: z.string().uuid(),
  modelUsed: z.string().nullable(),
  metadata: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const GenerateResponseSchema = z.object({
  pieceId: z.string(),
  versionId: z.string(),
  versionNum: z.number(),
  body: z.string(),
  modelUsed: z.string(),
  tokensUsed: z.number(),
  latencyMs: z.number(),
  brandContextCount: z.number(),
});
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

export const LocalizeResponseSchema = z.object({
  pieceId: z.string(),
  sourceLanguage: z.string(),
  variants: z.array(LocaleVariantSchema),
  totalLocales: z.number(),
  completedLocales: z.number(),
});
export type LocalizeResponse = z.infer<typeof LocalizeResponseSchema>;

export interface ImageAsset {
  id: string;
  pieceId: string;
  locale?: string | null;
  prompt?: string;
  status: 'processing' | 'completed' | 'failed';
  imageUrl?: string;
  error?: string | null;
  createdAt?: string | null;
}

export interface ImageGenerateResponse {
  pieceId: string;
  messageId?: string;
  queueUrl?: string;
  imageUrls?: string[];
  status: string;
}

export interface BrandDocument {
  document_name: string;
  chunks: number;
  status: string;
  last_ingested_at?: string | null;
}

export interface BrandDocumentUploadResponse {
  workspace_id: string;
  document_name: string;
  chunks_created: number;
  embedding_model: string;
  s3_key?: string | null;
  status: string;
}

export interface BrandDocumentDeleteResponse {
  workspace_id: string;
  document_name: string;
  deleted_chunks: number;
  status: string;
}

export interface BrandWorkspace {
  id: string;
  name: string;
  created_at?: string | null;
}

// ═══════════════════════════════════════════════════════════
// Request Types
// ═══════════════════════════════════════════════════════════

export interface CreateContentRequest {
  workspaceId: string;
  title: string;
  brief: string;
  contentType: ContentType;
  targetLocales: string[];
}

export interface GenerateRequest {
  workspaceId: string;
  pieceId: string;
  brief: string;
  contentType: ContentType;
  tone?: string;
  maxTokens?: number;
  temperature?: number;
  useBrandVoice?: boolean;
  connectionId?: string;
}

export interface LocalizeRequest {
  workspaceId: string;
  pieceId: string;
  sourceText: string;
  sourceLanguage?: string;
  targetLocales: string[];
  refineWithLlm?: boolean;
}

export interface PublishRequest {
  cmsTarget: 'contentful' | 'strapi' | 'wordpress';
  locale?: string;
}

export interface PublishResponse {
  pieceId: string;
  cmsTarget: string;
  locale: string;
  status: string;
  externalId: string;
}

// ═══════════════════════════════════════════════════════════
// WebSocket Message Types
// ═══════════════════════════════════════════════════════════

export interface StreamToken {
  type: 'token';
  text: string;
  pieceId?: string;
}

export interface StreamComplete {
  type: 'complete';
  pieceId: string;
  versionId: string;
  totalTokens: number;
  modelUsed: string;
}

export interface StreamError {
  type: 'error';
  message: string;
  pieceId?: string;
}

export type StreamMessage = StreamToken | StreamComplete | StreamError;
