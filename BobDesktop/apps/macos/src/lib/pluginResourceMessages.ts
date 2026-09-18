import type { MessageKey } from '../i18n/translate'
import type { PluginResourceStatus } from '@bob-work/shared-types'

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

const STATUS_KEY: Record<string, MessageKey> = {
  'stdio-cli.ready': 'plugins.resourceStatus.stdioCliReady',
  'host-cli.ready': 'plugins.resourceStatus.hostCliReady',
  'bundled-bin.ready': 'plugins.resourceStatus.bundledBinReady',
  'shell.ready': 'plugins.resourceStatus.shellReady',
  'node-cli.ready': 'plugins.resourceStatus.nodeCliReady',
  'bundled-python.ready': 'plugins.resourceStatus.bundledPythonReady',
  'bundled-python.needs_setup': 'plugins.resourceStatus.bundledPythonNeedsSetup',
  'bundled-python.inactive': 'plugins.resourceStatus.bundledPythonInactive',
  'bundled-assets.ready': 'plugins.resourceStatus.bundledAssetsReady',
  'api-public.ready': 'plugins.resourceStatus.apiPublicReady',
  'bob-llm.always_on': 'plugins.resourceStatus.bobLlmReady',
  'bob-llm.needs_setup': 'plugins.resourceStatus.bobLlmNeedsSetup',
  'web-search.ready': 'plugins.resourceStatus.webSearchReady',
  'web-search.inactive': 'plugins.resourceStatus.webSearchInactive',
  'web-search.needs_setup': 'plugins.resourceStatus.webSearchNeedsSetup',
}

const LEGACY_MESSAGE_KEY: Record<string, MessageKey> = {
  'CLI locale détectée.': 'plugins.resourceStatus.stdioCliReady',
  'CLI locale détectée': 'plugins.resourceStatus.stdioCliReady',
  'Local CLI detected.': 'plugins.resourceStatus.stdioCliReady',
  'CLI système détectée sur ce Mac.': 'plugins.resourceStatus.hostCliReady',
  'System CLI detected on this Mac.': 'plugins.resourceStatus.hostCliReady',
  'Binaire trouvé (bundle plugin ou PATH).': 'plugins.resourceStatus.bundledBinReady',
  'Binary found (plugin bundle or PATH).': 'plugins.resourceStatus.bundledBinReady',
  'Script shell du plugin disponible.': 'plugins.resourceStatus.shellReady',
  'Plugin shell script available.': 'plugins.resourceStatus.shellReady',
  'CLI Node du plugin disponible.': 'plugins.resourceStatus.nodeCliReady',
  'Plugin Node CLI available.': 'plugins.resourceStatus.nodeCliReady',
  'Prêt · API publique, aucune clé requise.': 'plugins.resourceStatus.apiPublicReady',
  'Ready · Public API, no key required.': 'plugins.resourceStatus.apiPublicReady',
  'Bob Shell détecté — synthèse via le LLM Bob.': 'plugins.resourceStatus.bobLlmReady',
  'Bob Shell detected — synthesis via Bob LLM.': 'plugins.resourceStatus.bobLlmReady',
  'Accès web activé dans Réglages.': 'plugins.resourceStatus.webSearchReady',
  'Web access enabled in Settings.': 'plugins.resourceStatus.webSearchReady',
  'Accès web désactivé.': 'plugins.resourceStatus.webSearchInactive',
  'Web access disabled.': 'plugins.resourceStatus.webSearchInactive',
  'Python 3.10+ requis pour exécuter les scripts embarqués.': 'plugins.resourceStatus.bundledPythonNeedsSetup',
  'Python 3.10+ required to run bundled scripts.': 'plugins.resourceStatus.bundledPythonNeedsSetup',
  'Python 3.10+ absent — scripts embarqués indisponibles.': 'plugins.resourceStatus.bundledPythonInactive',
  'Python 3.10+ missing — bundled scripts unavailable.': 'plugins.resourceStatus.bundledPythonInactive',
}

const GENERIC_STATUS_PREFIX = /^(?:Script Python embarqué|Bundled Python script|Assets indexés|Indexed bundled assets)/i

function isAuthorProvidedNotes(message: string, kind: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return false
  if (LEGACY_MESSAGE_KEY[trimmed]) return false
  if (kind === 'bundled-python' || kind === 'bundled-assets' || kind === 'shared-runtime') {
    if (trimmed.includes('—') || trimmed.includes(' - ')) return true
    if (GENERIC_STATUS_PREFIX.test(trimmed)) return false
    return trimmed.length > 48
  }
  return false
}

export function localizePluginResourceMessage(
  resource: Pick<PluginResourceStatus, 'kind' | 'state' | 'message'>,
  t: Translate,
): string {
  const trimmed = resource.message?.trim() ?? ''
  if (trimmed && LEGACY_MESSAGE_KEY[trimmed]) {
    return t(LEGACY_MESSAGE_KEY[trimmed])
  }
  if (trimmed && isAuthorProvidedNotes(trimmed, resource.kind)) {
    return trimmed
  }
  const composite = `${resource.kind}.${resource.state}`
  const key = STATUS_KEY[composite]
  if (key) return t(key)
  return trimmed
}

export function localizePluginResourceSetupHint(
  hint: string | null | undefined,
  t: Translate,
): string {
  if (!hint?.trim()) return ''
  const map: Record<string, MessageKey> = {
    'Installez Python 3 (python.org ou `brew install python`).': 'plugins.resourceHint.installPython',
    'Install Python 3 (python.org or `brew install python`).': 'plugins.resourceHint.installPython',
    'Activez Accès web dans Réglages → Accès & permissions.': 'plugins.resourceHint.enableWebAccess',
    'Activez Accès web dans Réglages → Accès et contrôle.': 'plugins.resourceHint.enableWebAccess',
    'Enable Web access in Settings → Access & permissions.': 'plugins.resourceHint.enableWebAccess',
    'Enable Web access in Settings → Access & control.': 'plugins.resourceHint.enableWebAccess',
  }
  const key = map[hint.trim()]
  return key ? t(key) : hint
}
