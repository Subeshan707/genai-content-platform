import { useParams } from 'react-router-dom';
import { useLocaleVariants } from '@/hooks/useApi';
import { Globe, Loader2 } from 'lucide-react';

const localeNames: Record<string, string> = {
  'fr-FR': '🇫🇷 French', 'es-ES': '🇪🇸 Spanish', 'de-DE': '🇩🇪 German',
  'ja-JP': '🇯🇵 Japanese', 'pt-BR': '🇧🇷 Portuguese', 'zh-CN': '🇨🇳 Chinese',
  'ko-KR': '🇰🇷 Korean', 'it-IT': '🇮🇹 Italian', 'nl-NL': '🇳🇱 Dutch',
  'ar-SA': '🇸🇦 Arabic', 'hi-IN': '🇮🇳 Hindi', 'ru-RU': '🇷🇺 Russian',
};

const statusStyles: Record<string, string> = {
  pending: 'badge-pending',
  approved: 'badge-approved',
  published: 'badge-published',
};

export default function LocaleReview() {
  const { id: pieceId } = useParams<{ id: string }>();
  const { data: variants, isLoading } = useLocaleVariants(pieceId || '');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600
                        flex items-center justify-center shadow-glow">
          <Globe className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Locale Review</h1>
          <p className="text-sm text-surface-500">
            {variants?.length || 0} locale variants · Review and approve translations
          </p>
        </div>
      </div>

      {/* Side-by-side locale cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {variants && variants.length > 0 ? (
          variants.map((variant) => (
            <div key={variant.locale} className="glass-card-hover overflow-hidden">
              {/* Header */}
              <div className="px-5 py-3 border-b border-surface-700/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {localeNames[variant.locale] || variant.locale}
                  </span>
                </div>
                <span className={statusStyles[variant.status] || 'badge-pending'}>
                  {variant.status}
                </span>
              </div>

              {/* Translated content */}
              <div className="p-5">
                <div className="max-h-48 overflow-y-auto text-sm text-surface-300 leading-relaxed">
                  {variant.translatedBody || 'Translation pending...'}
                </div>
              </div>

              {/* Model info */}
              {variant.modelUsed && (
                <div className="px-5 py-2 border-t border-surface-700/20">
                  <p className="text-[10px] text-surface-600">
                    Refined by <span className="font-mono text-surface-500">{variant.modelUsed}</span>
                  </p>
                </div>
              )}

              {/* Image thumbnails */}
              {variant.imageUrls && variant.imageUrls.length > 0 && (
                <div className="px-5 py-3 border-t border-surface-700/20">
                  <div className="flex gap-2 overflow-x-auto">
                    {variant.imageUrls.map((url, i) => (
                      <div key={i} className="w-16 h-16 rounded-lg bg-surface-800 flex-shrink-0 overflow-hidden">
                        <img src={url} alt={`${variant.locale} asset ${i + 1}`}
                          className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Read-only status for now; moderation endpoints are not available yet. */}
              <div className="px-5 py-3 border-t border-surface-700/30">
                <p className="text-[11px] text-surface-600">
                  Locale moderation actions will appear here once approve/reject APIs are enabled.
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full glass-card p-12 text-center">
            <Globe className="w-12 h-12 text-surface-700 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-surface-400 mb-2">No Locale Variants</h3>
            <p className="text-sm text-surface-600">
              Approve the content first, then translations will be generated automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
