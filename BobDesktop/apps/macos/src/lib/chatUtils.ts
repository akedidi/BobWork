
import { MutableRefObject } from 'react';
import { getMessages, getTaskDetail, registerExternalArtifact } from './ipc';
import type { FileChange, MessageAttachment, MessageSource, TaskDetail } from '@bob-work/shared-types';
import type { ChromeSnapshot } from './chromeSnapshot';
import { AUTO_PREVIEW_EXT, INLINE_IMAGE_EXT } from "../constants/fileTypes"
import { extractLocalFilePaths, fileNameFromPath, normalizeLocalFilePathKey, preferAbsoluteLocalPath } from './localFilePaths';
import { isActiveTaskState, latestActiveTaskForConversation } from './activeTasks';


export function sourcesFromLocalPaths(content: string): MessageSource[] {
  return extractLocalFilePaths(content).map(path => ({
    id: path,
    title: fileNameFromPath(path),
    path,
  }))
}

export function mergeMessageSources(...groups: (MessageSource[] | undefined)[]): MessageSource[] {
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

export async function registerMessageArtifacts(
  messages: any[], // simplified type for now
  conversationId: string,
): Promise<void> {
  const registrations: Promise<unknown>[] = []
  for (const message of messages) {
    if (message.author === 'user') continue
    const paths = new Set([
      ...extractLocalFilePaths(message.content),
      ...(message.sources ?? []).map((source: any) => source.path).filter((path: any): path is string => !!path),
    ])
    for (const path of paths) {
      registrations.push(registerExternalArtifact(path, conversationId))
    }
  }
  await Promise.allSettled(registrations)
}

export function applyActiveTaskForConversation(
  conversationId: string,
  allTasks: any[],
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

export interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: string
  state: 'sent' | 'streaming' | 'done' | 'error'
  error?: string
  persisted?: boolean
  attachments?: MessageAttachment[]
  sources?: MessageSource[]
  snapshots?: ChromeSnapshot[]
  fileChanges?: FileChange[]
  activities?: BobActivityEvent[]
  conversationId?: string
}

export function isToday(date: Date, reference = new Date()) {
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate()
}

export function mergeVisibleMessages(messages: Msg[], optimisticUserTurns: Msg[]): Msg[] {
  const visible = [...messages]
  for (const optimistic of optimisticUserTurns) {
    const optimisticTime = Date.parse(optimistic.ts)
    const alreadyVisible = visible.some(message => {
      if (message.id === optimistic.id) return true
      if (message.role !== 'user' || message.content !== optimistic.content) return false
      const messageTime = Date.parse(message.ts)
      return Number.isFinite(messageTime)
        && Number.isFinite(optimisticTime)
        && Math.abs(messageTime - optimisticTime) < 2_000
    })
    if (!alreadyVisible) visible.push(optimistic)
  }
  return visible.sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts))
}

export interface BobTokenEvent {
  sessionId: string
  conversationId: string
  chunk: string
  isFinal: boolean
  eventType: 'text' | 'token' | 'tool_use' | 'step' | 'thought' | 'error'
  taskId?: string
}

export interface BobSessionDoneEvent {
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

export interface BobActivityEvent {
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

export interface QueuedPrompt {
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

export function normalizeAssistantMarkdown(markdown: string): string {
  let normalized = markdown.replace(/^(#{1,6})(?=[^\s#])/gm, '$1 ')
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
    const firstPipe = lines[index - 1].indexOf('|')
    if (firstPipe > 0 && lines[index - 1].slice(0, firstPipe).trim()) {
      const prefix = lines[index - 1].slice(0, firstPipe).trimEnd()
      const header = lines[index - 1].slice(firstPipe)
      lines.splice(index - 1, 1, prefix, header)
      index += 1
    }
    const headerCells = tableCells(lines[index - 1])
    if (!headerCells || headerCells.length >= delimiters.length) continue
    const lastHeader = headerCells[headerCells.length - 1] ?? ''
    const splitHeader = lastHeader.match(/^(Label)\s+(Couleur|Color)$/i)
    if (headerCells.length + 1 === delimiters.length && splitHeader) {
      headerCells.splice(-1, 1, splitHeader[1], splitHeader[2])
    }
    while (headerCells.length < delimiters.length) headerCells.push('')
    lines[index - 1] = `| ${headerCells.join(' | ')} |`
  }
  return lines.join('\n')
}
