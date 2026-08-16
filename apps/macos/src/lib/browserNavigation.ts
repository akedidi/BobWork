const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i

// Keep this deliberately small and in sync with `frame-src` in tauri.conf.json.
// Authentication pages, arbitrary task output and local-network addresses must
// open in the user's browser instead of inheriting Bob Work's WebView process.
const TRUSTED_EMBEDDED_HOSTS = new Set([
  'bob.ibm.com',
])
const LOCAL_DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

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

/** Local loopback pages get a more capable sandbox for development workflows. */
export function isLocalDevelopmentBrowserUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol)
      && LOCAL_DEVELOPMENT_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Only loopback development pages and public HTTPS docs execute in Bob Work. */
export function isTrustedEmbeddedBrowserUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return isLocalDevelopmentBrowserUrl(value) || (parsed.protocol === 'https:'
      && parsed.port === ''
      && TRUSTED_EMBEDDED_HOSTS.has(parsed.hostname.toLowerCase()))
  } catch {
    return false
  }
}
