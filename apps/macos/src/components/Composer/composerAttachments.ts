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
  const match = text.match(/@plugin:([A-Za-z0-9-]+)/)
  return match?.[1] ?? null
}
