const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Restrict embedded navigation to ordinary web pages. */
export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'about:blank') return 'about:blank'
  if (EXPLICIT_SCHEME.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return 'about:blank'

  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return 'about:blank'
    return parsed.toString()
  } catch {
    return 'about:blank'
  }
}
