import { useT } from '../../i18n'
import { IntegrationCard } from '../../components/Integrations/IntegrationCard'
import { AddOauthMcpForm } from '../../components/Integrations/ConnectorForms'

export function IntegrationsCatalogTab({
  filter,
  setFilter,
  microsoftNeedsEntra,
  visible,
  statuses,
  pendingOAuth,
  connectingToken,
  connectPanelId,
  oauthForms,
  tokenForms,
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
  oauthMcpForm,
  setOauthMcpForm,
  persistOauthMcp,
}: any) {
  const t = useT()
  return (
    <>
      <div className="settings-warning" style={{ margin: '0 20px 12px', maxWidth: 980 }}>
        {t('integrations.catalogIntro')}
      </div>
      {microsoftNeedsEntra && (filter === 'all' || filter === 'productivity') && (
        <p className="settings-warning" role="status" style={{ margin: '0 20px 12px', maxWidth: 980 }}>
          {t('integrations.entraRequired')}
        </p>
      )}

      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6, flexShrink: 0 }}>
        {([['all', t('integrations.filterAll')], ['productivity', t('integrations.filterMicrosoft')], ['developer', t('integrations.filterDeveloper')]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            border: '1px solid var(--border)', background: filter === key ? 'var(--accent)' : 'var(--bg-surface)',
            color: filter === key ? 'white' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
        <h3 className="connector-section-title">{t('integrations.catalogTitle')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10, maxWidth: 980 }}>
          {visible.map((integration: any) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              info={statuses[integration.id]}
              isConnected={!!statuses[integration.id]?.connected}
              isPending={pendingOAuth === integration.id}
              isConnectingToken={connectingToken === integration.id}
              panelOpen={connectPanelId === integration.id}
              needsMoreScopes={!statuses[integration.id]?.connected && statuses[integration.id]?.scopeSatisfied === false}
              oauthForm={oauthForms[integration.id] ?? { clientId: '', clientSecret: '' }}
              tokenForm={tokenForms[integration.id] ?? { token: '', label: '' }}
              highlightProvider={highlightProvider}
              deviceCode={deviceCode}
              mcpTestBusy={mcpTestBusy}
              setOauthForms={setOauthForms}
              setTokenForms={setTokenForms}
              handleConnect={handleConnect}
              handleSaveOAuthAndConnect={handleSaveOAuthAndConnect}
              handleConnectWithToken={handleConnectWithToken}
              handleDisconnect={handleDisconnect}
              openConnectPanel={openConnectPanel}
              setConnectPanelId={setConnectPanelId}
              setDeviceCode={setDeviceCode}
              setPendingOAuth={setPendingOAuth}
              testIntegrationMcp={testIntegrationMcp}
            />
          ))}
        </div>
        <AddOauthMcpForm oauthMcpForm={oauthMcpForm} setOauthMcpForm={setOauthMcpForm} persistOauthMcp={persistOauthMcp} />
      </div>
    </>
  )
}
