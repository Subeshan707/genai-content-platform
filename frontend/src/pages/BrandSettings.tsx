import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, FileText, Loader2, Trash2, Upload } from 'lucide-react';

import {
  useBrandDocuments,
  useBrandWorkspaces,
  useDeleteBrandDocument,
  useUploadBrandDocument,
} from '@/hooks/useApi';
import { useAuthStore, useUIStore } from '@/stores';

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

function hasAllowedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatRelativeDate(value?: string | null): string {
  if (!value) {
    return 'Recently';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }
  return date.toLocaleString();
}

export default function BrandSettings() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeWorkspaceId = useUIStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useUIStore((s) => s.setActiveWorkspace);
  const authWorkspaceId = useAuthStore((s) => s.user?.workspaceId ?? null);
  const initialWorkspaceId = activeWorkspaceId ?? authWorkspaceId ?? DEFAULT_WORKSPACE_ID;
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);

  const [isDragActive, setIsDragActive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currentUploadName, setCurrentUploadName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const workspacesQuery = useBrandWorkspaces();
  const docsQuery = useBrandDocuments(workspaceId);
  const uploadMutation = useUploadBrandDocument(workspaceId);
  const deleteMutation = useDeleteBrandDocument(workspaceId);

  const documents = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);

  useEffect(() => {
    if (
      !activeWorkspaceId &&
      !authWorkspaceId &&
      workspaceId === DEFAULT_WORKSPACE_ID &&
      workspacesQuery.data &&
      workspacesQuery.data.length > 0
    ) {
      const fallbackWorkspaceId = workspacesQuery.data[0].id;
      setWorkspaceId(fallbackWorkspaceId);
      setActiveWorkspace(fallbackWorkspaceId);
    }
  }, [activeWorkspaceId, authWorkspaceId, setActiveWorkspace, workspaceId, workspacesQuery.data]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (!workspaceId) {
        setActionError('Workspace ID is required before uploading documents.');
        return;
      }

      const validationErrors: string[] = [];
      const accepted: File[] = [];
      for (const file of files) {
        if (!hasAllowedExtension(file.name)) {
          validationErrors.push(`${file.name}: unsupported type`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          validationErrors.push(`${file.name}: larger than 25 MB`);
          continue;
        }
        accepted.push(file);
      }

      if (validationErrors.length > 0) {
        setActionError(validationErrors.join(' | '));
      } else {
        setActionError(null);
      }

      for (const file of accepted) {
        try {
          setCurrentUploadName(file.name);
          await uploadMutation.mutateAsync({ file });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Upload failed';
          setActionError(`${file.name}: ${message}`);
        }
      }

      setCurrentUploadName(null);
    },
    [uploadMutation, workspaceId],
  );

  const handleFilePicker = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      await uploadFiles(files);
      e.target.value = '';
    },
    [uploadFiles],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragActive(false);
      await uploadFiles(Array.from(e.dataTransfer.files ?? []));
    },
    [uploadFiles],
  );

  const handleDelete = useCallback(
    async (documentName: string) => {
      if (!workspaceId) {
        setActionError('Workspace ID is required before deleting documents.');
        return;
      }
      setActionError(null);
      setDeletingName(documentName);
      try {
        await deleteMutation.mutateAsync(documentName);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Delete failed';
        setActionError(message);
      } finally {
        setDeletingName(null);
      }
    },
    [deleteMutation, workspaceId],
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600
                        flex items-center justify-center shadow-glow"
        >
          <Upload className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Brand Voice</h1>
          <p className="text-sm text-surface-500">Upload brand documents for AI to learn your style</p>
        </div>
      </div>

      <div className="glass-card p-4 mb-6">
        {workspacesQuery.data && workspacesQuery.data.length > 0 ? (
          <>
            <label className="block text-xs text-surface-500 mb-2">Workspace</label>
            <select
              value={workspaceId}
              onChange={(e) => {
                const next = e.target.value;
                setWorkspaceId(next);
                setActiveWorkspace(next);
              }}
              className="select-base w-full mb-3"
            >
              {workspacesQuery.data.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} ({ws.id})
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label className="block text-xs text-surface-500 mb-2">Workspace ID</label>
        <input
          value={workspaceId}
          onChange={(e) => {
            const next = e.target.value.trim();
            setWorkspaceId(next);
            if (next) {
              setActiveWorkspace(next);
            }
          }}
          className="input-base w-full"
          placeholder="Enter workspace UUID"
        />
        <p className="text-xs text-surface-700 mt-2">
          Use your real workspace UUID so uploads are stored in the correct brand knowledge base.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md"
        className="hidden"
        onChange={handleFilePicker}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`glass-card p-12 text-center border-2 border-dashed transition-all duration-300 mb-6 cursor-pointer ${
          isDragActive
            ? 'border-brand-500/60 bg-brand-600/10'
            : 'border-surface-600/40 hover:border-brand-500/40 hover:bg-brand-600/5'
        }`}
      >
        {uploadMutation.isPending ? (
          <Loader2 className="w-12 h-12 text-brand-400 mx-auto mb-4 animate-spin" />
        ) : (
          <Upload className="w-12 h-12 text-surface-600 mx-auto mb-4" />
        )}
        <h3 className="text-lg font-semibold text-surface-300 mb-2">
          {uploadMutation.isPending ? 'Processing documents...' : 'Drop brand documents here or click to upload'}
        </h3>
        <p className="text-sm text-surface-600">PDF, DOCX, TXT, MD · max 25 MB per file</p>
        <p className="text-xs text-surface-700 mt-2">Embeddings powered by Amazon Titan Embed V2</p>
        {currentUploadName ? <p className="text-xs text-brand-400 mt-3">Uploading: {currentUploadName}</p> : null}
      </div>

      {actionError ? (
        <div className="glass-card mb-6 border border-accent-rose/30 text-accent-rose text-sm px-4 py-3">
          {actionError}
        </div>
      ) : null}

      {docsQuery.error ? (
        <div className="glass-card mb-6 border border-accent-rose/30 text-accent-rose text-sm px-4 py-3">
          Failed to load documents. {(docsQuery.error as Error).message}
        </div>
      ) : null}

      <div className="glass-card overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700/40 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{documents.length} Brand Documents</h3>
          <button
            onClick={() => docsQuery.refetch()}
            className="btn-ghost text-xs px-2 py-1"
            disabled={docsQuery.isFetching}
          >
            {docsQuery.isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {docsQuery.isLoading ? (
          <div className="px-6 py-10 text-center text-surface-500 text-sm">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading brand documents...
          </div>
        ) : documents.length === 0 ? (
          <div className="px-6 py-10 text-center text-surface-500 text-sm">
            No brand documents yet. Upload your first guide to power brand-aligned generation.
          </div>
        ) : (
          <div className="divide-y divide-surface-700/30">
            {documents.map((doc) => (
              <div key={doc.document_name} className="flex items-center gap-4 px-6 py-4">
                <FileText className="w-5 h-5 text-surface-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-surface-200 font-medium truncate">{doc.document_name}</p>
                  <p className="text-xs text-surface-600">
                    {doc.chunks} chunks embedded · {formatRelativeDate(doc.last_ingested_at)}
                  </p>
                </div>
                <span className="badge-approved text-[10px]">
                  <CheckCircle className="w-3 h-3" /> {doc.status}
                </span>
                <button
                  className="btn-ghost p-1.5 text-surface-600 hover:text-accent-rose disabled:opacity-50"
                  onClick={() => handleDelete(doc.document_name)}
                  disabled={deleteMutation.isPending && deletingName === doc.document_name}
                  title="Delete document"
                >
                  {deleteMutation.isPending && deletingName === doc.document_name ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
