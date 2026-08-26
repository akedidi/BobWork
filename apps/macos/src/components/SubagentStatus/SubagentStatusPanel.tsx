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

  for (const event of events) {
    if (!isSubagentActivity(event)) continue
    const discoveredName = eventName(event)
    const name = discoveredName || `Sous-agent ${statuses.length + 1}`
    const explicitId = findString(event.payload, ID_KEYS)
    const key = explicitId ? `id:${explicitId}` : `name:${name.toLocaleLowerCase()}`
    let index = byKey.get(key)

    // Some Bob Shell versions expose an id only on the end event. Reuse a
    // generated matching row in that case. Never merge two explicitly
    // identified agents merely because Bob gave both the same generic name
    // (for example three concurrent agents all named "explore").
    if (index === undefined) {
      const namedIndex = statuses.findIndex(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())
      if (!explicitId || (namedIndex >= 0 && statuses[namedIndex].id.startsWith('subagent-'))) {
        index = namedIndex
      }
    }

    const state = eventState(event)
    if (index === undefined || index < 0) {
      byKey.set(key, statuses.length)
      statuses.push({ id: explicitId || `subagent-${statuses.length + 1}`, name, state })
    } else {
      statuses[index] = { ...statuses[index], name: discoveredName || statuses[index].name, state }
      byKey.set(key, index)
    }
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
          {items.map(item => (
            <li key={item.id} className={`subagent-status-row ${item.state}`}>
              <span className="subagent-status-icon" aria-hidden="true" />
              <span className="subagent-status-name" title={item.name}>{item.name}</span>
              <small>{stateLabel(item.state)}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
