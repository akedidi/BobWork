import { useT } from '../../i18n'
import { ConnectionTestBadge } from '../../components/Integrations/ConnectionTestBadge'
import { AddMcpForm } from '../../components/Integrations/ConnectorForms'
import { hasAuthHeaders, hasEnvSecrets } from '../../hooks/useMcpServers'
import { setMcpServerEnabled, deleteMcpServer } from '../../lib/ipc'
import { useAppDialog } from '../../components/AppDialog'

export function McpProtocolsTab({
  servers,
  mcpTestBusy,
  testServerMcp,
  loadMcp,
  mcpForm,
  setMcpForm,
  persistMcp,
}: any) {
  const t = useT()
  const dialog = useAppDialog()
  return (
    <div className="extension-grid integrations-mcp-grid">
      <section className="extension-list">
        <h2>Serveurs configurés <small>{servers.length}</small></h2>
        <p className="settings-note">
          Tous les connecteurs MCP (OAuth sync, APIs, stdio local). Protocoles : stdio, HTTP, SSE, streamable-http.
        </p>
        {servers.length === 0 ? <div className="task-empty">Aucun serveur MCP.</div> : servers.map((server: any) => (
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
                onClick={() => testServerMcp(server.name)}
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
        <AddMcpForm mcpForm={mcpForm} setMcpForm={setMcpForm} persistMcp={persistMcp} />
      </section>
    </div>
  )
}
