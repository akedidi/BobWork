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

export function getFileTypeLabel(path: string, isDirectory = false): string {
  if (isDirectory) return 'DOSSIER'
  const ext = getFileExtension(path)
  if (!ext) return 'FICHIER'
  return ext.toUpperCase()
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} Ko`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10_485_760 ? 1 : 0)} Mo`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`
}

export function mergeAttachmentPaths(current: string[], incoming: string[]): string[] {
  return Array.from(new Set([...current, ...incoming]))
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
  pdf: 'builtin-documents',
  rtf: 'builtin-documents',
  odt: 'builtin-documents',
  md: 'builtin-documents',
  markdown: 'builtin-documents',
  txt: 'builtin-documents',
  one: 'builtin-onenote',
  onetoc2: 'builtin-onenote',
}

export function getSuggestedBuiltinPluginId(path: string): string | null {
  const ext = getFileExtension(path)
  return EXTENSION_TO_BUILTIN_PLUGIN[ext] ?? null
}

export function getActivePluginMention(text: string): string | null {
  return getActivePluginMentions(text)[0] ?? null
}

/** Unique plugin ids mentioned in composer text, in appearance order. */
export function getActivePluginMentions(text: string): string[] {
  return uniqueMentions(text, /@plugin:([A-Za-z0-9-]+)/g)
}

/** Unique skill slugs mentioned in composer text, in appearance order. */
export function getActiveSkillMentions(text: string): string[] {
  return uniqueMentions(text, /@skill:([A-Za-z0-9._-]+)/g)
}

/** Unique MCP server names mentioned in composer text, in appearance order. */
export function getActiveMcpMentions(text: string): string[] {
  return uniqueMentions(text, /@mcp:([A-Za-z0-9._-]+)/g)
}

export type ComposerMentionChip =
  | { kind: 'plugin'; id: string }
  | { kind: 'skill'; id: string }
  | { kind: 'mcp'; id: string }

/** All @plugin / @skill / @mcp chips for the composer preview, first-seen order. */
export function getActiveComposerMentions(text: string): ComposerMentionChip[] {
  const chips: ComposerMentionChip[] = []
  const seen = new Set<string>()
  const pattern = /@(plugin|skill|mcp):([A-Za-z0-9._-]+)/g
  for (const match of text.matchAll(pattern)) {
    const kind = match[1] as ComposerMentionChip['kind']
    const id = match[2]
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
