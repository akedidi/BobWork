import { ConnectionOkPastille, ConnectionTestBadge } from '../../components/Integrations/ConnectionTestBadge'
import { AddPublicApiForm, AddApiKeyForm } from '../../components/Integrations/ConnectorForms'
import { hasAuthHeaders, hasEnvSecrets } from '../../hooks/useMcpServers'
import { useT } from '../../i18n'

export function ApisTab({
  classified,
  mcpTestBusy,
  testServerMcp,
  publicApiForm,
  setPublicApiForm,
  persistPublicApi,
  apiKeyForm,
  setApiKeyForm,
  persistApiKey,
  keyedApiPanelRef,
  highlightKeyedApi,
  editPublicApi,
  editKeyedApi,
  cancelPublicApiEdit,
  cancelKeyedApiEdit,
}: any) {
  const t = useT()
  return (
    <div className="extension-grid integrations-mcp-grid connector-apis-grid">
      {(classified.publicApis.length > 0 || classified.keyedApis.length > 0) && (
        <section className="connector-panel" style={{ gridColumn: '1 / -1' }}>
          <h3 className="connector-section-title">{t('integrations.configuredApis')} <small>{classified.publicApis.length + classified.keyedApis.length}</small></h3>
          <div className="connector-mini-list">
            {[...classified.keyedApis, ...classified.publicApis].map((server: any) => (
              <div key={server.name} className={`connector-mini-row${server.lastTest?.ok ? ' is-test-ok' : ''}`}>
                <span className="connector-mini-name">
                  {server.name}
                  <ConnectionOkPastille test={server.lastTest} />
                </span>
                <div className="connector-mini-meta">
                  <ConnectionTestBadge test={server.lastTest} compact />
                  <button
                    className="link-btn"
                    disabled={mcpTestBusy === server.name}
                    onClick={() => testServerMcp(server.name)}
                  >
                    {mcpTestBusy === server.name ? '…' : t('common.test')}
                  </button>
                  <button className="link-btn" onClick={() => hasAuthHeaders(server) || hasEnvSecrets(server) ? editKeyedApi(server) : editPublicApi(server)}>
                    {t('common.edit')}
                  </button>
                  <code>{server.transport}{(hasAuthHeaders(server) || hasEnvSecrets(server)) ? ' · auth' : ''}</code>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="connector-panel">
        <h3 className="connector-section-title">{publicApiForm.originalName ? t('integrations.publicApiEdit') : t('integrations.publicApiTitle')}</h3>
        <p className="settings-note">
          {t('integrations.publicApiHint')}
        </p>
        <AddPublicApiForm publicApiForm={publicApiForm} setPublicApiForm={setPublicApiForm} persistPublicApi={persistPublicApi} cancelEdit={cancelPublicApiEdit} />
        {classified.publicApis.length > 0 && (
          <div className="connector-mini-list" style={{ marginTop: 12 }}>
            <strong>{t('integrations.alreadyConfigured')}</strong>
            {classified.publicApis.map((server: any) => (
              <div key={server.name} className={`connector-mini-row${server.lastTest?.ok ? ' is-test-ok' : ''}`}>
                <span className="connector-mini-name">
                  {server.name}
                  <ConnectionOkPastille test={server.lastTest} />
                </span>
                <div className="connector-mini-meta">
                  <ConnectionTestBadge test={server.lastTest} compact />
                  <button
                    className="link-btn"
                    disabled={mcpTestBusy === server.name}
                    onClick={() => testServerMcp(server.name)}
                  >
                    {mcpTestBusy === server.name ? '…' : t('common.test')}
                  </button>
                  <button className="link-btn" onClick={() => editPublicApi(server)}>{t('common.edit')}</button>
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
        <h3 className="connector-section-title">{apiKeyForm.originalName ? t('integrations.keyedApiEdit') : t('integrations.keyedApiTitle')}</h3>
        <p className="settings-note">
          {t('integrations.keyedApiHint')}
        </p>
        <AddApiKeyForm apiKeyForm={apiKeyForm} setApiKeyForm={setApiKeyForm} persistApiKey={persistApiKey} cancelEdit={cancelKeyedApiEdit} />
      </section>
    </div>
  )
}
