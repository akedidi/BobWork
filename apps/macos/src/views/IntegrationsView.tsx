// ============================================================
// Bob Work – Integrations & MCP
// Sections : OAuth catalogue, APIs publiques, APIs + clé,
// protocoles MCP (stdio / HTTP / SSE / streamable-http)
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { listen } from '@tauri-apps/api/event'
import {
  connectIntegrationToken,
  deleteMcpServer,
  disconnectIntegration,
  getIntegrationStatuses,
  getMcpServers,
  getOAuthClientConfig,
  saveMcpServer,
  setMcpServerEnabled,
  setOAuthClientConfig,
  startIntegrationOAuth,
  testMcpServer,
} from '../lib/ipc'
import type { IntegrationConnectionStatus } from '../lib/ipc'
import { PluginIcon, resolveIntegrationIcon } from '../components/PluginIcon'
import type { ConnectionTestSummary, McpServer, SaveMcpServerInput } from '@bob-work/shared-types'
import { errorMessage } from '../lib/errorMessage'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { useT } from '../i18n'
import { useAppDialog } from '../components/AppDialog'

const MCP_BY_PROVIDER: Record<string, string> = {
  github: 'bob-work-github',
  slack: 'bob-work-slack',
  monday: 'bob-work-monday',
  microsoft: 'bob-work-microsoft',
}

function formatTestedAt(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(document.documentElement.lang || 'en', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function ConnectionTestBadge({ test, compact = false }: { test?: ConnectionTestSummary | null; compact?: boolean }) {
  const t = useT()
  if (!test) {
    return <span className={`plugin-mcp-state untested${compact ? ' compact' : ''}`}>{t('integrations.untested')}</span>
  }
  const when = formatTestedAt(test.testedAt)
  return (
    <span
      className={`plugin-mcp-state ${test.ok ? 'connected' : 'failed'}${compact ? ' compact' : ''}`}
      title={when ? `${test.message} · ${when}` : test.message}
    >
      {test.ok ? t('integrations.testOk') : t('integrations.testFail')}{when && !compact ? ` · ${when}` : ''}
    </span>
  )
}

interface IntegrationDef {
  id: string
  name: string
  description: string
  oauthProvider: string
  tools?: string[]
  group: 'developer' | 'microsoft'
  tokenHint: string
  permissions: string[]
  webOnly?: boolean
}

type PageTab = 'integrations' | 'apis' | 'mcp'
type IntegrationFilter = 'all' | 'productivity' | 'developer'

const CATALOG: IntegrationDef[] = [
  {
    id: 'github', name: 'GitHub', oauthProvider: 'github', group: 'developer',
    description: 'Parcourir dépôts, issues et pull requests avec votre compte GitHub.',
    tools: ['github_list_repos', 'github_search_issues', 'github_get_pull_request'],
    tokenHint: 'GitHub → Settings → Developer settings → Personal access tokens',
    permissions: ['Dépôts privés et publics (repo)', 'Profil (read:user)', 'Organisations (read:org)'],
  },
  {
    id: 'slack', name: 'Slack', oauthProvider: 'slack', group: 'developer',
    description: 'Rechercher des messages et publier dans les canaux autorisés.',
    tools: ['slack_search_messages', 'slack_list_channels', 'slack_post_message'],
    tokenHint: 'Slack → votre app → OAuth & Permissions → User OAuth Token (xoxp-…)',
    permissions: [
      'Canaux et historique (channels/groups/im)',
      'Envoi de messages (chat:write)',
      'Recherche (search:read)',
      'Profils (users:read)',
    ],
    webOnly: true,
  },
  {
    id: 'monday', name: 'Monday.com', oauthProvider: 'monday', group: 'developer',
    description: 'Consulter et mettre à jour vos tableaux Monday.com.',
    tools: ['monday_list_boards', 'monday_search_items', 'monday_create_update'],
    tokenHint: 'Monday.com → Avatar → Developers → My access tokens → API token',
    permissions: ['Tableaux (lecture/écriture)', 'Mises à jour (lecture/écriture)', 'Profil et compte (lecture)'],
    webOnly: true,
  },
  {
    id: 'outlook-mail', name: 'Outlook', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Lire, rechercher et préparer des e-mails via Microsoft Graph.',
    tools: ['graph_search_mail'],
    tokenHint: 'Microsoft Entra / Graph Explorer → jeton d’accès avec Mail.Read',
    permissions: ['Courrier (Mail.ReadWrite)', 'Envoi d’e-mails (Mail.Send)'],
  },
  {
    id: 'teams', name: 'Microsoft Teams', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Accéder aux équipes, canaux et messages Teams.',
    tools: ['graph_list_teams'],
    tokenHint: 'Couvert par le même jeton Microsoft Graph que Outlook',
    permissions: ['Équipes (Team.ReadBasic.All)', 'Messages de canaux (ChannelMessage.Read.All)'],
  },
  {
    id: 'outlook-calendar', name: 'Calendrier Outlook', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Consulter et gérer votre calendrier Microsoft 365.',
    tools: ['graph_list_calendar_events'],
    tokenHint: 'Couvert par le même jeton Microsoft Graph que Outlook',
    permissions: ['Calendriers (Calendars.ReadWrite)'],
  },
  {
    id: 'onedrive', name: 'OneDrive', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Rechercher, lire et déposer des fichiers OneDrive.',
    tools: ['graph_search_onedrive'],
    tokenHint: 'Couvert par le même jeton Microsoft Graph que Outlook',
    permissions: ['Fichiers OneDrive (Files.ReadWrite.All)'],
  },
  {
    id: 'onenote', name: 'OneNote', oauthProvider: 'microsoft', group: 'microsoft',
    description: 'Lire et organiser des carnets OneNote via Microsoft Graph.',
    tools: ['graph_onenote'],
    tokenHint: 'Couvert par le même jeton Microsoft Graph que Outlook',
    permissions: ['Notes OneNote (Notes.Read / Notes.ReadWrite)'],
  },
]

function connectLabel(integration: IntegrationDef, pending: boolean) {
  if (pending) return 'Connexion en cours…'
  if (integration.oauthProvider === 'microsoft') return 'Connecter avec Microsoft 365'
  return `Connecter avec ${integration.name}`
}

function isPkcePublicProvider(provider: string) {
  return provider === 'slack' || provider === 'microsoft' || provider === 'monday'
}

function setupStatusMessage(integration: IntegrationDef) {
  if (integration.oauthProvider === 'slack') {
    return 'Sur la page Slack : connectez-vous à votre workspace → créez l’app « Bob Work » → Basic Information → copiez le Client ID et collez-le ci-dessous (une seule fois).'
  }
  if (integration.oauthProvider === 'microsoft') {
    return 'Créez l’app Entra « Bob Work » (client public) dans l’onglet qui vient de s’ouvrir : ajoutez la redirection http://127.0.0.1:47823/oauth/callback, activez les flux clients publics / PKCE, puis collez uniquement le Client ID ci-dessous. Ensuite Bob Work ouvrira la page d’autorisation Microsoft 365.'
  }
  return `Créez une application OAuth ${integration.name} « Bob Work » avec la redirection http://127.0.0.1:47823/oauth/callback, puis collez les identifiants ci-dessous.`
}

function slugifyName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

function hasStoredSecretField(value: unknown) {
  if (!value) return false
  if (typeof value === 'string') return value.length > 0 && value !== '{}'
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return false
}

function hasAuthHeaders(server: McpServer) {
  return hasStoredSecretField(server.raw?.headers)
}

function hasEnvSecrets(server: McpServer) {
  return hasStoredSecretField(server.raw?.env)
}

function isRemoteTransport(transport: string) {
  return ['http', 'sse', 'streamable-http', 'streamable_http'].includes(transport)
}

export default function IntegrationsView() {
  const t = useT()
  const dialog = useAppDialog()
  const location = useLocation()
  const navigate = useNavigate()
  const integrationName = (item: IntegrationDef) =>
    item.id === 'outlook-calendar' ? t('integrations.outlookCalendar') : item.name
  const [tab, setTab] = useState<PageTab>('integrations')
  const [statuses, setStatuses] = useState<Record<string, IntegrationConnectionStatus>>({})
  const [filter, setFilter] = useState<IntegrationFilter>('all')
  const [pendingOAuth, setPendingOAuth] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState<{ integrationId: string; userCode: string; verificationUri: string } | null>(null)
  const [connectPanelId, setConnectPanelId] = useState<string | null>(null)
  const [oauthForms, setOauthForms] = useState<Record<string, { clientId: string; clientSecret: string }>>({})
  const [tokenForms, setTokenForms] = useState<Record<string, { token: string; label: string }>>({})
  const [connectingToken, setConnectingToken] = useState<string | null>(null)
  const [servers, setServers] = useState<McpServer[]>([])
  const [mcpForm, setMcpForm] = useState({
    name: '',
    transport: 'stdio',
    commandOrUrl: '',
    args: '',
    envText: '',
    headersText: '',
  })
  const [publicApiForm, setPublicApiForm] = useState({
    name: '',
    url: '',
    transport: 'streamable-http',
  })
  const [apiKeyForm, setApiKeyForm] = useState({
    name: '',
    url: '',
    transport: 'http',
    authMode: 'query' as 'bearer' | 'header' | 'env' | 'query',
    headerName: 'X-Api-Key',
    queryName: 'api_key',
    secret: '',
    envName: 'API_KEY',
  })
  const [oauthMcpForm, setOauthMcpForm] = useState({
    name: '',
    url: '',
    transport: 'streamable-http',
  })
  const [status, setStatus] = useState('')
  const [mcpTestBusy, setMcpTestBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [highlightKeyedApi, setHighlightKeyedApi] = useState(false)
  const [highlightProvider, setHighlightProvider] = useState<string | null>(null)
  const statusTimerRef = useRef<number | null>(null)
  const keyedApiPanelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const state = location.state as {
      tab?: PageTab
      apiKeyPreset?: {
        name?: string
        envName?: string
        authMode?: 'bearer' | 'header' | 'env' | 'query'
        url?: string
        transport?: string
      }
      highlight?: string
    } | null
    if (!state) return
    if (state.tab === 'apis' || state.tab === 'mcp' || state.tab === 'integrations') {
      setTab(state.tab)
    }
    if (state.apiKeyPreset) {
      const preset = state.apiKeyPreset
      setApiKeyForm(current => ({
        ...current,
        name: slugifyName(preset.name || current.name || 'api'),
        url: preset.url ?? current.url,
        transport: preset.transport || current.transport,
        authMode: preset.authMode || 'env',
        envName: preset.envName || current.envName || 'API_KEY',
        secret: '',
      }))
      setHighlightKeyedApi(true)
      setStatus(
        preset.envName
          ? `Formulaire prérempli pour ${preset.envName}. Collez la clé puis enregistrez.`
          : 'Formulaire API prérempli. Collez la clé puis enregistrez.',
      )
    } else if (state.highlight === 'keyed-api') {
      setHighlightKeyedApi(true)
    } else if (state.highlight && state.highlight !== 'mcp') {
      setHighlightProvider(state.highlight)
      if (!state.tab) setTab('integrations')
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    if (!highlightKeyedApi || tab !== 'apis') return
    const timer = window.setTimeout(() => {
      keyedApiPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [highlightKeyedApi, tab, loading])

  useEffect(() => {
    if (!highlightProvider || tab !== 'integrations') return
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[data-provider="${highlightProvider}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [highlightProvider, tab, loading])

  const refreshStatuses = useCallback(async () => {
    const next = await getIntegrationStatuses()
    setStatuses(Object.fromEntries(next.map(item => [item.integrationId, item])))
  }, [])

  const loadMcp = async () => {
    const next = await getMcpServers()
    setServers(next)
  }

  const reload = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    try {
      await Promise.all([refreshStatuses(), loadMcp()])
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [refreshStatuses])

  // Toast éphémère : succès de test MCP, ajout de connecteur, etc.
  useEffect(() => {
    if (!status) return
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = window.setTimeout(() => setStatus(''), 3500)
    return () => {
      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    }
  }, [status])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let unlistenDone: (() => void) | null = null
    let unlistenError: (() => void) | null = null
    listen<IntegrationConnectionStatus>('integration-oauth-done', event => {
      setPendingOAuth(null)
      setConnectingToken(null)
      setConnectPanelId(null)
      setDeviceCode(null)
      const name = CATALOG.find(item => item.id === event.payload.integrationId)?.name ?? event.payload.integrationId
      setStatus(`${name} connecté${event.payload.accountLabel ? ` (${event.payload.accountLabel})` : ''}. Le skill Bob associé est prêt.`)
      void reload()
    }).then(fn => { unlistenDone = fn })
    listen<string>('integration-oauth-error', event => {
      setPendingOAuth(null)
      setConnectingToken(null)
      setDeviceCode(null)
      setStatus(event.payload)
      void reload()
    }).then(fn => { unlistenError = fn })
    return () => { unlistenDone?.(); unlistenError?.() }
  }, [reload])

  const openConnectPanel = async (integration: IntegrationDef) => {
    setConnectPanelId(integration.id)
    setStatus('')
    const existing = await getOAuthClientConfig(integration.id).catch(() => null)
    setOauthForms(current => ({
      ...current,
      [integration.id]: {
        clientId: existing?.clientId ?? current[integration.id]?.clientId ?? '',
        clientSecret: existing?.clientSecret ?? current[integration.id]?.clientSecret ?? '',
      },
    }))
  }

  const handleConnect = async (integration: IntegrationDef) => {
    setStatus('')
    setDeviceCode(null)
    try {
      setPendingOAuth(integration.id)
      setConnectPanelId(null)
      const result = await startIntegrationOAuth(integration.id)
      if (result.mode === 'device' && result.userCode && result.verificationUri) {
        setDeviceCode({
          integrationId: integration.id,
          userCode: result.userCode,
          verificationUri: result.verificationUri,
        })
        try { await navigator.clipboard.writeText(result.userCode) } catch { /* clipboard optional */ }
        setStatus(`Saisissez le code affiché sur la page ${integration.name} qui vient de s’ouvrir, puis autorisez les permissions demandées.`)
      } else if (result.mode === 'setup') {
        setPendingOAuth(null)
        setStatus(setupStatusMessage(integration))
        if (integration.oauthProvider !== 'monday') {
          await openConnectPanel(integration)
        }
      } else {
        setStatus(`Autorisez ${integration.name} dans le navigateur. Bob Work reprendra automatiquement à la fin.`)
      }
    } catch (error) {
      setPendingOAuth(null)
      setStatus(errorMessage(error))
      const info = statuses[integration.id]
      if (integration.oauthProvider !== 'monday' && !info?.oauthClientConfigured && !info?.deviceFlowAvailable) {
        await openConnectPanel(integration)
      }
    }
  }

  const handleSaveOAuthAndConnect = async (integration: IntegrationDef) => {
    const form = oauthForms[integration.id]
    if (!form?.clientId.trim()) {
      setStatus('Renseignez au minimum l’identifiant client OAuth.')
      return
    }
    setStatus('')
    try {
      setPendingOAuth(integration.id)
      setConnectPanelId(null)
      await setOAuthClientConfig(
        integration.id,
        form.clientId.trim(),
        isPkcePublicProvider(integration.oauthProvider)
          ? undefined
          : (form.clientSecret.trim() || undefined),
      )
      await refreshStatuses()
      const result = await startIntegrationOAuth(integration.id)
      if (result.mode === 'web') {
        setStatus(`Autorisez ${integration.name} dans le navigateur. Bob Work reprendra automatiquement à la fin.`)
      } else {
        setStatus(`Connexion ${integration.name} en cours…`)
      }
    } catch (error) {
      setPendingOAuth(null)
      setStatus(errorMessage(error))
    }
  }

  const handleConnectWithToken = async (integration: IntegrationDef) => {
    const form = tokenForms[integration.id]
    if (!form?.token.trim()) {
      setStatus('Collez un jeton d’accès valide.')
      return
    }
    setStatus('')
    try {
      setConnectingToken(integration.id)
      await connectIntegrationToken(
        integration.id,
        form.token.trim(),
        form.label.trim() || undefined,
      )
    } catch (error) {
      setConnectingToken(null)
      setStatus(errorMessage(error))
    }
  }

  const handleDisconnect = async (integration: IntegrationDef) => {
    if (!await dialog.confirm({ message: t('integrations.disconnectConfirm', { name: integration.name }), confirmLabel: t('integrations.disconnect'), destructive: true })) return
    await disconnectIntegration(integration.id)
    await refreshStatuses()
    setConnectPanelId(current => (current === integration.id ? null : current))
    setStatus(`${integration.name} déconnecté.`)
  }

  const persistConnector = async (
    input: SaveMcpServerInput,
    successMessage: string,
    reset: () => void,
    options?: { stayOnTab?: PageTab },
  ) => {
    setStatus('')
    try {
      await saveMcpServer(input)
      reset()
      await loadMcp()
      setStatus(successMessage)
      setTab(options?.stayOnTab ?? 'mcp')
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  const persistMcp = async () => {
    const env = parseEnvLines(mcpForm.envText)
    const headers = parseHeaderLines(mcpForm.headersText)
    await persistConnector(
      {
        name: slugifyName(mcpForm.name),
        transport: mcpForm.transport,
        commandOrUrl: mcpForm.commandOrUrl.trim(),
        args: mcpForm.args.split(/\s+/).filter(Boolean),
        enabled: true,
        env: Object.keys(env).length ? env : undefined,
        headers: Object.keys(headers).length ? headers : undefined,
      },
      'Serveur MCP ajouté.',
      () => setMcpForm({ name: '', transport: 'stdio', commandOrUrl: '', args: '', envText: '', headersText: '' }),
    )
  }

  const persistPublicApi = async () => {
    await persistConnector(
      {
        name: slugifyName(publicApiForm.name),
        transport: publicApiForm.transport,
        commandOrUrl: publicApiForm.url.trim(),
        args: [],
        enabled: true,
      },
      'API publique enregistrée.',
      () => setPublicApiForm({ name: '', url: '', transport: 'streamable-http' }),
      { stayOnTab: 'apis' },
    )
  }

  const persistApiKey = async () => {
    const name = slugifyName(apiKeyForm.name)
    const secret = apiKeyForm.secret.trim()
    if (!secret) {
      setStatus('Indiquez la clé ou le jeton API.')
      return
    }
    let headers: Record<string, string> | undefined
    let env: Record<string, string> | undefined
    let commandOrUrl = apiKeyForm.url.trim()
    if (apiKeyForm.authMode === 'bearer') {
      headers = { Authorization: `Bearer ${secret}` }
    } else if (apiKeyForm.authMode === 'header') {
      headers = { [apiKeyForm.headerName.trim() || 'X-Api-Key']: secret }
    } else if (apiKeyForm.authMode === 'query') {
      // TMDB-style APIs: ?api_key=… (also mark as keyed via a redacted env hint)
      const param = apiKeyForm.queryName.trim() || 'api_key'
      try {
        const parsed = new URL(commandOrUrl)
        parsed.searchParams.set(param, secret)
        commandOrUrl = parsed.toString()
      } catch {
        const join = commandOrUrl.includes('?') ? '&' : '?'
        commandOrUrl = `${commandOrUrl}${join}${encodeURIComponent(param)}=${encodeURIComponent(secret)}`
      }
      env = { [`${param.toUpperCase()}`]: secret }
    } else {
      env = { [apiKeyForm.envName.trim() || 'API_KEY']: secret }
    }
    await persistConnector(
      {
        name,
        transport: apiKeyForm.transport,
        commandOrUrl,
        args: [],
        enabled: true,
        headers,
        env,
      },
      `API « ${name} » enregistrée.`,
      () => setApiKeyForm({
        name: '',
        url: '',
        transport: 'http',
        authMode: 'query',
        headerName: 'X-Api-Key',
        queryName: 'api_key',
        secret: '',
        envName: 'API_KEY',
      }),
      { stayOnTab: 'apis' },
    )
  }

  const persistOauthMcp = async () => {
    await persistConnector(
      {
        name: slugifyName(oauthMcpForm.name),
        transport: oauthMcpForm.transport,
        commandOrUrl: oauthMcpForm.url.trim(),
        args: [],
        enabled: true,
      },
      'Connecteur OAuth / MCP distant ajouté. Autorisez-le ensuite si le serveur le demande.',
      () => setOauthMcpForm({ name: '', url: '', transport: 'streamable-http' }),
    )
  }

  const visible = filter === 'all'
    ? CATALOG
    : filter === 'developer'
      ? CATALOG.filter(item => item.group === 'developer')
      : CATALOG.filter(item => item.group === 'microsoft')

  const connectedCount = CATALOG.filter(item => statuses[item.id]?.connected).length
  const microsoftNeedsEntra = !loading && !loadError && CATALOG
    .filter(item => item.oauthProvider === 'microsoft')
    .every(item => {
      const info = statuses[item.id]
      return info && !info.connected && !info.oauthClientConfigured
    })

  const classified = useMemo(() => {
    const publicApis: McpServer[] = []
    const keyedApis: McpServer[] = []
    const protocols: McpServer[] = []
    for (const server of servers) {
      // APIs tab = remote HTTP/SSE only. Local stdio (computer-use, chrome,
      // OAuth connectors, …) often carry env flags/tokens but are not "APIs".
      if (!isRemoteTransport(server.transport)) {
        protocols.push(server)
        continue
      }
      if (hasAuthHeaders(server) || hasEnvSecrets(server)) keyedApis.push(server)
      else publicApis.push(server)
    }
    return { publicApis, keyedApis, protocols }
  }, [servers])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="topbar titlebar-drag" data-tauri-drag-region>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('integrations.title')}</span>
        {tab === 'integrations' && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {connectedCount} connexion{connectedCount !== 1 ? 's' : ''} active{connectedCount !== 1 ? 's' : ''}
        </span>}
      </div>

      <div className="extensions-tabs">
        <button className={`filter-pill ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>{t('integrations.tabIntegrations')}</button>
        <button className={`filter-pill ${tab === 'apis' ? 'active' : ''}`} onClick={() => setTab('apis')}>{t('integrations.tabApis')}</button>
        <button className={`filter-pill ${tab === 'mcp' ? 'active' : ''}`} onClick={() => setTab('mcp')}>{t('integrations.tabMcp')}</button>
      </div>

      <LoadErrorBanner
        error={loadError}
        onRetry={() => { void reload() }}
        fallback={t('integrations.loadFailed')}
      />
      {loading && !loadError ? (
        <div className="task-empty" style={{ marginTop: 24 }}>Chargement…</div>
      ) : null}

      {tab === 'integrations' && !loading && !loadError && <>
        <div className="settings-warning" style={{ margin: '0 20px 12px', maxWidth: 980 }}>
          Catalogue OAuth Bob Work (GitHub, Slack, Monday, Microsoft 365). Pour un fournisseur hors catalogue,
          utilisez la section « Autre OAuth / MCP distant » ci-dessous, ou l’onglet APIs.
        </div>
        {microsoftNeedsEntra && (filter === 'all' || filter === 'productivity') && (
          <p className="settings-warning" role="status" style={{ margin: '0 20px 12px', maxWidth: 980 }}>
            {t('integrations.entraRequired')}
          </p>
        )}

        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6, flexShrink: 0 }}>
          {([['all', 'Toutes'], ['productivity', 'Microsoft 365'], ['developer', 'Dev & collab']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} style={{
              padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              border: '1px solid var(--border)', background: filter === key ? 'var(--accent)' : 'var(--bg-surface)',
              color: filter === key ? 'white' : 'var(--text-secondary)',
            }}>{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
          <h3 className="connector-section-title">Catalogue OAuth</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10, maxWidth: 980 }}>
            {visible.map(integration => {
              const info = statuses[integration.id]
              const isConnected = !!info?.connected
              const isPending = pendingOAuth === integration.id
              const isConnectingToken = connectingToken === integration.id
              const panelOpen = connectPanelId === integration.id
              const needsMoreScopes = !isConnected && info?.scopeSatisfied === false
              const oauthForm = oauthForms[integration.id] ?? { clientId: '', clientSecret: '' }
              const tokenForm = tokenForms[integration.id] ?? { token: '', label: '' }
              return <div
                key={integration.id}
                data-provider={integration.id}
                style={{
                  background: 'var(--bg-surface)',
                  border: `1px solid ${isConnected ? '#22c55e60' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  outline: highlightProvider === integration.id ? '2px solid var(--accent)' : undefined,
                  outlineOffset: highlightProvider === integration.id ? 2 : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <PluginIcon icon={resolveIntegrationIcon(integration.id)} size="lg" label={integrationName(integration)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{integrationName(integration)}</div>
                    <span style={{ fontSize: 11, background: 'var(--bg-hover)', padding: '2px 7px', borderRadius: 99, color: 'var(--text-secondary)' }}>
                      {info?.authMethod === 'token' ? 'Jeton' : 'OAuth'}
                    </span>
                  </div>
                  {isConnected && <span className="status-dot green" />}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <span className={`plugin-mcp-state ${isConnected ? (info?.lastTest && !info.lastTest.ok ? 'failed' : 'connected') : info?.oauthClientConfigured ? 'configured' : 'untested'}`}>
                    {isConnected
                      ? (info?.lastTest && !info.lastTest.ok ? t('integrations.testFailed') : t('integrations.connected'))
                      : info?.oauthClientConfigured
                        ? t('integrations.configured')
                        : t('integrations.notConnected')}
                  </span>
                  <ConnectionTestBadge test={info?.lastTest} />
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{integration.description}</p>
                {info?.lastTest && (
                  <p style={{ fontSize: 11.5, color: info.lastTest.ok ? 'var(--text-muted)' : 'var(--danger)', margin: 0 }}>
                    {info.lastTest.message}
                  </p>
                )}
                {needsMoreScopes && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                    Votre compte Microsoft 365 est connecté, mais les autorisations {integrationName(integration)} n’ont pas encore été accordées.
                  </p>
                )}
                {!isConnected && integration.oauthProvider === 'microsoft' && info && !info.oauthClientConfigured && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                    {t('integrations.entraRequired')}
                  </p>
                )}
                {info?.accountLabel && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Compte : {info.accountLabel}</p>}
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Autorisations demandées :
                  <ul style={{ margin: '4px 0 0', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {integration.permissions.map(permission => <li key={permission}>{permission}</li>)}
                  </ul>
                </div>
                {integration.tools && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{integration.tools.map(tool => <span key={tool} style={{ fontSize: 10.5, background: 'var(--bg-hover)', padding: '2px 7px', borderRadius: 4, color: 'var(--text-muted)', fontFamily: '"SF Mono", monospace' }}>{tool}</span>)}</div>}

                {deviceCode?.integrationId === integration.id && !isConnected && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-hover)', border: '1px solid var(--accent)' }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Code d’autorisation (copié dans le presse-papier)</div>
                    <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, fontFamily: '"SF Mono", monospace', textAlign: 'center' }}>{deviceCode.userCode}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                      Collez ce code sur la page <code>{deviceCode.verificationUri.replace('https://', '')}</code> ouverte dans le navigateur, puis validez les permissions demandées. Bob Work terminera la connexion automatiquement.
                    </div>
                    <button onClick={() => { setDeviceCode(null); setPendingOAuth(null) }} style={ghostButtonStyle}>Annuler</button>
                  </div>
                )}

                {panelOpen && !isConnected && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, background: 'var(--bg-hover)' }}>
                    {integration.oauthProvider === 'slack' && !info?.oauthClientConfigured && <>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Client ID Slack (une seule fois)</div>
                      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
                        1) Sur api.slack.com, cliquez <strong>Sign in</strong> avec le workspace Slack à connecter.
                        2) Créez l’app <strong>Bob Work</strong>.
                        3) Onglet <strong>Basic Information</strong> → copiez <strong>Client ID</strong>. Aucun secret.
                      </p>
                      <label style={fieldLabelStyle}>
                        Client ID
                        <input
                          value={oauthForm.clientId}
                          onChange={event => setOauthForms(current => ({
                            ...current,
                            [integration.id]: { ...oauthForm, clientId: event.target.value },
                          }))}
                          placeholder="1234567890.1234567890"
                          autoFocus
                          style={fieldInputStyle}
                        />
                      </label>
                      <button
                        disabled={isPending || !oauthForm.clientId.trim()}
                        onClick={() => void handleSaveOAuthAndConnect(integration)}
                        style={connectButtonStyle}
                      >
                        {isPending ? 'Ouverture…' : 'Enregistrer et ouvrir Slack'}
                      </button>
                      <button onClick={() => setConnectPanelId(null)} style={ghostButtonStyle}>Annuler</button>
                    </>}

                    {integration.oauthProvider !== 'slack' && !integration.webOnly && <>
                      {!info?.oauthClientConfigured && <>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          {isPkcePublicProvider(integration.oauthProvider)
                            ? `Client ID ${integration.oauthProvider === 'microsoft' ? 'Microsoft Entra' : 'OAuth'} (PKCE — sans secret)`
                            : 'Option 1 — OAuth (application développeur)'}
                        </div>
                        <label style={fieldLabelStyle}>
                          Client ID
                          <input
                            value={oauthForm.clientId}
                            onChange={event => setOauthForms(current => ({
                              ...current,
                              [integration.id]: { ...oauthForm, clientId: event.target.value },
                            }))}
                            placeholder={
                              integration.oauthProvider === 'microsoft'
                                ? 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                                : 'Identifiant de l’application OAuth'
                            }
                            style={fieldInputStyle}
                          />
                        </label>
                        {!isPkcePublicProvider(integration.oauthProvider) && (
                          <label style={fieldLabelStyle}>
                            Client secret{integration.oauthProvider === 'github' ? '' : ' (optionnel)'}
                            <input
                              type="password"
                              value={oauthForm.clientSecret}
                              onChange={event => setOauthForms(current => ({
                                ...current,
                                [integration.id]: { ...oauthForm, clientSecret: event.target.value },
                              }))}
                              placeholder="Secret client si requis par le provider"
                              style={fieldInputStyle}
                            />
                          </label>
                        )}
                        <button
                          disabled={isPending || !oauthForm.clientId.trim()}
                          onClick={() => void handleSaveOAuthAndConnect(integration)}
                          style={connectButtonStyle}
                        >
                          {isPending
                            ? 'Ouverture…'
                            : isPkcePublicProvider(integration.oauthProvider)
                              ? connectLabel(integration, false)
                              : 'Enregistrer et connecter via OAuth'}
                        </button>
                        <div style={{ height: 1, background: 'var(--border)' }} />
                      </>}
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {info?.oauthClientConfigured ? 'Connexion' : 'Option 2 — Jeton personnel'}
                      </div>
                      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>{integration.tokenHint}</p>
                      <label style={fieldLabelStyle}>
                        Jeton d’accès
                        <input
                          type="password"
                          value={tokenForm.token}
                          onChange={event => setTokenForms(current => ({
                            ...current,
                            [integration.id]: { ...tokenForm, token: event.target.value },
                          }))}
                          placeholder="ghp_…, xoxb-…, eyJ…"
                          style={fieldInputStyle}
                        />
                      </label>
                      <label style={fieldLabelStyle}>
                        Libellé du compte (optionnel)
                        <input
                          value={tokenForm.label}
                          onChange={event => setTokenForms(current => ({
                            ...current,
                            [integration.id]: { ...tokenForm, label: event.target.value },
                          }))}
                          placeholder="mon-compte@entreprise.com"
                          style={fieldInputStyle}
                        />
                      </label>
                      <button
                        disabled={isConnectingToken || !tokenForm.token.trim()}
                        onClick={() => void handleConnectWithToken(integration)}
                        style={connectButtonStyle}
                      >
                        {isConnectingToken ? 'Connexion…' : 'Connecter avec ce jeton'}
                      </button>
                      <button onClick={() => setConnectPanelId(null)} style={ghostButtonStyle}>Annuler</button>
                    </>}
                  </div>
                )}

                <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
                  {isConnected
                    ? <>
                      <button
                        disabled={mcpTestBusy === integration.id || !MCP_BY_PROVIDER[integration.oauthProvider]}
                        onClick={async () => {
                          const mcpName = MCP_BY_PROVIDER[integration.oauthProvider]
                          if (!mcpName) return
                          setMcpTestBusy(integration.id)
                          try {
                            const result = await testMcpServer(mcpName)
                            setStatus(result.ok ? `${integration.name} : ${result.message}` : `${integration.name} — échec : ${result.message}`)
                            await refreshStatuses()
                            await loadMcp()
                          } catch (error) {
                            setStatus(errorMessage(error))
                          } finally {
                            setMcpTestBusy(null)
                          }
                        }}
                        style={secondaryButtonStyle}
                      >
                        {mcpTestBusy === integration.id ? 'Test…' : 'Tester'}
                      </button>
                      <button onClick={() => void handleDisconnect(integration)} style={dangerButtonStyle}>Déconnecter</button>
                    </>
                    : <>
                      <button
                        disabled={isPending || isConnectingToken}
                        onClick={() => void handleConnect(integration)}
                        style={connectButtonStyle}
                      >
                        {needsMoreScopes && !isPending ? 'Étendre les autorisations Microsoft 365' : connectLabel(integration, isPending)}
                      </button>
                      {!integration.webOnly && !panelOpen && (
                        <button
                          disabled={isPending || isConnectingToken}
                          onClick={() => void openConnectPanel(integration)}
                          style={secondaryButtonStyle}
                        >
                          Jeton
                        </button>
                      )}
                    </>}
                </div>
              </div>
            })}
          </div>

          <section className="connector-panel" style={{ marginTop: 28, maxWidth: 640 }}>
            <h3 className="connector-section-title">Autre OAuth / MCP distant</h3>
            <p className="settings-note">
              Pour un fournisseur hors catalogue (MCP hébergé avec OAuth type Monday, ou endpoint streamable-http).
              Bob Work n’invente pas d’OAuth : le serveur distant gère l’autorisation.
            </p>
            <label style={fieldLabelStyle}>Nom
              <input value={oauthMcpForm.name} onChange={event => setOauthMcpForm(value => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="mon-oauth-mcp" style={fieldInputStyle} />
            </label>
            <label style={fieldLabelStyle}>Transport
              <select value={oauthMcpForm.transport} onChange={event => setOauthMcpForm(value => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
                <option value="streamable-http">streamable-http</option>
                <option value="sse">SSE</option>
                <option value="http">HTTP</option>
              </select>
            </label>
            <label style={fieldLabelStyle}>URL HTTPS
              <input value={oauthMcpForm.url} onChange={event => setOauthMcpForm(value => ({ ...value, url: event.target.value }))} placeholder="https://mcp.fournisseur.com/…" style={fieldInputStyle} />
            </label>
            <button className="btn-primary" disabled={!oauthMcpForm.name || !oauthMcpForm.url} onClick={() => void persistOauthMcp()}>
              Ajouter le connecteur
            </button>
          </section>
        </div>
      </>}

      {tab === 'apis' && !loading && !loadError && (
        <div className="extension-grid integrations-mcp-grid connector-apis-grid">
          {(classified.publicApis.length > 0 || classified.keyedApis.length > 0) && (
            <section className="connector-panel" style={{ gridColumn: '1 / -1' }}>
              <h3 className="connector-section-title">APIs configurées <small>{classified.publicApis.length + classified.keyedApis.length}</small></h3>
              <div className="connector-mini-list">
                {[...classified.keyedApis, ...classified.publicApis].map(server => (
                  <div key={server.name} className="connector-mini-row">
                    <span>{server.name}</span>
                    <div className="connector-mini-meta">
                      <ConnectionTestBadge test={server.lastTest} compact />
                      <button
                        className="link-btn"
                        disabled={mcpTestBusy === server.name}
                        onClick={async () => {
                          setMcpTestBusy(server.name)
                          try {
                            const result = await testMcpServer(server.name)
                            setStatus(result.ok ? `${server.name} : ${result.message}` : `${server.name} — échec : ${result.message}`)
                            await loadMcp()
                          } catch (error) {
                            setStatus(errorMessage(error))
                          } finally {
                            setMcpTestBusy(null)
                          }
                        }}
                      >
                        {mcpTestBusy === server.name ? '…' : 'Tester'}
                      </button>
                      <code>{server.transport}{(hasAuthHeaders(server) || hasEnvSecrets(server)) ? ' · auth' : ''}</code>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="connector-panel">
            <h3 className="connector-section-title">API publique (sans clé)</h3>
            <p className="settings-note">
              Endpoint HTTPS ouvert (pas d’auth). Ex. registres publics, démos, open data.
            </p>
            <label style={fieldLabelStyle}>Nom
              <input value={publicApiForm.name} onChange={event => setPublicApiForm(value => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="stooq-public" style={fieldInputStyle} />
            </label>
            <label style={fieldLabelStyle}>Transport
              <select value={publicApiForm.transport} onChange={event => setPublicApiForm(value => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
                <option value="streamable-http">streamable-http</option>
                <option value="sse">SSE</option>
                <option value="http">HTTP</option>
              </select>
            </label>
            <label style={fieldLabelStyle}>URL HTTPS
              <input value={publicApiForm.url} onChange={event => setPublicApiForm(value => ({ ...value, url: event.target.value }))} placeholder="https://…" style={fieldInputStyle} />
            </label>
            <button className="btn-primary" disabled={!publicApiForm.name || !publicApiForm.url} onClick={() => void persistPublicApi()}>
              Ajouter l’API publique
            </button>
            {classified.publicApis.length > 0 && (
              <div className="connector-mini-list">
                <strong>Déjà configurées</strong>
                {classified.publicApis.map(server => (
                  <div key={server.name} className="connector-mini-row">
                    <span>{server.name}</span>
                    <div className="connector-mini-meta">
                      <ConnectionTestBadge test={server.lastTest} compact />
                      <button
                        className="link-btn"
                        disabled={mcpTestBusy === server.name}
                        onClick={async () => {
                          setMcpTestBusy(server.name)
                          try {
                            const result = await testMcpServer(server.name)
                            setStatus(result.ok ? `${server.name} : ${result.message}` : `${server.name} — échec : ${result.message}`)
                            await loadMcp()
                          } catch (error) {
                            setStatus(errorMessage(error))
                          } finally {
                            setMcpTestBusy(null)
                          }
                        }}
                      >
                        {mcpTestBusy === server.name ? '…' : 'Tester'}
                      </button>
                      <code>{server.transport}</code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            className="connector-panel"
            ref={keyedApiPanelRef}
            style={highlightKeyedApi ? { outline: '2px solid var(--accent)', outlineOffset: 2 } : undefined}
          >
            <h3 className="connector-section-title">API protégée par clé</h3>
            <p className="settings-note">
              Bearer, en-tête, paramètre d’URL (<code>api_key</code> pour TMDB) ou variable d’environnement
              (ex. <code>FINNHUB_API_KEY</code> pour le plugin CTO).
              La clé est stockée localement (redactée à l’affichage) et injectée dans Bob au lancement.
            </p>
            <label style={fieldLabelStyle}>Nom
              <input value={apiKeyForm.name} onChange={event => setApiKeyForm(value => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="tmdb" style={fieldInputStyle} />
            </label>
            <label style={fieldLabelStyle}>Transport
              <select value={apiKeyForm.transport} onChange={event => setApiKeyForm(value => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
                <option value="http">HTTP</option>
                <option value="streamable-http">streamable-http</option>
                <option value="sse">SSE</option>
              </select>
            </label>
            <label style={fieldLabelStyle}>URL HTTPS
              <input value={apiKeyForm.url} onChange={event => setApiKeyForm(value => ({ ...value, url: event.target.value }))} placeholder="https://api.themoviedb.org/3/configuration" style={fieldInputStyle} />
            </label>
            <label style={fieldLabelStyle}>Mode d’auth
              <select value={apiKeyForm.authMode} onChange={event => setApiKeyForm(value => ({ ...value, authMode: event.target.value as typeof apiKeyForm.authMode }))} style={fieldInputStyle}>
                <option value="query">Paramètre d’URL (?api_key=…)</option>
                <option value="bearer">Authorization: Bearer …</option>
                <option value="header">En-tête personnalisé</option>
                <option value="env">Variable d’environnement</option>
              </select>
            </label>
            {apiKeyForm.authMode === 'header' && (
              <label style={fieldLabelStyle}>Nom de l’en-tête
                <input value={apiKeyForm.headerName} onChange={event => setApiKeyForm(value => ({ ...value, headerName: event.target.value }))} placeholder="X-Api-Key" style={fieldInputStyle} />
              </label>
            )}
            {apiKeyForm.authMode === 'query' && (
              <label style={fieldLabelStyle}>Nom du paramètre
                <input value={apiKeyForm.queryName} onChange={event => setApiKeyForm(value => ({ ...value, queryName: event.target.value }))} placeholder="api_key" style={fieldInputStyle} />
              </label>
            )}
            {apiKeyForm.authMode === 'env' && (
              <label style={fieldLabelStyle}>Nom de la variable
                <input value={apiKeyForm.envName} onChange={event => setApiKeyForm(value => ({ ...value, envName: event.target.value }))} placeholder="API_KEY" style={fieldInputStyle} />
              </label>
            )}
            <label style={fieldLabelStyle}>Clé / jeton
              <input type="password" value={apiKeyForm.secret} onChange={event => setApiKeyForm(value => ({ ...value, secret: event.target.value }))} placeholder="sk-… / token" style={fieldInputStyle} />
            </label>
            <button className="btn-primary" disabled={!apiKeyForm.name || !apiKeyForm.url || !apiKeyForm.secret} onClick={() => void persistApiKey()}>
              Ajouter l’API avec clé
            </button>
          </section>
        </div>
      )}

      {tab === 'mcp' && !loading && !loadError && (
        <div className="extension-grid integrations-mcp-grid">
          <section className="extension-list">
            <h2>Serveurs configurés <small>{servers.length}</small></h2>
            <p className="settings-note">
              Tous les connecteurs MCP (OAuth sync, APIs, stdio local). Protocoles : stdio, HTTP, SSE, streamable-http.
            </p>
            {servers.length === 0 ? <div className="task-empty">Aucun serveur MCP.</div> : servers.map(server => (
              <article className="extension-card" key={server.name}>
                <div>
                  <strong>{server.name}</strong>
                  <span>{server.transport}{(hasAuthHeaders(server) || hasEnvSecrets(server)) ? ' · auth' : ''}</span>
                  <ConnectionTestBadge test={server.lastTest} />
                </div>
                <p>{server.commandOrUrl}</p>
                {server.lastTest && (
                  <p className={server.lastTest.ok ? 'status-ok' : 'plugin-version-warning'} role={server.lastTest.ok ? undefined : 'alert'}>
                    {server.lastTest.message}
                  </p>
                )}
                <div className="settings-actions">
                  <label className="mini-toggle">
                    <input type="checkbox" checked={server.enabled} onChange={async event => { await setMcpServerEnabled(server.name, event.target.checked); await loadMcp() }} /> Actif
                  </label>
                  <button
                    className="secondary-btn"
                    disabled={mcpTestBusy === server.name}
                    onClick={async () => {
                      setMcpTestBusy(server.name)
                      try {
                        const result = await testMcpServer(server.name)
                        setStatus(result.ok ? `${server.name} : ${result.message}` : `${server.name} — échec : ${result.message}`)
                        await loadMcp()
                        await refreshStatuses()
                      } catch (error) {
                        setStatus(errorMessage(error))
                      } finally {
                        setMcpTestBusy(null)
                      }
                    }}
                  >
                    {mcpTestBusy === server.name ? 'Test…' : 'Tester'}
                  </button>
                  <button className="danger-link" onClick={async () => { if (await dialog.confirm({ message: t('integrations.deleteMcpConfirm', { name: server.name }), confirmLabel: t('common.delete'), destructive: true })) { await deleteMcpServer(server.name); await loadMcp() } }}>{t('common.delete')}</button>
                </div>
              </article>
            ))}
          </section>
          <section className="extension-editor">
            <h2>Ajouter un protocole MCP</h2>
            <p className="settings-note">stdio local, ou distant HTTP / SSE / streamable-http, avec env et en-têtes optionnels.</p>
            <label>Nom<input value={mcpForm.name} onChange={event => setMcpForm(value => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="mon-serveur" /></label>
            <label>Transport
              <select value={mcpForm.transport} onChange={event => setMcpForm(value => ({ ...value, transport: event.target.value }))}>
                <option value="stdio">stdio (commande locale)</option>
                <option value="streamable-http">streamable-http</option>
                <option value="sse">SSE</option>
                <option value="http">HTTP</option>
              </select>
            </label>
            <label>{mcpForm.transport === 'stdio' ? 'Commande' : 'URL'}
              <input value={mcpForm.commandOrUrl} onChange={event => setMcpForm(value => ({ ...value, commandOrUrl: event.target.value }))} placeholder={mcpForm.transport === 'stdio' ? 'python3' : 'https://…'} />
            </label>
            {mcpForm.transport === 'stdio' && (
              <label>Arguments<input value={mcpForm.args} onChange={event => setMcpForm(value => ({ ...value, args: event.target.value }))} placeholder="server.py --flag" /></label>
            )}
            {mcpForm.transport === 'stdio' && (
              <label>Variables d’environnement (KEY=value)
                <textarea value={mcpForm.envText} onChange={event => setMcpForm(value => ({ ...value, envText: event.target.value }))} placeholder={'API_TOKEN=${API_TOKEN}\nDEBUG=1'} rows={3} />
              </label>
            )}
            {mcpForm.transport !== 'stdio' && (
              <label>En-têtes HTTP (Name: value)
                <textarea value={mcpForm.headersText} onChange={event => setMcpForm(value => ({ ...value, headersText: event.target.value }))} placeholder={'Authorization: Bearer …\nX-Api-Key: …'} rows={3} />
              </label>
            )}
            {mcpForm.transport !== 'stdio' && (
              <label>Variables d’environnement (KEY=value)
                <textarea value={mcpForm.envText} onChange={event => setMcpForm(value => ({ ...value, envText: event.target.value }))} placeholder="OPTIONNEL=valeur" rows={2} />
              </label>
            )}
            <button className="btn-primary" disabled={!mcpForm.name || !mcpForm.commandOrUrl} onClick={() => void persistMcp()}>Ajouter avec Bob Shell</button>
          </section>
        </div>
      )}

      {status && <div className="settings-status">{status}</div>}
    </div>
  )
}

const connectButtonStyle = { flex: 1, padding: '7px 0', borderRadius: 99, fontSize: 12, fontWeight: 500, border: 'none', background: 'var(--accent)', color: 'white', cursor: 'pointer' }
const secondaryButtonStyle = { ...connectButtonStyle, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
const dangerButtonStyle = { ...connectButtonStyle, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444' }
const ghostButtonStyle = { ...connectButtonStyle, background: 'transparent', color: 'var(--text-muted)', border: 'none' }
const fieldLabelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 11.5, color: 'var(--text-secondary)' }
const fieldInputStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }
