import { useT } from '../../i18n'
import { IntegrationCard } from '../../components/Integrations/IntegrationCard'
import { AddOauthMcpForm } from '../../components/Integrations/ConnectorForms'
import type { IntegrationDef } from './catalogData'
import type { IntegrationFilter } from '../IntegrationsView'

export function IntegrationsCatalogTab({
  filter,
  setFilter,
  integrationGroups,
  visible,
  statuses,
  pendingOAuth,
  connectingToken,
  connectingSsh,
  connectPanelId,
  oauthForms,
  tokenForms,
  authModeForms,
  highlightProvider,
  deviceCode,
  mcpTestBusy,
  setOauthForms,
  setTokenForms,
  setAuthModeForms,
  handleConnect,
  handleStartOAuth,
  handleSaveOAuthAndConnect,
  handleConnectWithToken,
  handleConnectWithSsh,
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
  const filters: Array<[IntegrationFilter, string]> = [['all', t('integrations.filterAll')]]
  if ((integrationGroups as IntegrationDef['group'][]).includes('developer')) {
    filters.push(['developer', t('integrations.filterDeveloper')])
  }
  const showFilters = filters.length > 1

  return (
    <>
      {showFilters ? (
        <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6, flexShrink: 0 }}>
          {filters.map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} style={{
              padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              border: '1px solid var(--border)', background: filter === key ? 'var(--accent)' : 'var(--bg-surface)',
              color: filter === key ? 'white' : 'var(--text-secondary)',
            }}>{label}</button>
          ))}
        </div>
      ) : null}

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
              connectingSsh={connectingSsh === integration.id}
              panelOpen={connectPanelId === integration.id}
              needsMoreScopes={!statuses[integration.id]?.connected && statuses[integration.id]?.scopeSatisfied === false}
              oauthForm={oauthForms[integration.id] ?? { clientId: '', clientSecret: '' }}
              tokenForm={tokenForms[integration.id] ?? { token: '', label: '' }}
              authModeForm={authModeForms[integration.id]}
              highlightProvider={highlightProvider}
              deviceCode={deviceCode}
              mcpTestBusy={mcpTestBusy}
              setOauthForms={setOauthForms}
              setTokenForms={setTokenForms}
              setAuthModeForms={setAuthModeForms}
              handleConnect={handleConnect}
              handleStartOAuth={handleStartOAuth}
              handleSaveOAuthAndConnect={handleSaveOAuthAndConnect}
              handleConnectWithToken={handleConnectWithToken}
              handleConnectWithSsh={handleConnectWithSsh}
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
