import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Image, Wand2, Loader2, Download, Trash2 } from 'lucide-react';

import { useContentPiece, useGenerateImage, useImageAssets } from '@/hooks/useApi';
import { useAuthStore, useUIStore } from '@/stores';

export default function AssetManager() {
  const { id: pieceId } = useParams<{ id: string }>();

  const activeWorkspaceId = useUIStore((s) => s.activeWorkspaceId);
  const authWorkspaceId = useAuthStore((s) => s.user?.workspaceId ?? null);

  const [prompt, setPrompt] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [ephemeralAssets, setEphemeralAssets] = useState<{ id: string; url: string; locale?: string }[]>([]);

  const { data: piece } = useContentPiece(pieceId || '');
  const generateImage = useGenerateImage();
  const { data: persistedAssets = [], refetch: refetchAssets } = useImageAssets(pieceId || '');

  const minPromptLength = 3;
  const trimmedPrompt = prompt.trim();
  const workspaceId = piece?.workspaceId ?? activeWorkspaceId ?? authWorkspaceId ?? '';

  const completedPersistedAssets = persistedAssets
    .filter((asset) => asset.status === 'completed' && !!asset.imageUrl)
    .map((asset) => ({
      id: asset.id,
      url: asset.imageUrl as string,
      locale: asset.locale ?? undefined,
    }));

  const latestFailedJob = persistedAssets.find((asset) => asset.status === 'failed');
  const assets = [...completedPersistedAssets, ...ephemeralAssets];

  const handleGenerate = async () => {
    if (trimmedPrompt.length < minPromptLength) {
      setErrorMessage(`Prompt must be at least ${minPromptLength} characters.`);
      return;
    }

    if (!pieceId) {
      setErrorMessage('Missing content piece ID. Open this page from the editor flow.');
      return;
    }

    if (!workspaceId) {
      setErrorMessage('Workspace ID is required before generating assets.');
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');

    try {
      const data = await generateImage.mutateAsync({
        workspaceId,
        pieceId,
        prompt: trimmedPrompt,
        width: 1024,
        height: 1024,
        numImages: 1,
      });

      if (data.imageUrls && data.imageUrls.length > 0) {
        const newAssets = data.imageUrls.map((url, idx) => ({
          id: `${Date.now()}-${idx}`,
          url,
        }));
        setEphemeralAssets((prev) => [...newAssets, ...prev]);
        setSuccessMessage(`Generated ${newAssets.length} image(s).`);
      } else if (data.status === 'queued') {
        setSuccessMessage(`Image request queued${data.messageId ? ` (${data.messageId})` : ''}.`);
        await refetchAssets();
      } else {
        setSuccessMessage('Image request submitted successfully.');
      }
    } catch (err) {
      console.error('Image generation failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Image generation failed.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600
                        flex items-center justify-center shadow-glow">
          <Image className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Asset Manager</h1>
          <p className="text-sm text-surface-500">Generate and manage images per locale</p>
        </div>
      </div>

      <div className="glass-card p-6 mb-6">
        <h3 className="text-sm font-semibold text-surface-300 mb-3">Generate Image with AI</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (errorMessage) setErrorMessage('');
              if (successMessage) setSuccessMessage('');
            }}
            placeholder="Describe the image you want to generate..."
            className="input-base flex-1"
          />
          <button
            onClick={handleGenerate}
            disabled={generateImage.isPending || !pieceId || !workspaceId || trimmedPrompt.length < minPromptLength}
            className="btn-primary"
          >
            {generateImage.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            Generate
          </button>
        </div>

        {errorMessage && (
          <p className="mt-2 text-xs text-accent-rose">{errorMessage}</p>
        )}

        {successMessage && (
          <p className="mt-2 text-xs text-emerald-400">{successMessage}</p>
        )}

        {!errorMessage && latestFailedJob?.error && (
          <p className="mt-2 text-xs text-accent-rose">
            Last queued job failed: {latestFailedJob.error}
          </p>
        )}

        <p className="mt-2 text-[10px] text-surface-600">
          Powered by Amazon Titan Image Generator
        </p>
        {workspaceId ? (
          <p className="mt-1 text-[10px] text-surface-700">Workspace: {workspaceId}</p>
        ) : null}
      </div>

      {assets.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {assets.map((asset) => (
            <div key={asset.id} className="glass-card-hover overflow-hidden group">
              <div className="aspect-square bg-surface-800 relative">
                <img src={asset.url} alt="Generated asset" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100
                                transition-opacity flex items-center justify-center gap-2">
                  <button className="btn-ghost p-2 bg-surface-900/80 rounded-lg">
                    <Download className="w-4 h-4" />
                  </button>
                  <button className="btn-ghost p-2 bg-surface-900/80 rounded-lg text-accent-rose">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {asset.locale && (
                <div className="p-2 text-center">
                  <span className="text-xs text-surface-500">{asset.locale}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <Image className="w-12 h-12 text-surface-700 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-surface-400 mb-2">No Assets Yet</h3>
          <p className="text-sm text-surface-600">Generate images using the prompt above</p>
        </div>
      )}
    </div>
  );
}
