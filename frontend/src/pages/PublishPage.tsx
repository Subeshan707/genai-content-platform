import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApproveContent, useContentPiece, usePublishContent } from '@/hooks/useApi';
import { Send, CheckCircle, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';

const cmsTargets = [
  {
    id: 'contentful', name: 'Contentful', desc: 'Headless CMS for omnichannel delivery',
    color: 'from-blue-500 to-blue-600',
  },
  {
    id: 'strapi', name: 'Strapi', desc: 'Open-source self-hosted CMS',
    color: 'from-violet-500 to-purple-600',
  },
  {
    id: 'wordpress', name: 'WordPress', desc: 'World\'s most popular CMS',
    color: 'from-sky-500 to-cyan-600',
  },
] as const;

export default function PublishPage() {
  const { id: pieceId } = useParams<{ id: string }>();
  const publishContent = usePublishContent();
  const approveContent = useApproveContent();
  const { data: piece } = useContentPiece(pieceId || '');

  const [selectedCms, setSelectedCms] = useState<string>('');
  const [locale, setLocale] = useState('en');
  const [isApproved, setIsApproved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!piece) return;
    setIsApproved(['approved', 'localized', 'publishing', 'published'].includes(piece.status));
  }, [piece]);

  const handleApprove = async () => {
    if (!pieceId) return;
    try {
      setActionError(null);
      setPublishSuccess(null);
      await approveContent.mutateAsync({ pieceId, comment: 'Approved for publishing' });
      setIsApproved(true);
    } catch (err) {
      console.error('Approval failed:', err);
      setActionError(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handlePublish = async () => {
    if (!pieceId || !selectedCms) return;
    try {
      setActionError(null);
      const result = await publishContent.mutateAsync({
        pieceId,
        cmsTarget: selectedCms as 'contentful' | 'strapi' | 'wordpress',
        locale,
      });
      setPublishSuccess(
        `Published to ${result.cmsTarget} (${result.status})${result.externalId ? ` · External ID: ${result.externalId}` : ''}`,
      );
    } catch (err) {
      console.error('Publish failed:', err);
      setActionError(err instanceof Error ? err.message : 'Publish failed');
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600
                        flex items-center justify-center shadow-glow">
          <Send className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Publish Content</h1>
          <p className="text-sm text-surface-500">Approve and publish to your CMS</p>
        </div>
      </div>

      {/* Step 1: Approve */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-brand-600/20 text-brand-400 flex items-center justify-center text-xs">1</span>
            Approve Content
          </h3>
          {isApproved && (
            <span className="badge-approved">
              <CheckCircle className="w-3 h-3" /> Approved
            </span>
          )}
        </div>
        {!isApproved ? (
          <button onClick={handleApprove} disabled={approveContent.isPending} className="btn-success">
            {approveContent.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Approve for Publishing
          </button>
        ) : (
          <p className="text-sm text-surface-400">Content has been approved. Select a CMS below.</p>
        )}
      </div>

      {/* Step 2: Select CMS */}
      <div className={`glass-card p-6 mb-6 transition-opacity ${isApproved ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <span className="w-6 h-6 rounded-full bg-brand-600/20 text-brand-400 flex items-center justify-center text-xs">2</span>
          Select CMS Target
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {cmsTargets.map((cms) => (
            <button
              key={cms.id}
              onClick={() => setSelectedCms(cms.id)}
              className={`p-4 rounded-xl border text-left transition-all duration-200
                ${selectedCms === cms.id
                  ? 'bg-brand-600/10 border-brand-500/40 ring-1 ring-brand-500/20'
                  : 'bg-surface-800/40 border-surface-700/40 hover:bg-surface-800/70'
                }`}
            >
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${cms.color}
                              flex items-center justify-center mb-2`}>
                <ExternalLink className="w-4 h-4 text-white" />
              </div>
              <p className="text-sm font-medium text-surface-200">{cms.name}</p>
              <p className="text-xs text-surface-600 mt-0.5">{cms.desc}</p>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="text-xs text-surface-400 block mb-1">Locale</label>
          <select value={locale} onChange={(e) => setLocale(e.target.value)} className="select-base w-40">
            <option value="en">English</option>
            <option value="fr-FR">French</option>
            <option value="es-ES">Spanish</option>
            <option value="de-DE">German</option>
            <option value="ja-JP">Japanese</option>
          </select>
        </div>
      </div>

      {/* Step 3: Publish */}
      <div className={`glass-card p-6 transition-opacity ${selectedCms ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
          <span className="w-6 h-6 rounded-full bg-brand-600/20 text-brand-400 flex items-center justify-center text-xs">3</span>
          Publish
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex-1 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <div className="flex items-center gap-2 text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">This will publish to the live CMS</span>
            </div>
          </div>
          <button onClick={handlePublish} disabled={publishContent.isPending || !selectedCms} className="btn-primary">
            {publishContent.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Publish Now
          </button>
        </div>
        {actionError ? <p className="mt-3 text-xs text-accent-rose">{actionError}</p> : null}
        {publishSuccess ? <p className="mt-3 text-xs text-emerald-400">{publishSuccess}</p> : null}
      </div>
    </div>
  );
}
