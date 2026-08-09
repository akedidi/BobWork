// ============================================================
// Bob Work – Integrations & MCP
// Catalogue des connecteurs et serveurs MCP natifs Bob Shell.
// ============================================================

import { useEffect, useState } from 'react'
import {
  clearSessionSecret, deleteMcpServer, getMcpServers, hasSessionSecret,
  installBuiltinIntegration, saveMcpServer, setMcpServerEnabled, setSessionSecret,
} from '../lib/ipc'
import { PluginIcon, resolveIntegrationIcon } from '../components/PluginIcon'
import type { McpServer } from '@bob-work/shared-types'

interface IntegrationDef {
  id: string
  name: string
  description: string
  authType: 'connector' | 'apikey'
  tools?: string[]
  secretId: string
  tokenPlaceholder?: string
}

type PageTab = 'integrations' | 'mcp'
type IntegrationFilter = 'all' | 'connector' | 'apikey'

const CATALOG: IntegrationDef[] = [
  { id: 'outlook-mail', name: 'Outlook', description: 'Lire, rechercher et préparer des e-mails Outlook via Microsoft Graph.', authType: 'connector', tools: ['mail.search','mail.draft','mail.send'], secretId: 'integration_outlook' },
  { id: 'teams', name: 'Microsoft Teams', description: 'Accéder aux équipes, canaux, réunions et messages.', authType: 'connector', tools: ['teams.search','teams.message','meetings'], secretId: 'integration_teams' },
  { id: 'outlook-calendar', name: 'Outlook Calendar', description: 'Lire et gérer le calendrier Microsoft 365.', authType: 'connector', tools: ['calendar.read','calendar.create','calendar.update'], secretId: 'integration_outlook_calendar' },
  { id: 'onedrive', name: 'OneDrive', description: 'Rechercher, lire et déposer des fichiers OneDrive.', authType: 'connector', tools: ['files.search','files.read','files.write'], secretId: 'integration_onedrive' },
  { id: 'github', name: 'GitHub', description: 'Gérer les dépôts, issues, PRs et code.', authType: 'apikey', tools: ['repos','issues','pull_requests'], secretId: 'integration_github', tokenPlaceholder: 'github_pat_…' },
  { id: 'slack', name: 'Slack', description: 'Rechercher et envoyer des messages Slack.', authType: 'apikey', tools: ['search','channels','send_message'], secretId: 'integration_slack', tokenPlaceholder: 'xoxb-…' },
  { id: 'monday', name: 'Monday.com', description: 'Lire et mettre à jour tableaux, éléments et automatisations.', authType: 'apikey', tools: ['boards','items','updates'], secretId: 'integration_monday', tokenPlaceholder: 'Jeton API Monday.com' },
]

const AUTH_LABEL: Record<IntegrationDef['authType'], string> = { connector: 'Connecteur / OAuth', apikey: 'Jeton de session' }

export default function IntegrationsView() {
  const [tab, setTab] = useState<PageTab>('integrations')
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<IntegrationFilter>('all')
  const [apikeyModal, setApikeyModal] = useState<{ id: string; name: string; placeholder?: string } | null>(null)
  const [apikeyValue, setApikeyValue] = useState('')
  const [servers, setServers] = useState<McpServer[]>([])
  const [mcpForm, setMcpForm] = useState({ name: '', transport: 'stdio', commandOrUrl: '', args: '' })
  const [status, setStatus] = useState('')

  const loadMcp = async () => {
    const next = await getMcpServers().catch(() => [])
    setServers(next)
  }

  useEffect(() => {
    const checkAll = async () => {
      const results = await Promise.all(
        CATALOG.filter(c => c.authType === 'apikey').map(async c => ({ id: c.id, has: await hasSessionSecret(c.secretId).catch(() => false) }))
      )
      const connectedIds = new Set(results.filter(r => r.has).map(r => r.id))
      setConnected(connectedIds)
      await Promise.all([...connectedIds].map(id => installBuiltinIntegration(id).catch(() => null)))
    }
    void checkAll()
    void loadMcp()
  }, [])

  const handleConnect = (integration: IntegrationDef) => {
    if (integration.authType === 'apikey') {
      setApikeyModal({ id: integration.id, name: integration.name, placeholder: integration.tokenPlaceholder })
      return
    }
    setTab('mcp')
    setStatus('Configurez ici le connecteur ou serveur MCP officiel fourni par le service.')
  }

  const handleSaveApiKey = async () => {
    if (!apikeyModal || !apikeyValue.trim()) return
    const integration = CATALOG.find(item => item.id === apikeyModal.id)!
    await setSessionSecret(integration.secretId, apikeyValue.trim())
    await installBuiltinIntegration(integration.id).catch(() => {})
    setConnected(previous => new Set(previous).add(apikeyModal.id))
    setApikeyModal(null)
    setApikeyValue('')
  }

  const handleDisconnect = async (integration: IntegrationDef) => {
    if (!confirm(`Déconnecter ${integration.name} ? Le jeton sera effacé du coffre local chiffré.`)) return
    await clearSessionSecret(integration.secretId)
    setConnected(previous => { const next = new Set(previous); next.delete(integration.id); return next })
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

  const visible = filter === 'all' ? CATALOG : CATALOG.filter(integration => integration.authType === filter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="topbar titlebar-drag">
        <span className="titlebar-no-drag" style={{ fontWeight: 600, fontSize: 14 }}>Intégrations et MCP</span>
        {tab === 'integrations' && <span className="titlebar-no-drag" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {connected.size} connexion{connected.size !== 1 ? 's' : ''} enregistrée{connected.size !== 1 ? 's' : ''}
        </span>}
      </div>

      <div className="extensions-tabs">
        <button className={`filter-pill ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>Intégrations</button>
        <button className={`filter-pill ${tab === 'mcp' ? 'active' : ''}`} onClick={() => setTab('mcp')}>Serveurs MCP</button>
      </div>

      {tab === 'integrations' ? <>
        <div className="settings-warning" style={{ margin: '0 20px 12px', maxWidth: 980 }}>
          Bob Work n’utilise pas le Trousseau macOS. Les jetons manuels sont conservés dans un coffre local chiffré sur ce Mac et restent disponibles après redémarrage de l’application. Microsoft 365 et les connexions OAuth passent par un connecteur MCP réel.
        </div>

        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6, flexShrink: 0 }}>
          {([['all','Toutes'],['connector','Connecteurs'],['apikey','Jetons']] as const).map(([key, label]) => (
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
              const isConnected = connected.has(integration.id)
              return <div key={integration.id} style={{ background: 'var(--bg-surface)', border: `1px solid ${isConnected ? '#22c55e60' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <PluginIcon icon={resolveIntegrationIcon(integration.id)} size="lg" label={integration.name} />
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{integration.name}</div><span style={{ fontSize: 11, background: 'var(--bg-hover)', padding: '2px 7px', borderRadius: 99, color: 'var(--text-secondary)' }}>{AUTH_LABEL[integration.authType]}</span></div>
                  {isConnected && <span className="status-dot green" />}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{integration.description}</p>
                {integration.tools && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{integration.tools.map(tool => <span key={tool} style={{ fontSize: 10.5, background: 'var(--bg-hover)', padding: '2px 7px', borderRadius: 4, color: 'var(--text-muted)', fontFamily: '"SF Mono", monospace' }}>{tool}</span>)}</div>}
                <div style={{ marginTop: 'auto' }}>
                  {isConnected
                    ? <button onClick={() => handleDisconnect(integration)} style={dangerButtonStyle}>Déconnecter</button>
                    : <button onClick={() => handleConnect(integration)} style={connectButtonStyle}>{integration.authType === 'apikey' ? 'Enregistrer un jeton' : 'Configurer le connecteur'}</button>}
                </div>
              </div>
            })}
          </div>
        </div>
      </> : <div className="extension-grid integrations-mcp-grid">
        <section className="extension-list">
          <h2>Serveurs configurés <small>{servers.length}</small></h2>
          <p className="settings-note">L’ajout, l’activation et la suppression passent par les commandes MCP natives de Bob Shell 2.</p>
          {servers.length === 0 ? <div className="task-empty">Aucun serveur MCP.</div> : servers.map(server => <article className="extension-card" key={server.name}>
            <div><strong>{server.name}</strong><span>{server.transport}</span></div><p>{server.commandOrUrl}</p>
            <div className="settings-actions"><label className="mini-toggle"><input type="checkbox" checked={server.enabled} onChange={async event => { await setMcpServerEnabled(server.name, event.target.checked); await loadMcp() }} /> Actif</label><button className="danger-link" onClick={async () => { if (confirm(`Supprimer le serveur ${server.name} ?`)) { await deleteMcpServer(server.name); await loadMcp() } }}>Supprimer</button></div>
          </article>)}
        </section>
        <section className="extension-editor">
          <h2>Ajouter un serveur MCP</h2>
          <label>Nom<input value={mcpForm.name} onChange={event => setMcpForm(value => ({ ...value, name: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} placeholder="mon-serveur" /></label>
          <label>Transport<select value={mcpForm.transport} onChange={event => setMcpForm(value => ({ ...value, transport: event.target.value }))}><option value="stdio">stdio</option><option value="http">HTTP</option><option value="sse">SSE</option></select></label>
          <label>{mcpForm.transport === 'stdio' ? 'Commande' : 'URL'}<input value={mcpForm.commandOrUrl} onChange={event => setMcpForm(value => ({ ...value, commandOrUrl: event.target.value }))} placeholder={mcpForm.transport === 'stdio' ? '/chemin/serveur' : 'https://…'} /></label>
          {mcpForm.transport === 'stdio' && <label>Arguments<input value={mcpForm.args} onChange={event => setMcpForm(value => ({ ...value, args: event.target.value }))} placeholder="--option valeur" /></label>}
          <button className="btn-primary" disabled={!mcpForm.name || !mcpForm.commandOrUrl} onClick={persistMcp}>Ajouter avec Bob Shell</button>
          <div className="settings-warning" style={{ marginTop: 16 }}>Computer Use et Chrome ne sont pas simulés : ils deviennent actifs uniquement après ajout d’une extension/MCP compatible et autorisation macOS explicite.</div>
        </section>
      </div>}

      {status && <div className="settings-status">{status}</div>}

      {apikeyModal && <div style={modalBackdropStyle}>
        <div style={modalStyle}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Connecter {apikeyModal.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>Le jeton sera enregistré dans le coffre local chiffré de Bob Work sur ce Mac. Il reste disponible après redémarrage, n’utilise pas le Trousseau macOS et n’est jamais écrit en clair dans SQLite ou les journaux.</div>
          <input autoFocus type="password" value={apikeyValue} onChange={event => setApikeyValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void handleSaveApiKey() }} placeholder={apikeyModal.placeholder ?? 'Collez votre clé API ici…'} style={secretInputStyle} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => { setApikeyModal(null); setApikeyValue('') }} className="secondary-btn">Annuler</button>
            <button onClick={handleSaveApiKey} disabled={!apikeyValue.trim()} className="btn-primary">Enregistrer</button>
          </div>
        </div>
      </div>}
    </div>
  )
}

const connectButtonStyle = { width: '100%', padding: '7px 0', borderRadius: 99, fontSize: 12, fontWeight: 500, border: 'none', background: 'var(--accent)', color: 'white', cursor: 'pointer' }
const dangerButtonStyle = { ...connectButtonStyle, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444' }
const modalBackdropStyle = { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const modalStyle = { background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: 28, width: 420, maxWidth: '90vw' }
const secretInputStyle = { width: '100%', padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-surface)', fontSize: 13, fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: 16, boxSizing: 'border-box' as const }
