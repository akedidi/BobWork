import { useT } from '../../i18n'
import { ConnectionOkPastille, ConnectionTestBadge } from '../../components/Integrations/ConnectionTestBadge'
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
  editMcp,
  cancelMcpEdit,
}: any) {
  const t = useT()
  const dialog = useAppDialog()
  const orderedServers = [...servers].sort((left: any, right: any) =>
    Number(Boolean(left.builtin)) - Number(Boolean(right.builtin))
      || left.name.localeCompare(right.name),
  )
  return (
    <div className="extension-grid integrations-mcp-grid">
      <section className="extension-list">
        <h2>{t('integrations.mcpConfigured')} <small>{servers.length}</small></h2>
        <p className="settings-note">
          {t('integrations.mcpListHint')}
        </p>
        {servers.length === 0 ? <div className="task-empty">{t('integrations.mcpEmpty')}</div> : orderedServers.map((server: any) => (
          <article className={`extension-card${server.lastTest?.ok ? ' is-test-ok' : ''}`} key={server.name} data-testid={`mcp-server-${server.name}`}>
            <div>
              <span className="extension-card-title">
                <strong>{server.name}</strong>
                {server.builtin ? <span className="skill-builtin-badge">{t('integrations.mcpBuiltin')}</span> : null}
                <ConnectionOkPastille test={server.lastTest} />
              </span>
              <span className="extension-card-tag">{server.transport}{(hasAuthHeaders(server) || hasEnvSecrets(server)) ? ` · ${t('integrations.mcpAuth')}` : ''}</span>
              <ConnectionTestBadge test={server.lastTest} />
            </div>
            <p>{server.commandOrUrl}</p>
            {server.lastTest && (
              <p className={server.lastTest.ok ? 'status-ok' : 'plugin-version-warning'} role={server.lastTest.ok ? undefined : 'alert'}>
                {server.lastTest.message}
              </p>
            )}
            <div className="settings-actions">
              {!server.builtin ? <label className="mini-toggle">
                <input type="checkbox" checked={server.enabled} onChange={async event => { await setMcpServerEnabled(server.name, event.target.checked); await loadMcp() }} /> {t('common.active')}
              </label> : <span className="settings-note">{t('integrations.mcpManagedBuiltin')}</span>}
              <button
                className="secondary-btn"
                disabled={mcpTestBusy === server.name}
                onClick={() => testServerMcp(server.name)}
              >
                {mcpTestBusy === server.name ? t('common.testingShort') : t('common.test')}
              </button>
              {!server.builtin ? <>
                <button className="secondary-btn" onClick={() => editMcp(server)}>{t('common.edit')}</button>
                <button className="danger-link" onClick={async () => { if (await dialog.confirm({ message: t('integrations.deleteMcpConfirm', { name: server.name }), confirmLabel: t('common.delete'), destructive: true })) { await deleteMcpServer(server.name); await loadMcp() } }}>{t('common.delete')}</button>
              </> : null}
            </div>
          </article>
        ))}
      </section>
      <section className="extension-editor">
        <h2>{mcpForm.originalName ? t('integrations.mcpEdit') : t('integrations.mcpAdd')}</h2>
        <p className="settings-note">{t('integrations.mcpAddHint')}</p>
        <AddMcpForm mcpForm={mcpForm} setMcpForm={setMcpForm} persistMcp={persistMcp} cancelEdit={cancelMcpEdit} />
      </section>
    </div>
  )
}
