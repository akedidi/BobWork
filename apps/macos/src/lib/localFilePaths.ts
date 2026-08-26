/** Document / deliverable extensions Bob Work can preview or open. */
const DELIVERABLE_EXT = 'pptx?|docx?|xlsx?|pdf|md|html?|csv|txt|png|jpe?g|gif|webp|svg|d2|dot|json|ya?ml|zip|key|pages|numbers'

/**
 * Matches absolute or ~/ paths ending with a deliverable extension.
 * macOS workspace paths commonly contain spaces (notably
 * `Library/Application Support`), so whitespace cannot terminate a path.
 */
const ABSOLUTE_PATH_RE = new RegExp(
  `(^|[\\s«»"'\\\`(=:\\[])((?:\\/|~\\/)[^\\r\\n"'\\\`()\\]<>]+?\\.(?:${DELIVERABLE_EXT}))\\b`,
  'gi',
)

function cleanCandidate(raw: string): string {
  return raw
    .replace(/^file:\/\//i, '')
    .replace(/[),.;:]+$/g, '')
    .trim()
}

function followsWebUrlScheme(text: string, pathStart: number): boolean {
  const before = text.slice(Math.max(0, pathStart - 12), pathStart)
  return /(?:https?|ftp):$/i.test(before)
}

/**
 * Collapse `/Users/me/Desktop/a.pptx` and `~/Desktop/a.pptx` to the same key
 * so chips / extracts don’t show the same file twice.
 */
export function normalizeLocalFilePathKey(path: string): string {
  const cleaned = cleanCandidate(path)
  if (!cleaned) return ''
  if (cleaned.startsWith('~/')) return `home:${cleaned.slice(2)}`
  const homeRelative = cleaned.match(/^\/(?:Users|home)\/[^/]+\/(.+)$/i)
  if (homeRelative) return `home:${homeRelative[1]}`
  return cleaned
}

export function preferAbsoluteLocalPath(a: string, b: string): string {
  if (a.startsWith('/') && !b.startsWith('/')) return a
  if (b.startsWith('/') && !a.startsWith('/')) return b
  // Prefer longer (more specific) absolute path
  return a.length >= b.length ? a : b
}

/** Absolute (or ~/…) file paths mentioned in assistant text. */
export function extractLocalFilePaths(text: string): string[] {
  if (!text) return []
  const byKey = new Map<string, string>()
  for (const match of text.matchAll(ABSOLUTE_PATH_RE)) {
    const pathStart = (match.index ?? 0) + (match[1]?.length ?? 0)
    if (followsWebUrlScheme(text, pathStart)) continue
    const path = cleanCandidate(match[2] ?? '')
    if (!path) continue
    const key = normalizeLocalFilePathKey(path)
    if (!key) continue
    const existing = byKey.get(key)
    byKey.set(key, existing ? preferAbsoluteLocalPath(existing, path) : path)
  }
  return Array.from(byKey.values())
}

export function fileNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

/**
 * Wrap bare absolute paths in markdown links so ReactMarkdown makes them clickable.
 * Skips paths already inside markdown link destinations, and skips ~/… when the
 * same file already appears as an absolute path in the message.
 */
export function linkifyLocalFilePaths(markdown: string): string {
  if (!markdown) return markdown
  const absoluteKeys = new Set(
    extractLocalFilePaths(markdown)
      .filter(path => path.startsWith('/'))
      .map(normalizeLocalFilePathKey),
  )
  return markdown.replace(ABSOLUTE_PATH_RE, (full, prefix: string, path: string, offset: number) => {
    const start = offset + (prefix?.length ?? 0)
    if (followsWebUrlScheme(markdown, start)) return full
    const before = markdown.slice(Math.max(0, start - 3), start)
    if (before.includes('](')) return full
    const cleaned = cleanCandidate(path)
    const key = normalizeLocalFilePathKey(cleaned)
    // Avoid a second link for `~/Desktop/foo.pptx` when `/Users/…/Desktop/foo.pptx` is present.
    if (cleaned.startsWith('~/') && absoluteKeys.has(key)) return full
    const name = fileNameFromPath(cleaned)
    const destination = /\s/.test(cleaned) ? `<${cleaned}>` : cleaned
    return `${prefix}[${name}](${destination})`
  })
}
