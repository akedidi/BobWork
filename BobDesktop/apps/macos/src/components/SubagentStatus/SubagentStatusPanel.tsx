import { useMemo, useState } from 'react'

export interface SubagentActivity {
  eventType: string
  title?: string
  content?: string
  toolName?: string
  payload?: Record<string, unknown>
}

export type SubagentState = 'running' | 'completed' | 'failed' | 'cancelled'

export interface SubagentStatus {
  id: string
  name: string
  state: SubagentState
  thinking: string
}

const NAME_KEYS = [
  'agentName', 'agent_name', 'taskName', 'task_name', 'label', 'name',
]
const DESCRIPTION_KEYS = ['description', 'prompt', 'objective']
const ID_KEYS = [
  'subagentId', 'subagent_id', 'agentId', 'agent_id', 'toolId', 'tool_id',
  'toolUseId', 'tool_use_id', 'id',
]
const GENERIC_AGENT_NAMES = new Set(['explore', 'research', 'general', 'worker', 'subagent'])
const REASONING_OWNER_KEYS = [
  'subagentId', 'subagent_id', 'agentId', 'agent_id',
]

function findString(value: unknown, keys: string[], depth = 0): string | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  for (const candidate of Object.values(record)) {
    if (candidate && typeof candidate === 'object') {
      const found = findString(candidate, keys, depth + 1)
      if (found) return found
    }
  }
  return undefined
}

function titleName(title?: string): string | undefined {
  if (!title) return undefined
  const separator = title.indexOf(':')
  if (separator < 0) return undefined
  const value = title.slice(separator + 1).trim()
  return value || undefined
}

function descriptionName(description?: string): string | undefined {
  if (!description) return undefined
  const emphasizedTarget = description.match(/\*\*([^*\n]{2,88})\*\*/)?.[1]?.trim()
  if (emphasizedTarget) return emphasizedTarget
  const firstLine = description
    .split('\n')
    .map(line => line.trim())
    .find(Boolean)
  if (!firstLine) return undefined
  return firstLine.replace(/^tu es\s+/i, '').replace(/[.:;]+$/, '').trim() || undefined
}

function eventState(event: SubagentActivity): SubagentState {
  const type = event.eventType.toLowerCase()
  const status = findString(event.payload, ['status', 'state'])?.toLowerCase()
  if (type.includes('cancel') || status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (type.includes('error') || type.includes('fail') || status === 'error' || status === 'failed') return 'failed'
  const isSpawnTool = event.toolName?.toLowerCase() === 'spawn_subagent'
  const containsTaskResult = event.content?.includes('<task_result')
    || JSON.stringify(event.payload ?? {}).includes('<task_result')

  // A successful spawn_subagent tool call only confirms that delegation was
  // accepted. The child can continue running long after that tool call ends.
  // Only an explicit lifecycle event (or a legacy task_result payload) proves
  // that the child itself has completed.
  if (isSpawnTool && type === 'tool_finished' && !containsTaskResult) return 'running'
  if (type.includes('finish') || type.includes('complete') || ['ok', 'success', 'completed'].includes(status ?? '')) return 'completed'
  return 'running'
}

function isSubagentActivity(event: SubagentActivity): boolean {
  return event.eventType.toLowerCase().includes('subagent')
    || event.toolName?.toLowerCase() === 'spawn_subagent'
}

export function taggedSubagentReasoningId(payload?: Record<string, unknown>): string | undefined {
  return findString(payload, REASONING_OWNER_KEYS)
}

function extractTaskResult(text?: string): string | undefined {
  if (!text?.trim()) return undefined
  const match = text.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/i)
  return match?.[1]?.trim() || undefined
}

function appendThinking(current: string, chunk?: string): string {
  const next = chunk?.trim()
  if (!next) return current
  if (!current) return next
  if (current === next || current.endsWith(next)) return current
  if (next.startsWith(current)) return next
  return `${current}\n${next}`
}

function latestThinkingLine(text: string): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

function eventThinkingChunk(event: SubagentActivity): string | undefined {
  const type = event.eventType.toLowerCase()
  if (type === 'analysis' || type === 'step') return event.content?.trim() || undefined
  if (event.toolName?.toLowerCase() === 'spawn_subagent') {
    return extractTaskResult(event.content)
  }
  if (type.includes('subagent') && (type.includes('finish') || type.includes('complete'))) {
    return extractTaskResult(event.content) || event.content?.trim() || undefined
  }
  return undefined
}

function eventName(event: SubagentActivity): string | undefined {
  const fromPayload = findString(event.payload, NAME_KEYS)
  const fromTitle = titleName(event.title)
  const fromDescription = descriptionName(findString(event.payload, DESCRIPTION_KEYS))
  const payloadNameIsGeneric = fromPayload
    ? GENERIC_AGENT_NAMES.has(fromPayload.toLocaleLowerCase())
    : false
  const raw = (!payloadNameIsGeneric ? fromPayload : undefined)
    || fromTitle
    || fromDescription
    || fromPayload
  if (!raw) return undefined
  return raw.length > 88 ? `${raw.slice(0, 85)}…` : raw
}

/** Reduces start/progress/end protocol events into one live row per sub-agent. */
export function deriveSubagentStatuses(events: SubagentActivity[]): SubagentStatus[] {
  const statuses: SubagentStatus[] = []
  const byKey = new Map<string, number>()

  const remember = (key: string, index: number) => {
    byKey.set(key, index)
  }

  const findIndex = (name: string, explicitId?: string) => {
    if (explicitId) {
      const byId = byKey.get(`id:${explicitId}`)
      if (byId !== undefined) return byId
    }
    const key = explicitId ? `id:${explicitId}` : `name:${name.toLocaleLowerCase()}`
    let index = byKey.get(key)
    if (index === undefined) {
      const namedIndex = statuses.findIndex(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())
      if (!explicitId || (namedIndex >= 0 && statuses[namedIndex].id.startsWith('subagent-'))) {
        index = namedIndex >= 0 ? namedIndex : undefined
      }
    }
    return index
  }

  const applyThinking = (index: number, event: SubagentActivity) => {
    const chunk = eventThinkingChunk(event)
    if (!chunk) return
    statuses[index] = {
      ...statuses[index],
      thinking: appendThinking(statuses[index].thinking, chunk),
    }
  }

  for (const event of events) {
    const reasoningOwner = taggedSubagentReasoningId(event.payload)
    if (!isSubagentActivity(event)) {
      if (!reasoningOwner) continue
      const index = byKey.get(`id:${reasoningOwner}`)
        ?? statuses.findIndex(item => item.id === reasoningOwner)
      if (index === undefined || index < 0) continue
      applyThinking(index, event)
      continue
    }

    const discoveredName = eventName(event)
    const name = discoveredName || `Sous-agent ${statuses.length + 1}`
    const explicitId = findString(event.payload, ID_KEYS) || reasoningOwner
    const key = explicitId ? `id:${explicitId}` : `name:${name.toLocaleLowerCase()}`
    let index = findIndex(name, explicitId)

    const state = eventState(event)
    if (index === undefined || index < 0) {
      index = statuses.length
      remember(key, index)
      statuses.push({
        id: explicitId || `subagent-${statuses.length + 1}`,
        name,
        state,
        thinking: '',
      })
    } else {
      statuses[index] = {
        ...statuses[index],
        name: discoveredName || statuses[index].name,
        state,
      }
      remember(key, index)
    }
    if (explicitId) remember(`id:${explicitId}`, index)
    applyThinking(index, event)
  }

  return statuses
}

function stateLabel(state: SubagentState): string {
  if (state === 'completed') return 'Terminé'
  if (state === 'failed') return 'Échec'
  if (state === 'cancelled') return 'Arrêté'
  return 'En cours'
}

export function SubagentStatusPanel({ events }: { events: SubagentActivity[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const items = useMemo(() => deriveSubagentStatuses(events), [events])
  const runningCount = items.filter(item => item.state === 'running').length

  if (!items.length) return null

  const title = runningCount > 0
    ? `${runningCount} sous-agent${runningCount > 1 ? 's' : ''} en cours`
    : `${items.length} sous-agent${items.length > 1 ? 's' : ''}`

  return (
    <section className="subagent-status-panel" aria-label="Sous-agents de la tâche principale">
      <button
        type="button"
        className="subagent-status-header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(value => !value)}
      >
        <span className={runningCount ? 'subagent-status-pulse' : 'subagent-status-pulse completed'} aria-hidden="true" />
        <strong>{title}</strong>
        <span className={`subagent-status-chevron ${collapsed ? 'collapsed' : ''}`} aria-hidden="true">⌄</span>
      </button>
      {!collapsed && (
        <ul className="subagent-status-list">
          {items.map(item => {
            const thinkingLine = latestThinkingLine(item.thinking)
            return (
              <li key={item.id} className={`subagent-status-row ${item.state}${thinkingLine ? ' has-thinking' : ''}`}>
                <span className="subagent-status-icon" aria-hidden="true" />
                <span className="subagent-status-name" title={item.name}>{item.name}</span>
                <small>{stateLabel(item.state)}</small>
                {thinkingLine ? (
                  <span className="subagent-status-thinking" title={item.thinking}>{thinkingLine}</span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
