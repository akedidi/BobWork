import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

export interface SubagentActivity {
  eventType: string
  title?: string | null
  content?: string | null
  toolName?: string | null
  payload?: Record<string, unknown>
}

type SubagentState = 'running' | 'completed' | 'failed' | 'cancelled'

interface SubagentStatus {
  id: string
  name: string
  state: SubagentState
  thinking: string
}

const nameKeys = ['agentName', 'agent_name', 'taskName', 'task_name', 'label', 'name']
const descriptionKeys = ['description', 'prompt', 'objective']
const idKeys = ['subagentId', 'subagent_id', 'agentId', 'agent_id', 'toolId', 'tool_id', 'toolUseId', 'tool_use_id', 'id']
const ownerKeys = ['subagentId', 'subagent_id', 'agentId', 'agent_id']
const genericNames = new Set(['explore', 'research', 'general', 'worker', 'subagent'])

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

function titleName(title?: string | null): string | undefined {
  const separator = title?.indexOf(':') ?? -1
  if (separator < 0 || !title) return undefined
  return title.slice(separator + 1).trim() || undefined
}

function descriptionName(description?: string): string | undefined {
  const line = description?.split('\n').map(value => value.trim()).find(Boolean)
  return line?.replace(/^tu es\s+/i, '').replace(/[.:;]+$/, '').trim() || undefined
}

function eventName(event: SubagentActivity): string | undefined {
  const fromPayload = findString(event.payload, nameKeys)
  const fromDescription = descriptionName(findString(event.payload, descriptionKeys))
  const raw = (fromPayload && !genericNames.has(fromPayload.toLowerCase()) ? fromPayload : undefined)
    ?? titleName(event.title)
    ?? fromDescription
    ?? fromPayload
  return raw ? (raw.length > 72 ? `${raw.slice(0, 69)}…` : raw) : undefined
}

function eventState(event: SubagentActivity): SubagentState {
  const type = event.eventType.toLowerCase()
  const status = findString(event.payload, ['status', 'state'])?.toLowerCase()
  if (type.includes('cancel') || status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (type.includes('error') || type.includes('fail') || status === 'error' || status === 'failed') return 'failed'
  const result = event.content?.includes('<task_result') || JSON.stringify(event.payload ?? {}).includes('<task_result')
  if (event.toolName?.toLowerCase() === 'spawn_subagent' && type === 'tool_finished' && !result) return 'running'
  if (type.includes('finish') || type.includes('complete') || ['ok', 'success', 'completed'].includes(status ?? '')) return 'completed'
  return 'running'
}

function isSubagentActivity(event: SubagentActivity): boolean {
  return event.eventType.toLowerCase().includes('subagent') || event.toolName?.toLowerCase() === 'spawn_subagent'
}

export function isSubagentRelatedActivity(event: SubagentActivity): boolean {
  return isSubagentActivity(event) || Boolean(findString(event.payload, ownerKeys))
}

function thinkingChunk(event: SubagentActivity): string | undefined {
  const type = event.eventType.toLowerCase()
  if (type === 'analysis' || type === 'step') return event.content?.trim() || undefined
  if (event.toolName?.toLowerCase() !== 'spawn_subagent' && !type.includes('subagent')) return undefined
  const result = event.content?.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/i)?.[1]?.trim()
  return result || (type.includes('finish') || type.includes('complete') ? event.content?.trim() : undefined)
}

export function deriveSubagentStatuses(events: SubagentActivity[], fallbackName = 'Sub-agent'): SubagentStatus[] {
  const statuses: SubagentStatus[] = []
  const byKey = new Map<string, number>()
  for (const event of events) {
    const ownerId = findString(event.payload, ownerKeys)
    if (!isSubagentActivity(event)) {
      if (!ownerId) continue
      const index = byKey.get(`id:${ownerId}`)
      if (index === undefined) continue
      const chunk = thinkingChunk(event)
      const current = statuses[index]
      if (chunk && current) statuses[index] = { ...current, thinking: chunk }
      continue
    }
    const discoveredName = eventName(event)
    const name = discoveredName ?? `${fallbackName} ${statuses.length + 1}`
    const explicitId = findString(event.payload, idKeys) ?? ownerId
    const key = explicitId ? `id:${explicitId}` : `name:${name.toLowerCase()}`
    let index = byKey.get(key)
    if (index === undefined && explicitId) index = statuses.findIndex(item => item.id === explicitId)
    if (index === undefined || index < 0) {
      index = statuses.length
      statuses.push({ id: explicitId ?? `subagent-${index + 1}`, name, state: eventState(event), thinking: '' })
    } else {
      const current = statuses[index]
      if (!current) continue
      statuses[index] = { ...current, name: discoveredName ?? current.name, state: eventState(event) }
    }
    byKey.set(key, index)
    if (explicitId) byKey.set(`id:${explicitId}`, index)
    const chunk = thinkingChunk(event)
    const current = statuses[index]
    if (chunk && current) statuses[index] = { ...current, thinking: chunk }
  }
  return statuses
}

type Translation = (key: 'subagentsRunning' | 'subagents' | 'subagentFallback' | 'subagentRunning' | 'subagentCompleted' | 'subagentFailed' | 'subagentCancelled', params?: Record<string, string | number>) => string

const stateIcon: Record<SubagentState, keyof typeof Ionicons.glyphMap> = {
  running: 'sync-outline', completed: 'checkmark-circle', failed: 'close-circle', cancelled: 'remove-circle',
}

export function SubagentStatusPanel({ events, t }: { events: SubagentActivity[]; t: Translation }) {
  const [collapsed, setCollapsed] = useState(false)
  const fallbackName = t('subagentFallback')
  const items = useMemo(() => deriveSubagentStatuses(events, fallbackName), [events, fallbackName])
  const running = items.filter(item => item.state === 'running').length
  if (!items.length) return null
  const label = (state: SubagentState) => t(state === 'running' ? 'subagentRunning' : state === 'completed' ? 'subagentCompleted' : state === 'failed' ? 'subagentFailed' : 'subagentCancelled')
  const title = running ? t('subagentsRunning', { count: running }) : t('subagents', { count: items.length })
  return <View style={styles.panel} accessibilityLabel={title}>
    <Pressable style={styles.header} onPress={() => setCollapsed(value => !value)} accessibilityRole="button" accessibilityState={{ expanded: !collapsed }}>
      {running ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="checkmark-circle" size={17} color={colors.success} />}
      <Text style={styles.title}>{title}</Text>
      <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={17} color={colors.textMuted} />
    </Pressable>
    {!collapsed && <View style={styles.list}>{items.map(item => <View key={item.id} style={styles.row}>
      <Ionicons name={stateIcon[item.state]} size={17} color={item.state === 'running' ? colors.accent : item.state === 'completed' ? colors.success : item.state === 'failed' ? colors.danger : colors.textMuted} />
      <View style={styles.text}><Text style={styles.name} numberOfLines={1}>{item.name}</Text>{item.thinking ? <Text style={styles.thinking} numberOfLines={1}>{item.thinking.split('\n').at(-1)}</Text> : null}</View>
      <Text style={styles.state}>{label(item.state)}</Text>
    </View>)}</View>}
  </View>
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 12, marginTop: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.surface },
  header: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11 },
  title: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '900' },
  list: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 4 },
  row: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11 },
  text: { flex: 1, minWidth: 0 }, name: { color: colors.text, fontSize: 11, fontWeight: '800' }, thinking: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  state: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
})
