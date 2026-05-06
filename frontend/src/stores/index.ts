/**
 * GenAI Content Platform — Zustand UI State Stores
 */
import { create } from 'zustand';
import type { User, ContentPiece } from '@/types';

// ═══════════════════════════════════════════════════════════
// Auth Store
// ═══════════════════════════════════════════════════════════

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  setUser: (user, token) => set({ user, token, isAuthenticated: true }),
  logout: () => set({ user: null, token: null, isAuthenticated: false }),
}));

// ═══════════════════════════════════════════════════════════
// Editor Store
// ═══════════════════════════════════════════════════════════

interface EditorState {
  currentPiece: ContentPiece | null;
  isGenerating: boolean;
  streamedContent: string;
  lastAiVersion: string;
  connectionId: string | null;
  setCurrentPiece: (piece: ContentPiece) => void;
  setGenerating: (generating: boolean) => void;
  appendStreamToken: (token: string) => void;
  resetStreamContent: () => void;
  setLastAiVersion: (content: string) => void;
  setConnectionId: (id: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  currentPiece: null,
  isGenerating: false,
  streamedContent: '',
  lastAiVersion: '',
  connectionId: null,
  setCurrentPiece: (piece) => set({ currentPiece: piece }),
  setGenerating: (generating) => set({ isGenerating: generating }),
  appendStreamToken: (token) =>
    set((state) => ({ streamedContent: state.streamedContent + token })),
  resetStreamContent: () => set({ streamedContent: '' }),
  setLastAiVersion: (content) => set({ lastAiVersion: content }),
  setConnectionId: (id) => set({ connectionId: id }),
}));

// ═══════════════════════════════════════════════════════════
// UI Store
// ═══════════════════════════════════════════════════════════

interface UIState {
  sidebarOpen: boolean;
  activeWorkspaceId: string | null;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveWorkspace: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  activeWorkspaceId: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
}));
