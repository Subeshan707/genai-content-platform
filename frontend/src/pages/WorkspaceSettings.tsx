import { useEffect, useMemo, useState } from 'react';
import { Settings, Globe, Key, Link as LinkIcon, Loader2 } from 'lucide-react';

import { useBrandDocuments, useBrandWorkspaces, useContentList, useWorkspace } from '@/hooks/useApi';
import { useAuthStore, useUIStore } from '@/stores';

function formatDate(value?: string | null): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function WorkspaceSettings() {
  const activeWorkspaceId = useUIStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useUIStore((s) => s.setActiveWorkspace);
  const authWorkspaceId = useAuthStore((s) => s.user?.workspaceId ?? null);

  const workspacesQuery = useBrandWorkspaces();
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId ?? authWorkspaceId ?? '');

  useEffect(() => {
    if (activeWorkspaceId && activeWorkspaceId !== workspaceId) {
      setWorkspaceId(activeWorkspaceId);
      return;
    }
    if (!workspaceId && authWorkspaceId) {
      setWorkspaceId(authWorkspaceId);
    }
  }, [activeWorkspaceId, authWorkspaceId, workspaceId]);

  useEffect(() => {
    const workspaces = workspacesQuery.data ?? [];
    if (!workspaceId && workspaces.length > 0) {
      const fallback = workspaces[0].id;
      setWorkspaceId(fallback);
      setActiveWorkspace(fallback);
    }
  }, [workspaceId, workspacesQuery.data, setActiveWorkspace]);

  const workspaceQuery = useWorkspace(workspaceId);
  const brandDocsQuery = useBrandDocuments(workspaceId);
  const contentQuery = useContentList(workspaceId, 0, 100);

  const brandDocs = brandDocsQuery.data ?? [];
  const totalChunks = brandDocs.reduce((sum, doc) => sum + doc.chunks, 0);

  const topLocales = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of contentQuery.data?.items ?? []) {
      for (const locale of item.targetLocales ?? []) {
        counts.set(locale, (counts.get(locale) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [contentQuery.data?.items]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-surface-500 to-surface-600
                        flex items-center justify-center shadow-glow">
          <Settings className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Workspace Settings</h1>
          <p className="text-sm text-surface-500">Live configuration and workspace health details</p>
        </div>
      </div>

      <div className="glass-card p-6 mb-6">
        <label className="text-xs text-surface-500 block mb-2">Workspace</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            value={workspaceId}
            onChange={(e) => {
              const next = e.target.value;
              setWorkspaceId(next);
              setActiveWorkspace(next);
            }}
            className="select-base"
          >
            {(workspacesQuery.data ?? []).map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>

          <input
            value={workspaceId}
            onChange={(e) => {
              const next = e.target.value.trim();
              setWorkspaceId(next);
              if (next) setActiveWorkspace(next);
            }}
            className="input-base"
            placeholder="Workspace UUID"
          />
        </div>
      </div>

      <div className="glass-card p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-white">Workspace Profile</h3>
        </div>

        {workspaceQuery.isLoading ? (
          <div className="text-sm text-surface-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading workspace profile...
          </div>
        ) : workspaceQuery.isError ? (
          <div className="text-sm text-accent-rose">
            Could not load workspace profile. {(workspaceQuery.error as Error).message}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-800/40">
              <span className="text-sm text-surface-400">Workspace Name</span>
              <span className="text-sm text-surface-200">{workspaceQuery.data?.name ?? 'N/A'}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-800/40">
              <span className="text-sm text-surface-400">Workspace ID</span>
              <span className="text-xs text-surface-500 font-mono">{workspaceId || 'N/A'}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-800/40">
              <span className="text-sm text-surface-400">Brand KB ID</span>
              <span className="text-xs text-surface-500 font-mono">{workspaceQuery.data?.brandKbId ?? 'Not linked'}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-800/40">
              <span className="text-sm text-surface-400">Created At</span>
              <span className="text-xs text-surface-500">{formatDate(workspaceQuery.data?.createdAt)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="glass-card p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <LinkIcon className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-white">Brand Voice Documents</h3>
        </div>

        {brandDocsQuery.isLoading ? (
          <div className="text-sm text-surface-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading brand docs...
          </div>
        ) : brandDocsQuery.isError ? (
          <div className="text-sm text-accent-rose">
            Failed to load brand docs. {(brandDocsQuery.error as Error).message}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-xl bg-surface-800/40">
                <p className="text-xs text-surface-500">Documents</p>
                <p className="text-xl text-white font-semibold">{brandDocs.length}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-800/40">
                <p className="text-xs text-surface-500">Embedded Chunks</p>
                <p className="text-xl text-white font-semibold">{totalChunks}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-800/40">
                <p className="text-xs text-surface-500">Embedding Model</p>
                <p className="text-xs text-surface-300 font-mono mt-1">amazon.titan-embed-text-v2:0</p>
              </div>
            </div>

            <div className="space-y-2">
              {brandDocs.slice(0, 5).map((doc) => (
                <div key={doc.document_name} className="flex items-center justify-between p-3 rounded-xl bg-surface-800/40">
                  <span className="text-sm text-surface-300 truncate">{doc.document_name}</span>
                  <span className="text-xs text-surface-500">{doc.chunks} chunks</span>
                </div>
              ))}
              {brandDocs.length === 0 ? (
                <p className="text-sm text-surface-500">No brand docs ingested for this workspace.</p>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-white">Locale Defaults from Real Content</h3>
        </div>

        {contentQuery.isLoading ? (
          <div className="text-sm text-surface-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Analyzing locale usage...
          </div>
        ) : topLocales.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {topLocales.map(([locale, count]) => (
              <span
                key={locale}
                className="px-3 py-1.5 rounded-lg bg-brand-600/10 border border-brand-500/30
                           text-xs text-brand-300 font-medium"
              >
                {locale} ({count})
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-surface-500">No locale history available yet.</p>
        )}
      </div>
    </div>
  );
}
