/**
 * GenAI Content Platform — TanStack Query API Hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores';
import type {
  ContentPiece, CreateContentRequest, GenerateRequest,
  GenerateResponse, LocalizeRequest, LocalizeResponse,
  LocaleVariant, ContentVersion, AuditEntry, PublishRequest, ImageAsset,
  BrandDocument, BrandDocumentDeleteResponse, BrandDocumentUploadResponse, BrandWorkspace,
  ImageGenerateResponse, PublishResponse, User, Workspace,
} from '@/types';

const normalizeBase = (value: string) => value.replace(/\/+$/, '');

const API_BASE = normalizeBase(
  import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_BASE ?? '/api')
);
const AI_BASE = normalizeBase(
  import.meta.env.DEV ? '/ai' : (import.meta.env.VITE_AI_BASE ?? '/ai')
);

const getPathname = (url: string): string => {
  if (url.startsWith('/')) {
    return url.split('?')[0];
  }
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0];
  }
};

const isPublicCoreRoute = (url: string, method: string): boolean => {
  const verb = method.toUpperCase();
  const path = getPathname(url);

  if (path.startsWith('/api/auth/')) {
    return true;
  }

  if (verb === 'POST' && path === '/api/content') {
    return true;
  }

  if (verb === 'GET') {
    if (path === '/api/content') {
      return true;
    }
    if (/^\/api\/content\/[^/]+$/.test(path)) {
      return true;
    }
    if (/^\/api\/workspaces\/[^/]+$/.test(path)) {
      return true;
    }
    if (/^\/api\/audit\/[^/]+$/.test(path)) {
      return true;
    }
  }

  return false;
};

type ApiFetchOptions = RequestInit & {
  skipAuth?: boolean;
};

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const mapContentVersion = (raw: any): ContentVersion => ({
  id: asString(raw.id),
  pieceId: asString(raw.pieceId ?? raw.piece_id),
  versionNum: asNumber(raw.versionNum ?? raw.version_num),
  body: asString(raw.body),
  modelUsed: asString(raw.modelUsed ?? raw.model_used),
  promptHash: asString(raw.promptHash ?? raw.prompt_hash),
  tokensUsed: raw.tokensUsed ?? raw.tokens_used ?? null,
  latencyMs: raw.latencyMs ?? raw.latency_ms ?? null,
  createdAt: asString(raw.createdAt ?? raw.created_at),
});

const mapLocaleVariant = (raw: any): LocaleVariant => ({
  locale: asString(raw.locale),
  translatedBody: asString(raw.translatedBody ?? raw.translated_body),
  status: asString(raw.status, 'pending') as LocaleVariant['status'],
  modelUsed: raw.modelUsed ?? raw.model_used ?? null,
  subtitleSrt: raw.subtitleSrt ?? raw.subtitle_srt ?? null,
  subtitleVtt: raw.subtitleVtt ?? raw.subtitle_vtt ?? null,
  imageUrls: raw.imageUrls ?? raw.image_urls ?? [],
  approvedBy: raw.approvedBy ?? raw.approved_by ?? null,
  createdAt: raw.createdAt ?? raw.created_at,
});

const mapGenerateResponse = (raw: any): GenerateResponse => ({
  pieceId: asString(raw.pieceId ?? raw.piece_id),
  versionId: asString(raw.versionId ?? raw.version_id),
  versionNum: asNumber(raw.versionNum ?? raw.version_num),
  body: asString(raw.body),
  modelUsed: asString(raw.modelUsed ?? raw.model_used),
  tokensUsed: asNumber(raw.tokensUsed ?? raw.tokens_used),
  latencyMs: asNumber(raw.latencyMs ?? raw.latency_ms),
  brandContextCount: asNumber(raw.brandContextCount ?? raw.brand_context_count),
});

const mapLocalizeResponse = (raw: any): LocalizeResponse => ({
  pieceId: asString(raw.pieceId ?? raw.piece_id),
  sourceLanguage: asString(raw.sourceLanguage ?? raw.source_language, 'en'),
  variants: Array.isArray(raw.variants) ? raw.variants.map(mapLocaleVariant) : [],
  totalLocales: asNumber(raw.totalLocales ?? raw.total_locales),
  completedLocales: asNumber(raw.completedLocales ?? raw.completed_locales),
});

const mapPublishResponse = (raw: any): PublishResponse => ({
  pieceId: asString(raw.pieceId ?? raw.piece_id),
  cmsTarget: asString(raw.cmsTarget ?? raw.cms_target),
  locale: asString(raw.locale),
  status: asString(raw.status),
  externalId: asString(raw.externalId ?? raw.external_id),
});

const mapImageGenerateResponse = (raw: any): ImageGenerateResponse => ({
  pieceId: asString(raw.pieceId ?? raw.piece_id),
  messageId: raw.messageId ?? raw.message_id,
  queueUrl: raw.queueUrl ?? raw.queue_url,
  imageUrls: raw.imageUrls ?? raw.image_urls,
  status: asString(raw.status, 'queued'),
});

async function apiFetch<T>(url: string, options?: ApiFetchOptions): Promise<T> {
  const token = useAuthStore.getState().token;
  const method = (options?.method ?? 'GET').toUpperCase();
  const skipAuth = Boolean(options?.skipAuth) || isPublicCoreRoute(url, method);
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token && !skipAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    headers: { ...headers, ...options?.headers },
    ...options,
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error ${res.status}: ${error}`);
  }

  // CloudFront/ALB can occasionally return HTML for API failures; surface a clear diagnostic.
  if (!contentType.includes('application/json')) {
    const body = await res.text();
    const preview = body.replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(
      `Expected JSON but received '${contentType || 'unknown'}' from ${url}. ` +
      `This usually means API routing/auth failed and an HTML page was returned instead. ` +
      `Body preview: ${preview}`
    );
  }

  return res.json();
}

async function apiFetchForm<T>(
  url: string,
  formData: FormData,
  options?: Omit<ApiFetchOptions, 'body'>,
): Promise<T> {
  const token = useAuthStore.getState().token;
  const method = (options?.method ?? 'POST').toUpperCase();
  const skipAuth = Boolean(options?.skipAuth) || isPublicCoreRoute(url, method);
  const headers: HeadersInit = {};
  if (token && !skipAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    method: options?.method ?? 'POST',
    headers: { ...headers, ...options?.headers },
    body: formData,
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error ${res.status}: ${error}`);
  }

  if (!contentType.includes('application/json')) {
    const body = await res.text();
    const preview = body.replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(
      `Expected JSON but received '${contentType || 'unknown'}' from ${url}. ` +
      `Body preview: ${preview}`
    );
  }

  return res.json();
}

// ═══════════════════════════════════════════════════════════
// Content Queries
// ═══════════════════════════════════════════════════════════

export function useContentList(workspaceId: string, page = 0, size = 20) {
  return useQuery({
    queryKey: ['content', workspaceId, page, size],
    queryFn: () => apiFetch<{ items: ContentPiece[]; total: number }>(
      `${API_BASE}/content?workspaceId=${workspaceId}&page=${page}&size=${size}`,
      { skipAuth: true }
    ),
    enabled: !!workspaceId,
  });
}

export function useContentPiece(pieceId: string) {
  return useQuery({
    queryKey: ['content', pieceId],
    queryFn: () => apiFetch<ContentPiece>(`${API_BASE}/content/${pieceId}`, { skipAuth: true }),
    enabled: !!pieceId,
  });
}

export function useContentVersions(pieceId: string) {
  return useQuery({
    queryKey: ['versions', pieceId],
    queryFn: async () => {
      const data = await apiFetch<any[]>(`${AI_BASE}/versions/${pieceId}`);
      return data.map(mapContentVersion);
    },
    enabled: !!pieceId,
  });
}

export function useLocaleVariants(pieceId: string) {
  return useQuery({
    queryKey: ['locales', pieceId],
    queryFn: async () => {
      const data = await apiFetch<any[]>(`${AI_BASE}/locales/${pieceId}`);
      return data.map(mapLocaleVariant);
    },
    enabled: !!pieceId,
  });
}

export function useImageAssets(pieceId: string) {
  return useQuery({
    queryKey: ['image-assets', pieceId],
    queryFn: () => apiFetch<ImageAsset[]>(`${AI_BASE}/image/${pieceId}`, { skipAuth: true }),
    enabled: !!pieceId,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
}

export function useBrandWorkspaces() {
  return useQuery({
    queryKey: ['brand-workspaces'],
    queryFn: () => apiFetch<BrandWorkspace[]>(`${AI_BASE}/brand/workspaces`, { skipAuth: true }),
  });
}

export function useBrandDocuments(workspaceId: string) {
  return useQuery({
    queryKey: ['brand-docs', workspaceId],
    queryFn: () => apiFetch<BrandDocument[]>(`${AI_BASE}/brand/documents/${workspaceId}`, { skipAuth: true }),
    enabled: !!workspaceId,
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['auth-me'],
    queryFn: () => apiFetch<User>(`${API_BASE}/auth/me`),
    retry: false,
  });
}

export function useWorkspace(workspaceId: string) {
  return useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => apiFetch<Workspace>(`${API_BASE}/workspaces/${workspaceId}`),
    enabled: !!workspaceId,
  });
}

export function useUploadBrandDocument(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      chunkSize,
      chunkOverlap,
    }: {
      file: File;
      chunkSize?: number;
      chunkOverlap?: number;
    }) => {
      const formData = new FormData();
      formData.append('workspace_id', workspaceId);
      formData.append('file', file);
      if (typeof chunkSize === 'number') {
        formData.append('chunk_size', String(chunkSize));
      }
      if (typeof chunkOverlap === 'number') {
        formData.append('chunk_overlap', String(chunkOverlap));
      }
      return apiFetchForm<BrandDocumentUploadResponse>(
        `${AI_BASE}/brand/documents/upload`,
        formData,
        { skipAuth: true },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brand-docs', workspaceId] }),
  });
}

export function useDeleteBrandDocument(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentName: string) =>
      apiFetch<BrandDocumentDeleteResponse>(
        `${AI_BASE}/brand/documents/${workspaceId}?document_name=${encodeURIComponent(documentName)}`,
        { method: 'DELETE', skipAuth: true },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brand-docs', workspaceId] }),
  });
}

export function useAuditTrail(pieceId: string) {
  return useQuery({
    queryKey: ['audit', pieceId],
    queryFn: () => apiFetch<AuditEntry[]>(`${API_BASE}/audit/${pieceId}`),
    enabled: !!pieceId,
  });
}

// ═══════════════════════════════════════════════════════════
// Content Mutations
// ═══════════════════════════════════════════════════════════

export function useCreateContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateContentRequest) =>
      apiFetch<ContentPiece>(`${API_BASE}/content`, {
        method: 'POST',
        body: JSON.stringify(data),
        skipAuth: true,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content'] }),
  });
}

export function useGenerateContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: GenerateRequest) => {
      const raw = await apiFetch<any>(`${AI_BASE}/generate`, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: data.workspaceId,
          piece_id: data.pieceId,
          brief: data.brief,
          content_type: data.contentType,
          tone: data.tone,
          max_tokens: data.maxTokens,
          temperature: data.temperature,
          use_brand_voice: data.useBrandVoice,
          connection_id: data.connectionId,
        }),
      });
      return mapGenerateResponse(raw);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['versions', vars.pieceId] });
      qc.invalidateQueries({ queryKey: ['content', vars.pieceId] });
    },
  });
}

export function useLocalizeContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: LocalizeRequest) => {
      const raw = await apiFetch<any>(`${AI_BASE}/localize`, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: data.workspaceId,
          piece_id: data.pieceId,
          source_text: data.sourceText,
          source_language: data.sourceLanguage,
          target_locales: data.targetLocales,
          refine_with_llm: data.refineWithLlm,
        }),
      });
      return mapLocalizeResponse(raw);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['locales', vars.pieceId] });
    },
  });
}

export function useGenerateImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      pieceId: string;
      prompt: string;
      negativePrompt?: string;
      locale?: string;
      width?: number;
      height?: number;
      numImages?: number;
    }) => {
      const raw = await apiFetch<any>(`${AI_BASE}/image/generate`, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: data.workspaceId,
          piece_id: data.pieceId,
          prompt: data.prompt,
          negative_prompt: data.negativePrompt,
          locale: data.locale,
          width: data.width ?? 1024,
          height: data.height ?? 1024,
          num_images: data.numImages ?? 1,
        }),
        skipAuth: true,
      });

      return mapImageGenerateResponse(raw);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['image-assets', vars.pieceId] });
    },
  });
}

export function useApproveContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pieceId, comment }: { pieceId: string; comment?: string }) =>
      apiFetch<ContentPiece>(`${API_BASE}/content/${pieceId}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ comment }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['content', vars.pieceId] });
      qc.invalidateQueries({ queryKey: ['content'] });
    },
  });
}

export function usePublishContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pieceId, ...data }: PublishRequest & { pieceId: string }) => {
      const raw = await apiFetch<any>(`${API_BASE}/content/${pieceId}/publish`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return mapPublishResponse(raw);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content'] }),
  });
}
