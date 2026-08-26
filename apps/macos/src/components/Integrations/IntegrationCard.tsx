import { useT } from '../../i18n'
import { PluginIcon, resolveIntegrationIcon } from '../PluginIcon'
import { ConnectionTestBadge } from './ConnectionTestBadge'
import type { IntegrationDef } from '../../views/IntegrationsTabs/catalogData'
import type { IntegrationConnectionStatus } from '../../lib/ipc'
import { isPkcePublicProvider } from '../../hooks/useIntegrations'

const connectButtonStyle = { flex: 1, padding: '7px 0', borderRadius: 99, fontSize: 12, fontWeight: 500, border: 'none', background: 'var(--accent)', color: 'white', cursor: 'pointer' }
const secondaryButtonStyle = { ...connectButtonStyle, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
const dangerButtonStyle = { ...connectButtonStyle, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444' }
const ghostButtonStyle = { ...connectButtonStyle, background: 'transparent', color: 'var(--text-muted)', border: 'none' }
const fieldLabelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 11.5, color: 'var(--text-secondary)' }
const fieldInputStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }

const MCP_BY_PROVIDER: Record<string, string> = {
  github: 'bob-work-github',
  slack: 'bob-work-slack',
  monday: 'bob-work-monday',
  microsoft: 'bob-work-microsoft',
}

function connectLabel(integration: IntegrationDef, pending: boolean) {
  if (pending) return 'Connexion en cours…'
  if (integration.oauthProvider === 'microsoft') return 'Connecter avec Microsoft 365'
  return `Connecter avec ${integration.name}`
}

export function IntegrationCard({
  integration,
  info,
  isConnected,
  isPending,
  isConnectingToken,
  panelOpen,
  needsMoreScopes,
  oauthForm,
  tokenForm,
  highlightProvider,
  deviceCode,
  mcpTestBusy,
  setOauthForms,
  setTokenForms,
  handleConnect,
  handleSaveOAuthAndConnect,
  handleConnectWithToken,
  handleDisconnect,
  openConnectPanel,
  setConnectPanelId,
  setDeviceCode,
  setPendingOAuth,
  testIntegrationMcp,
}: any) {
  const t = useT()
  const integrationName = (item: IntegrationDef) =>
    item.id === 'outlook-calendar' ? t('integrations.outlookCalendar') : item.name

  return (
    <div
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
          {integration.permissions.map((permission: string) => <li key={permission}>{permission}</li>)}
        </ul>
      </div>
      {integration.tools && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{integration.tools.map((tool: string) => <span key={tool} style={{ fontSize: 10.5, background: 'var(--bg-hover)', padding: '2px 7px', borderRadius: 4, color: 'var(--text-muted)', fontFamily: '"SF Mono", monospace' }}>{tool}</span>)}</div>}

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
                onChange={event => setOauthForms((current: any) => ({
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
                  onChange={event => setOauthForms((current: any) => ({
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
                    onChange={event => setOauthForms((current: any) => ({
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
                onChange={event => setTokenForms((current: any) => ({
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
                onChange={event => setTokenForms((current: any) => ({
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
              onClick={() => testIntegrationMcp(integration.id, MCP_BY_PROVIDER[integration.oauthProvider])}
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
  )
}
