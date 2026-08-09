// ============================================================
// Bob Work – ChatView
// Conversations réelles : IPC → DB → streaming Tauri events
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Copy, Check } from 'lucide-react'
import Composer from '../components/Composer/Composer'
import WorkspacePanel, { type PanelActivity, type PreviewRequest } from '../components/WorkspacePanel/WorkspacePanel'
import ReactMarkdown from 'react-markdown'
import {
  sendMessage, stopTask,
  getConversation, getMessages, createConversation, updateConversation, getTaskDetail, cancelTask, getTasks, getPlugin,
} from '../lib/ipc'
import type { MessageAttachment, MessageSource, TaskDetail } from '@bob-work/shared-types'

// ── Types ─────────────────────────────────────────────────────

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: string
  state: 'sent' | 'streaming' | 'done' | 'error'
  attachments?: MessageAttachment[]
  sources?: MessageSource[]
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

// ── Component ─────────────────────────────────────────────────

export default function ChatView() {
  const { id } = useParams<{ id?: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const [convId, setConvId] = useState<string | null>(id ?? null)
  const [convTitle, setConvTitle] = useState('Nouvelle conversation')
  const [conversationPinned, setConversationPinned] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null)
  const [activities, setActivities] = useState<BobActivityEvent[]>([])
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([])
  const [loadingHistory, setLoadingHistory] = useState(!!id)

  const bottomRef = useRef<HTMLDivElement>(null)
  const unlistenRef = useRef<UnlistenFn[]>([])
  const runningRef = useRef(false)
  const queueRef = useRef<QueuedPrompt[]>([])
  const activeSessionRef = useRef<{ conversationId: string; sessionId: string | null } | null>(null)
  const completedSessionsRef = useRef(new Set<string>())

  const replaceQueue = useCallback((next: QueuedPrompt[]) => {
    queueRef.current = next
    setPromptQueue(next)
  }, [])

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  // ── Load existing conversation ───────────────────────────────
  useEffect(() => {
    if (!id) {
      setConversationPinned(false)
      setLoadingHistory(false)
      return
    }
    setConvId(id)
    setConversationPinned(false)
    setLoadingHistory(true)

    Promise.all([getConversation(id), getMessages(id), getTasks()])
      .then(([conv, messages, allTasks]) => {
        if (conv) {
          setConvTitle(conv.title)
          setConversationPinned(conv.pinned)
        }
        setMsgs(prev => {
          const loaded = messages.map(m => ({
            id: m.id,
            role: (m.author === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content,
            ts: m.createdAt,
            state: 'done' as const,
            attachments: m.attachments,
            sources: m.sources,
          }))
          const optimistic = prev.filter(p => p.state !== 'done' && !loaded.some(l => l.content === p.content))
          return [...loaded, ...optimistic]
        })
        const latestTask = allTasks.find(task => task.conversationId === id)
        if (latestTask) {
          setTaskId(latestTask.id)
          getTaskDetail(latestTask.id).then(setTaskDetail).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false))
  }, [id])

  useEffect(() => {
    if (!convId) return
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('conversation-updated', event => {
      if (event.payload !== convId) return
      getConversation(convId).then(conversation => {
        if (!disposed && conversation) setConvTitle(conversation.title)
      }).catch(() => {})
    }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [convId])

  // ── Handle initial prompt from HomeView ──────────────────────
  const routeState = location.state as { initialPrompt?: string; mode?: string; attachmentPaths?: string[]; projectId?: string; resumeTaskId?: string } | null
  const initialPrompt = routeState?.initialPrompt
  const initialMode = routeState?.mode ?? 'agent'
  const initialHandled = useRef(false)

  useEffect(() => {
    if (initialPrompt && !initialHandled.current) {
      initialHandled.current = true
      handleSend(initialPrompt, initialMode, routeState?.attachmentPaths ?? [], routeState?.projectId, routeState?.resumeTaskId)
    }
  }, [initialPrompt])

  // ── Subscribe to Tauri Bob events ────────────────────────────
  const subscribeToSession = useCallback(async (conversationId: string) => {
    // Clean up any previous listeners
    unlistenRef.current.forEach(fn => fn())
    unlistenRef.current = []

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

      setMsgs(prev => {
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
    })

    // bob-session-done: finalise + persist
    const unDone = await listen<BobSessionDoneEvent>('bob-session-done', async event => {
      if (!matchesActiveSession(event.payload)) return

      const { success, fullOutput, error } = event.payload
      completedSessionsRef.current.add(event.payload.sessionId)
      activeSessionRef.current = null

      // Finalize the streaming message or create it if it didn't exist (fast execution)
      setMsgs(prev => {
        const hasStreaming = prev.some(m => m.state === 'streaming')
        if (hasStreaming) {
          return prev.map(m =>
            m.state === 'streaming'
              ? {
                  ...m,
                  id: `done-${Date.now()}`,
                  content: fullOutput || m.content || error || '(Pas de réponse)',
                  state: success ? 'done' : 'error',
                }
              : m
          )
        } else {
          return [...prev, {
            id: `done-${Date.now()}`,
            role: 'assistant',
            content: fullOutput || error || '(Pas de réponse)',
            state: success ? 'done' : 'error',
            ts: new Date().toISOString()
          }]
        }
      })

      setIsRunning(false)
      runningRef.current = false
      setSessionId(null)

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

    unlistenRef.current = [unToken, unActivity, unDone]
  }, [])

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

    runningRef.current = true
    setIsRunning(true)
    const { text, mode, attachmentPaths, projectId, resumeTaskId } = prompt

    // Ensure we have a conversation
    let cid = convId
    if (!cid) {
      try {
        const conv = await createConversation({
          title: '',
          conversationType: mode === 'agent' || mode === 'plan' ? 'work' : 'chat',
          businessMode: mode,
          bobMode: mode,
          projectId,
        })
        cid = conv.id
        setConvId(cid)
        setConvTitle(conv.title)
        setConversationPinned(conv.pinned)
        // Update URL without re-mounting
        navigate(`/chat/${cid}`, { replace: true, state: null })
      } catch {
        // fallback: use ephemeral ID
        cid = `ephemeral-${Date.now()}`
        setConvId(cid)
      }
    }

    // Optimistic user message
    const userMsg: Msg = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      ts: new Date().toISOString(),
      state: 'sent',
      attachments: attachmentPaths.map((path, index) => ({ id: `attachment-${index}`, name: path.split('/').pop() || path, size: 0, type: 'file', path })),
    }
    setMsgs(prev => [...prev, userMsg])
    setActivities([])
    setTaskDetail(null)

    const mentionedPluginIds = Array.from(text.matchAll(/@plugin:([A-Za-z0-9-]+)/g), match => match[1])
    const approvedPluginIds: string[] = []
    for (const pluginId of mentionedPluginIds) {
      try {
        const plugin = await getPlugin(pluginId)
        const manifest = plugin?.manifest as unknown as { permissions?: { type?: string; description?: string }[]; runtime?: { python?: string; cli?: boolean } } | undefined
        const guarded = manifest?.permissions?.filter(permission => ['command.execute', 'file.delete', 'network.request', 'mcp.connect'].includes(permission.type ?? '')) ?? []
        if (plugin && guarded.length > 0) {
          const runtime = [manifest?.runtime?.python ? 'Python' : '', manifest?.runtime?.cli ? 'CLI' : ''].filter(Boolean).join(' / ')
          const details = guarded.map(permission => `• ${permission.description || permission.type}`).join('\n')
          const accepted = window.confirm(`Autoriser « ${plugin.name} » pour ce prompt${runtime ? ` (${runtime})` : ''} ?\n\n${details}\n\nBob Work lancera Bob Shell uniquement après votre accord.`)
          if (!accepted) {
            setMsgs(prev => [...prev, {
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
    activeSessionRef.current = { conversationId: cid, sessionId: null }

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
      setMsgs(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Erreur : ${err instanceof Error ? err.message : String(err)}`,
        ts: new Date().toISOString(),
        state: 'error',
      }])
      runningRef.current = false
      setIsRunning(false)
    }
  }, [convId, navigate, replaceQueue, subscribeToSession])

  const handleSend = useCallback((text: string, mode: string, attachmentPaths: string[] = [], projectId?: string, resumeTaskId?: string) => {
    if (!text.trim()) return
    const prompt: QueuedPrompt = {
      id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim(),
      mode,
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
  const handleStop = async () => {
    if (!sessionId) return
    try {
      await stopTask(sessionId)
      if (taskId) await cancelTask(taskId)
    } catch { /* ignore */ }
    runningRef.current = false
    setIsRunning(false)
    setSessionId(null)
    if (taskId) setTaskId(null)
    unlistenRef.current.forEach(fn => fn())
    unlistenRef.current = []
    setMsgs(prev =>
      prev.map(m => m.state === 'streaming' ? { ...m, state: 'done' } : m)
    )
  }

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

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* Topbar */}
      <div className="topbar titlebar-drag">
        <div className="conversation-title titlebar-no-drag" style={{
          marginLeft: 8,
          fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)',
          maxWidth: 'min(520px, calc(100% - 180px))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
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
          {isRunning && (
            <button
              className="icon-btn"
              onClick={handleStop}
              title="Arrêter"
              style={{ color: 'var(--danger)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
            </button>
          )}
          <button className="icon-btn" title="Navigateur intégré (⌘⇧B)" onClick={() => openPreview('about:blank', 'Nouvel onglet', 'web')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>
          </button>
          <button className={`icon-btn ${panelOpen ? 'active' : ''}`} title="Activité, sources et fichiers" onClick={() => setPanelOpen(value => !value)}>
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
          live={activities as PanelActivity[]}
          running={isRunning}
          request={previewRequest}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', display: msgs.length === 0 ? 'none' : 'block' }}>
        {loadingHistory ? (
          <LoadingMessages />
        ) : (
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {msgs.map(msg => <MessageBubble key={msg.id} msg={msg} onOpenResource={openPreview} />)}
            {isRunning && msgs[msgs.length - 1]?.state !== 'streaming' && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="composer-wrap" style={{ 
        maxWidth: 720, margin: '0 auto', width: '100%', 
        ...(msgs.length === 0 ? { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' } : {})
      }}>
        {msgs.length === 0 && <EmptyState />}
        {promptQueue.length > 0 && (
          <PromptQueuePanel
            items={promptQueue}
            onRemove={removeQueuedPrompt}
            onMove={moveQueuedPrompt}
            onClear={() => replaceQueue([])}
          />
        )}
        <Composer
          placeholder="Travailler avec Bob…"
          showModePill
          showProjectPill
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

export function MessageBubble({ msg, onOpenResource }: { msg: Msg; onOpenResource: (target: string, title?: string, kind?: 'file' | 'web') => void }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (msg.role === 'user') {
    return (
      <div className="msg-user-row group items-center gap-2">
        <button onClick={handleCopy} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-400" title="Copier" style={{ cursor: 'pointer' }}>
           {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <div className="msg-user-stack"><div className="msg-user">{msg.content}</div><MessageResources msg={msg} onOpen={onOpenResource} /></div>
      </div>
    )
  }

  const isError = msg.state === 'error'

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }} className="group">
      <BobAvatar streaming={msg.state === 'streaming'} error={isError} />
      <div
        className="msg-assistant prose"
        style={isError ? { color: 'var(--danger)' } : undefined}
      >
        <ReactMarkdown components={{ a: ({ href, children }) => <a href={href} onClick={event => {
          if (!href) return
          event.preventDefault(); onOpenResource(href, String(children), href.startsWith('http') ? 'web' : 'file')
        }}>{children}</a> }}>{msg.content}</ReactMarkdown>
        <MessageResources msg={msg} onOpen={onOpenResource} />
        {msg.state === 'streaming' && (
          <span style={{
            display: 'inline-block', width: 8, height: 14,
            background: 'var(--accent)', borderRadius: 2,
            marginLeft: 2, verticalAlign: 'text-bottom',
            animation: 'blink 1s step-end infinite',
          }} />
        )}
      </div>
      <button onClick={handleCopy} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-400 mt-2" title="Copier" style={{ cursor: 'pointer' }}>
         {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

function MessageResources({ msg, onOpen }: { msg: Msg; onOpen: (target: string, title?: string, kind?: 'file' | 'web') => void }) {
  const resources = [
    ...(msg.attachments ?? []).map(item => ({ id: item.id, name: item.name, target: item.path || item.url, kind: item.url ? 'web' as const : 'file' as const })),
    ...(msg.sources ?? []).map(item => ({ id: item.id, name: item.title, target: item.url || item.path, kind: item.url ? 'web' as const : 'file' as const })),
  ].filter(item => item.target)
  if (!resources.length) return null
  return <div className="message-resources">{resources.map(item => <button className="message-resource-chip" key={`${item.kind}-${item.id}`} onClick={() => item.target && onOpen(item.target, item.name, item.kind)}><b>{item.kind === 'web' ? '◎' : '◇'}</b><span>{item.name}</span></button>)}</div>
}

function PromptQueuePanel({ items, onRemove, onMove, onClear }: {
  items: QueuedPrompt[]
  onRemove: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onClear: () => void
}) {
  return (
    <section className="prompt-queue" aria-label={`File d’attente, ${items.length} prompt${items.length > 1 ? 's' : ''}`}>
      <header className="prompt-queue-header">
        <div><span className="prompt-queue-icon">≡</span><strong>File d’attente</strong><span className="prompt-queue-count">{items.length}</span></div>
        <button onClick={onClear}>Tout retirer</button>
      </header>
      <div className="prompt-queue-list">
        {items.map((item, index) => (
          <article className="prompt-queue-item" key={item.id}>
            <span className="prompt-queue-position">{index + 1}</span>
            <div className="prompt-queue-content">
              <strong title={item.text}>{item.text}</strong>
              <small>{item.mode}{item.attachmentPaths.length ? ` · ${item.attachmentPaths.length} pièce${item.attachmentPaths.length > 1 ? 's' : ''} jointe${item.attachmentPaths.length > 1 ? 's' : ''}` : ''}</small>
            </div>
            <div className="prompt-queue-actions">
              <button disabled={index === 0} onClick={() => onMove(item.id, -1)} title="Monter" aria-label={`Monter le prompt ${index + 1}`}>↑</button>
              <button disabled={index === items.length - 1} onClick={() => onMove(item.id, 1)} title="Descendre" aria-label={`Descendre le prompt ${index + 1}`}>↓</button>
              <button className="prompt-queue-remove" onClick={() => onRemove(item.id)} title="Retirer" aria-label={`Retirer le prompt ${index + 1}`}>×</button>
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
    <div style={{
      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
      background: error
        ? 'var(--danger)'
        : streaming
          ? 'linear-gradient(135deg, #4338ca, #0891b2)'
          : 'linear-gradient(135deg, #4338ca, #0891b2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700, color: 'white', marginTop: 2,
      boxShadow: streaming ? '0 0 0 2px var(--accent)' : undefined,
      transition: 'box-shadow .3s',
    }}>B</div>
  )
}

function TypingIndicator() {
  return (
    <div role="status" aria-label="Bob travaille" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <BobAvatar streaming />
      <div style={{
        display: 'flex', gap: 5, alignItems: 'center',
        padding: '12px 16px', borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--text-muted)',
            animation: `bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
          }} />
        ))}
      </div>
      <style>{`
        @keyframes bounce { 0%,60%,100%{transform:translateY(0);opacity:.4} 30%{transform:translateY(-5px);opacity:1} }
        @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, marginBottom: 24,
      color: 'var(--text-muted)', fontSize: 14,
    }}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity={.4}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span>Posez une question ou démarrez une tâche</span>
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
