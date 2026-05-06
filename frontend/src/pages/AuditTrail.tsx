import { useEffect, useMemo, useState } from 'react';
import { FileText, User, Clock, Filter, Loader2 } from 'lucide-react';

import { useAuditTrail, useBrandWorkspaces, useContentList } from '@/hooks/useApi';
import { useAuthStore, useUIStore } from '@/stores';

const actionColors: Record<string, string> = {
  content_created: 'text-brand-400 bg-brand-500/10',
  content_generated: 'text-emerald-400 bg-emerald-500/10',
  content_approved: 'text-amber-400 bg-amber-500/10',
  content_localized: 'text-violet-400 bg-violet-500/10',
  content_publish_queued: 'text-cyan-400 bg-cyan-500/10',
  cms_published: 'text-cyan-300 bg-cyan-500/10',
  transcription_submitted: 'text-rose-400 bg-rose-500/10',
};

function formatRelativeTime(value?: string): string {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AuditTrail() {
  const activeWorkspaceId = useUIStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useUIStore((s) => s.setActiveWorkspace);
  const authWorkspaceId = useAuthStore((s) => s.user?.workspaceId ?? null);

  const workspacesQuery = useBrandWorkspaces();
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId ?? authWorkspaceId ?? '');
  const [selectedPieceId, setSelectedPieceId] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

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

  const contentQuery = useContentList(workspaceId, 0, 100);
  const pieces = contentQuery.data?.items ?? [];

  useEffect(() => {
    if (!selectedPieceId && pieces.length > 0) {
      setSelectedPieceId(pieces[0].id);
    }
  }, [selectedPieceId, pieces]);

  const auditQuery = useAuditTrail(selectedPieceId);

  const actions = useMemo(() => {
    const source = auditQuery.data ?? [];
    const unique = new Set<string>();
    for (const entry of source) {
      unique.add(entry.action);
    }
    return [...unique].sort();
  }, [auditQuery.data]);

  const rows = useMemo(() => {
    const source = auditQuery.data ?? [];
    if (actionFilter === 'all') {
      return source;
    }
    return source.filter((entry) => entry.action === actionFilter);
  }, [auditQuery.data, actionFilter]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-surface-500 to-surface-600
                          flex items-center justify-center shadow-glow">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Audit Trail</h1>
            <p className="text-sm text-surface-500">Live event history for the selected content piece</p>
          </div>
        </div>
        <button
          className="btn-secondary text-xs"
          onClick={() => {
            contentQuery.refetch();
            auditQuery.refetch();
          }}
        >
          <Filter className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="glass-card p-4 mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-surface-500 mb-1">Workspace</label>
          <select
            value={workspaceId}
            onChange={(e) => {
              const next = e.target.value;
              setWorkspaceId(next);
              setActiveWorkspace(next);
              setSelectedPieceId('');
            }}
            className="select-base"
          >
            {(workspacesQuery.data ?? []).map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-surface-500 mb-1">Content Piece</label>
          <select
            value={selectedPieceId}
            onChange={(e) => setSelectedPieceId(e.target.value)}
            className="select-base"
          >
            {pieces.map((piece) => (
              <option key={piece.id} value={piece.id}>
                {piece.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-surface-500 mb-1">Action Filter</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="select-base"
          >
            <option value="all">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-700/40">
              <th className="px-6 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">Action</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">Piece ID</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">Actor</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">Model</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-700/20">
            {contentQuery.isLoading || auditQuery.isLoading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-surface-500 text-sm">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading audit entries...
                  </span>
                </td>
              </tr>
            ) : contentQuery.isError ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-accent-rose text-sm">
                  Failed to load content list. {(contentQuery.error as Error).message}
                </td>
              </tr>
            ) : auditQuery.isError ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-accent-rose text-sm">
                  Failed to load audit trail. {(auditQuery.error as Error).message}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-surface-500 text-sm">
                  No audit entries for the selected content piece.
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr key={entry.id} className="hover:bg-surface-800/30 transition-colors">
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                    ${actionColors[entry.action] || 'text-surface-400 bg-surface-800'}`}
                    >
                      {entry.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-surface-500 font-mono">{entry.pieceId ?? 'n/a'}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <User className="w-3 h-3 text-surface-600" />
                      <span className="text-xs text-surface-400 font-mono">{entry.actorId}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {entry.modelUsed ? (
                      <span className="text-xs text-surface-500 font-mono">{entry.modelUsed}</span>
                    ) : (
                      <span className="text-xs text-surface-700">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-surface-600" />
                      <span className="text-xs text-surface-500">{formatRelativeTime(entry.createdAt)}</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
