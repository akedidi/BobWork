export type ChromeSnapshot = {
  id: string
  url: string
  title: string
  headings: string[]
  actions: string[]
  text: string
  pending: boolean
  failed: boolean
}

const CHROME_TOOLS = new Set([
  'browser_snapshot',
  'chrome_read_front_tab',
  'chrome_open_url',
  'chrome_navigate',
])

export function chromeToolShortName(name?: string | null): string {
  if (!name) return ''
  return name.split('__').pop() || name
}

export function isChromeSnapshotTool(name?: string | null): boolean {
  return CHROME_TOOLS.has(chromeToolShortName(name))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => asString(item)).filter(Boolean).slice(0, 12)
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

type CollectedChromeSnapshot = Pick<ChromeSnapshot, 'url' | 'title' | 'headings' | 'actions' | 'text'>

function collectFrom(source: Record<string, unknown> | null, depth = 0): CollectedChromeSnapshot {
  if (!source) {
    return { url: '', title: '', headings: [] as string[], actions: [] as string[], text: '' }
  }
  const tab = asRecord(source.tab)
  const outline = asRecord(source.outline)
  const nested = depth < 2
    ? asRecord(parseMaybeJson(source.output ?? source.result ?? source.content))
    : null
  const fromNested: CollectedChromeSnapshot = nested && nested !== source
    ? collectFrom(nested, depth + 1)
    : { url: '', title: '', headings: [] as string[], actions: [] as string[], text: '' }
  return {
    url: asString(source.url)
      || asString(source.requested_url)
      || asString(tab?.url)
      || asString(outline?.url)
      || fromNested.url,
    title: asString(source.title)
      || asString(tab?.title)
      || asString(outline?.title)
      || fromNested.title,
    headings: asStringList(source.headings).length
      ? asStringList(source.headings)
      : asStringList(outline?.headings).length
        ? asStringList(outline?.headings)
        : fromNested.headings,
    actions: asStringList(source.actions).length
      ? asStringList(source.actions)
      : asStringList(outline?.actions).length
        ? asStringList(outline?.actions)
        : fromNested.actions,
    text: asString(source.text) || asString(outline?.text) || fromNested.text,
  }
}

export function extractChromeSnapshot(event: {
  eventType?: string
  toolName?: string
  title?: string
  content?: string
  payload?: Record<string, unknown>
}): ChromeSnapshot | null {
  const payload = event.payload ?? {}
  const input = asRecord(payload.parameters) ?? asRecord(payload.input) ?? asRecord(payload.event)
  const toolName = event.toolName
    || asString(payload.tool_name)
    || asString(payload.toolName)
    || asString(input?.name)
  if (!isChromeSnapshotTool(toolName) && !/aperçu chrome/i.test(event.title || '')) return null

  const parsedContent = asRecord(parseMaybeJson(event.content))
  const fields = collectFrom({
    ...payload,
    ...input,
    ...(parsedContent ?? {}),
  })
  const url = fields.url
  if (!url && event.eventType !== 'tool_started') return null
  const pending = event.eventType === 'tool_started'
  const failed = event.eventType === 'tool_error' || event.eventType === 'error'
  const hostname = (() => {
    try { return url ? new URL(url).hostname : '' } catch { return '' }
  })()
  return {
    id: `${toolName || 'chrome'}:${url || 'pending'}`,
    url,
    title: fields.title || hostname || (pending ? 'Aperçu Chrome…' : 'Chrome'),
    headings: fields.headings,
    actions: fields.actions,
    text: fields.text,
    pending,
    failed,
  }
}

export function upsertChromeSnapshot(list: ChromeSnapshot[], next: ChromeSnapshot): ChromeSnapshot[] {
  const key = next.url || next.id
  const index = list.findIndex(item => (item.url || item.id) === key || item.id === next.id)
  if (index < 0) return [...list, next]
  const current = list[index]
  const merged: ChromeSnapshot = {
    ...current,
    ...next,
    title: next.title && next.title !== 'Chrome' ? next.title : current.title,
    headings: next.headings.length ? next.headings : current.headings,
    actions: next.actions.length ? next.actions : current.actions,
    text: next.text || current.text,
    pending: next.pending,
    failed: next.failed,
  }
  return list.map((item, itemIndex) => itemIndex === index ? merged : item)
}
