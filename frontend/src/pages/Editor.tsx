import { useEffect, useCallback, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';

import { useEditorStore } from '@/stores';
import { useBrandDocuments, useGenerateContent, useContentPiece, useContentVersions } from '@/hooks/useApi';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  Sparkles, Bold, Italic, UnderlineIcon, List, ListOrdered,
  Quote, Undo, Redo, Loader2, CheckCircle, Globe, Image,
  Send, History, Wand2, MessageSquare,
} from 'lucide-react';

const WS_URL = (
  import.meta.env.DEV ? '/ws' : (import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws')
).replace(/\/+$/, '');

const getDraftStorageKey = (pieceId: string) => `editor-draft-${pieceId}`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toStructuredHtml = (text: string) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sectionLabel = /^(Title|Introduction|Conclusion|Call to Action|Subject|Greeting|Body|Sign-off|Hook|Value|CTA|Hashtags|Section\s+\d+\s*-\s*[^:]+|HOOK|PROBLEM|SOLUTION|BENEFITS|CALL TO ACTION):\s*(.*)$/i;

  let html = '';
  let inList = false;

  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${escapeHtml(bulletMatch[1])}</li>`;
      continue;
    }

    closeList();

    const match = line.match(sectionLabel);
    if (match) {
      const label = match[1];
      const body = match[2]?.trim();
      if (/^title$/i.test(label)) {
        html += `<h2>${escapeHtml(body || label)}</h2>`;
      } else {
        html += `<h3>${escapeHtml(label)}:</h3>`;
        if (body) {
          html += `<p>${escapeHtml(body)}</p>`;
        }
      }
      continue;
    }

    html += `<p>${escapeHtml(line)}</p>`;
  }

  closeList();
  return html || `<p>${escapeHtml(text)}</p>`;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type SelectionSnapshot = {
  from: number;
  to: number;
  text: string;
};

type SelectionActionState = {
  x: number;
  y: number;
  visible: boolean;
};

export default function Editor() {
  const { id: pieceId } = useParams<{ id: string }>();
  const generateContent = useGenerateContent();
  const chatEditMutation = useGenerateContent();

  const { data: piece } = useContentPiece(pieceId || '');
  const { data: versions } = useContentVersions(pieceId || '');
  const { data: brandDocuments } = useBrandDocuments(piece?.workspaceId ?? '');

  const {
    isGenerating, streamedContent, setGenerating,
    resetStreamContent, setLastAiVersion, setConnectionId,
  } = useEditorStore();

  const [showHistory, setShowHistory] = useState(false);
  const [useBrandVoice, setUseBrandVoice] = useState(true);
  const [hasHydratedContent, setHasHydratedContent] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<'ask' | 'rewrite'>('rewrite');
  const lastSelectionRef = useRef<SelectionSnapshot | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionActionState>({
    x: 0,
    y: 0,
    visible: false,
  });

  const [latestGenerationMeta, setLatestGenerationMeta] = useState<{
    modelUsed: string;
    tokensUsed: number;
    brandContextCount: number;
  } | null>(null);

  const connectionId = `editor-${pieceId}`;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: true }),
      Underline,
      Placeholder.configure({
        placeholder: 'Start writing or click "Generate with AI" to create content...',
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[400px] p-6',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (!pieceId) return;
      try {
        localStorage.setItem(getDraftStorageKey(pieceId), currentEditor.getHTML());
      } catch {
        // Ignore localStorage write errors and keep editing uninterrupted.
      }
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { from, to } = currentEditor.state.selection;
      if (from === to) {
        // Keep the menu visible when focus moves to chat controls.
        return;
      }

      const text = currentEditor.state.doc.textBetween(from, to, '\n', '\n').trim();
      if (!text) {
        return;
      }

      lastSelectionRef.current = { from, to, text };

      const fromCoords = currentEditor.view.coordsAtPos(from);
      const toCoords = currentEditor.view.coordsAtPos(to);
      const centerX = (fromCoords.left + toCoords.right) / 2;
      let bubbleY = Math.min(fromCoords.top, toCoords.top) - 44;

      // If there is not enough space above selection, place menu below selection.
      if (bubbleY < 8) {
        bubbleY = Math.max(fromCoords.bottom, toCoords.bottom) + 8;
      }

      setSelectionAction({
        x: Math.max(90, Math.min(centerX, window.innerWidth - 90)),
        y: Math.max(8, Math.min(bubbleY, window.innerHeight - 56)),
        visible: true,
      });
    },
  });

  const appendChatMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setChatMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        text,
      },
    ]);
  }, []);

  const { isConnected } = useWebSocket({
    url: WS_URL,
    connectionId,
    onToken: useCallback(
      (text: string) => {
        if (editor) {
          editor.chain().focus().insertContent(text).run();
        }
      },
      [editor],
    ),
    onComplete: useCallback(() => {
      if (editor) {
        setLastAiVersion(editor.getHTML());
      }
    }, [editor, setLastAiVersion]),
  });

  useEffect(() => {
    setConnectionId(connectionId);
  }, [connectionId, setConnectionId]);

  useEffect(() => {
    setHasHydratedContent(false);
    setChatMessages([]);
    setChatInput('');
    setChatError(null);
    setSelectionAction({ x: 0, y: 0, visible: false });
  }, [pieceId]);

  const handleQuickSelectionMode = useCallback((mode: 'ask' | 'rewrite') => {
    if (!lastSelectionRef.current) {
      setChatError('Select text in the editor first.');
      return;
    }

    setChatMode(mode);
    setChatError(null);

    // Keep selection stable when jumping focus to chat input.
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (!editor || !pieceId || hasHydratedContent) return;

    try {
      const draftHtml = localStorage.getItem(getDraftStorageKey(pieceId));
      if (draftHtml && draftHtml.trim().length > 0) {
        editor.commands.setContent(draftHtml);
        setHasHydratedContent(true);
        return;
      }
    } catch {
      // Ignore localStorage read errors and continue to DB-backed restore.
    }

    if (!versions) return;

    if (versions.length > 0) {
      const latest = versions[0];
      editor.commands.setContent(toStructuredHtml(latest.body));
      setLastAiVersion(latest.body);
      setLatestGenerationMeta((existing) => (
        existing ?? {
          modelUsed: latest.modelUsed,
          tokensUsed: latest.tokensUsed ?? 0,
          brandContextCount: 0,
        }
      ));
    }

    setHasHydratedContent(true);
  }, [editor, pieceId, versions, hasHydratedContent, setLastAiVersion]);

  useEffect(() => {
    if (streamedContent && editor && !isGenerating) {
      editor.commands.setContent(toStructuredHtml(streamedContent));
      resetStreamContent();
    }
  }, [streamedContent, editor, isGenerating, resetStreamContent]);

  const handleGenerate = async () => {
    if (!pieceId || !piece) return;

    setGenerating(true);
    resetStreamContent();
    editor?.commands.clearContent();

    try {
      const result = await generateContent.mutateAsync({
        workspaceId: piece.workspaceId,
        pieceId,
        brief: piece.brief,
        contentType: piece.contentType,
        useBrandVoice,
        connectionId,
      });

      setLatestGenerationMeta({
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
        brandContextCount: result.brandContextCount,
      });

      if (result.body) {
        editor?.commands.setContent(toStructuredHtml(result.body));
        setLastAiVersion(result.body);
      }
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleChatApply = async () => {
    if (!editor || !piece || !pieceId) return;

    const instruction = chatInput.trim();
    if (!instruction) {
      setChatError('Enter what you want to change.');
      return;
    }

    const currentSelection = editor.state.selection;
    let from = currentSelection.from;
    let to = currentSelection.to;
    let sourceText = editor.state.doc.textBetween(from, to, '\n', '\n').trim();

    if (from === to || !sourceText) {
      const fallback = lastSelectionRef.current;
      if (!fallback || fallback.from === fallback.to) {
        setChatError('Select text in the editor first, then use selective chat.');
        return;
      }

      const docSize = editor.state.doc.content.size;
      from = Math.max(0, Math.min(fallback.from, docSize));
      to = Math.max(0, Math.min(fallback.to, docSize));
      if (from === to) {
        setChatError('Selected text is no longer available. Please select it again.');
        return;
      }

      sourceText = editor.state.doc.textBetween(from, to, '\n', '\n').trim() || fallback.text;
    }

    if (!sourceText) {
      setChatError('No editable text found for this request.');
      return;
    }

    const userMessage = chatMode === 'rewrite'
      ? `Selection edit: ${instruction}`
      : `Selection question: ${instruction}`;

    appendChatMessage('user', userMessage);
    setChatError(null);
    setSelectionAction((prev) => (prev.visible ? { ...prev, visible: false } : prev));

    const editBrief = chatMode === 'rewrite'
      ? (
        'Rewrite ONLY the text segment below according to the instruction. '
        + 'Return only the revised segment with no intro or explanation.\n\n'
        + `Instruction: ${instruction}\n\n`
        + `Text segment:\n${sourceText}`
      )
      : (
        'Answer the user question using ONLY the selected text below as context. '
        + 'Do not rewrite or alter the text. Return a concise direct answer.\n\n'
        + `Question: ${instruction}\n\n`
        + `Selected text:\n${sourceText}`
      );

    try {
      const result = await chatEditMutation.mutateAsync({
        workspaceId: piece.workspaceId,
        pieceId,
        brief: editBrief,
        contentType: piece.contentType,
        useBrandVoice,
      });

      const revised = (result.body || '').trim();
      if (!revised) {
        throw new Error('AI returned an empty response for this edit request.');
      }

      if (chatMode === 'rewrite') {
        editor.chain().focus().insertContentAt({ from, to }, revised).run();
        lastSelectionRef.current = null;
      }

      setLatestGenerationMeta({
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
        brandContextCount: result.brandContextCount,
      });

      if (chatMode === 'rewrite') {
        setLastAiVersion(editor.getHTML());
        appendChatMessage('assistant', 'Applied requested changes to selected text only.');
      } else {
        appendChatMessage('assistant', revised);
      }

      setChatInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply edit request.';
      setChatError(message);
      appendChatMessage('assistant', `Could not apply change: ${message}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-white">Content Editor</h1>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse-soft`} />
            <span className="text-xs text-surface-500">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/editor/${pieceId}/locales`} className="btn-ghost text-xs">
            <Globe className="w-4 h-4" /> Locales
          </Link>
          <Link to={`/editor/${pieceId}/assets`} className="btn-ghost text-xs">
            <Image className="w-4 h-4" /> Assets
          </Link>
          <Link to={`/publish/${pieceId}`} className="btn-ghost text-xs">
            <Send className="w-4 h-4" /> Publish
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <div className="glass-card rounded-b-none border-b-0 px-4 py-2 flex items-center gap-1 flex-wrap">
            <button
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={`btn-ghost p-2 ${editor?.isActive('bold') ? 'text-brand-400 bg-brand-600/10' : ''}`}
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={`btn-ghost p-2 ${editor?.isActive('italic') ? 'text-brand-400 bg-brand-600/10' : ''}`}
            >
              <Italic className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              className={`btn-ghost p-2 ${editor?.isActive('underline') ? 'text-brand-400 bg-brand-600/10' : ''}`}
            >
              <UnderlineIcon className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-surface-700 mx-1" />
            <button
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              className={`btn-ghost p-2 ${editor?.isActive('bulletList') ? 'text-brand-400 bg-brand-600/10' : ''}`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              className={`btn-ghost p-2 ${editor?.isActive('orderedList') ? 'text-brand-400 bg-brand-600/10' : ''}`}
            >
              <ListOrdered className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              className={`btn-ghost p-2 ${editor?.isActive('blockquote') ? 'text-brand-400 bg-brand-600/10' : ''}`}
            >
              <Quote className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-surface-700 mx-1" />
            <button onClick={() => editor?.chain().focus().undo().run()} className="btn-ghost p-2">
              <Undo className="w-4 h-4" />
            </button>
            <button onClick={() => editor?.chain().focus().redo().run()} className="btn-ghost p-2">
              <Redo className="w-4 h-4" />
            </button>

            <div className="flex-1" />

            {selectionAction.visible ? (
              <div className="flex items-center gap-2 mr-2">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleQuickSelectionMode('ask')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-cyan-200/60 bg-cyan-300 text-surface-950 shadow"
                >
                  Ask Selection
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleQuickSelectionMode('rewrite')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-brand-200/60 bg-brand-400 text-white shadow"
                >
                  Rewrite Selection
                </button>
              </div>
            ) : null}

            <button
              onClick={() => setUseBrandVoice((prev) => !prev)}
              className={`btn-ghost text-xs py-2 px-3 border ${
                useBrandVoice
                  ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                  : 'border-surface-700/50 text-surface-500 bg-surface-800/30'
              }`}
            >
              {useBrandVoice ? 'Brand Voice: On' : 'Brand Voice: Off'}
            </button>

            <button onClick={handleGenerate} disabled={isGenerating || !piece} className="btn-primary text-xs py-2">
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Generating...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" /> Generate with AI
                </>
              )}
            </button>
          </div>

          <div ref={editorSurfaceRef} className="glass-card rounded-t-none tiptap-editor relative">
            {isGenerating && (
              <div
                className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5
                              bg-brand-600/15 rounded-lg border border-brand-500/20 z-10"
              >
                <Loader2 className="w-3 h-3 text-brand-400 animate-spin" />
                <span className="text-xs text-brand-400 font-medium">AI is generating...</span>
              </div>
            )}
            <EditorContent editor={editor} />
          </div>

          {editor && (
            <BubbleMenu
              editor={editor}
              tippyOptions={{
                duration: 150,
                placement: 'top',
                animation: 'shift-away',
              }}
            >
              <div className="flex items-center gap-1 rounded-[10px] border border-surface-700 bg-[#1e1e24] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.8)]">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleQuickSelectionMode('ask')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                    chatMode === 'ask'
                      ? 'bg-surface-800 text-white'
                      : 'text-surface-300 hover:text-white hover:bg-surface-800'
                  }`}
                >
                  <Wand2 className="w-3.5 h-3.5" /> Ask AI
                </button>
                <div className="w-[1px] h-4 bg-surface-700 mx-1" />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleQuickSelectionMode('rewrite')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                    chatMode === 'rewrite'
                      ? 'bg-brand-500/20 text-brand-300'
                      : 'text-surface-300 hover:text-brand-300 hover:bg-brand-500/10'
                  }`}
                >
                  Rewrite
                </button>
              </div>
            </BubbleMenu>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-brand-400" />
              <h3 className="text-sm font-semibold text-white">AI Model</h3>
            </div>
            <p className="text-xs text-surface-400 mb-2">
              Latest model:{' '}
              <span className="text-brand-300 font-mono">
                {latestGenerationMeta?.modelUsed ?? 'Not generated yet'}
              </span>
            </p>
            <p className="text-xs text-surface-600">Workspace: {piece?.workspaceId ?? 'Unknown'}</p>
            <p className="text-xs text-surface-600">
              Brand docs available: {brandDocuments?.length ?? 0}
            </p>
            {latestGenerationMeta ? (
              <p className="text-xs text-surface-600 mt-1">
                Tokens: {latestGenerationMeta.tokensUsed} · Brand chunks used: {latestGenerationMeta.brandContextCount}
              </p>
            ) : null}
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-brand-400" />
              <h3 className="text-sm font-semibold text-white">Selective Edit Chat</h3>
            </div>
            <p className="text-[11px] text-surface-600 mb-3">
              Select text in the editor and use the floating Ask/Rewrite menu, or choose a mode below.
            </p>

            <label className="block text-xs text-surface-500 mb-1">Mode</label>
            <select
              value={chatMode}
              onChange={(e) => setChatMode(e.target.value as 'ask' | 'rewrite')}
              className="select-base text-xs mb-2"
            >
              <option value="rewrite">Rewrite selected text only</option>
              <option value="ask">Answer question from selected text</option>
            </select>

            <div className="space-y-2 max-h-36 overflow-y-auto mb-3">
              {chatMessages.length === 0 ? (
                <p className="text-xs text-surface-600">No edit requests yet.</p>
              ) : chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`text-xs rounded-lg px-2.5 py-2 ${
                    message.role === 'user'
                      ? 'bg-brand-600/15 text-brand-200'
                      : 'bg-surface-800/60 text-surface-300'
                  }`}
                >
                  {message.text}
                </div>
              ))}
            </div>

            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => {
                setChatInput(e.target.value);
                if (chatError) setChatError(null);
              }}
              placeholder={chatMode === 'rewrite'
                ? 'Example: make this paragraph shorter and more persuasive'
                : 'Example: what is the CTA and why is it strong?'}
              className="textarea-base h-24 text-xs"
            />

            {chatError ? <p className="text-xs text-accent-rose mt-2">{chatError}</p> : null}

            <button
              onClick={handleChatApply}
              disabled={chatEditMutation.isPending || !piece || chatInput.trim().length === 0}
              className="btn-primary w-full text-xs mt-2"
            >
              {chatEditMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Applying...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" /> {chatMode === 'rewrite' ? 'Apply to Selection' : 'Ask About Selection'}
                </>
              )}
            </button>
          </div>

          <div className="glass-card p-4">
            <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-2 w-full mb-3">
              <History className="w-4 h-4 text-surface-400" />
              <h3 className="text-sm font-semibold text-white flex-1 text-left">Versions</h3>
            </button>
            {showHistory ? (
              versions && versions.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => editor?.commands.setContent(toStructuredHtml(v.body))}
                      className="w-full text-left p-2 rounded-lg bg-surface-800/40
                               hover:bg-surface-800/80 transition-colors"
                    >
                      <p className="text-xs font-medium text-surface-300">v{v.versionNum}</p>
                      <p className="text-[10px] text-surface-600 mt-0.5">
                        {v.modelUsed} · {v.tokensUsed || 0} tokens
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-surface-600">No versions yet</p>
              )
            ) : (
              <p className="text-xs text-surface-600">Click to expand version history.</p>
            )}
          </div>

          <div className="glass-card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-white mb-3">Quick Actions</h3>
            <Link to={`/editor/${pieceId}/locales`} className="w-full btn-secondary text-xs justify-start">
              <Globe className="w-4 h-4" /> Translate to Locales
            </Link>
            <Link to={`/editor/${pieceId}/assets`} className="w-full btn-secondary text-xs justify-start">
              <Image className="w-4 h-4" /> Generate Images
            </Link>
            <Link to={`/publish/${pieceId}`} className="w-full btn-success text-xs justify-start">
              <CheckCircle className="w-4 h-4" /> Approve & Publish
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
