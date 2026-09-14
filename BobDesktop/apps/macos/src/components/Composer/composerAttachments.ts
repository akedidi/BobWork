export type FileVisualKind =
  | 'image'
  | 'folder'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'code'
  | 'audio'
  | 'video'
  | 'generic'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif'])
const DOCUMENT_EXTENSIONS = new Set(['doc', 'docx', 'rtf', 'odt', 'pages', 'txt', 'md', 'markdown'])
const SPREADSHEET_EXTENSIONS = new Set(['xls', 'xlsx', 'xlsm', 'ods', 'numbers', 'csv', 'tsv'])
const PRESENTATION_EXTENSIONS = new Set(['ppt', 'pptx', 'odp', 'key'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'])
const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'rb', 'php', 'sql', 'sh', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css',
])
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'])

export function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

export function getFileExtension(path: string): string {
  const name = getFileName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(path))
}

export function getFileVisualKind(path: string, isDirectory = false): FileVisualKind {
  if (isDirectory) return 'folder'
  const ext = getFileExtension(path)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet'
  if (PRESENTATION_EXTENSIONS.has(ext)) return 'presentation'
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return 'generic'
}

export function getFileTypeLabel(path: string): string {
  const ext = getFileExtension(path)
  return ext ? ext.toUpperCase() : ''
}

export interface ComposerAttachment {
  path: string
  isDirectory: boolean
}

export function mergeAttachmentPaths(current: ComposerAttachment[], incoming: ComposerAttachment[]): ComposerAttachment[] {
  const seen = new Set(current.map(item => item.path))
  const out = [...current]
  for (const item of incoming) {
    if (seen.has(item.path)) continue
    seen.add(item.path)
    out.push(item)
  }
  return out
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} Ko`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10_485_760 ? 1 : 0)} Mo`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`
}

const EXTENSION_TO_BUILTIN_PLUGIN: Record<string, string> = {
  doc: 'builtin-word',
  docx: 'builtin-word',
  xls: 'builtin-excel',
  xlsx: 'builtin-excel',
  xlsm: 'builtin-excel',
  csv: 'builtin-excel',
  tsv: 'builtin-excel',
  ppt: 'builtin-powerpoint',
  pptx: 'builtin-powerpoint',
  png: 'builtin-docling',
  jpg: 'builtin-docling',
  jpeg: 'builtin-docling',
  tiff: 'builtin-docling',
  tif: 'builtin-docling',
  webp: 'builtin-docling',
  bmp: 'builtin-docling',
  one: 'builtin-onenote',
  onetoc2: 'builtin-onenote',
}

/** Document types handled by the built-in Documents plugin without an explicit @plugin mention. */
const DEFAULT_DOCUMENTS_PLUGIN_EXTENSIONS = new Set([
  'pdf', 'rtf', 'odt', 'md', 'markdown', 'txt',
])

export function getSuggestedBuiltinPluginId(path: string): string | null {
  const ext = getFileExtension(path)
  return EXTENSION_TO_BUILTIN_PLUGIN[ext] ?? null
}

export function usesDefaultDocumentsPlugin(path: string): boolean {
  return DEFAULT_DOCUMENTS_PLUGIN_EXTENSIONS.has(getFileExtension(path))
}

export function attachmentsUseDefaultDocumentsPlugin(paths: readonly string[]): boolean {
  return paths.some(usesDefaultDocumentsPlugin)
}

export interface ComposerMentionCatalog {
  pluginIds?: readonly string[]
  skillSlugs?: readonly string[]
}

const MENTION_ID_CHARS: Record<ComposerMentionChip['kind'], RegExp> = {
  plugin: /[A-Za-z0-9-]/,
  skill: /[A-Za-z0-9._-]/,
  integration: /[A-Za-z0-9-]/,
  api: /[A-Za-z0-9._-]/,
  mcp: /[A-Za-z0-9._-]/,
  db: /[A-Za-z0-9._-]/,
}

function longestKnownPrefix(rest: string, knownIds: readonly string[]): string | null {
  let best: string | null = null
  for (const id of knownIds) {
    if (!rest.startsWith(id)) continue
    if (!best || id.length > best.length) best = id
  }
  return best
}

function fallbackMentionId(rest: string, allowed: RegExp): string | null {
  let length = 0
  for (const char of rest) {
    if (!allowed.test(char)) break
    length += char.length
  }
  return length > 0 ? rest.slice(0, length) : null
}

function matchMentionId(
  rest: string,
  knownIds: readonly string[] | undefined,
  kind: ComposerMentionChip['kind'],
): string | null {
  const known = knownIds?.length ? longestKnownPrefix(rest, knownIds) : null
  if (known) return known
  return fallbackMentionId(rest, MENTION_ID_CHARS[kind])
}

function scanTypedMentions(
  text: string,
  kind: ComposerMentionChip['kind'],
  knownIds: readonly string[] | undefined,
): string[] {
  const marker = new RegExp(`@${kind}:`, 'g')
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.matchAll(marker)) {
    const rest = text.slice(match.index! + match[0].length)
    const id = matchMentionId(rest, knownIds, kind)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function getActivePluginMention(text: string, catalog?: ComposerMentionCatalog): string | null {
  return getActivePluginMentions(text, catalog)[0] ?? null
}

/** Unique plugin ids mentioned in composer text, in appearance order. */
export function getActivePluginMentions(text: string, catalog?: ComposerMentionCatalog): string[] {
  return scanTypedMentions(text, 'plugin', catalog?.pluginIds)
}

/** Unique skill slugs mentioned in composer text, in appearance order. */
export function getActiveSkillMentions(text: string, catalog?: ComposerMentionCatalog): string[] {
  return scanTypedMentions(text, 'skill', catalog?.skillSlugs)
}

/** Unique MCP server names mentioned in composer text, in appearance order. */
export function getActiveMcpMentions(text: string): string[] {
  return uniqueMentions(text, /@mcp:([A-Za-z0-9._-]+)/g)
}

export function getActiveDbMentions(text: string): string[] {
  return uniqueMentions(text, /@db:([A-Za-z0-9._-]+)/g)
}

export type ComposerMentionChip =
  | { kind: 'plugin'; id: string }
  | { kind: 'skill'; id: string }
  | { kind: 'integration'; id: string }
  | { kind: 'api'; id: string }
  | { kind: 'mcp'; id: string }
  | { kind: 'db'; id: string }

const PLUGIN_MENTION_ALIASES: Record<string, string> = {
  'agentic-senior-cloud-architect': 'agentic-cloud-architect',
  'builtin-cloud-architect': 'agentic-cloud-architect',
}

function rewriteAttachedPluginMentions(text: string, catalog?: ComposerMentionCatalog): string {
  const marker = /@plugin:/g
  let result = ''
  let lastIndex = 0
  for (const match of text.matchAll(marker)) {
    const idx = match.index!
    if (lastIndex < idx) result += text.slice(lastIndex, idx)
    const rest = text.slice(idx + match[0].length)
    const id = matchMentionId(rest, catalog?.pluginIds, 'plugin')
    if (!id) {
      result += match[0]
      lastIndex = idx + match[0].length
      continue
    }
    const tail = rest.slice(id.length)
    const needsSpace = tail.length > 0 && !/^[\s@]/.test(tail)
    result += `@plugin:${id}${needsSpace ? ' ' : ''}`
    lastIndex = idx + match[0].length + id.length
  }
  if (lastIndex < text.length) result += text.slice(lastIndex)
  return result
}

/** Canonicalize historical plugin ids and keep only one mention per plugin. */
export function normalizeComposerCapabilityMentions(text: string, catalog?: ComposerMentionCatalog): string {
  const seenPlugins = new Set<string>()
  const withDetachedText = rewriteAttachedPluginMentions(text, catalog)
  let result = ''
  let lastIndex = 0
  for (const match of withDetachedText.matchAll(/@plugin:/g)) {
    const idx = match.index!
    result += withDetachedText.slice(lastIndex, idx)
    const rest = withDetachedText.slice(idx + match[0].length)
    const id = matchMentionId(rest, catalog?.pluginIds, 'plugin')
    if (!id) {
      result += match[0]
      lastIndex = idx + match[0].length
      continue
    }
    const canonical = PLUGIN_MENTION_ALIASES[id] ?? id
    if (!seenPlugins.has(canonical)) {
      seenPlugins.add(canonical)
      result += `@plugin:${canonical}`
    }
    lastIndex = idx + match[0].length + id.length
  }
  result += withDetachedText.slice(lastIndex)
  return result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** All typed capability mentions for the composer preview, first-seen order. */
export function getActiveComposerMentions(text: string, catalog?: ComposerMentionCatalog): ComposerMentionChip[] {
  const chips: ComposerMentionChip[] = []
  const seen = new Set<string>()
  const pattern = /@(plugin|skill|integration|api|mcp|db):/g
  for (const match of text.matchAll(pattern)) {
    const kind = match[1] as ComposerMentionChip['kind']
    const rest = text.slice(match.index! + match[0].length)
    const knownIds = kind === 'plugin'
      ? catalog?.pluginIds
      : kind === 'skill'
        ? catalog?.skillSlugs
        : undefined
    const id = matchMentionId(rest, knownIds, kind)
    if (!id) continue
    const key = `${kind}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    chips.push({ kind, id })
  }
  return chips
}

/** Remove one mention token (and a following space) from composer text. */
export function removeComposerMention(text: string, kind: ComposerMentionChip['kind'], id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\s)@${kind}:${escaped}(?=\\s|$)`, 'g')
  return text
    .replace(pattern, match => (match.startsWith(' ') || match.startsWith('\n') ? match[0] : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s+/, '')
}

function uniqueMentions(text: string, pattern: RegExp): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.matchAll(pattern)) {
    const id = match[1]
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}
