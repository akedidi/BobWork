import { ConnectionTestBadge } from '../../components/Integrations/ConnectionTestBadge'
import { AddPublicApiForm, AddApiKeyForm } from '../../components/Integrations/ConnectorForms'
import { hasAuthHeaders, hasEnvSecrets } from '../../hooks/useMcpServers'

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
}: any) {
  return (
    <div className="extension-grid integrations-mcp-grid connector-apis-grid">
      {(classified.publicApis.length > 0 || classified.keyedApis.length > 0) && (
        <section className="connector-panel" style={{ gridColumn: '1 / -1' }}>
          <h3 className="connector-section-title">APIs configurées <small>{classified.publicApis.length + classified.keyedApis.length}</small></h3>
          <div className="connector-mini-list">
            {[...classified.keyedApis, ...classified.publicApis].map((server: any) => (
              <div key={server.name} className="connector-mini-row">
                <span>{server.name}</span>
                <div className="connector-mini-meta">
                  <ConnectionTestBadge test={server.lastTest} compact />
                  <button
                    className="link-btn"
                    disabled={mcpTestBusy === server.name}
                    onClick={() => testServerMcp(server.name)}
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
        <AddPublicApiForm publicApiForm={publicApiForm} setPublicApiForm={setPublicApiForm} persistPublicApi={persistPublicApi} />
        {classified.publicApis.length > 0 && (
          <div className="connector-mini-list" style={{ marginTop: 12 }}>
            <strong>Déjà configurées</strong>
            {classified.publicApis.map((server: any) => (
              <div key={server.name} className="connector-mini-row">
                <span>{server.name}</span>
                <div className="connector-mini-meta">
                  <ConnectionTestBadge test={server.lastTest} compact />
                  <button
                    className="link-btn"
                    disabled={mcpTestBusy === server.name}
                    onClick={() => testServerMcp(server.name)}
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
        <AddApiKeyForm apiKeyForm={apiKeyForm} setApiKeyForm={setApiKeyForm} persistApiKey={persistApiKey} />
      </section>
    </div>
  )
}
