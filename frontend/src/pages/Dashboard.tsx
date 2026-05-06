import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PenSquare, FileText, Globe, TrendingUp,
  Clock, Sparkles, ArrowRight, Zap,
} from 'lucide-react';

import { useBrandWorkspaces, useContentList } from '@/hooks/useApi';
import { useAuthStore, useUIStore } from '@/stores';

const statusColors: Record<string, string> = {
  draft: 'badge-draft',
  generating: 'badge-generating',
  review: 'badge-review',
  approved: 'badge-approved',
  localized: 'badge-approved',
  published: 'badge-published',
};

function formatRelativeTime(value?: string): string {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Dashboard() {
  const navigate = useNavigate();

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

  const contentQuery = useContentList(workspaceId, 0, 20);
  const items = contentQuery.data?.items ?? [];

  const stats = useMemo(() => {
    const total = contentQuery.data?.total ?? 0;
    const inReview = items.filter((item) => item.status === 'review').length;
    const published = items.filter((item) => item.status === 'published').length;
    const localesActive = new Set(items.flatMap((item) => item.targetLocales ?? [])).size;

    return [
      { label: 'Total Content', value: total.toString(), icon: FileText, color: 'from-brand-500 to-brand-600' },
      { label: 'In Review', value: inReview.toString(), icon: Clock, color: 'from-amber-500 to-orange-500' },
      { label: 'Published', value: published.toString(), icon: TrendingUp, color: 'from-emerald-500 to-green-500' },
      { label: 'Locales Active', value: localesActive.toString(), icon: Globe, color: 'from-cyan-500 to-blue-500' },
    ];
  }, [contentQuery.data?.total, items]);

  const recentItems = useMemo(
    () => [...items]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5),
    [items],
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="glass-card p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-600/10 via-transparent to-cyan-500/5" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-brand-400" />
                <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">
                  AI-Powered
                </span>
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Welcome to <span className="text-gradient">GenAI Content Platform</span>
              </h1>
              <p className="text-surface-400 max-w-xl mb-6">
                Create, localize, and publish on-brand content from one workflow.
              </p>
            </div>

            <div className="min-w-[280px]">
              <label className="block text-xs text-surface-500 mb-2">Workspace</label>
              <select
                value={workspaceId}
                onChange={(e) => {
                  const next = e.target.value;
                  setWorkspaceId(next);
                  setActiveWorkspace(next);
                }}
                className="select-base w-full"
              >
                {(workspacesQuery.data ?? []).map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button onClick={() => navigate('/new')} className="btn-primary">
            <PenSquare className="w-4 h-4" />
            Create New Content
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card-hover p-5 group">
            <div className="flex items-center justify-between mb-3">
              <div
                className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color}
                              flex items-center justify-center shadow-lg
                              group-hover:scale-110 transition-transform duration-300`}
              >
                <stat.icon className="w-5 h-5 text-white" />
              </div>
              <Zap className="w-4 h-4 text-surface-600 group-hover:text-brand-400 transition-colors" />
            </div>
            <p className="text-2xl font-bold text-white mb-0.5">{stat.value}</p>
            <p className="text-xs text-surface-500 font-medium">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700/40 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Recent Content</h2>
          <button
            className="btn-ghost text-xs"
            onClick={() => contentQuery.refetch()}
            disabled={contentQuery.isFetching}
          >
            {contentQuery.isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {contentQuery.isLoading ? (
          <div className="px-6 py-10 text-center text-sm text-surface-500">
            Loading content...
          </div>
        ) : contentQuery.isError ? (
          <div className="px-6 py-10 text-center text-sm text-accent-rose">
            Failed to load content. {(contentQuery.error as Error).message}
          </div>
        ) : recentItems.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-surface-500">
            No content yet in this workspace. Create your first piece to get started.
          </div>
        ) : (
          <div className="divide-y divide-surface-700/30">
            {recentItems.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(`/editor/${item.id}`)}
                className="w-full flex items-center gap-4 px-6 py-4 text-left
                         hover:bg-surface-800/40 transition-colors duration-200 group"
              >
                <div
                  className="w-10 h-10 rounded-xl bg-surface-800 flex items-center justify-center
                              group-hover:bg-brand-600/15 transition-colors"
                >
                  <FileText className="w-5 h-5 text-surface-400 group-hover:text-brand-400 transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-200 truncate group-hover:text-white transition-colors">
                    {item.title}
                  </p>
                  <p className="text-xs text-surface-500 mt-0.5">
                    <span className="capitalize">{item.contentType}</span> · {formatRelativeTime(item.updatedAt)}
                  </p>
                </div>
                <span className={statusColors[item.status] ?? 'badge-draft'}>{item.status}</span>
                <ArrowRight
                  className="w-4 h-4 text-surface-600 group-hover:text-brand-400
                                     group-hover:translate-x-1 transition-all"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
