// ============================================================
// Bob Work – ChatView
// Conversations réelles : IPC → DB → streaming Tauri events
// ============================================================

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type MutableRefObject } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Copy, Check, Pencil } from 'lucide-react'
import Composer from '../components/Composer/Composer'
import WorkspacePanel, { type PanelActivity, type PreviewRequest } from '../components/WorkspacePanel/WorkspacePanel'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  sendMessage, stopTask,
  getConversation, getMessages, createConversation, updateConversation, getTaskDetail, cancelTask, getTasks, getPlugin,
  rewindConversationFromMessage,
  registerExternalArtifact,
} from '../lib/ipc'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import type { MessageAttachment, MessageSource, TaskDetail } from '@bob-work/shared-types'
import { useT } from '../i18n'
import { errorMessage } from '../lib/errorMessage'
import { isActiveTaskState, latestActiveTaskForConversation } from '../lib/activeTasks'
import { useAppStore, useConversationStore } from '../stores/appStore'
import { useConversationUpdated, useConversationMessagesChanged, useTaskUpdated, useBobSessionDone } from '../hooks/useTauriEvents'
import { extractLocalFilePaths, fileNameFromPath, linkifyLocalFilePaths, normalizeLocalFilePathKey, preferAbsoluteLocalPath } from '../lib/localFilePaths'
import { PluginIcon, iconForFileName } from '../components/PluginIcon'
import { ChromeSnapshotCard } from '../components/ChromeSnapshot/ChromeSnapshotCard'
import { AUTO_PREVIEW_EXT, INLINE_IMAGE_EXT } from "../constants/fileTypes"
import { extractChromeSnapshot, upsertChromeSnapshot, type ChromeSnapshot } from '../lib/chromeSnapshot'
import { useAppDialog } from '../components/AppDialog'
import { SubagentStatusPanel } from '../components/SubagentStatus/SubagentStatusPanel'
import bobAvatarIcon from '../assets/bob-avatar.png'


function sourcesFromLocalPaths(content: string): MessageSource[] {
  return extractLocalFilePaths(content).map(path => ({
    id: path,
    title: fileNameFromPath(path),
    path,
  }))
}

function mergeMessageSources(...groups: (MessageSource[] | undefined)[]): MessageSource[] {
  const byKey = new Map<string, MessageSource>()
  for (const group of groups) {
    for (const item of group ?? []) {
      const target = item.path || item.url || item.id
      if (!target) continue
      const key = item.url && !item.path
        ? `web:${item.url}`
        : `file:${normalizeLocalFilePathKey(item.path || target)}`
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, item)
        continue
      }
      if (item.path && existing.path) {
        const preferred = preferAbsoluteLocalPath(existing.path, item.path)
        if (preferred !== existing.path) {
          byKey.set(key, { ...item, path: preferred, title: item.title || existing.title })
        }
      }
    }
  }
  return Array.from(byKey.values())
}

async function registerMessageArtifacts(
  messages: Awaited<ReturnType<typeof getMessages>>,
  conversationId: string,
): Promise<void> {
  const registrations: Promise<unknown>[] = []
  for (const message of messages) {
    if (message.author === 'user') continue
    const paths = new Set([
      ...extractLocalFilePaths(message.content),
      ...(message.sources ?? []).map(source => source.path).filter((path): path is string => !!path),
    ])
    for (const path of paths) registrations.push(registerExternalArtifact(path, conversationId))
  }
  await Promise.allSettled(registrations)
}

export function normalizeAssistantMarkdown(markdown: string): string {
  let normalized = markdown.replace(/^(#{1,6})(?=[^\s#])/gm, '$1 ')

  // Some streamed answers lose the line break between two table rows. Restore
  // it before asking remark-gfm to parse the table.
  if (/\|\s*\|\s*:?-{3}/.test(normalized)) {
    normalized = normalized.replace(/\|\s*\|(?=\s*-)/g, '|\n|')
    normalized = normalized.replace(/\|\s*\|(?=\s*[^|\-])/g, '|\n|')
  }

  const lines = normalized.split('\n')
  const tableCells = (line: string): string[] | null => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null
    return trimmed.slice(1, -1).split('|').map(cell => cell.trim())
  }

  for (let index = 1; index < lines.length; index += 1) {
    const delimiters = tableCells(lines[index])
    if (!delimiters?.length || !delimiters.every(cell => /^:?-{3,}:?$/.test(cell))) continue

    // A flattened block can leave prose/the heading directly before the first
    // header pipe. Move that prefix back to its own line.
    const firstPipe = lines[index - 1].indexOf('|')
    if (firstPipe > 0 && lines[index - 1].slice(0, firstPipe).trim()) {
      const prefix = lines[index - 1].slice(0, firstPipe).trimEnd()
      const header = lines[index - 1].slice(firstPipe)
      lines.splice(index - 1, 1, prefix, header)
      index += 1
    }

    const headerCells = tableCells(lines[index - 1])
    if (!headerCells || headerCells.length >= delimiters.length) continue

    // This is the malformed header emitted by the architecture report:
    // `Label Couleur` represents two data columns. Repair it semantically.
    const lastHeader = headerCells[headerCells.length - 1] ?? ''
    const splitHeader = lastHeader.match(/^(Label)\s+(Couleur|Color)$/i)
    if (headerCells.length + 1 === delimiters.length && splitHeader) {
      headerCells.splice(-1, 1, splitHeader[1], splitHeader[2])
    }

    // Keep other imperfect LLM tables renderable without inventing labels.
    while (headerCells.length < delimiters.length) headerCells.push('')
    lines[index - 1] = `| ${headerCells.join(' | ')} |`
  }

  normalized = lines.join('\n')
  return normalized
}

function renderableImageSource(source: string): string {
  if (!source) return ''
  if (/^(?:https?:|data:|blob:|asset:)/i.test(source)) return source
  let localPath = source
  if (/^file:\/\//i.test(source)) {
    try { localPath = decodeURIComponent(new URL(source).pathname) } catch { localPath = source.replace(/^file:\/\//i, '') }
  }
  if (!localPath.startsWith('/')) return source
  // Markdown parsers preserve percent-encoding in absolute paths. Tauri's
  // asset protocol expects the real filesystem path (not `%20` segments).
  try { localPath = decodeURIComponent(localPath) } catch { /* keep malformed input unchanged */ }
  try { return convertFileSrc(localPath) } catch { return source }
}

function ResilientImage({ source, alt, className }: { source: string; alt: string; className?: string }) {
  const t = useT()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [source])
  if (failed || !source) {
    return <span className={`${className ? `${className}-fallback ` : ''}image-preview-fallback`}>{t('chat.imagePreviewUnavailable')}</span>
  }
  return <img className={className} src={renderableImageSource(source)} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}

function applyActiveTaskForConversation(
  conversationId: string,
  allTasks: Awaited<ReturnType<typeof getTasks>>,
  refs: {
    runningRef: MutableRefObject<boolean>
    activeSessionRef: MutableRefObject<{ conversationId: string; sessionId: string | null } | null>
  },
  setters: {
    setTaskId: (id: string | null) => void
    setTaskDetail: (detail: TaskDetail | null) => void
    setIsRunning: (running: boolean) => void
    setSessionId: (id: string | null) => void
  },
) {
  const activeTask = latestActiveTaskForConversation(allTasks, conversationId)
  if (activeTask) {
    setters.setTaskId(activeTask.id)
    getTaskDetail(activeTask.id).then(setters.setTaskDetail).catch(() => {})
    if (activeTask.bobProcessId && isActiveTaskState(activeTask.state)) {
      refs.runningRef.current = true
      setters.setIsRunning(true)
      setters.setSessionId(activeTask.bobProcessId)
      refs.activeSessionRef.current = { conversationId, sessionId: activeTask.bobProcessId }
      return
    }
  }
  setters.setTaskId(null)
  setters.setTaskDetail(null)
  refs.runningRef.current = false
  setters.setIsRunning(false)
  setters.setSessionId(null)
  refs.activeSessionRef.current = null
}

// ── Types ─────────────────────────────────────────────────────

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: string
  state: 'sent' | 'streaming' | 'done' | 'error'
  /** Fatal/session error shown separately — not painted over the assistant reply. */
  error?: string
  persisted?: boolean
  attachments?: MessageAttachment[]
  sources?: MessageSource[]
  snapshots?: ChromeSnapshot[]
}

interface BobTokenEvent {
  sessionId: string
  conversationId: string
  chunk: string
  isFinal: boolean
  eventType: 'text' | 'token' | 'tool_use' | 'step' | 'thought' | 'error'
  taskId?: string
}

interface BobSessionDoneEvent {
  sessionId: string
  conversationId: string
  success: boolean
  fullOutput: string
  error?: string
  taskId?: string
  runId?: string
  shellTaskId?: string
  cancelled?: boolean
}

interface BobActivityEvent {
  sessionId: string
  conversationId: string
  taskId?: string
  eventType: string
  title?: string
  content?: string
  toolName?: string
  payload: Record<string, unknown>
}

interface QueuedPrompt {
  id: string
  text: string
  mode: string
  attachmentPaths: string[]
  projectId?: string
  resumeTaskId?: string
  queuedAt: string
}

export function conversationTitleForMode(mode: string): string {
  if (mode === 'skill_builder') return 'Création de skill'
  if (mode === 'plugin_builder') return 'Création de plugin'
  return ''
}

export function isPlaceholderConversationTitle(title: string): boolean {
  return ['', 'Nouvelle conversation', 'Nouveau chat'].includes(title.trim())
}

// ── Component ─────────────────────────────────────────────────

export default function ChatView() {
  const t = useT()
  const dialog = useAppDialog()
  const { id } = useParams<{ id?: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const [convId, setConvId] = useState<string | null>(id ?? null)
  const [convTitle, setConvTitle] = useState('Nouvelle conversation')
  const [conversationPinned, setConversationPinned] = useState(false)
  const setConversationStoreMsgs = useConversationStore(s => s.setMessages)
  const msgs = useConversationStore(s => convId ? (s.messages[convId] || []) : [])
  const setMsgs = useCallback((updater: Msg[] | ((prev: Msg[]) => Msg[])) => {
    if (convId) setConversationStoreMsgs(convId, updater)
  }, [convId, setConversationStoreMsgs])
  const [isRunning, setIsRunning] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null)
  const [activities, setActivities] = useState<BobActivityEvent[]>([])
  const [thinkingText, setThinkingText] = useState('')
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([])
  const [loadingHistory, setLoadingHistory] = useState(!!id)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [bobMode, setBobMode] = useState('agent')

  const bottomRef = useRef<HTMLDivElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const autoScrollEnabledRef = useRef(true)
  const unlistenRef = useRef<UnlistenFn[]>([])
  const runningRef = useRef(false)
  const queueRef = useRef<QueuedPrompt[]>([])
  const activeSessionRef = useRef<{ conversationId: string; sessionId: string | null } | null>(null)
  const completedSessionsRef = useRef(new Set<string>())

  const replaceQueue = useCallback((next: QueuedPrompt[]) => {
    queueRef.current = next
    setPromptQueue(next)
  }, [])

  // Keep following the response while the reader remains at the bottom.
  // Assigning scrollTop synchronously avoids competing smooth-scroll
  // animations when the final answer, activities and previews settle.
  useLayoutEffect(() => {
    if (!autoScrollEnabledRef.current) return
    const container = messageScrollRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [msgs, thinkingText, isRunning])

  useEffect(() => {
    autoScrollEnabledRef.current = true
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [id])

  const handleMessageScroll = useCallback(() => {
    const container = messageScrollRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    autoScrollEnabledRef.current = distanceFromBottom <= 80
  }, [])

  // ── Load existing conversation ───────────────────────────────
  useEffect(() => {
    if (!id) {
      setConvId(null)
      setConvTitle('Nouvelle conversation')
      setConversationPinned(false)
      setActivities([])
      setThinkingText('')
      setTaskId(null)
      setTaskDetail(null)
      setSessionId(null)
      setBobMode('agent')
      runningRef.current = false
      activeSessionRef.current = null
      setIsRunning(false)
      setLoadingHistory(false)
      setLoadError(null)
      return
    }
    const ownsInFlightPromptAtNavigation = runningRef.current
      && activeSessionRef.current?.conversationId === id
    setConvId(id)
    // Activity is live, conversation-scoped state. Never let the previous
    // conversation's tools or sub-agents flash while this history is loading.
    if (!ownsInFlightPromptAtNavigation) setActivities([])
    useAppStore.getState().markConversationRead(id)
    setConversationPinned(false)
    setLoadingHistory(true)
    setLoadError(null)

    Promise.all([getConversation(id), getMessages(id), getTasks()])
      .then(async ([conv, messages, allTasks]) => {
        if (conv) {
          setConvTitle(conv.title)
          setConversationPinned(conv.pinned)
          setBobMode(conv.bobMode ?? 'agent')
        }
        // Restore asset-protocol access before local image previews mount.
        await registerMessageArtifacts(messages, id)
        const activeTask = latestActiveTaskForConversation(allTasks, id)
        const ownsInFlightPrompt = runningRef.current
          && activeSessionRef.current?.conversationId === id
        setConversationStoreMsgs(id, prev => {
          const loaded = messages.map(m => ({
            id: m.id,
            role: (m.author === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content,
            ts: m.createdAt,
            state: 'done' as const,
            persisted: true,
            attachments: m.attachments,
            sources: mergeMessageSources(m.sources, sourcesFromLocalPaths(m.content)),
          }))
          const optimistic = (activeTask || ownsInFlightPrompt)
            ? prev.filter(p => p.state !== 'done' && !loaded.some(l => l.content === p.content))
            : []
          return [...loaded, ...optimistic]
        })
        // A newly-created conversation can finish this load before send_message
        // has created its task. Do not let that short window cancel the local run.
        if (id && !(ownsInFlightPrompt && !activeTask)) {
          applyActiveTaskForConversation(
            id,
            allTasks,
            { runningRef, activeSessionRef },
            { setTaskId, setTaskDetail, setIsRunning, setSessionId },
          )
        }
      })
      .catch(error => {
        setLoadError(error)
      })
      .finally(() => setLoadingHistory(false))
  }, [id])

  useEffect(() => {
    if (!convId) return
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('conversation-updated', event => {
      if (event.payload !== convId) return
      getConversation(convId).then(conversation => {
        if (!disposed && conversation) {
          setConvTitle(conversation.title)
          setLoadError(null)
        }
      }).catch(error => {
        if (!disposed) setLoadError(error)
      })
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [convId])

  useEffect(() => {
    if (!convId || convId.startsWith('ephemeral-')) return
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('conversation-messages-changed', event => {
      if (event.payload !== convId || editingMessageId) return
      getMessages(convId).then(async messages => {
        if (disposed || runningRef.current) return
        await registerMessageArtifacts(messages, convId)
        if (disposed || runningRef.current) return
        setConversationStoreMsgs(convId, messages.map(m => ({
          id: m.id,
          role: (m.author === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
          ts: m.createdAt,
          state: 'done' as const,
          persisted: true,
          attachments: m.attachments,
          sources: mergeMessageSources(m.sources, sourcesFromLocalPaths(m.content)),
        })))
        setActivities([])
        setTaskDetail(null)
        setTaskId(null)
      }).catch(error => {
        if (!disposed) setLoadError(error)
      })
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [convId, editingMessageId])

  // ── Handle initial prompt from HomeView ──────────────────────
  const routeState = location.state as { initialPrompt?: string; mode?: string; attachmentPaths?: string[]; projectId?: string; resumeTaskId?: string; focusComposer?: boolean } | null
  const initialPrompt = routeState?.initialPrompt
  const initialMode = routeState?.mode ?? 'agent'
  const initialHandledKey = useRef<string | null>(null)

  useEffect(() => {
    if (initialMode === 'plugin_builder' || initialMode === 'skill_builder') {
      if (!useAppStore.getState().builderSession) {
        useAppStore.getState().setBuilderSession({ kind: initialMode, brief: initialPrompt ?? '', guided: false })
      }
    }
    if (initialPrompt && initialHandledKey.current !== location.key) {
      initialHandledKey.current = location.key
      handleSend(initialPrompt, initialMode, routeState?.attachmentPaths ?? [], routeState?.projectId, routeState?.resumeTaskId)
    }
  }, [initialPrompt, location.key])

  const builderSession = useAppStore(s => s.builderSession)
  const routeBuilderMode = routeState?.mode === 'plugin_builder' || routeState?.mode === 'skill_builder'
    ? routeState.mode
    : null
  const conversationBuilderMode = bobMode === 'plugin_builder' || bobMode === 'skill_builder'
    ? bobMode
    : null
  const builderMode = builderSession?.kind ?? routeBuilderMode ?? conversationBuilderMode

  useEffect(() => {
    const builderTitle = conversationTitleForMode(builderMode ?? '')
    if (!builderTitle || !convId || convId.startsWith('ephemeral-') || !isPlaceholderConversationTitle(convTitle)) return
    setConvTitle(builderTitle)
    // Also repairs conversations created before builder titles were persisted.
    // updateConversation emits conversation-updated, refreshing the sidebar.
    void updateConversation(convId, { title: builderTitle }).catch(() => {
      setConvTitle(current => current === builderTitle ? 'Nouvelle conversation' : current)
    })
  }, [builderMode, convId, convTitle])

  useEffect(() => {
    if (builderMode !== 'plugin_builder') return
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('plugin-updated', event => {
      if (disposed || !event.payload) return
      useAppStore.getState().clearBuilderSession()
      navigate('/plugins', { state: { selectPluginId: event.payload, openCommissioning: true } })
    }).then(fn => { unlisten = fn })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [builderMode, navigate])

  // ── Subscribe to Tauri Bob events ────────────────────────────
  const subscribeToSession = useCallback(async (conversationId: string) => {

    const matchesActiveSession = (payload: { sessionId: string; conversationId: string }) => {
      const active = activeSessionRef.current
      return !!active
        && payload.conversationId === conversationId
        && payload.conversationId === active.conversationId
        && (!active.sessionId || payload.sessionId === active.sessionId)
    }

    // bob-token: streaming chunk
    const unToken = await listen<BobTokenEvent>('bob-token', event => {
      if (!matchesActiveSession(event.payload)) return

      if (event.payload.eventType === 'thought' && event.payload.chunk) {
        setThinkingText(current => appendThinkingText(current, event.payload.chunk))
        return
      }

      // Keep protocol/stderr errors out of the reply body — shown as a footer on done.
      if (event.payload.eventType === 'error') {
        const errorText = event.payload.chunk?.trim()
        if (!errorText) return
        setConversationStoreMsgs(conversationId, prev => {
          const streaming = prev.find(m => m.state === 'streaming')
          if (streaming) {
            return prev.map(m =>
              m.state === 'streaming' ? { ...m, error: errorText } : m
            )
          }
          return [...prev, {
            id: `streaming-${event.payload.sessionId}`,
            role: 'assistant' as const,
            content: '',
            ts: new Date().toISOString(),
            state: 'streaming' as const,
            error: errorText,
          }]
        })
        return
      }

      // Activities have their own Reflection/panel rendering. Never duplicate
      // them into the assistant answer body.
      if (!['text', 'token'].includes(event.payload.eventType)) return

      setConversationStoreMsgs(conversationId, prev => {
        const streaming = prev.find(m => m.state === 'streaming')
        if (streaming) {
          return prev.map(m =>
            m.state === 'streaming'
              ? { ...m, content: m.content + event.payload.chunk }
              : m
          )
        }
        // First chunk: create the streaming message
        return [...prev, {
          id: `streaming-${event.payload.sessionId}`,
          role: 'assistant',
          content: event.payload.chunk,
          ts: new Date().toISOString(),
          state: 'streaming',
        }]
      })
    })

    const unActivity = await listen<BobActivityEvent>('bob-activity', event => {
      if (!matchesActiveSession(event.payload)) return
      setActivities(current => [...current, event.payload])
      const { eventType, content, title, toolName } = event.payload
      if (eventType === 'analysis' && content) {
        setThinkingText(current => appendThinkingText(current, content))
      } else if (eventType === 'tool_started') {
        const line = title || (toolName ? `Outil ${toolName}` : 'Outil en cours…')
        setThinkingText(current => appendThinkingText(current, line))
      } else if (eventType === 'step' && content) {
        setThinkingText(current => appendThinkingText(current, content))
      }
      const snapshot = extractChromeSnapshot(event.payload)
      if (snapshot) {
        setConversationStoreMsgs(conversationId, prev => prev.map(message =>
          message.state === 'streaming'
            ? { ...message, snapshots: upsertChromeSnapshot(message.snapshots ?? [], snapshot) }
            : message,
        ))
      }
      // Sub-agent activity is displayed inline above the composer. The right
      // preview panel remains user-controlled for web pages and files.
    })

    // bob-session-done: finalise + persist
    const unDone = await listen<BobSessionDoneEvent>('bob-session-done', async event => {
      if (!matchesActiveSession(event.payload)) return

      const { success, fullOutput, error } = event.payload
      completedSessionsRef.current.add(event.payload.sessionId)
      activeSessionRef.current = null

      const localSources = sourcesFromLocalPaths(fullOutput || '')
      await Promise.allSettled(localSources
        .map(source => source.path)
        .filter((path): path is string => !!path)
        .map(path => registerExternalArtifact(path, event.payload.conversationId)))

      // Finalize the streaming message or create it if it didn't exist (fast execution)
      setConversationStoreMsgs(conversationId, prev => {
        const finalizeAssistant = (contentRaw: string, priorError?: string, priorSources?: MessageSource[]): Pick<Msg, 'content' | 'error' | 'state' | 'sources'> => {
          const content = contentRaw.trim()
          const errorText = success ? undefined : (error || priorError)
          const errorOnly = !success && !!content && (
            /^(error|erreur)\b/i.test(content)
            || (!!errorText && content === errorText.trim())
          )
          const sources = mergeMessageSources(priorSources, localSources, sourcesFromLocalPaths(content))
          if (errorOnly) {
            return { content, error: undefined, state: 'error', sources }
          }
          return {
            content: content || errorText || '(Pas de réponse)',
            error: content && errorText ? errorText : undefined,
            state: success || content ? 'done' : 'error',
            sources,
          }
        }

        const hasStreaming = prev.some(m => m.state === 'streaming')
        if (hasStreaming) {
          return prev.map(m => {
            if (m.state !== 'streaming') return m
            return {
              ...m,
              id: `done-${Date.now()}`,
              ...finalizeAssistant(fullOutput || m.content, m.error, m.sources),
              snapshots: m.snapshots,
            }
          })
        }
        return [...prev, {
          id: `done-${Date.now()}`,
          role: 'assistant',
          ...finalizeAssistant(fullOutput, undefined, undefined),
          ts: new Date().toISOString(),
        }]
      })

      setIsRunning(false)
      runningRef.current = false
      setSessionId(null)
      setThinkingText('')
      setActivities([])

      const firstDoc = localSources.find(source => source.path && AUTO_PREVIEW_EXT.test(source.path))
      if (success && firstDoc?.path) {
        setPreviewRequest({
          id: `${Date.now()}-${Math.random()}`,
          target: firstDoc.path,
          title: firstDoc.title,
          kind: 'file',
        })
        setPanelOpen(true)
      }

      const completedTaskId = event.payload.taskId
      if (completedTaskId) {
        getTaskDetail(completedTaskId).then(detail => setTaskDetail(detail)).catch(() => {})
      }

      // Clean up listeners
      unlistenRef.current.forEach(fn => fn())
      unlistenRef.current = []

      // Persist assistant message to DB
      // The Rust side already saves it via bob-session-done handler — no duplicate needed
    })

    // Clean up any listeners that were active previously or created by a concurrent
    // execution of subscribeToSession before we swap to the new ones.
    unlistenRef.current.forEach(fn => fn())
    unlistenRef.current = [unToken, unActivity, unDone]
  }, [setConversationStoreMsgs])

  useEffect(() => {
    if (!convId || !isRunning) return
    void subscribeToSession(convId)
  }, [convId, isRunning, subscribeToSession])

  useEffect(() => {
    if (!convId || convId.startsWith('ephemeral-')) return
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('task-updated', _event => {
      getTasks()
        .then(allTasks => {
          if (disposed) return
          const activeTask = latestActiveTaskForConversation(allTasks, convId)
          if (activeTask?.bobProcessId && isActiveTaskState(activeTask.state)) {
            runningRef.current = true
            setIsRunning(true)
            setSessionId(activeTask.bobProcessId)
            activeSessionRef.current = { conversationId: convId, sessionId: activeTask.bobProcessId }
            setTaskId(activeTask.id)
            return
          }
          if (!runningRef.current) return
          runningRef.current = false
          setIsRunning(false)
          setSessionId(null)
          activeSessionRef.current = null
          setThinkingText('')
          setActivities([])
          unlistenRef.current.forEach(fn => fn())
          unlistenRef.current = []
          // The final session event can race with listener registration. The
          // terminal task state is authoritative, so replace any stale
          // "Réflexion" placeholder with messages already persisted by Rust.
          getMessages(convId).then(messages => {
            if (disposed) return
            setConversationStoreMsgs(convId, messages.map(message => ({
              id: message.id,
              role: (message.author === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: message.content,
              ts: message.createdAt,
              state: 'done' as const,
              persisted: true,
              attachments: message.attachments,
              sources: mergeMessageSources(message.sources, sourcesFromLocalPaths(message.content)),
            })))
          }).catch(error => {
            if (!disposed) setLoadError(error)
          })
        })
        .catch(() => {})
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [convId])

  const openPreview = useCallback((target: string, title?: string, kind?: 'file' | 'web') => {
    setPreviewRequest({ id: `${Date.now()}-${Math.random()}`, target, title, kind })
    setPanelOpen(true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        openPreview('about:blank', 'Nouvel onglet', 'web')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openPreview])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unlistenRef.current.forEach(fn => fn())
    }
  }, [])

  // ── Send message / prompt queue ──────────────────────────────
  const executePrompt = useCallback(async (prompt: QueuedPrompt) => {
    if (runningRef.current) {
      replaceQueue([...queueRef.current, prompt])
      return
    }

    autoScrollEnabledRef.current = true
    runningRef.current = true
    setIsRunning(true)
    setThinkingText(FALLBACK_THINKING)
    const { text, mode, attachmentPaths, projectId, resumeTaskId } = prompt

    // Render the user's intent immediately. Conversation creation can involve
    // the local database/keychain and must not leave a clicked suggestion or
    // builder action looking as if nothing happened.
    const userMsg: Msg = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      ts: new Date().toISOString(),
      state: 'sent',
      persisted: false,
      attachments: attachmentPaths.map((path, index) => ({ id: `attachment-${index}`, name: path.split('/').pop() || path, size: 0, type: 'file', path })),
    }
    setActivities([])
    setTaskDetail(null)

    // Ensure we have a conversation
    let cid = convId
    if (!cid) {
      try {
        const conv = await createConversation({
          // Builder conversations already have a meaningful, stable context.
          // Persist it immediately instead of relying on a second silent Bob
          // request that may be slow or fail and leave "Nouvelle conversation".
          title: conversationTitleForMode(builderMode ?? mode),
          conversationType: mode === 'agent' || mode === 'plan' ? 'work' : 'chat',
          businessMode: mode,
          bobMode: mode,
          projectId,
        })
        cid = conv.id
        setConvId(cid)
        setConvTitle(conv.title)
        setConversationPinned(conv.pinned)
      } catch {
        // fallback: use ephemeral ID
        cid = `ephemeral-${Date.now()}`
        setConvId(cid)
      }
    }

    // Claim the new route before its asynchronous history request resolves.
    // Otherwise that initial empty result can arrive after the optimistic first
    // prompt and erase it from the view while the backend is starting the task.
    activeSessionRef.current = { conversationId: cid, sessionId: null }
    setConversationStoreMsgs(cid, prev => [...prev, userMsg])

    if (!cid.startsWith('ephemeral-') && id !== cid) {
      // Update URL without re-mounting. The optimistic prompt is already stored
      // under the definitive conversation id before the history load begins.
      navigate(`/chat/${cid}`, { replace: true, state: null })
    }

    const mentionedPluginIds = Array.from(text.matchAll(/@plugin:([A-Za-z0-9-]+)/g), match => match[1])
    const approvedPluginIds: string[] = []
    for (const pluginId of mentionedPluginIds) {
      try {
        const plugin = await getPlugin(pluginId)
        const manifest = plugin?.manifest as unknown as { builtin?: boolean; specializedMode?: unknown; permissions?: { type?: string; description?: string }[]; runtime?: { python?: string; cli?: boolean } } | undefined
        const guarded = manifest?.permissions?.filter(permission => ['command.execute', 'file.delete', 'network.request', 'mcp.connect'].includes(permission.type ?? '')) ?? []
        // Packaged Work modes (Brief Mission IBM, CTO Invest…) ship with specializedMode
        // even when manifest.builtin is false — treat them as trusted local office tools.
        const trustedLocalOffice = Boolean(manifest?.specializedMode)
        if (plugin && guarded.length > 0 && !trustedLocalOffice) {
          const runtime = [manifest?.runtime?.python ? 'Python' : '', manifest?.runtime?.cli ? 'CLI' : ''].filter(Boolean).join(' / ')
          const details = guarded.map(permission => `• ${permission.description || permission.type}`).join('\n')
          const accepted = await dialog.confirm({
            title: t('chat.pluginPermissionTitle'),
            message: t('chat.pluginPermissionMessage', {
              plugin: plugin.name,
              runtime: runtime ? ` (${runtime})` : '',
              details,
            }),
            confirmLabel: t('chat.authorize'),
          })
          if (!accepted) {
            setConversationStoreMsgs(cid, prev => [...prev, {
              id: `permission-${Date.now()}`,
              role: 'assistant',
              content: `Exécution annulée : le plugin ${plugin.name} n’a pas été autorisé.`,
              ts: new Date().toISOString(),
              state: 'error',
            }])
            runningRef.current = false
            setIsRunning(false)
            return
          }
          approvedPluginIds.push(pluginId)
        }
      } catch { /* the backend performs the authoritative plugin check */ }
    }
    try {
      // Install listeners before invoking the backend. Bob Shell can emit its
      // first JSONL records before the Tauri command returns its session id.
      await subscribeToSession(cid)
      const result = await sendMessage({
        conversationId: cid,
        message: text,
        mode,
        projectId,
        attachmentPaths,
        resumeTaskId,
        approvedPluginIds,
      })

      setConversationStoreMsgs(cid, prev => prev.map(m =>
        m.id === userMsg.id ? { ...m, id: result.userMessageId || m.id, persisted: true } : m
      ))

      setTaskId(result.taskId)
      if (completedSessionsRef.current.delete(result.sessionId)) {
        setSessionId(null)
      } else {
        activeSessionRef.current = { conversationId: cid, sessionId: result.sessionId }
        setSessionId(result.sessionId)
      }

    } catch (err) {
      activeSessionRef.current = null
      unlistenRef.current.forEach(fn => fn())
      unlistenRef.current = []
      setConversationStoreMsgs(cid, prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Erreur : ${errorMessage(err)}`,
        ts: new Date().toISOString(),
        state: 'error',
      }])
      runningRef.current = false
      setIsRunning(false)
    }
  }, [builderMode, convId, id, navigate, replaceQueue, setConversationStoreMsgs, subscribeToSession])

  const handleSend = useCallback((text: string, mode: string, attachmentPaths: string[] = [], projectId?: string, resumeTaskId?: string) => {
    if (!text.trim()) return
    const builderKind = useAppStore.getState().builderSession?.kind
    const resolvedMode = builderKind === 'plugin_builder' || builderKind === 'skill_builder' || mode === 'plugin_builder' || mode === 'skill_builder'
      ? 'agent'
      : (builderKind ?? mode)
    const prompt: QueuedPrompt = {
      id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim(),
      mode: resolvedMode,
      attachmentPaths: [...attachmentPaths],
      projectId,
      resumeTaskId,
      queuedAt: new Date().toISOString(),
    }

    // If completion and the next dispatch happen in the same render frame,
    // preserve FIFO by joining the existing queue instead of jumping ahead.
    if (runningRef.current || queueRef.current.length > 0) {
      replaceQueue([...queueRef.current, prompt])
      return
    }
    void executePrompt(prompt)
  }, [executePrompt, replaceQueue])

  useEffect(() => {
    if (isRunning || runningRef.current || promptQueue.length === 0) return
    const [next, ...remaining] = queueRef.current
    if (!next) return
    replaceQueue(remaining)
    void executePrompt(next)
  }, [executePrompt, isRunning, promptQueue, replaceQueue])

  const removeQueuedPrompt = useCallback((queuedId: string) => {
    replaceQueue(queueRef.current.filter(item => item.id !== queuedId))
  }, [replaceQueue])

  const moveQueuedPrompt = useCallback((queuedId: string, direction: -1 | 1) => {
    const current = [...queueRef.current]
    const index = current.findIndex(item => item.id === queuedId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= current.length) return
    ;[current[index], current[target]] = [current[target], current[index]]
    replaceQueue(current)
  }, [replaceQueue])

  // ── Stop ─────────────────────────────────────────────────────
  const handleStop = useCallback(async () => {
    const currentTaskId = taskId
    if (currentTaskId) {
      const { tasks, setTasks } = useAppStore.getState()
      setTasks(tasks.map(task => (
        task.id === currentTaskId && isActiveTaskState(task.state)
          ? { ...task, state: 'cancelled' as const }
          : task
      )))
    }
    try {
      if (sessionId) await stopTask(sessionId)
      if (currentTaskId) await cancelTask(currentTaskId)
    } catch { /* ignore */ }
    runningRef.current = false
    setIsRunning(false)
    setSessionId(null)
    setThinkingText('')
    setActivities([])
    if (currentTaskId) setTaskId(null)
    unlistenRef.current.forEach(fn => fn())
    unlistenRef.current = []
    setMsgs(prev =>
      prev.map(m => m.state === 'streaming' ? { ...m, state: 'done' } : m)
    )
  }, [sessionId, taskId])

  const handleEditMessage = useCallback(async (msg: Msg, newContent: string) => {
    const trimmed = newContent.trim()
    if (!trimmed || !convId || convId.startsWith('ephemeral-')) return
    if (trimmed === msg.content.trim()) {
      setEditingMessageId(null)
      return
    }
    if (!msg.persisted) {
      setMsgs(prev => [...prev, {
        id: `edit-err-${Date.now()}`,
        role: 'assistant',
        content: 'Ce message n’est pas encore enregistré. Attendez la fin de l’envoi ou rechargez la conversation.',
        ts: new Date().toISOString(),
        state: 'error',
      }])
      setEditingMessageId(null)
      return
    }

    const index = msgs.findIndex(item => item.id === msg.id)
    if (index < 0) return

    const messagesAfter = msgs.length - index - 1
    if (messagesAfter > 0) {
      const accepted = await dialog.confirm({
        message:
        messagesAfter === 1
          ? t('chat.editDeleteOne')
          : t('chat.editDeleteMany', { count: messagesAfter }),
        confirmLabel: t('chat.editAndRestart'),
        destructive: true,
      })
      if (!accepted) return
    }

    setEditingMessageId(null)
    replaceQueue([])

    if (runningRef.current) {
      await handleStop()
      if (taskId) {
        try { await cancelTask(taskId) } catch { /* ignore */ }
      }
    }

    activeSessionRef.current = null
    setSessionId(null)
    setTaskId(null)
    setTaskDetail(null)
    completedSessionsRef.current.clear()

    try {
      const rewind = await rewindConversationFromMessage(convId, msg.id)
      if (rewind.titleReset) {
        setConvTitle('Nouvelle conversation')
      }
      setMsgs(prev => prev.slice(0, index))
      setActivities([])
      setThinkingText('')

      const attachmentPaths = (msg.attachments ?? [])
        .map(item => item.path)
        .filter((path): path is string => !!path)

      await executePrompt({
        id: `queued-edit-${Date.now()}`,
        text: trimmed,
        mode: bobMode,
        attachmentPaths,
        queuedAt: new Date().toISOString(),
      })
    } catch (err) {
      setMsgs(prev => [...prev, {
        id: `edit-err-${Date.now()}`,
        role: 'assistant',
        content: `Impossible de modifier le message : ${errorMessage(err)}`,
        ts: new Date().toISOString(),
        state: 'error',
      }])
    }
  }, [bobMode, convId, executePrompt, handleStop, msgs, replaceQueue, taskId])

  const handleTogglePin = async () => {
    if (!convId || convId.startsWith('ephemeral-')) return
    const next = !conversationPinned
    setConversationPinned(next)
    try {
      await updateConversation(convId, { pinned: next })
    } catch {
      setConversationPinned(!next)
    }
  }

  const displayedConversationId = id ?? convId
  const visibleActivities = displayedConversationId
    ? activities.filter(event => event.conversationId === displayedConversationId)
    : []
  const showSubagentStatus = isRunning
    && !!displayedConversationId
    && activeSessionRef.current?.conversationId === displayedConversationId

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* Topbar */}
      <div className="topbar titlebar-drag" data-tauri-drag-region>
        <div
          className="conversation-title"
          title={convTitle}
          aria-label={convTitle}
          style={{
            marginLeft: 8,
            fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)',
            maxWidth: 'min(520px, calc(100% - 180px))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {convTitle}
        </div>
        <div className="titlebar-no-drag" style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {convId && !convId.startsWith('ephemeral-') && (
            <button
              className={`icon-btn ${conversationPinned ? 'active' : ''}`}
              onClick={handleTogglePin}
              title={conversationPinned ? 'Désépingler la conversation' : 'Épingler la conversation'}
              aria-label={conversationPinned ? 'Désépingler la conversation' : 'Épingler la conversation'}
            >
              <PinIcon filled={conversationPinned} />
            </button>
          )}
          <button className="icon-btn" title={t('chat.embeddedBrowser')} onClick={() => openPreview('about:blank', t('chat.newTab'), 'web')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>
          </button>
          <button className={`icon-btn ${panelOpen ? 'active' : ''}`} title={t('chat.activitySourcesFiles')} onClick={() => setPanelOpen(value => !value)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </button>
        </div>
      </div>

      {panelOpen && (
        <WorkspacePanel
          detail={taskDetail}
          live={visibleActivities as PanelActivity[]}
          running={isRunning}
          request={previewRequest}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {builderMode && (
        <div
          className="builder-mode-banner"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {builderMode === 'plugin_builder' ? 'Création de plugin' : 'Création de skill'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {builderMode === 'plugin_builder'
                ? (builderSession?.guided
                  ? 'Cahier des charges validé — Bob génère le bundle, puis mise en service dans Plugins'
                  : 'Décrivez l’idée ici. Bob pose les questions utiles, puis génère le plugin.')
                : 'Décrivez le skill. Bob pose quelques questions, puis écrit le fichier d’instructions.'}
            </div>
          </div>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              useAppStore.getState().clearBuilderSession()
              navigate(builderMode === 'plugin_builder' ? '/plugins' : '/skills')
            }}
          >
            {builderMode === 'plugin_builder' ? 'Terminer' : 'Ouvrir Skills'}
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messageScrollRef}
        onScroll={handleMessageScroll}
        aria-label="Messages de la conversation"
        style={{ flex: 1, overflowY: 'auto', padding: '8px 0', display: msgs.length === 0 && !loadError && !loadingHistory ? 'none' : 'block' }}
      >
        {loadError ? (
          <LoadErrorBanner
            error={loadError}
            onRetry={() => {
              if (!id) return
              setLoadingHistory(true)
              setLoadError(null)
              Promise.all([getConversation(id), getMessages(id), getTasks()])
                .then(async ([conv, messages, allTasks]) => {
                  if (conv) {
                    setConvTitle(conv.title)
                    setConversationPinned(conv.pinned)
                    setBobMode(conv.bobMode ?? 'agent')
                  }
                  await registerMessageArtifacts(messages, id)
                  setConversationStoreMsgs(id, messages.map(m => ({
                    id: m.id,
                    role: (m.author === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: m.content,
                    ts: m.createdAt,
                    state: 'done' as const,
                    persisted: true,
                    attachments: m.attachments,
                    sources: mergeMessageSources(m.sources, sourcesFromLocalPaths(m.content)),
                  })))
                  applyActiveTaskForConversation(
                    id,
                    allTasks,
                    { runningRef, activeSessionRef },
                    { setTaskId, setTaskDetail, setIsRunning, setSessionId },
                  )
                })
                .catch(error => setLoadError(error))
                .finally(() => setLoadingHistory(false))
            }}
            fallback={t('chat.loadFailed')}
          />
        ) : null}
        {loadingHistory && msgs.length === 0 ? (
          <LoadingMessages />
        ) : (
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {msgs.map(msg => (
              <div key={msg.id}>
                {isRunning && msg.state === 'streaming' && thinkingText && (
                  <WorkingIndicator
                    thinking={thinkingText}
                    loading={false}
                    snapshots={msg.snapshots}
                    onOpenSnapshot={openPreview}
                  />
                )}
                <MessageBubble
                  msg={msg}
                  onOpenResource={openPreview}
                  canEdit={
                    msg.role === 'user'
                    && !!msg.persisted
                    && !isRunning
                    && !convId?.startsWith('ephemeral-')
                    && (msg.state === 'done' || msg.state === 'sent')
                  }
                  isEditing={editingMessageId === msg.id}
                  onStartEdit={() => setEditingMessageId(msg.id)}
                  onCancelEdit={() => setEditingMessageId(null)}
                  onSubmitEdit={content => handleEditMessage(msg, content)}
                />
              </div>
            ))}
            {isRunning && !msgs.some(message => message.state === 'streaming') && (
              <WorkingIndicator
                thinking={thinkingText}
                loading
                snapshots={visibleActivities.reduce<ChromeSnapshot[]>((list, event) => {
                  const snapshot = extractChromeSnapshot(event)
                  return snapshot ? upsertChromeSnapshot(list, snapshot) : list
                }, [])}
                onOpenSnapshot={openPreview}
              />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="composer-wrap" style={{ 
        maxWidth: 720, margin: '0 auto', width: '100%', 
        ...(msgs.length === 0 && !loadingHistory && !loadError ? { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' } : {})
      }}>
        {msgs.length === 0 && !loadingHistory && !loadError && <EmptyState builderMode={builderMode} />}
        {promptQueue.length > 0 && (
          <PromptQueuePanel
            items={promptQueue}
            onRemove={removeQueuedPrompt}
            onMove={moveQueuedPrompt}
            onClear={() => replaceQueue([])}
          />
        )}
        {showSubagentStatus && <SubagentStatusPanel events={visibleActivities} />}
        <Composer
          placeholder={
            builderMode === 'plugin_builder'
              ? 'Décrivez le plugin à créer…'
              : builderMode === 'skill_builder'
                ? 'Décrivez le skill à créer…'
                : t('chat.placeholder')
          }
          showModePill
          showProjectPill
          initialProjectId={routeState?.projectId}
          focusRequestKey={routeState?.focusComposer ? location.key : undefined}
          onSend={handleSend}
          onStop={handleStop}
          busy={isRunning}
          queueCount={promptQueue.length}
        />
        <div style={{ textAlign: 'center', marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
          {isRunning ? 'Entrée pour ajouter à la file' : 'Entrée pour envoyer'} · Maj+Entrée pour nouvelle ligne
          {isRunning && <span style={{ marginLeft: 12, color: 'var(--accent)' }}>● Bob travaille{promptQueue.length ? ` · ${promptQueue.length} en attente` : '…'}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Message Bubble ────────────────────────────────────────────

export function MessageBubble({
  msg,
  onOpenResource,
  canEdit = false,
  isEditing = false,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: {
  msg: Msg
  onOpenResource: (target: string, title?: string, kind?: 'file' | 'web') => void
  canEdit?: boolean
  isEditing?: boolean
  onStartEdit?: () => void
  onCancelEdit?: () => void
  onSubmitEdit?: (content: string) => void
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [draft, setDraft] = useState(msg.content)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing) {
      setDraft(msg.content)
      requestAnimationFrame(() => {
        const el = editRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    }
  }, [isEditing, msg.content])

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const submitEdit = () => {
    if (!onSubmitEdit) return
    const trimmed = draft.trim()
    if (!trimmed) return
    onSubmitEdit(trimmed)
  }

  if (msg.role === 'user') {
    return (
      <div className="msg-user-row group items-center gap-2">
        <div className="msg-user-actions">
          {canEdit && !isEditing && (
            <button
              onClick={onStartEdit}
              className="msg-action-btn"
              title={t('chat.edit')}
              style={{ cursor: 'pointer' }}
            >
              <Pencil size={14} />
            </button>
          )}
          {!isEditing && (
            <button onClick={handleCopy} className="msg-action-btn" title={t('chat.copy')} type="button">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
        <div className="msg-user-stack">
          {isEditing ? (
            <div className="msg-user-edit">
              <textarea
                ref={editRef}
                className="msg-user-edit-input"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onCancelEdit?.()
                  } else if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submitEdit()
                  }
                }}
                rows={Math.min(12, Math.max(2, draft.split('\n').length))}
              />
              <div className="msg-edit-actions">
                <button type="button" className="msg-edit-cancel" onClick={onCancelEdit}>{t('common.cancel')}</button>
                <button type="button" className="msg-edit-save" onClick={submitEdit} disabled={!draft.trim()}>{t('chat.send')}</button>
              </div>
            </div>
          ) : (
            <div className="msg-user" data-testid="chat-message-user">{msg.content}</div>
          )}
          {!isEditing && <MessageResources msg={msg} onOpen={onOpenResource} />}
        </div>
      </div>
    )
  }

  const isHardError = msg.state === 'error' && !msg.error
  const showErrorFooter = Boolean(msg.error) || msg.state === 'error'

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }} className="group">
      <BobAvatar streaming={msg.state === 'streaming'} error={showErrorFooter} />
      <div className="msg-assistant prose">
        {msg.content && (
          <div style={isHardError ? { color: 'var(--danger)' } : undefined}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              table: ({ node: _node, ...props }) => (
                <div className="markdown-table-scroll" role="region" aria-label="Tableau défilant horizontalement" tabIndex={0}>
                  <table {...props} />
                </div>
              ),
              a: ({ href, children }) => <a href={href} onClick={event => {
                if (!href) return
                event.preventDefault(); onOpenResource(href, String(children), href.startsWith('http') ? 'web' : 'file')
              }}>{children}</a>,
              img: ({ src, alt }) => (
                <ResilientImage source={src || ''} alt={alt || 'Image'} className="markdown-inline-image" />
              ),
            }}>{normalizeAssistantMarkdown(linkifyLocalFilePaths(msg.content))}</ReactMarkdown>
          </div>
        )}
        {msg.error && (
          <p style={{ color: 'var(--danger)', marginTop: msg.content ? 10 : 0, fontSize: 13, lineHeight: 1.45 }}>
            {msg.error}
          </p>
        )}
        <MessageResources msg={msg} onOpen={onOpenResource} />
        {msg.snapshots?.some(snapshot => !snapshot.background) ? (
          <div className="chrome-snapshot-stack">
            {msg.snapshots.filter(snapshot => !snapshot.background).map(snapshot => (
              <ChromeSnapshotCard key={snapshot.id} snapshot={snapshot} onOpen={(url, title) => onOpenResource(url, title, 'web')} />
            ))}
          </div>
        ) : null}
        {msg.state === 'streaming' && (
          <span style={{
            display: 'inline-block', width: 8, height: 14,
            background: 'var(--accent)', borderRadius: 2,
            marginLeft: 2, verticalAlign: 'text-bottom',
            animation: 'blink 1s step-end infinite',
          }} />
        )}
      </div>
      <button onClick={handleCopy} className="msg-action-btn msg-action-btn--assistant" title={t('chat.copy')} type="button">
         {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

function MessageResources({ msg, onOpen }: { msg: Msg; onOpen: (target: string, title?: string, kind?: 'file' | 'web') => void }) {
  const merged = mergeMessageSources(
    msg.sources,
    sourcesFromLocalPaths(msg.content),
    (msg.attachments ?? []).map(item => ({
      id: item.id,
      title: item.name,
      path: item.path,
      url: item.url,
    })),
    (msg.snapshots ?? [])
      .filter(snapshot => snapshot.background && snapshot.url)
      .map(snapshot => ({
        id: snapshot.id,
        title: snapshot.title,
        url: snapshot.url,
      })),
  )
  const resources = merged
    .map(item => ({
      id: item.id,
      name: item.title,
      target: item.url || item.path,
      kind: item.url && !item.path ? 'web' as const : 'file' as const,
    }))
    .filter(item => item.target)
  if (!resources.length) return null
  const imageResources = msg.role === 'assistant'
    ? resources.filter(item => item.target && INLINE_IMAGE_EXT.test(item.target))
    : []
  return (
    <>
      {imageResources.length > 0 && (
        <div className="message-image-previews" aria-label="Images générées">
          {imageResources.map(item => {
            const label = item.name || fileNameFromPath(item.target || '')
            return (
              <button
                type="button"
                className="message-image-preview"
                key={`preview-${item.kind}-${normalizeLocalFilePathKey(item.target || item.id)}`}
                onClick={() => item.target && onOpen(item.target, item.name, item.kind)}
                aria-label={`Ouvrir l’aperçu ${label}`}
                title={item.target}
              >
                <ResilientImage source={item.target || ''} alt={`Aperçu de ${label}`} className="message-image-preview-visual" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="message-resources">
        {resources.map(item => {
          const label = item.name || fileNameFromPath(item.target || '')
          return (
            <button
              className="message-resource-chip"
              key={`${item.kind}-${normalizeLocalFilePathKey(item.target || item.id)}`}
              onClick={() => item.target && onOpen(item.target, item.name, item.kind)}
              title={item.target}
            >
              {item.kind === 'web' ? (
                <span className="message-resource-glyph" aria-hidden="true">◎</span>
              ) : (
                <PluginIcon
                  icon={iconForFileName(label || item.target || '')}
                  size="sm"
                  className="message-resource-icon"
                />
              )}
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function PromptQueuePanel({ items, onRemove, onMove, onClear }: {
  items: QueuedPrompt[]
  onRemove: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onClear: () => void
}) {
  const t = useT()
  return (
    <section className="prompt-queue" aria-label={t('chat.queueLabel', { count: items.length })}>
      <header className="prompt-queue-header">
        <div><span className="prompt-queue-icon">≡</span><strong>{t('chat.queue')}</strong><span className="prompt-queue-count">{items.length}</span></div>
        <button onClick={onClear}>{t('chat.clearQueue')}</button>
      </header>
      <div className="prompt-queue-list">
        {items.map((item, index) => (
          <article className="prompt-queue-item" key={item.id}>
            <span className="prompt-queue-position">{index + 1}</span>
            <div className="prompt-queue-content">
              <strong title={item.text}>{item.text}</strong>
              <small>{item.mode}{item.attachmentPaths.length ? ` · ${t(item.attachmentPaths.length > 1 ? 'chat.attachments' : 'chat.attachment', { count: item.attachmentPaths.length })}` : ''}</small>
            </div>
            <div className="prompt-queue-actions">
              <button disabled={index === 0} onClick={() => onMove(item.id, -1)} title={t('chat.moveUp')} aria-label={t('chat.movePromptUp', { index: index + 1 })}>↑</button>
              <button disabled={index === items.length - 1} onClick={() => onMove(item.id, 1)} title={t('chat.moveDown')} aria-label={t('chat.movePromptDown', { index: index + 1 })}>↓</button>
              <button className="prompt-queue-remove" onClick={() => onRemove(item.id)} title={t('chat.remove')} aria-label={t('chat.removePrompt', { index: index + 1 })}>×</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

// ── Sub-components ────────────────────────────────────────────

function PinIcon({ filled = false }: { filled?: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 17v5"/><path d="m5 17 3.5-3.5V6L7 4.5V3h10v1.5L15.5 6v7.5L19 17z"/>
  </svg>
}

function BobAvatar({ streaming, error }: { streaming?: boolean; error?: boolean }) {
  return (
    <div
      data-streaming={streaming ? 'true' : 'false'}
      data-error={error ? 'true' : 'false'}
      style={{
        width: 30,
        height: 28,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
        position: 'relative',
      }}
    >
      <img
        src={bobAvatarIcon}
        alt="Bob"
        style={{ width: 30, height: 28, objectFit: 'contain', display: 'block' }}
      />
      {error ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--danger)',
          }}
        />
      ) : null}
    </div>
  )
}

const FALLBACK_THINKING = 'Analyse de la demande…'
const THINKING_SWAP_MS = 280

export function appendThinkingText(current: string, chunk: string): string {
  const next = chunk.trim()
  if (!next) return current
  if (!current) return next
  if (current === next || current.endsWith(next)) return current
  if (next.startsWith(current)) return next

  for (let i = Math.min(current.length, next.length); i > 0; i--) {
    if (current.endsWith(next.slice(0, i))) {
      return current + next.slice(i)
    }
  }

  let combined = ""
  if (next.length <= 48 && !next.includes('\n') && !current.endsWith('\n')) {
    combined = `${current} ${next}`.replace(/\s{2,}/g, ' ').trim()
  } else {
    combined = `${current}\n${next}`
  }
  
  // Collapse adjacent duplicated words to handle LLM streaming hiccups
  combined = combined.replace(/(\b\w+\b)(?:\s+\1\b)+/gi, '$1')
  // Also handle exact substrings that are glued together like "JeJe" -> "Je"
  combined = combined.replace(/([a-zA-Z]{2,})\1+/gi, '$1')
  
  return combined
}

export function latestThinkingLine(text: string): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

export function isThinkingContinuation(previous: string, next: string): boolean {
  if (!previous || !next) return false
  if (previous === next) return true
  return next.startsWith(previous) || previous.startsWith(next)
}

function ThinkingStream({ thinking }: { thinking: string }) {
  const current = latestThinkingLine(thinking) || FALLBACK_THINKING
  const previousRef = useRef(current)
  const [displayed, setDisplayed] = useState(current)
  const [outgoing, setOutgoing] = useState<string | null>(null)
  const [entering, setEntering] = useState(false)

  useLayoutEffect(() => {
    const previous = previousRef.current
    if (current === previous) return
    previousRef.current = current

    if (isThinkingContinuation(previous, current)) {
      setDisplayed(current)
      return
    }

    setOutgoing(previous)
    setDisplayed(current)
    setEntering(true)
    const timer = window.setTimeout(() => {
      setOutgoing(null)
      setEntering(false)
    }, THINKING_SWAP_MS)
    return () => window.clearTimeout(timer)
  }, [current])

  return (
    <div className="thinking-stream">
      {outgoing ? (
        <div className="thinking-stream-line thinking-stream-line--out" aria-hidden="true">
          {outgoing}
        </div>
      ) : null}
      <div className={entering ? 'thinking-stream-line thinking-stream-line--in' : 'thinking-stream-line'}>
        {displayed}
      </div>
    </div>
  )
}

export function WorkingIndicator({
  thinking,
  loading,
  snapshots,
  onOpenSnapshot,
}: {
  thinking: string
  loading: boolean
  snapshots?: ChromeSnapshot[]
  onOpenSnapshot?: (target: string, title?: string, kind?: 'file' | 'web') => void
}) {
  const t = useT()
  return (
    <div role="status" aria-label={t('chat.thinkingInProgress')} className="working-indicator">
      <BobAvatar streaming />
      <div className="working-indicator-body">
        {loading && (
          <div className="typing-dots" aria-hidden="true">
            {[0, 1, 2].map(index => <span key={index} className="typing-dot" style={{ animationDelay: `${index * 0.2}s` }} />)}
          </div>
        )}
        <div className="thinking-stream-wrap">
          <div className="thinking-stream-label">
            {thinking.trim() ? t('chat.thinking') : t('chat.thinkingInProgress')}
          </div>
          <ThinkingStream thinking={thinking} />
        </div>
        {snapshots && snapshots.length > 0 ? (
          <div className="chrome-snapshot-stack">
            {snapshots.map(snapshot => (
              <ChromeSnapshotCard
                key={snapshot.id}
                snapshot={snapshot}
                onOpen={(url, title) => onOpenSnapshot?.(url, title, 'web')}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function EmptyState({ builderMode }: { builderMode?: 'plugin_builder' | 'skill_builder' | null }) {
  const t = useT()
  const hint = builderMode === 'plugin_builder'
    ? 'Décrivez le plugin (ex. « brief client AXA avec risques à vérifier »). Pas de formulaire.'
    : builderMode === 'skill_builder'
      ? 'Décrivez le skill (ex. « relire un contrat et lister les clauses à risque »). Pas de formulaire.'
      : t('chat.empty')
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, marginBottom: 24,
      color: 'var(--text-muted)', fontSize: 14,
    }}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity={.4}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span>{hint}</span>
    </div>
  )
}

function LoadingMessages() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: 'var(--text-muted)', gap: 8 }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%',
        border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
        animation: 'spin 0.8s linear infinite' }} />
      Chargement de la conversation…
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
