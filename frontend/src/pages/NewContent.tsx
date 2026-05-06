import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrandWorkspaces, useCreateContent } from '@/hooks/useApi';
import { useAuthStore, useUIStore } from '@/stores';
import { PenSquare, Sparkles, FileText, Video, MessageSquare, Mail, Megaphone } from 'lucide-react';
import type { ContentType } from '@/types';

const contentTypes: { value: ContentType; label: string; icon: typeof FileText; desc: string }[] = [
  { value: 'article', label: 'Article', icon: FileText, desc: 'Blog posts, news articles, thought leadership' },
  { value: 'script', label: 'Script', icon: Video, desc: 'Video scripts, podcasts, webinar outlines' },
  { value: 'social', label: 'Social Media', icon: MessageSquare, desc: 'Social posts, threads, captions' },
  { value: 'email', label: 'Email', icon: Mail, desc: 'Newsletters, drip campaigns, announcements' },
  { value: 'ad', label: 'Ad Copy', icon: Megaphone, desc: 'Display ads, search ads, sponsored content' },
];

const availableLocales = [
  'fr-FR', 'es-ES', 'de-DE', 'ja-JP', 'pt-BR', 'zh-CN', 'ko-KR',
  'it-IT', 'nl-NL', 'ar-SA', 'hi-IN', 'ru-RU',
];

export default function NewContent() {
  const navigate = useNavigate();
  const createContent = useCreateContent();
  const workspacesQuery = useBrandWorkspaces();

  const activeWorkspaceId = useUIStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useUIStore((s) => s.setActiveWorkspace);
  const authWorkspaceId = useAuthStore((s) => s.user?.workspaceId ?? null);

  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [contentType, setContentType] = useState<ContentType>('article');
  const [selectedLocales, setSelectedLocales] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId ?? authWorkspaceId ?? '');
  const [workspaceError, setWorkspaceError] = useState('');

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

  const toggleLocale = (locale: string) => {
    setSelectedLocales((prev) =>
      prev.includes(locale) ? prev.filter((l) => l !== locale) : [...prev, locale]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!workspaceId) {
      setWorkspaceError('Select a workspace before creating content.');
      return;
    }

    try {
      const piece = await createContent.mutateAsync({
        workspaceId,
        title,
        brief,
        contentType,
        targetLocales: selectedLocales,
      });
      navigate(`/editor/${piece.id}`);
    } catch (err) {
      console.error('Create failed:', err);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-cyan-500
                        flex items-center justify-center shadow-glow">
          <PenSquare className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Create New Content</h1>
          <p className="text-sm text-surface-500">Describe what you need and let AI do the heavy lifting</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div className="glass-card p-6 space-y-4">
          {workspacesQuery.data && workspacesQuery.data.length > 0 ? (
            <label className="block">
              <span className="text-sm font-medium text-surface-300 mb-1.5 block">Workspace</span>
              <select
                value={workspaceId}
                onChange={(e) => {
                  const next = e.target.value;
                  setWorkspaceId(next);
                  setActiveWorkspace(next);
                  setWorkspaceError('');
                }}
                className="select-base"
              >
                {workspacesQuery.data.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="text-sm font-medium text-surface-300 mb-1.5 block">Workspace ID</span>
            <input
              type="text"
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value.trim());
                setWorkspaceError('');
              }}
              placeholder="Enter workspace UUID"
              className="input-base"
              required
            />
          </label>

          {workspaceError ? (
            <p className="text-xs text-accent-rose">{workspaceError}</p>
          ) : null}

          <label className="block">
            <span className="text-sm font-medium text-surface-300 mb-1.5 block">Title</span>
            <input
              type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Q4 Holiday Campaign Script"
              className="input-base" required
            />
          </label>

          {/* Brief */}
          <label className="block">
            <span className="text-sm font-medium text-surface-300 mb-1.5 block">Content Brief</span>
            <textarea
              value={brief} onChange={(e) => setBrief(e.target.value)}
              placeholder="Describe the content you need. Include target audience, key messages, tone, and any specific requirements..."
              className="textarea-base h-40" required minLength={10}
            />
            <p className="mt-1.5 text-xs text-surface-600">
              {brief.length} characters · Min 10 required
            </p>
          </label>
        </div>

        {/* Content Type */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-medium text-surface-300 mb-4">Content Type</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {contentTypes.map(({ value, label, icon: Icon, desc }) => (
              <button
                type="button" key={value}
                onClick={() => setContentType(value)}
                className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-200
                  ${contentType === value
                    ? 'bg-brand-600/10 border-brand-500/40 ring-1 ring-brand-500/20'
                    : 'bg-surface-800/40 border-surface-700/40 hover:bg-surface-800/70 hover:border-surface-600/50'
                  }`}
              >
                <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${contentType === value ? 'text-brand-400' : 'text-surface-500'}`} />
                <div>
                  <p className={`text-sm font-medium ${contentType === value ? 'text-brand-300' : 'text-surface-300'}`}>
                    {label}
                  </p>
                  <p className="text-xs text-surface-600 mt-0.5">{desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Target Locales */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-medium text-surface-300 mb-1">Target Locales</h3>
          <p className="text-xs text-surface-600 mb-4">Select target languages for automatic translation after approval</p>
          <div className="flex flex-wrap gap-2">
            {availableLocales.map((locale) => (
              <button
                type="button" key={locale}
                onClick={() => toggleLocale(locale)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200
                  ${selectedLocales.includes(locale)
                    ? 'bg-brand-600/15 border-brand-500/40 text-brand-300'
                    : 'bg-surface-800/40 border-surface-700/40 text-surface-500 hover:border-surface-600/60 hover:text-surface-300'
                  }`}
              >
                {locale}
              </button>
            ))}
          </div>
          {selectedLocales.length > 0 && (
            <p className="mt-3 text-xs text-surface-500">
              {selectedLocales.length} locale{selectedLocales.length > 1 ? 's' : ''} selected
            </p>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/')} className="btn-secondary">
            Cancel
          </button>
          <button
            type="submit" className="btn-primary"
            disabled={!workspaceId || !title || brief.length < 10 || createContent.isPending}
          >
            <Sparkles className="w-4 h-4" />
            {createContent.isPending ? 'Creating...' : 'Create & Open Editor'}
          </button>
        </div>
      </form>
    </div>
  );
}
