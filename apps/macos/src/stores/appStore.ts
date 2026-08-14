// ============================================================
// Bob Work - Zustand Store
// Global application state
// ============================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Project, Conversation, Task, Plugin, Approval,
  AppSettings, BobDetectionResult, BusinessMode,
} from '@bob-work/shared-types';

export interface BuilderSession {
  kind: 'plugin_builder' | 'skill_builder'
  brief: string
  /** Wizard already collected the spec; Bob should generate, not interview. */
  guided?: boolean
}

export interface AppNotification {
  id: string
  title: string
  body: string
  kind: string
  createdAt: string
  taskId?: string | null
  conversationId?: string | null
  read: boolean
}

// ── App Store ─────────────────────────────────────────────────

interface AppState {
  // Bob status
  bobStatus: 'detecting' | 'not_found' | 'incompatible' | 'unauthenticated' | 'ready' | 'busy' | 'error';
  bobInfo: BobDetectionResult | null;

  // Navigation
  activeView: 'home' | 'chat' | 'project' | 'tasks' | 'scheduled' | 'plugins' | 'integrations' | 'settings';
  activeProjectId: string | null;
  activeConversationId: string | null;
  sidebarVisible: boolean;
  inspectorVisible: boolean;

  // Data
  projects: Project[];
  conversations: Conversation[];
  tasks: Task[];
  plugins: Plugin[];
  pendingApprovals: Approval[];
  notifications: AppNotification[];
  notificationsOpen: boolean;
  builderSession: BuilderSession | null;
  unreadConversationIds: string[];

  // UI State
  settings: AppSettings | null;
  isLoading: boolean;
  globalError: string | null;
  activeMode: BusinessMode;
  sidebarWidth: number;
  inspectorWidth: number;

  // Active streaming
  streamingMessageId: string | null;
  streamingContent: string;
  isStreaming: boolean;

  // Actions
  setBobStatus: (status: AppState['bobStatus']) => void;
  setBobInfo: (info: BobDetectionResult | null) => void;
  setActiveView: (view: AppState['activeView']) => void;
  setActiveProject: (id: string | null) => void;
  setActiveConversation: (id: string | null) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setInspectorVisible: (visible: boolean) => void;
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (conversation: Conversation) => void;
  removeConversation: (id: string) => void;
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  setPlugins: (plugins: Plugin[]) => void;
  addPlugin: (plugin: Plugin) => void;
  removePlugin: (id: string) => void;
  setPendingApprovals: (approvals: Approval[]) => void;
  removeApproval: (id: string) => void;
  pushNotification: (notification: Omit<AppNotification, 'read'>) => void;
  setNotificationsOpen: (open: boolean) => void;
  revealNotificationCenter: () => void;
  setBuilderSession: (session: BuilderSession | null) => void;
  clearBuilderSession: () => void;
  markNotificationsRead: () => void;
  clearNotifications: () => void;
  markConversationUnread: (id: string) => void;
  markConversationRead: (id: string) => void;
  setSettings: (settings: AppSettings) => void;
  setLoading: (loading: boolean) => void;
  setGlobalError: (error: string | null) => void;
  setActiveMode: (mode: BusinessMode) => void;
  setSidebarWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setStreamingMessage: (id: string | null, content: string) => void;
  appendStreamingContent: (content: string) => void;
  clearStreaming: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      bobStatus: 'detecting',
      bobInfo: null,
      activeView: 'home',
      activeProjectId: null,
      activeConversationId: null,
      sidebarVisible: true,
      inspectorVisible: true,
      projects: [],
      conversations: [],
      tasks: [],
      plugins: [],
      pendingApprovals: [],
      notifications: [],
      notificationsOpen: false,
      builderSession: null,
      unreadConversationIds: [],
      settings: null,
      isLoading: false,
      globalError: null,
      activeMode: 'general_work',
      sidebarWidth: 260,
      inspectorWidth: 340,
      streamingMessageId: null,
      streamingContent: '',
      isStreaming: false,

      // Actions
      setBobStatus: (status) => set({ bobStatus: status }),
      setBobInfo: (info) => set({ bobInfo: info }),
      setActiveView: (view) => set({ activeView: view }),
      setActiveProject: (id) => set({ activeProjectId: id, activeConversationId: null }),
      setActiveConversation: (id) => set({ activeConversationId: id }),
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      toggleInspector: () => set((s) => ({ inspectorVisible: !s.inspectorVisible })),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
      setInspectorVisible: (visible) => set({ inspectorVisible: visible }),
      setProjects: (projects) => set({ projects }),
      addProject: (project) => set((s) => ({ projects: [project, ...s.projects] })),
      updateProject: (project) => set((s) => ({
        projects: s.projects.map((p) => (p.id === project.id ? project : p)),
      })),
      removeProject: (id) => set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
      })),
      setConversations: (conversations) => set({ conversations }),
      addConversation: (conversation) => set((s) => ({
        conversations: [conversation, ...s.conversations],
      })),
      updateConversation: (conversation) => set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === conversation.id ? conversation : c
        ),
      })),
      removeConversation: (id) => set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
      })),
      setTasks: (tasks) => set({ tasks }),
      addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
      updateTask: (task) => set((s) => ({
        tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
      })),
      setPlugins: (plugins) => set({ plugins }),
      addPlugin: (plugin) => set((s) => ({ plugins: [plugin, ...s.plugins] })),
      removePlugin: (id) => set((s) => ({
        plugins: s.plugins.filter((p) => p.id !== id),
      })),
      setPendingApprovals: (pendingApprovals) => set({ pendingApprovals }),
      removeApproval: (id) => set((s) => ({
        pendingApprovals: s.pendingApprovals.filter((a) => a.id !== id),
      })),
      pushNotification: (notification) => set((s) => {
        if (s.notifications.some(item => item.id === notification.id)) return s
        return {
          notifications: [{ ...notification, read: false }, ...s.notifications].slice(0, 40),
        }
      }),
      setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
      revealNotificationCenter: () => set({ notificationsOpen: true, sidebarVisible: true }),
      setBuilderSession: (builderSession) => set({ builderSession }),
      clearBuilderSession: () => set({ builderSession: null }),
      markNotificationsRead: () => set((s) => ({
        notifications: s.notifications.map(item => ({ ...item, read: true })),
      })),
      clearNotifications: () => set({ notifications: [] }),
      markConversationUnread: (id) => set((s) => ({
        unreadConversationIds: [id, ...s.unreadConversationIds.filter(item => item !== id)].slice(0, 50),
      })),
      markConversationRead: (id) => set((s) => ({
        unreadConversationIds: s.unreadConversationIds.filter(item => item !== id),
      })),
      setSettings: (settings) => set({ settings }),
      setLoading: (isLoading) => set({ isLoading }),
      setGlobalError: (globalError) => set({ globalError }),
      setActiveMode: (activeMode) => set({ activeMode }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
      setStreamingMessage: (id, content) => set({
        streamingMessageId: id,
        streamingContent: content,
        isStreaming: id !== null,
      }),
      appendStreamingContent: (content) => set((s) => ({
        streamingContent: s.streamingContent + content,
      })),
      clearStreaming: () => set({
        streamingMessageId: null,
        streamingContent: '',
        isStreaming: false,
      }),
    }),
    {
      name: 'bob-work-ui-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarVisible: state.sidebarVisible,
        inspectorVisible: state.inspectorVisible,
        sidebarWidth: state.sidebarWidth,
        inspectorWidth: state.inspectorWidth,
        activeMode: state.activeMode,
        unreadConversationIds: state.unreadConversationIds,
        notifications: state.notifications,
      }),
    }
  )
);

// ── Conversation Store ────────────────────────────────────────

interface ConversationState {
  messages: Record<string, Message[]>;
  loadingMessages: Record<string, boolean>;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setLoadingMessages: (conversationId: string, loading: boolean) => void;
}

import type { Message } from '@bob-work/shared-types';

export const useConversationStore = create<ConversationState>()((set) => ({
  messages: {},
  loadingMessages: {},
  setMessages: (conversationId, messages) =>
    set((s) => ({ messages: { ...s.messages, [conversationId]: messages } })),
  addMessage: (conversationId, message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: [...(s.messages[conversationId] || []), message],
      },
    })),
  setLoadingMessages: (conversationId, loading) =>
    set((s) => ({ loadingMessages: { ...s.loadingMessages, [conversationId]: loading } })),
}));
