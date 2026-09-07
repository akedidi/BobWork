// ============================================================
// Bob Work – ChatView
// Conversations réelles : IPC → DB → streaming Tauri events
// ============================================================

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, type MutableRefObject } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  Bot, Check, CircleAlert, Copy, Database, FilePlus2, FilePenLine, FileSearch,
  FileX2, Globe2, MousePointer2, Pencil, Search, Terminal, Wrench, ChevronRight,
} from 'lucide-react'
import Composer from '../components/Composer/Composer'
import WorkspacePanel, { type PanelActivity, type PreviewRequest } from '../components/WorkspacePanel/WorkspacePanel'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  sendMessage, stopTask,
  getConversation, getMessages, createConversation, updateConversation, getTaskDetail, cancelTask, getTasks, getPlugin,
  rewindConversationFromMessage,
  registerExternalArtifact,
  getCodeGraphSuggestion, installExternalRuntime,
} from '../lib/ipc'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import type { ConversationChoice, ConversationInteraction, FileChange, MessageAttachment, MessageSource, TaskDetail, ToolUse } from '@bob-work/shared-types'
import { localeToBcp47, useI18n, useT } from '../i18n'
import { errorMessage } from '../lib/errorMessage'
import { formatMessageTimestamp } from '../lib/messageTimestamp'
import { isActiveTaskState, latestActiveTaskForConversation } from '../lib/activeTasks'
import { useAppStore, useConversationStore } from '../stores/appStore'
import { useConversationUpdated, useConversationMessagesChanged, useTaskUpdated, useBobSessionDone } from '../hooks/useTauriEvents'
import { extractLocalFilePaths, fileNameFromPath, linkifyLocalFilePaths, normalizeLocalFilePathKey, preferAbsoluteLocalPath } from '../lib/localFilePaths'
import { PluginIcon, iconForFileName } from '../components/PluginIcon'
import { ChromeSnapshotCard } from '../components/ChromeSnapshot/ChromeSnapshotCard'
import { INLINE_IMAGE_EXT, INLINE_VISUALIZATION_EXT } from "../constants/fileTypes"
import { extractChromeSnapshot, upsertChromeSnapshot, type ChromeSnapshot } from '../lib/chromeSnapshot'
import { useAppDialog } from '../components/AppDialog'
import { SubagentStatusPanel, taggedSubagentReasoningId } from '../components/SubagentStatus/SubagentStatusPanel'
import { FittedHtmlFrame } from '../components/FittedHtmlFrame'
import { ConversationMapCard } from '../components/Map/ConversationMapCard'
import { mapSpecsFromActivities } from '../lib/mapSpec'
import { ExecutionPlanCard } from '../components/ExecutionPlan/ExecutionPlanCard'
import { executionPlanFromActivities } from '../lib/executionPlan'
import bobAvatarIcon from '../assets/bob-avatar.png'
import { mergeVisibleMessages } from '../lib/chatUtils'


function sourcesFromLocalPaths(content: string): MessageSource[] {
  return extractLocalFilePaths(content).map(path => ({
    id: path,
    title: fileNameFromPath(path),
    path,
  }))
}

/**
 * `bob-session-done` is authoritative for files created in the session
 * workspace. Unlike paths printed by the model, these have already been
 * resolved, checked and made durable by the backend.
 */
function sourcesFromDeliverablePaths(paths: string[] | undefined): MessageSource[] {
  return (paths ?? [])
    .filter((path): path is string => typeof path === 'string' && path.startsWith('/'))
    .map(path => ({ id: path, title: fileNameFromPath(path), path }))
}

/** Replace only links whose filename matches a persisted session deliverable. */
function resolveDeliverableLinks(markdown: string, sources: MessageSource[]): string {
  if (!markdown || !sources.length) return markdown
  const byName = new Map(
    sources
      .filter((source): source is MessageSource & { path: string } => !!source.path)
      .map(source => [fileNameFromPath(source.path).toLowerCase(), source.path]),
  )
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, label: string, rawTarget: string) => {
    const target = rawTarget.trim().replace(/^<|>$/g, '')
    if (/^(?:[a-z]+:|\/|~\/)/i.test(target)) return whole
    const resolved = byName.get(fileNameFromPath(target).toLowerCase())
    if (!resolved) return whole
    return `[${label}](${/\s/.test(resolved) ? `<${resolved}>` : resolved})`
  })
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
  const expandedLines: string[] = []
  let fence: { character: string; length: number } | null = null

  for (const originalLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = originalLine.match(/^\s{0,3}(`{3,}|~{3,})/)
    const markerText = marker?.[1]
    if (fence) {
      expandedLines.push(originalLine)
      if (markerText && markerText[0] === fence.character && markerText.length >= fence.length) fence = null
      continue
    }
    if (markerText) {
      fence = { character: markerText[0], length: markerText.length }
      expandedLines.push(originalLine)
      continue
    }

    let line = originalLine.replace(/^(\s{0,3})(#{1,6})(?=[^\s#])/, '$1$2 ')
    // Streaming can flatten a complete table onto one line. Identify the
    // delimiter block itself: an empty header such as `| | |---|---|` does
    // not contain the usual double-pipe boundary before that block.
    const delimiterBlock = line.match(/\|(?:\s*:?-+:?\s*\|){2,}/)
    if (delimiterBlock?.index !== undefined) {
      let before = line.slice(0, delimiterBlock.index).trimEnd()
      const after = line.slice(delimiterBlock.index + delimiterBlock[0].length).trimStart()
      // Bob occasionally emits `| | |---|---|`: the empty two-column header
      // has lost its final closing pipe while being streamed.
      if (/^\s*\|\s*\|\s*$/.test(before)) before = '| | |'
      line = [before, delimiterBlock[0], after].filter(Boolean).join('\n')
      line = line.replace(/\|\s*\|(?=\s*[^\s|\-])/g, '|\n|')
    }
    expandedLines.push(...line.split('\n'))
  }

  const lines = expandedLines
  const tableCells = (line: string): string[] | null => {
    const trimmed = line.trim()
    if (!trimmed.includes('|')) return null
    let body = trimmed
    if (body.startsWith('|')) body = body.slice(1)
    if (body.endsWith('|')) body = body.slice(0, -1)

    const cells: string[] = []
    let cell = ''
    let inlineCodeTicks = 0
    for (let cursor = 0; cursor < body.length; cursor += 1) {
      const character = body[cursor]
      if (character === '\\' && cursor + 1 < body.length) {
        cell += character + body[cursor + 1]
        cursor += 1
        continue
      }
      if (character === '`') {
        let count = 1
        while (body[cursor + count] === '`') count += 1
        if (inlineCodeTicks === 0) inlineCodeTicks = count
        else if (inlineCodeTicks === count) inlineCodeTicks = 0
        cell += '`'.repeat(count)
        cursor += count - 1
        continue
      }
      if (character === '|' && inlineCodeTicks === 0) {
        cells.push(cell.trim())
        cell = ''
      } else {
        cell += character
      }
    }
    cells.push(cell.trim())
    return cells
  }

  for (let index = 1; index < lines.length; index += 1) {
    const delimiters = tableCells(lines[index])
    if (!delimiters || delimiters.length < 2 || !delimiters.every(cell => /^:?-+:?$/.test(cell))) continue
    if (/^\s*\|\s*\|\s*$/.test(lines[index - 1])) {
      lines[index - 1] = '| | |'
    }
    for (let cellIndex = 0; cellIndex < delimiters.length; cellIndex += 1) {
      const delimiter = delimiters[cellIndex]
      delimiters[cellIndex] = `${delimiter.startsWith(':') ? ':' : ''}---${delimiter.endsWith(':') ? ':' : ''}`
    }

    // A flattened block can leave prose/the heading directly before the first
    // header pipe. Move that prefix back to its own line.
    const firstPipe = lines[index - 1].indexOf('|')
    if (lines[index].trimStart().startsWith('|') && firstPipe > 0 && lines[index - 1].slice(0, firstPipe).trim()) {
      const prefix = lines[index - 1].slice(0, firstPipe).trimEnd()
      const header = lines[index - 1].slice(firstPipe)
      lines.splice(index - 1, 1, prefix, header)
      index += 1
    }

    const headerCells = tableCells(lines[index - 1])
    if (!headerCells || headerCells.length < 2) continue

    // Some streamed responses omit the last separator cell even though the
    // header and data rows contain it, for example a 3-column action table
    // emitted as `|---|---|`. GFM rejects the whole table in that case.
    if (headerCells.length > delimiters.length) {
      while (delimiters.length < headerCells.length) delimiters.push('---')
      lines[index] = `| ${delimiters.join(' | ')} |`
      lines[index - 1] = `| ${headerCells.join(' | ')} |`
      continue
    }
    if (headerCells.length === delimiters.length) {
      lines[index - 1] = `| ${headerCells.join(' | ')} |`
      lines[index] = `| ${delimiters.join(' | ')} |`
      continue
    }

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
    lines[index] = `| ${delimiters.join(' | ')} |`
  }

  return lines.join('\n')
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
  fileChanges?: FileChange[]
  /** Explicit Bob Shell actions associated with this assistant turn. */
  activities?: BobActivityEvent[]
  /** Local display scope used while a new conversation has no persisted id yet. */
  conversationId?: string
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
  deliverablePaths?: string[]
  fileChanges?: FileChange[]
  workspacePath?: string
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
  receivedAt?: string
}

function activitiesFromToolsUsed(toolsUsed: ToolUse[] | undefined): BobActivityEvent[] {
  return (toolsUsed ?? []).flatMap(tool => {
    const eventType = tool.eventType
    if (!eventType) {
      // Keep compatibility with any older, conventional ToolUse entries.
      if (!tool.name) return []
      return [{
        sessionId: '',
        conversationId: '',
        eventType: 'tool_finished',
        title: tool.name,
        content: tool.output,
        toolName: tool.name,
        payload: tool.input ?? {},
        receivedAt: tool.timestamp,
      }]
    }
    return [{
      sessionId: '',
      conversationId: '',
      eventType,
      title: tool.title,
      content: tool.content,
      toolName: tool.toolName,
      payload: tool.payload ?? {},
      receivedAt: tool.createdAt ?? tool.timestamp,
    }]
  })
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function mightNeedCodeGraph(message: string): boolean {
  const normalized = message.toLocaleLowerCase()
  return [
    'codegraph', 'code graph', 'graphe de code', 'semantic search', 'recherche sémantique',
    'callers', 'callees', 'appelants', 'appelé par', 'qui appelle', 'impact analysis',
    "analyse d'impact", 'analyse d’impact', 'find usages', 'trouver les usages',
    'dépendances du code', 'dependances du code', 'architecture du code', 'architecture de la base',
  ].some(needle => normalized.includes(needle))
}

/** Normalize Bob Shell 1/2 follow-up payloads into one native chat card. */
export function interactionFromActivity(event: BobActivityEvent): ConversationInteraction | null {
  if (event.eventType !== 'user_input_required') return null
  const envelope = recordValue(event.payload)
  const parameters = recordValue(envelope?.parameters)
    ?? recordValue(envelope?.input)
    ?? recordValue(envelope?.payload)
    ?? envelope
  const firstQuestion = Array.isArray(parameters?.questions)
    ? recordValue(parameters.questions[0])
    : parameters
  const question = String(firstQuestion?.question ?? firstQuestion?.prompt ?? firstQuestion?.message ?? '').trim()
  const rawOptions = Array.isArray(firstQuestion?.options)
    ? firstQuestion.options
    : Array.isArray(firstQuestion?.choices)
      ? firstQuestion.choices
      : Array.isArray(firstQuestion?.follow_up)
        ? firstQuestion.follow_up
        : []
  const choices = rawOptions.map((raw, index): ConversationChoice | null => {
    if (typeof raw === 'string') {
      return { id: `choice-${index}`, label: raw, value: raw }
    }
    const option = recordValue(raw)
    if (!option) return null
    const label = String(option.label ?? option.title ?? option.value ?? '').trim()
    if (!label) return null
    return {
      id: String(option.id ?? `choice-${index}`),
      label,
      description: typeof option.description === 'string' ? option.description : undefined,
      value: String(option.value ?? option.prompt ?? label),
    }
  }).filter((choice): choice is ConversationChoice => choice !== null)
  if (!question || choices.length === 0) return null
  return {
    id: String(envelope?.id ?? `${event.sessionId}-${Date.now()}`),
    kind: 'question',
    title: String(firstQuestion?.header ?? event.title ?? 'Bob a besoin de votre choix'),
    question,
    detail: typeof firstQuestion?.description === 'string' ? firstQuestion.description : undefined,
    choices,
  }
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
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editingTitleRef = useRef(false)
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
  const [optimisticUserTurns, setOptimisticUserTurns] = useState<Msg[]>([])
  const [loadingHistory, setLoadingHistory] = useState(!!id)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [bobMode, setBobMode] = useState('agent')
  const [interaction, setInteraction] = useState<ConversationInteraction | null>(null)
  const [interactionBusy, setInteractionBusy] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const autoScrollEnabledRef = useRef(true)
  const unlistenRef = useRef<UnlistenFn[]>([])
  const runningRef = useRef(false)
  const queueRef = useRef<QueuedPrompt[]>([])
  const activeSessionRef = useRef<{ conversationId: string; sessionId: string | null } | null>(null)
  const completedSessionsRef = useRef(new Set<string>())
  const pendingInteractionPromptRef = useRef<QueuedPrompt | null>(null)
  const activitiesRef = useRef<BobActivityEvent[]>([])

  const displayConversationScope = id ?? convId ?? '__new_conversation__'
  const visibleOptimisticTurns = useMemo(() => optimisticUserTurns.filter(message =>
    message.conversationId === displayConversationScope
    || (!id && message.conversationId === '__new_conversation__')
  ), [displayConversationScope, id, optimisticUserTurns])
  const visibleMsgs = useMemo(
    () => mergeVisibleMessages(msgs, visibleOptimisticTurns),
    [msgs, visibleOptimisticTurns],
  )

  useEffect(() => {
    setInteraction(null)
    setInteractionBusy(false)
    pendingInteractionPromptRef.current = null
  }, [displayConversationScope])

  // send_message acknowledges the request before the conversation history is
  // necessarily readable. Keep the local turn until an independently loaded,
  // persisted copy is present; otherwise a route/task hydration can expose an
  // empty history for a frame (or for the whole run) and hide the user's text.
  useEffect(() => {
    if (!msgs.some(message => message.role === 'user' && message.persisted)) return
    setOptimisticUserTurns(current => current.filter(optimistic => !msgs.some(message => {
      if (message.role !== 'user' || !message.persisted) return false
      if (message.id === optimistic.id) return true
      if (message.content !== optimistic.content) return false
      const messageTime = Date.parse(message.ts)
      const optimisticTime = Date.parse(optimistic.ts)
      return Number.isFinite(messageTime)
        && Number.isFinite(optimisticTime)
        && Math.abs(messageTime - optimisticTime) < 2_000
    })))
  }, [msgs])

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
  }, [visibleMsgs, thinkingText, isRunning])

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
    let disposed = false
    if (!id) {
      setConvId(null)
      setConvTitle('Nouvelle conversation')
      setEditingTitle(false)
      editingTitleRef.current = false
      setConversationPinned(false)
      activitiesRef.current = []
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
    setEditingTitle(false)
    editingTitleRef.current = false
    // Activity is live, conversation-scoped state. Never let the previous
    // conversation's tools or sub-agents flash while this history is loading.
    if (!ownsInFlightPromptAtNavigation) {
      activitiesRef.current = []
      setActivities([])
    }
    useAppStore.getState().markConversationRead(id)
    setConversationPinned(false)
    setLoadingHistory(true)
    setLoadError(null)

    // Conversation + messages are the route's core payload. Tasks and artifact
    // registration are auxiliary: a transient failure there must not make the
    // selected conversation disappear during startup.
    Promise.all([getConversation(id), getMessages(id)])
      .then(async ([conv, messages]) => {
        if (disposed) return
        if (!conv) throw new Error('Conversation introuvable.')
        if (conv) {
          setConvTitle(conv.title)
          setConversationPinned(conv.pinned)
          setBobMode(conv.bobMode ?? 'agent')
        }
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
            fileChanges: m.fileChanges,
            activities: activitiesFromToolsUsed(m.toolsUsed),
          }))
          const optimistic = ownsInFlightPrompt
            ? prev.filter(p => p.state !== 'done' && !loaded.some(l => l.content === p.content))
            : []
          return [...loaded, ...optimistic]
        })

        setLoadingHistory(false)
        void registerMessageArtifacts(messages, id)

        const allTasks = await getTasks().catch(() => [])
        if (disposed) return
        const activeTask = latestActiveTaskForConversation(allTasks, id)
        // A newly-created conversation can finish this load before send_message
        // has created its task. Do not let that short window cancel the local run.
        if (!(ownsInFlightPrompt && !activeTask)) {
          applyActiveTaskForConversation(
            id,
            allTasks,
            { runningRef, activeSessionRef },
            { setTaskId, setTaskDetail, setIsRunning, setSessionId },
          )
        }
      })
      .catch(error => {
        if (!disposed) setLoadError(error)
      })
      .finally(() => { if (!disposed) setLoadingHistory(false) })
    return () => { disposed = true }
  }, [id])

  useEffect(() => {
    if (!convId) return
    let disposed = false
    let unlisten: (() => void) | null = null
    listen<string>('conversation-updated', event => {
      if (event.payload !== convId) return
      getConversation(convId).then(conversation => {
        if (!disposed && conversation && !editingTitleRef.current) {
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
          fileChanges: m.fileChanges,
          activities: activitiesFromToolsUsed(m.toolsUsed),
        })))
        activitiesRef.current = []
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
      const requestedInteraction = interactionFromActivity(event.payload)
      if (requestedInteraction) setInteraction(requestedInteraction)
      setActivities(current => {
        const next = [...current, {
          ...event.payload,
          receivedAt: new Date().toISOString(),
        }]
        activitiesRef.current = next
        return next
      })
      const { eventType, content, title, toolName } = event.payload
      if (eventType === 'analysis' && content) {
        if (!taggedSubagentReasoningId(event.payload.payload)) {
          setThinkingText(current => appendThinkingText(current, content))
        }
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
      const completedActivities = activitiesRef.current.filter(activity => (
        activity.conversationId === event.payload.conversationId
        && (!activity.sessionId || activity.sessionId === event.payload.sessionId)
      ))
      completedSessionsRef.current.add(event.payload.sessionId)
      activeSessionRef.current = null

      const localSources = mergeMessageSources(
        sourcesFromLocalPaths(fullOutput || ''),
        sourcesFromDeliverablePaths(event.payload.deliverablePaths),
      )
      await Promise.allSettled(localSources
        .map(source => source.path)
        .filter((path): path is string => !!path)
        .map(path => registerExternalArtifact(path, event.payload.conversationId)))

      // Finalize the streaming message or create it if it didn't exist (fast execution)
      setConversationStoreMsgs(conversationId, prev => {
        const finalizeAssistant = (contentRaw: string, priorError?: string, priorSources?: MessageSource[]): Pick<Msg, 'content' | 'error' | 'state' | 'sources'> => {
          const content = resolveDeliverableLinks(contentRaw.trim(), localSources)
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
              fileChanges: event.payload.fileChanges ?? m.fileChanges,
              activities: completedActivities,
            }
          })
        }
        return [...prev, {
          id: `done-${Date.now()}`,
          role: 'assistant',
          ...finalizeAssistant(fullOutput, undefined, undefined),
          ts: new Date().toISOString(),
          fileChanges: event.payload.fileChanges,
          activities: completedActivities,
        }]
      })

      setIsRunning(false)
      runningRef.current = false
      setSessionId(null)
      setThinkingText('')
      activitiesRef.current = []
      setActivities([])

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
    listen<string>('task-updated', event => {
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
          // During send_message startup, task-updated can beat the command
          // result (and a concurrent getTasks snapshot can still be stale).
          // Absence is not a terminal state: only the known task, observed in
          // a terminal state, may tear down the optimistic conversation UI.
          if (!taskId || event.payload !== taskId) return
          const updatedTask = allTasks.find(task => task.id === taskId)
          if (!updatedTask || isActiveTaskState(updatedTask.state)) return
          runningRef.current = false
          setIsRunning(false)
          setSessionId(null)
          activeSessionRef.current = null
          setThinkingText('')
          activitiesRef.current = []
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
              fileChanges: message.fileChanges,
              activities: activitiesFromToolsUsed(message.toolsUsed),
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
  }, [convId, taskId])

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
      id: `user-${prompt.id}`,
      role: 'user',
      content: text,
      ts: new Date().toISOString(),
      state: 'sent',
      persisted: false,
      conversationId: convId ?? id ?? '__new_conversation__',
      attachments: attachmentPaths.map((path, index) => ({ id: `attachment-${index}`, name: path.split('/').pop() || path, size: 0, type: 'file', path })),
    }
    setOptimisticUserTurns(current => mergeVisibleMessages(current, [userMsg]))
    activitiesRef.current = []
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
          title: isPlaceholderConversationTitle(convTitle)
            ? (conversationTitleForMode(builderMode ?? mode) || convTitle)
            : convTitle,
          conversationType: mode === 'agent' || mode === 'plan' ? 'work' : 'chat',
          businessMode: mode,
          bobMode: mode,
          projectId,
        })
        cid = conv.id
        userMsg.conversationId = cid
        setOptimisticUserTurns(current => current.map(message => message.id === userMsg.id ? { ...message, conversationId: cid! } : message))
        setConvId(cid)
        setConvTitle(conv.title)
        setConversationPinned(conv.pinned)
      } catch {
        // fallback: use ephemeral ID
        cid = `ephemeral-${Date.now()}`
        userMsg.conversationId = cid
        setOptimisticUserTurns(current => current.map(message => message.id === userMsg.id ? { ...message, conversationId: cid! } : message))
        setConvId(cid)
      }
    }

    // Claim the new route before its asynchronous history request resolves.
    // Otherwise that initial empty result can arrive after the optimistic first
    // prompt and erase it from the view while the backend is starting the task.
    activeSessionRef.current = { conversationId: cid, sessionId: null }
    setConversationStoreMsgs(cid, prev => mergeVisibleMessages(prev, [userMsg]))

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
            setOptimisticUserTurns(current => current.filter(message => message.id !== userMsg.id))
            activeSessionRef.current = null
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
        // The returned id confirms acceptance, not that a concurrent history
        // read can already observe the row. The history loader marks the
        // authoritative copy as persisted and then retires the local outbox.
        m.id === userMsg.id ? { ...m, id: result.userMessageId || m.id } : m
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
      setOptimisticUserTurns(current => current.filter(message => message.id !== userMsg.id))
      runningRef.current = false
      setIsRunning(false)
    }
  }, [builderMode, convId, id, navigate, replaceQueue, setConversationStoreMsgs, subscribeToSession, t])

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
    const suggestionDisabled = projectId
      ? window.localStorage.getItem(`bobwork.codegraph.dismissed.${projectId}`) === '1'
      : false
    if (projectId && mightNeedCodeGraph(prompt.text) && !suggestionDisabled) {
      void getCodeGraphSuggestion(prompt.text, projectId)
        .then(suggestion => {
          if (!suggestion) {
            void executePrompt(prompt)
            return
          }
          const pendingUserMessage: Msg = {
            id: `user-${prompt.id}`,
            role: 'user',
            content: prompt.text,
            ts: new Date().toISOString(),
            state: 'sent',
            persisted: false,
            conversationId: convId ?? id ?? '__new_conversation__',
            attachments: prompt.attachmentPaths.map((path, index) => ({
              id: `attachment-${index}`,
              name: path.split('/').pop() || path,
              size: 0,
              type: 'file',
              path,
            })),
          }
          setOptimisticUserTurns(current => mergeVisibleMessages(current, [pendingUserMessage]))
          pendingInteractionPromptRef.current = prompt
          setInteraction(suggestion)
        })
        .catch(() => { void executePrompt(prompt) })
      return
    }
    void executePrompt(prompt)
  }, [convId, executePrompt, id, replaceQueue])

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
    activitiesRef.current = []
    setActivities([])
    if (currentTaskId) setTaskId(null)
    unlistenRef.current.forEach(fn => fn())
    unlistenRef.current = []
    setMsgs(prev =>
      prev.map(m => m.state === 'streaming' ? { ...m, state: 'done' } : m)
    )
  }, [sessionId, taskId])

  const handleInteractionChoice = useCallback(async (choice: ConversationChoice) => {
    if (!interaction || interactionBusy) return
    setInteractionBusy(true)
    try {
      const pending = pendingInteractionPromptRef.current
      if (interaction.kind === 'runtime_suggestion' && pending) {
        let promptToExecute = pending
        if (choice.action === 'install_runtime') {
          if (!interaction.runtimeId) throw new Error('Runtime manquant dans la suggestion.')
          await installExternalRuntime(interaction.runtimeId, true)
        } else if (choice.action === 'dismiss_project' && interaction.projectId) {
          window.localStorage.setItem(`bobwork.codegraph.dismissed.${interaction.projectId}`, '1')
          promptToExecute = { ...pending, text: `${pending.text}\n\n${choice.value}` }
        } else {
          // The preflight card is local UI state. Carry the explicit choice in
          // the request so Bob does not immediately propose CodeGraph again.
          promptToExecute = { ...pending, text: `${pending.text}\n\n${choice.value}` }
        }
        pendingInteractionPromptRef.current = null
        setInteraction(null)
        await executePrompt(promptToExecute)
        return
      }

      const resumeTaskId = taskId ?? undefined
      if (runningRef.current) await handleStop()
      setInteraction(null)
      await executePrompt({
        id: `interaction-${Date.now()}`,
        text: choice.value,
        mode: bobMode,
        attachmentPaths: [],
        resumeTaskId,
        queuedAt: new Date().toISOString(),
      })
    } catch (error) {
      setLoadError(error)
    } finally {
      setInteractionBusy(false)
    }
  }, [bobMode, executePrompt, handleStop, interaction, interactionBusy, taskId])

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
      activitiesRef.current = []
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

  const startTitleEdit = () => {
    setTitleDraft(convTitle)
    editingTitleRef.current = true
    setEditingTitle(true)
  }

  const cancelTitleEdit = () => {
    editingTitleRef.current = false
    setEditingTitle(false)
  }

  const submitTitleEdit = async () => {
    if (!editingTitleRef.current) return
    const next = titleDraft.trim()
    editingTitleRef.current = false
    setEditingTitle(false)
    if (!next || next === convTitle) return
    const previous = convTitle
    setConvTitle(next)
    if (!convId || convId.startsWith('ephemeral-')) return
    try {
      await updateConversation(convId, { title: next })
    } catch {
      setConvTitle(previous)
    }
  }

  useEffect(() => {
    if (!editingTitle) return
    const input = titleInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editingTitle])

  const displayedConversationId = id ?? convId
  const visibleActivities = displayedConversationId
    ? activities.filter(event => event.conversationId === displayedConversationId)
    : []
  const showSubagentStatus = isRunning
    && !!displayedConversationId
    && activeSessionRef.current?.conversationId === displayedConversationId
  const liveExecutionPlan = executionPlanFromActivities(visibleActivities)
  const persistedExecutionPlan = (() => {
    for (let index = visibleMsgs.length - 1; index >= 0; index -= 1) {
      const message = visibleMsgs[index]
      if (message.role !== 'assistant') continue
      const plan = executionPlanFromActivities(message.activities)
      if (plan) return plan
    }
    return null
  })()
  // Never show an older completed plan while a new run is still waiting to
  // publish its own plan snapshot.
  const displayedExecutionPlan = isRunning ? liveExecutionPlan : persistedExecutionPlan

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>

      {/* Topbar */}
      <div className="topbar titlebar-drag" data-tauri-drag-region>
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="conversation-title-input titlebar-no-drag"
            value={titleDraft}
            onChange={event => setTitleDraft(event.target.value)}
            onBlur={() => { void submitTitleEdit() }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitTitleEdit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelTitleEdit()
              }
            }}
            aria-label={t('chat.editTitle')}
          />
        ) : (
          <button
            type="button"
            className="conversation-title titlebar-no-drag"
            title={t('nav.renameChat')}
            aria-label={t('chat.editTitle')}
            onClick={startTitleEdit}
          >
            {convTitle}
          </button>
        )}
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
                  : 'Décrivez l’idée ici. Collez une URL de base si besoin — Bob Work crée la connexion et la lie au plugin.')
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
        style={{ flex: 1, overflowY: 'auto', padding: '8px 0', display: visibleMsgs.length === 0 && !loadError && !loadingHistory ? 'none' : 'block' }}
      >
        {displayedExecutionPlan ? (
          <div className="execution-plan-sticky">
            <ExecutionPlanCard plan={displayedExecutionPlan} live={isRunning} />
          </div>
        ) : null}
        {loadError ? (
          <LoadErrorBanner
            error={loadError}
            onRetry={() => {
              if (!id) return
              setLoadingHistory(true)
              setLoadError(null)
              Promise.all([getConversation(id), getMessages(id)])
                .then(async ([conv, messages]) => {
                  if (!conv) throw new Error('Conversation introuvable.')
                  if (conv) {
                    setConvTitle(conv.title)
                    setConversationPinned(conv.pinned)
                    setBobMode(conv.bobMode ?? 'agent')
                  }
                  setConversationStoreMsgs(id, messages.map(m => ({
                    id: m.id,
                    role: (m.author === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                    content: m.content,
                    ts: m.createdAt,
                    state: 'done' as const,
                    persisted: true,
                    attachments: m.attachments,
                    sources: mergeMessageSources(m.sources, sourcesFromLocalPaths(m.content)),
                    fileChanges: m.fileChanges,
                    activities: activitiesFromToolsUsed(m.toolsUsed),
                  })))
                  void registerMessageArtifacts(messages, id)
                  const allTasks = await getTasks().catch(() => [])
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
        {loadingHistory && visibleMsgs.length === 0 ? (
          <LoadingMessages />
        ) : (
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {visibleMsgs.map(msg => (
              <div key={msg.id}>
                {isRunning && msg.state === 'streaming' && thinkingText && (
                  <WorkingIndicator
                    thinking={thinkingText}
                    loading={false}
                    activities={visibleActivities}
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
            {isRunning && !visibleMsgs.some(message => message.state === 'streaming') && (
              <WorkingIndicator
                thinking={thinkingText}
                loading
                activities={visibleActivities}
                snapshots={visibleActivities.reduce<ChromeSnapshot[]>((list, event) => {
                  const snapshot = extractChromeSnapshot(event)
                  return snapshot ? upsertChromeSnapshot(list, snapshot) : list
                }, [])}
                onOpenSnapshot={openPreview}
              />
            )}
            {interaction && (
              <ConversationInteractionCard
                interaction={interaction}
                busy={interactionBusy}
                onChoose={handleInteractionChoice}
              />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="composer-wrap" style={{ 
        maxWidth: 720, margin: '0 auto', width: '100%', 
        ...(visibleMsgs.length === 0 && !loadingHistory && !loadError ? { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' } : {})
      }}>
        {visibleMsgs.length === 0 && !loadingHistory && !loadError && <EmptyState builderMode={builderMode} />}
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
  const { t, locale } = useI18n()
  const timestamp = formatMessageTimestamp(msg.ts, localeToBcp47(locale))
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
          {!isEditing && timestamp && <time className="message-timestamp" dateTime={msg.ts}>{timestamp}</time>}
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
        {msg.state !== 'streaming' && msg.activities?.length ? (
          <ActivityDisclosure events={msg.activities} live={false} />
        ) : null}
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
            }}>{normalizeAssistantMarkdown(linkifyLocalFilePaths(resolveDeliverableLinks(msg.content, msg.sources ?? [])))}</ReactMarkdown>
          </div>
        )}
        {mapSpecsFromActivities(msg.activities).map((spec, index) => (
          <ConversationMapCard key={`${spec.title}-${index}`} spec={spec} />
        ))}
        {msg.error && (
          <p style={{ color: 'var(--danger)', marginTop: msg.content ? 10 : 0, fontSize: 13, lineHeight: 1.45 }}>
            {msg.error}
          </p>
        )}
        <MessageResources msg={msg} onOpen={onOpenResource} />
        <FileChanges changes={msg.fileChanges} onOpen={onOpenResource} />
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
        {timestamp && <time className="message-timestamp" dateTime={msg.ts}>{timestamp}</time>}
      </div>
      <button onClick={handleCopy} className="msg-action-btn msg-action-btn--assistant" title={t('chat.copy')} type="button">
         {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

function FileChanges({ changes, onOpen }: { changes?: FileChange[]; onOpen: (target: string, title?: string, kind?: 'file' | 'web') => void }) {
  const t = useT()
  if (!changes?.length) return null
  const presentation = {
    created: { label: t('chat.fileCreated'), Icon: FilePlus2, color: '#22c55e' },
    modified: { label: t('chat.fileModified'), Icon: FilePenLine, color: '#f59e0b' },
    deleted: { label: t('chat.fileDeleted'), Icon: FileX2, color: '#ef4444' },
  } as const
  return (
    <section className="message-file-changes" aria-label={t('chat.fileChanges')}>
      <div className="message-file-changes__title">{t('chat.fileChanges')}</div>
      {changes.map(change => {
        const item = presentation[change.changeType]
        const name = fileNameFromPath(change.path)
        return (
          <button
            key={`${change.changeType}:${change.path}`}
            type="button"
            className="message-file-change"
            disabled={change.changeType === 'deleted'}
            onClick={() => change.changeType !== 'deleted' && onOpen(change.path, name, 'file')}
            title={change.path}
          >
            <item.Icon size={16} style={{ color: item.color, flexShrink: 0 }} />
            <span className="message-file-change__path">{name}</span>
            <span className="message-file-change__status" style={{ color: item.color }}>{item.label}</span>
          </button>
        )
      })}
    </section>
  )
}

export function ConversationInteractionCard({
  interaction,
  busy,
  onChoose,
}: {
  interaction: ConversationInteraction
  busy: boolean
  onChoose: (choice: ConversationChoice) => void
}) {
  const t = useT()
  return (
    <section
      className="conversation-interaction"
      aria-labelledby={`interaction-title-${interaction.id}`}
      data-testid="conversation-interaction"
    >
      <div className="conversation-interaction__eyebrow">{interaction.title}</div>
      <h3 id={`interaction-title-${interaction.id}`}>{interaction.question}</h3>
      {interaction.detail && <p>{interaction.detail}</p>}
      <div className="conversation-interaction__choices">
        {interaction.choices.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            className={index === 0 ? 'conversation-interaction__choice conversation-interaction__choice--primary' : 'conversation-interaction__choice'}
            disabled={busy}
            onClick={() => onChoose(choice)}
          >
            <strong>{choice.label}</strong>
            {choice.description && <span>{choice.description}</span>}
          </button>
        ))}
      </div>
      {busy && <div className="conversation-interaction__busy" role="status"><span className="task-spinner" aria-hidden="true" />{t('chat.interactionInstalling')}</div>}
    </section>
  )
}

function InlineVisualizationPreview({ src, label, onOpen }: { src: string; label: string; onOpen: () => void }) {
  const t = useT()

  return (
    <section className="message-visualization-preview">
      <div className="message-visualization-preview__bar">
        <span>{t('chat.interactiveVisualization')}</span>
        <button type="button" onClick={onOpen}>{t('chat.openPreview')}</button>
      </div>
      <FittedHtmlFrame src={src} title={label} mode="inline" />
    </section>
  )
}

function MessageResources({ msg, onOpen }: { msg: Msg; onOpen: (target: string, title?: string, kind?: 'file' | 'web') => void }) {
  const t = useT()
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
  const visualizationResources = msg.role === 'assistant'
    ? resources.filter(item => item.kind === 'file' && item.target && INLINE_VISUALIZATION_EXT.test(item.target))
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
      {visualizationResources.length > 0 && (
        <div className="message-visualization-previews" aria-label={t('chat.generatedVisualizations')}>
          {visualizationResources.map(item => {
            const label = item.name || fileNameFromPath(item.target || '')
            return (
              <InlineVisualizationPreview
                key={`visual-${normalizeLocalFilePathKey(item.target || item.id)}`}
                src={item.target || ''}
                label={label}
                onOpen={() => { if (item.target) onOpen(item.target, item.name, item.kind) }}
              />
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
  activities,
  snapshots,
  onOpenSnapshot,
}: {
  thinking: string
  loading: boolean
  activities?: BobActivityEvent[]
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
        {activities && activities.length > 0 ? (
          <ActivityDisclosure events={activities} live />
        ) : null}
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

function liveActivityLabel(type: string) {
  return ({
    analysis: 'Analyse',
    tool_started: 'Outil démarré',
    tool_finished: 'Outil terminé',
    tool_error: 'Erreur outil',
    usage: 'Consommation',
    source: 'Source',
    step: 'Étape',
    subagent_started: 'Sous-agent démarré',
    subagent_finished: 'Sous-agent terminé',
    graph_started: 'Orchestration démarrée',
    graph_finished: 'Orchestration terminée',
  } as Record<string, string>)[type] ?? type.replace(/_/g, ' ')
}

function liveActivityState(type: string) {
  if (type === 'error' || type.endsWith('_error')) return 'failed'
  if (type.endsWith('_finished')) return 'completed'
  return 'running'
}

function ActivityEventIcon({ event }: { event: BobActivityEvent }) {
  const identity = `${event.eventType} ${event.toolName ?? ''} ${event.title ?? ''}`.toLocaleLowerCase()
  let Icon = Wrench
  let kind = 'tool'

  if (/error|failed|échec|erreur/.test(identity)) {
    Icon = CircleAlert
    kind = 'error'
  } else if (/computer|click|scroll|mouse|cursor|type_text|accessibility|capture_screen/.test(identity)) {
    Icon = MousePointer2
    kind = 'computer'
  } else if (/web|browser|http|url|fetch|source/.test(identity)) {
    Icon = Globe2
    kind = 'web'
  } else if (/search|find|grep|query/.test(identity)) {
    Icon = Search
    kind = 'search'
  } else if (/write|edit|patch|create_file|save/.test(identity)) {
    Icon = FilePenLine
    kind = 'edit'
  } else if (/read|file|folder|directory|list_dir|glob/.test(identity)) {
    Icon = FileSearch
    kind = 'file'
  } else if (/terminal|shell|exec|command|ssh/.test(identity)) {
    Icon = Terminal
    kind = 'terminal'
  } else if (/database|sql|db_|query_db/.test(identity)) {
    Icon = Database
    kind = 'database'
  } else if (/subagent|agent|delegate|orchestration|graph_/.test(identity)) {
    Icon = Bot
    kind = 'agent'
  }

  return <Icon className="thinking-activity__icon" data-activity-icon={kind} size={14} strokeWidth={1.8} aria-hidden="true" />
}

function activityPayloadText(payload: unknown) {
  if (payload == null) return ''
  if (typeof payload === 'string') return payload
  if (typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload as object).length === 0) return ''
  try {
    const serialized = JSON.stringify(payload, null, 2)
    const maxLength = 12_000
    return serialized.length > maxLength
      ? `${serialized.slice(0, maxLength)}\n…`
      : serialized
  } catch {
    return String(payload)
  }
}

function activityToolId(event: BobActivityEvent): string | undefined {
  const value = event.payload?.tool_id
  return typeof value === 'string' ? value : undefined
}

function isGenericFinishedTitle(title: string | undefined) {
  return !title || /^(?:Outil terminé|Tool finished|Herramienta finalizada)(?:\s*:.*)?$/i.test(title.trim())
}

/** Turn start/result protocol pairs into one user-facing, inspectable action. */
export function coalesceActivityEvents(events: BobActivityEvent[]): BobActivityEvent[] {
  const displayed: BobActivityEvent[] = []
  const pendingById = new Map<string, number>()

  for (const event of events) {
    if (['analysis', 'usage', 'task_started', 'run_finished'].includes(event.eventType)) continue
    const toolId = activityToolId(event)
    if (event.eventType === 'tool_started') {
      const index = displayed.push(event) - 1
      if (toolId) pendingById.set(toolId, index)
      continue
    }
    if ((event.eventType === 'tool_finished' || event.eventType === 'tool_error') && toolId && pendingById.has(toolId)) {
      const index = pendingById.get(toolId)!
      const started = displayed[index]
      const parameters = started.payload?.parameters ?? started.payload
      const result = event.payload?.output ?? event.payload?.error ?? event.content ?? event.payload
      displayed[index] = {
        ...started,
        ...event,
        title: isGenericFinishedTitle(event.title) ? started.title : event.title,
        content: event.content,
        payload: { parameters, result },
        receivedAt: event.receivedAt ?? started.receivedAt,
      }
      pendingById.delete(toolId)
      continue
    }
    displayed.push(event)
  }
  return displayed
}

function ActivityDisclosure({ events, live }: { events: BobActivityEvent[]; live: boolean }) {
  const t = useT()
  const actionEvents = coalesceActivityEvents(events)
  if (actionEvents.length === 0) return null
  const completedLabel = actionEvents.length === 1
    ? t('chat.activityCompleteOne')
    : t('chat.activityCompleteOther', { count: actionEvents.length })
  return (
    <div
      className={`thinking-activity${live ? ' is-live' : ''}`}
      role="region"
      aria-label={live ? t('chat.activityRunning') : completedLabel}
      aria-description={t('tasks.activityPrivacy')}
    >
      <div className="thinking-activity__list">
        {actionEvents.map((event, index) => {
          const payload = activityPayloadText(event.payload)
          const hasDetail = !!event.content || !!payload
          const title = event.title || event.toolName || liveActivityLabel(event.eventType)
          return (
            <details
              key={`${event.eventType}-${event.toolName ?? ''}-${index}`}
              className={`thinking-activity__item ${liveActivityState(event.eventType)}`}
            >
              <summary>
                <ActivityEventIcon event={event} />
                <span className="thinking-activity__summary">{title}</span>
                {event.receivedAt ? (
                  <time>{new Date(event.receivedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
                ) : null}
                {hasDetail ? <ChevronRight className="thinking-activity__chevron" size={14} aria-hidden="true" /> : null}
              </summary>
              {hasDetail ? (
                <div className="thinking-activity__detail">
                  {event.content ? <p>{event.content}</p> : null}
                  {payload ? <pre>{payload}</pre> : null}
                </div>
              ) : null}
            </details>
          )
        })}
      </div>
    </div>
  )
}

function EmptyState({ builderMode }: { builderMode?: 'plugin_builder' | 'skill_builder' | null }) {
  const t = useT()
  const hint = builderMode === 'plugin_builder'
    ? 'Décrivez le plugin. Vous pouvez coller une URL DB (postgres://, jdbc:db2://…). Bob Work créera la connexion et la liera au plugin. Pas de formulaire.'
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
