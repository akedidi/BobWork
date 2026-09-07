import { useT } from '../../i18n'
import { PluginIcon, resolveIntegrationIcon } from '../PluginIcon'
import { ConnectionOkPastille, ConnectionTestBadge } from './ConnectionTestBadge'
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

function connectLabel(t: (key: string, params?: Record<string, string | number>) => string, integration: IntegrationDef, pending: boolean) {
  if (pending) return t('integrations.connectPending')
  if (integration.oauthProvider === 'microsoft') return t('integrations.connectMicrosoft')
  return t('integrations.connectWith', { name: integration.name })
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
            {info?.authMethod === 'token' ? t('common.token') : t('common.oauth')}
          </span>
        </div>
        {info?.lastTest?.ok ? <ConnectionOkPastille test={info.lastTest} /> : isConnected ? <span className="status-dot green" /> : null}
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
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{t(integration.descriptionKey)}</p>
      {info?.lastTest && (
        <p style={{ fontSize: 11.5, color: info.lastTest.ok ? 'var(--text-muted)' : 'var(--danger)', margin: 0 }}>
          {info.lastTest.message}
        </p>
      )}
      {needsMoreScopes && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          {t('integrations.needsMoreScopes', { name: integrationName(integration) })}
        </p>
      )}
      {!isConnected && integration.oauthProvider === 'microsoft' && info && !info.oauthClientConfigured && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          {t('integrations.entraRequired')}
        </p>
      )}
      {info?.accountLabel && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('integrations.accountLabel', { label: info.accountLabel })}</p>}
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {t('integrations.requestedPermissions')}
        <ul style={{ margin: '4px 0 0', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {integration.permissionKeys.map((permission: string) => <li key={permission}>{t(permission)}</li>)}
        </ul>
      </div>
      {integration.tools && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{integration.tools.map((tool: string) => <span key={tool} style={{ fontSize: 10.5, background: 'var(--bg-hover)', padding: '2px 7px', borderRadius: 4, color: 'var(--text-muted)', fontFamily: '"SF Mono", monospace' }}>{tool}</span>)}</div>}

      {deviceCode?.integrationId === integration.id && !isConnected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 10, background: 'var(--bg-hover)', border: '1px solid var(--accent)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{t('integrations.deviceCodeCopied')}</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, fontFamily: '"SF Mono", monospace', textAlign: 'center' }}>{deviceCode.userCode}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {t('integrations.deviceCodeHint', { host: deviceCode.verificationUri.replace('https://', '') })}
          </div>
          <button onClick={() => { setDeviceCode(null); setPendingOAuth(null) }} style={ghostButtonStyle}>{t('common.cancel')}</button>
        </div>
      )}

      {panelOpen && !isConnected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, background: 'var(--bg-hover)' }}>
          {integration.oauthProvider === 'slack' && !info?.oauthClientConfigured && <>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t('integrations.slackClientOnce')}</div>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
              {t('integrations.slackSetupHint')}
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
              {isPending ? t('common.opening') : t('integrations.saveAndOpenSlack')}
            </button>
            <button onClick={() => setConnectPanelId(null)} style={ghostButtonStyle}>{t('common.cancel')}</button>
          </>}

          {integration.oauthProvider !== 'slack' && !integration.webOnly && <>
            {!info?.oauthClientConfigured && <>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {isPkcePublicProvider(integration.oauthProvider)
                  ? (integration.oauthProvider === 'microsoft' ? t('integrations.clientIdEntra') : t('integrations.clientIdOauthPkce'))
                  : t('integrations.optionOauthApp')}
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
                      : t('integrations.oauthAppIdPlaceholder')
                  }
                  style={fieldInputStyle}
                />
              </label>
              {!isPkcePublicProvider(integration.oauthProvider) && (
                <label style={fieldLabelStyle}>
                  {integration.oauthProvider === 'github' ? t('integrations.clientSecret') : t('integrations.clientSecretOptional')}
                  <input
                    type="password"
                    value={oauthForm.clientSecret}
                    onChange={event => setOauthForms((current: any) => ({
                      ...current,
                      [integration.id]: { ...oauthForm, clientSecret: event.target.value },
                    }))}
                    placeholder={t('integrations.clientSecretPlaceholder')}
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
                  ? t('common.opening')
                  : isPkcePublicProvider(integration.oauthProvider)
                    ? connectLabel(t, integration, false)
                    : t('integrations.saveAndConnectOauth')}
              </button>
              <div style={{ height: 1, background: 'var(--border)' }} />
            </>}
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {info?.oauthClientConfigured ? t('integrations.connected') : t('integrations.optionPersonalToken')}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>{t(integration.tokenHintKey)}</p>
            <label style={fieldLabelStyle}>
              {t('integrations.accessToken')}
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
              {t('integrations.accountLabelOptional')}
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
              {isConnectingToken ? t('common.connecting') : t('integrations.connectWithToken')}
            </button>
            <button onClick={() => setConnectPanelId(null)} style={ghostButtonStyle}>{t('common.cancel')}</button>
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
              {mcpTestBusy === integration.id ? t('common.testingShort') : t('common.test')}
            </button>
            <button onClick={() => void handleDisconnect(integration)} style={dangerButtonStyle}>{t('integrations.disconnect')}</button>
          </>
          : <>
            <button
              disabled={isPending || isConnectingToken}
              onClick={() => void handleConnect(integration)}
              style={connectButtonStyle}
            >
              {needsMoreScopes && !isPending ? t('integrations.extendMicrosoftScopes') : connectLabel(t, integration, isPending)}
            </button>
            {!integration.webOnly && !panelOpen && (
              <button
                disabled={isPending || isConnectingToken}
                onClick={() => void openConnectPanel(integration)}
                style={secondaryButtonStyle}
              >
                {t('common.token')}
              </button>
            )}
          </>}
      </div>
    </div>
  )
}
