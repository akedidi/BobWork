// ============================================================
// Bob Work – Integrations & MCP
// Connexion OAuth en un clic (PKCE + callback local)
// ou jeton personnel si l’app OAuth n’est pas configurée
// ============================================================

import { useCallback, useEffect, useState } from 'react'
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
} from '../lib/ipc'
import type { IntegrationConnectionStatus } from '../lib/ipc'
import { PluginIcon, resolveIntegrationIcon } from '../components/PluginIcon'
import type { McpServer } from '@bob-work/shared-types'

interface IntegrationDef {
  id: string
  name: string
  description: string
  oauthProvider: string
  tools?: string[]
  group: 'developer' | 'microsoft'
  tokenHint: string
  /** Human-readable permissions requested during authorization (per-provider scopes). */
  permissions: string[]
}

type PageTab = 'integrations' | 'mcp'
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
    tokenHint: 'Slack → votre app → OAuth & Permissions → Bot User OAuth Token',
    permissions: ['Canaux et historique (bot)', 'Envoi de messages (chat:write)', 'Recherche (search:read, jeton utilisateur)'],
  },
  {
    id: 'monday', name: 'Monday.com', oauthProvider: 'monday', group: 'developer',
    description: 'Consulter et mettre à jour vos tableaux Monday.com.',
    tools: ['monday_list_boards', 'monday_search_items', 'monday_create_update'],
    tokenHint: 'Monday.com → Avatar → Developers → My access tokens → API token',
    permissions: ['Tableaux (lecture/écriture)', 'Mises à jour (lecture/écriture)', 'Profil et compte (lecture)'],
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
    id: 'outlook-calendar', name: 'Outlook Calendar', oauthProvider: 'microsoft', group: 'microsoft',
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
]

function connectLabel(integration: IntegrationDef, pending: boolean) {
  if (pending) return 'Connexion en cours…'
  if (integration.oauthProvider === 'microsoft') return 'Connecter avec Microsoft 365'
  return `Connecter avec ${integration.name}`
}

export default function IntegrationsView() {
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
  const [mcpForm, setMcpForm] = useState({ name: '', transport: 'stdio', commandOrUrl: '', args: '' })
  const [status, setStatus] = useState('')

  const refreshStatuses = useCallback(async () => {
    const next = await getIntegrationStatuses().catch(() => [])
    setStatuses(Object.fromEntries(next.map(item => [item.integrationId, item])))
  }, [])

  const loadMcp = async () => {
    const next = await getMcpServers().catch(() => [])
    setServers(next)
  }

  useEffect(() => {
    void refreshStatuses()
    void loadMcp()
  }, [refreshStatuses])

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
      void refreshStatuses()
      // The connector MCP server was just synced with Bob Shell.
      void loadMcp()
    }).then(fn => { unlistenDone = fn })
    listen<string>('integration-oauth-error', event => {
      setPendingOAuth(null)
      setConnectingToken(null)
      setDeviceCode(null)
      setStatus(event.payload)
    }).then(fn => { unlistenError = fn })
    return () => { unlistenDone?.(); unlistenError?.() }
  }, [refreshStatuses])

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
      } else {
        setStatus(`Autorisez ${integration.name} dans le navigateur. Bob Work reprendra automatiquement à la fin.`)
      }
    } catch (error) {
      setPendingOAuth(null)
      setStatus(String(error))
      // Slack/Monday have no zero-config flow: open the guided setup panel.
      const info = statuses[integration.id]
      if (!info?.oauthClientConfigured && !info?.deviceFlowAvailable) {
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
      await setOAuthClientConfig(
        integration.id,
        form.clientId.trim(),
        form.clientSecret.trim() || undefined,
      )
      await refreshStatuses()
      await startIntegrationOAuth(integration.id)
      setStatus(`Autorisez ${integration.name} dans le navigateur. Bob Work reprendra automatiquement à la fin.`)
    } catch (error) {
      setPendingOAuth(null)
      setStatus(String(error))
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
      setStatus(String(error))
    }
  }

  const handleDisconnect = async (integration: IntegrationDef) => {
    if (!confirm(`Déconnecter ${integration.name} ? Les jetons seront effacés du coffre local chiffré.`)) return
    await disconnectIntegration(integration.id)
    await refreshStatuses()
    setConnectPanelId(current => (current === integration.id ? null : current))
    setStatus(`${integration.name} déconnecté.`)
  }

  const persistMcp = async () => {
    setStatus('')
    try {
      await saveMcpServer({
        name: mcpForm.name,
        transport: mcpForm.transport,
        commandOrUrl: mcpForm.commandOrUrl,
        args: mcpForm.args.split(/\s+/).filter(Boolean),
        enabled: true,
      })
      setMcpForm({ name: '', transport: 'stdio', commandOrUrl: '', args: '' })
      await loadMcp()
      setStatus('Serveur MCP ajouté par Bob Shell.')
    } catch (error) {
      setStatus(String(error))
    }
  }

  const visible = filter === 'all'
    ? CATALOG
    : filter === 'developer'
      ? CATALOG.filter(item => item.group === 'developer')
      : CATALOG.filter(item => item.group === 'microsoft')

  const connectedCount = CATALOG.filter(item => statuses[item.id]?.connected).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="topbar titlebar-drag">
        <span className="titlebar-no-drag" style={{ fontWeight: 600, fontSize: 14 }}>Intégrations et MCP</span>
        {tab === 'integrations' && <span className="titlebar-no-drag" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {connectedCount} connexion{connectedCount !== 1 ? 's' : ''} active{connectedCount !== 1 ? 's' : ''}
        </span>}
      </div>

      <div className="extensions-tabs">
        <button className={`filter-pill ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>Intégrations</button>
        <button className={`filter-pill ${tab === 'mcp' ? 'active' : ''}`} onClick={() => setTab('mcp')}>Serveurs MCP</button>
      </div>

      {tab === 'integrations' ? <>
        <div className="settings-warning" style={{ margin: '0 20px 12px', maxWidth: 980 }}>
          Un clic ouvre la page d’autorisation officielle du fournisseur (GitHub, Microsoft 365…) avec les permissions demandées.
          Slack et Monday.com nécessitent une application OAuth (Client ID) ou un jeton personnel.
        </div>

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10, maxWidth: 980 }}>
            {visible.map(integration => {
              const info = statuses[integration.id]
              const isConnected = !!info?.connected
              const isPending = pendingOAuth === integration.id
              const isConnectingToken = connectingToken === integration.id
              const panelOpen = connectPanelId === integration.id
              // Provider signed in but this integration's scopes were never granted
              // (e.g. Microsoft 365 authorized for Outlook only, Teams pending).
              const needsMoreScopes = !isConnected && info?.scopeSatisfied === false
              const oauthForm = oauthForms[integration.id] ?? { clientId: '', clientSecret: '' }
              const tokenForm = tokenForms[integration.id] ?? { token: '', label: '' }
              return <div key={integration.id} style={{ background: 'var(--bg-surface)', border: `1px solid ${isConnected ? '#22c55e60' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <PluginIcon icon={resolveIntegrationIcon(integration.id)} size="lg" label={integration.name} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{integration.name}</div>
                    <span style={{ fontSize: 11, background: 'var(--bg-hover)', padding: '2px 7px', borderRadius: 99, color: 'var(--text-secondary)' }}>
                      {info?.authMethod === 'token' ? 'Jeton' : 'OAuth'}
                    </span>
                  </div>
                  {isConnected && <span className="status-dot green" />}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{integration.description}</p>
                {needsMoreScopes && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                    Votre compte Microsoft 365 est connecté, mais les autorisations {integration.name} n’ont pas encore été accordées.
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
                    {!info?.oauthClientConfigured && <>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>Option 1 — OAuth (application développeur)</div>
                      <label style={fieldLabelStyle}>
                        Client ID
                        <input
                          value={oauthForm.clientId}
                          onChange={event => setOauthForms(current => ({
                            ...current,
                            [integration.id]: { ...oauthForm, clientId: event.target.value },
                          }))}
                          placeholder="Identifiant de l’application OAuth"
                          style={fieldInputStyle}
                        />
                      </label>
                      <label style={fieldLabelStyle}>
                        Client secret (optionnel)
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
                      <button
                        disabled={isPending || !oauthForm.clientId.trim()}
                        onClick={() => void handleSaveOAuthAndConnect(integration)}
                        style={secondaryButtonStyle}
                      >
                        {isPending ? 'Ouverture du navigateur…' : 'Enregistrer et connecter via OAuth'}
                      </button>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Enregistrez l’URI de redirection <code>http://127.0.0.1:47823/oauth/callback</code> chez {integration.name}.
                      </div>
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
                  </div>
                )}

                <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
                  {isConnected
                    ? <button onClick={() => void handleDisconnect(integration)} style={dangerButtonStyle}>Déconnecter</button>
                    : <>
                      <button
                        disabled={isPending || isConnectingToken}
                        onClick={() => void handleConnect(integration)}
                        style={connectButtonStyle}
                      >
                        {needsMoreScopes && !isPending ? 'Étendre les autorisations Microsoft 365' : connectLabel(integration, isPending)}
                      </button>
                      {!panelOpen && (
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
        </div>
      </> : <div className="extension-grid integrations-mcp-grid">
        <section className="extension-list">
          <h2>Serveurs configurés <small>{servers.length}</small></h2>
          <p className="settings-note">Serveurs MCP avancés pour des outils ou connecteurs personnalisés. Les intégrations GitHub, Slack, Microsoft, etc. passent par OAuth ci-dessus.</p>
          {servers.length === 0 ? <div className="task-empty">Aucun serveur MCP.</div> : servers.map(server => <article className="extension-card" key={server.name}>
            <div><strong>{server.name}</strong><span>{server.transport}</span></div><p>{server.commandOrUrl}</p>
            <div className="settings-actions"><label className="mini-toggle"><input type="checkbox" checked={server.enabled} onChange={async event => { await setMcpServerEnabled(server.name, event.target.checked); await loadMcp() }} /> Actif</label><button className="danger-link" onClick={async () => { if (confirm(`Supprimer le serveur ${server.name} ?`)) { await deleteMcpServer(server.name); await loadMcp() } }}>Supprimer</button></div>
          </article>)}
        </section>
        <section className="extension-editor">
          <h2>Ajouter un serveur MCP</h2>
          <label>Nom<input value={mcpForm.name} onChange={event => setMcpForm(value => ({ ...value, name: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} placeholder="mon-serveur" /></label>
          <label>Transport<select value={mcpForm.transport} onChange={event => setMcpForm(value => ({ ...value, transport: event.target.value }))}><option value="stdio">stdio</option><option value="http">HTTP</option><option value="sse">SSE</option></select></label>
          <label>{mcpForm.transport === 'stdio' ? 'Commande' : 'URL'}<input value={mcpForm.commandOrUrl} onChange={event => setMcpForm(value => ({ ...value, commandOrUrl: event.target.value }))} placeholder={mcpForm.transport === 'stdio' ? '/chemin/serveur' : 'https://…'} /></label>
          {mcpForm.transport === 'stdio' && <label>Arguments<input value={mcpForm.args} onChange={event => setMcpForm(value => ({ ...value, args: event.target.value }))} placeholder="--option valeur" /></label>}
          <button className="btn-primary" disabled={!mcpForm.name || !mcpForm.commandOrUrl} onClick={() => void persistMcp()}>Ajouter avec Bob Shell</button>
        </section>
      </div>}

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
