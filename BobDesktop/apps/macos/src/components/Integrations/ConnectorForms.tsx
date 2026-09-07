import { createEnvironmentField, environmentFieldsAreValid, slugifyName } from '../../hooks/useConnectorForms'
import { useT } from '../../i18n'

const fieldLabelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 11.5, color: 'var(--text-secondary)' }
const fieldInputStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }

export function AddOauthMcpForm({ oauthMcpForm, setOauthMcpForm, persistOauthMcp }: any) {
  const t = useT()
  return (
    <section className="connector-panel" style={{ marginTop: 28, maxWidth: 640 }}>
      <h3 className="connector-section-title">{t('integrations.otherOauthTitle')}</h3>
      <p className="settings-note">
        {t('integrations.otherOauthHint')}
      </p>
      <label style={fieldLabelStyle}>{t('common.name')}
        <input value={oauthMcpForm.name} onChange={event => setOauthMcpForm((value: any) => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="mon-oauth-mcp" style={fieldInputStyle} />
      </label>
      <label style={fieldLabelStyle}>{t('integrations.transport')}
        <select value={oauthMcpForm.transport} onChange={event => setOauthMcpForm((value: any) => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
      </label>
      <label style={fieldLabelStyle}>{t('integrations.httpsUrl')}
        <input value={oauthMcpForm.url} onChange={event => setOauthMcpForm((value: any) => ({ ...value, url: event.target.value }))} placeholder="https://mcp.fournisseur.com/…" style={fieldInputStyle} />
      </label>
      <button className="btn-primary" disabled={!oauthMcpForm.name || !oauthMcpForm.url} onClick={() => void persistOauthMcp()}>
        {t('integrations.addConnector')}
      </button>
    </section>
  )
}

export function AddPublicApiForm({ publicApiForm, setPublicApiForm, persistPublicApi, cancelEdit }: any) {
  const t = useT()
  return (
    <>
      <label style={fieldLabelStyle}>{t('common.name')}
        <input value={publicApiForm.name} onChange={event => setPublicApiForm((value: any) => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="stooq-public" style={fieldInputStyle} />
      </label>
      <label style={fieldLabelStyle}>{t('integrations.transport')}
        <select value={publicApiForm.transport} onChange={event => setPublicApiForm((value: any) => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
      </label>
      <label style={fieldLabelStyle}>{t('integrations.httpsUrl')}
        <input value={publicApiForm.url} onChange={event => setPublicApiForm((value: any) => ({ ...value, url: event.target.value }))} placeholder="https://…" style={fieldInputStyle} />
      </label>
      <button className="btn-primary" disabled={!publicApiForm.name || !publicApiForm.url} onClick={() => void persistPublicApi()}>
        {publicApiForm.originalName ? t('common.save') : t('integrations.addPublicApi')}
      </button>
      {publicApiForm.originalName && <button className="secondary-btn" onClick={cancelEdit}>{t('common.cancel')}</button>}
    </>
  )
}

export function AddApiKeyForm({ apiKeyForm, setApiKeyForm, persistApiKey, cancelEdit }: any) {
  const t = useT()
  return (
    <>
      <label style={fieldLabelStyle}>{t('common.name')}
        <input value={apiKeyForm.name} onChange={event => setApiKeyForm((value: any) => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="tmdb" style={fieldInputStyle} />
      </label>
      <label style={fieldLabelStyle}>{t('integrations.transport')}
        <select value={apiKeyForm.transport} onChange={event => setApiKeyForm((value: any) => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
          <option value="http">HTTP</option>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">SSE</option>
        </select>
      </label>
      <label style={fieldLabelStyle}>{t('integrations.httpsUrl')}
        <input value={apiKeyForm.url} onChange={event => setApiKeyForm((value: any) => ({ ...value, url: event.target.value }))} placeholder="https://api.themoviedb.org/3/configuration" style={fieldInputStyle} />
      </label>
      <label style={fieldLabelStyle}>{t('integrations.authMode')}
        <select value={apiKeyForm.authMode} onChange={event => setApiKeyForm((value: any) => ({ ...value, authMode: event.target.value }))} style={fieldInputStyle}>
          <option value="query">{t('integrations.authQuery')}</option>
          <option value="bearer">{t('integrations.authBearer')}</option>
          <option value="header">{t('integrations.authHeader')}</option>
          <option value="env">{t('integrations.authEnv')}</option>
        </select>
      </label>
      {apiKeyForm.authMode === 'header' && (
        <label style={fieldLabelStyle}>{t('integrations.headerName')}
          <input value={apiKeyForm.headerName} onChange={event => setApiKeyForm((value: any) => ({ ...value, headerName: event.target.value }))} placeholder="X-Api-Key" style={fieldInputStyle} />
        </label>
      )}
      {apiKeyForm.authMode === 'query' && (
        <label style={fieldLabelStyle}>{t('integrations.queryName')}
          <input value={apiKeyForm.queryName} onChange={event => setApiKeyForm((value: any) => ({ ...value, queryName: event.target.value }))} placeholder="api_key" style={fieldInputStyle} />
        </label>
      )}
      {apiKeyForm.authMode === 'env' && (
        <label style={fieldLabelStyle}>{t('integrations.envName')}
          <input value={apiKeyForm.envName} onChange={event => setApiKeyForm((value: any) => ({ ...value, envName: event.target.value }))} placeholder="API_KEY" style={fieldInputStyle} />
        </label>
      )}
      <label style={fieldLabelStyle}>{t('integrations.keyOrToken')}
        <input type="password" value={apiKeyForm.secret} onChange={event => setApiKeyForm((value: any) => ({ ...value, secret: event.target.value }))} placeholder={apiKeyForm.originalName ? t('integrations.keepExistingSecret') : 'sk-… / token'} style={fieldInputStyle} />
      </label>
      <button className="btn-primary" disabled={!apiKeyForm.name || !apiKeyForm.url || (!apiKeyForm.secret && !apiKeyForm.originalName)} onClick={() => void persistApiKey()}>
        {apiKeyForm.originalName ? t('common.save') : t('integrations.addKeyedApi')}
      </button>
      {apiKeyForm.originalName && <button className="secondary-btn" onClick={cancelEdit}>{t('common.cancel')}</button>}
    </>
  )
}

export function AddMcpForm({ mcpForm, setMcpForm, persistMcp, cancelEdit }: any) {
  const t = useT()
  const updateEnvironmentField = (id: string, patch: Record<string, string>) => {
    setMcpForm((value: any) => ({
      ...value,
      envFields: value.envFields.map((field: any) => field.id === id ? { ...field, ...patch } : field),
    }))
  }
  const environmentValid = environmentFieldsAreValid(mcpForm.envFields)
  return (
    <>
      <label>{t('common.name')}<input value={mcpForm.name} onChange={event => setMcpForm((value: any) => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="mon-serveur" /></label>
      <label>{t('integrations.transport')}
        <select value={mcpForm.transport} onChange={event => setMcpForm((value: any) => ({ ...value, transport: event.target.value }))}>
          <option value="stdio">{t('integrations.stdioLocal')}</option>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
      </label>
      <label>{mcpForm.transport === 'stdio' ? t('integrations.command') : t('integrations.httpsUrl')}
        <input value={mcpForm.commandOrUrl} onChange={event => setMcpForm((value: any) => ({ ...value, commandOrUrl: event.target.value }))} placeholder={mcpForm.transport === 'stdio' ? 'python3' : 'https://…'} />
      </label>
      {mcpForm.transport === 'stdio' && (
        <label>{t('integrations.arguments')}<input value={mcpForm.args} onChange={event => setMcpForm((value: any) => ({ ...value, args: event.target.value }))} placeholder="server.py --flag" /></label>
      )}
      {mcpForm.transport === 'stdio' && (
        <details className="mcp-advanced-config" key={mcpForm.originalName || 'new'} open={mcpForm.originalName ? true : undefined}>
          <summary>{t('integrations.advancedOptional')}</summary>
          <p className="settings-note">{t('integrations.envVarsHint')}</p>
          <div className="mcp-environment-fields">
            {mcpForm.envFields.map((field: any) => (
              <div className="mcp-environment-row" key={field.id}>
                <input
                  aria-label={t('integrations.envKey')}
                  value={field.key}
                  onChange={event => updateEnvironmentField(field.id, { key: event.target.value })}
                  placeholder="API_TOKEN"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <input
                  aria-label={t('integrations.envValue')}
                  value={field.value}
                  onChange={event => updateEnvironmentField(field.id, { value: event.target.value })}
                  placeholder={field.persistedKey ? t('integrations.keepExistingValue') : '…'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="danger-link"
                  aria-label={t('integrations.removeEnvVar', { name: field.key || t('integrations.envVar') })}
                  onClick={() => setMcpForm((value: any) => ({ ...value, envFields: value.envFields.filter((item: any) => item.id !== field.id) }))}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="secondary-btn mcp-add-environment"
            onClick={() => setMcpForm((value: any) => ({ ...value, envFields: [...value.envFields, createEnvironmentField()] }))}
          >
            {t('integrations.addEnvVar')}
          </button>
          {!environmentValid && <p className="plugin-version-warning" role="alert">{t('integrations.invalidEnvVars')}</p>}
        </details>
      )}
      {mcpForm.transport !== 'stdio' && (
        <label>{t('integrations.httpHeaders')}
          <textarea value={mcpForm.headersText} onChange={event => setMcpForm((value: any) => ({ ...value, headersText: event.target.value }))} placeholder={'Authorization: Bearer …\nX-Api-Key: …'} rows={3} />
        </label>
      )}
      {mcpForm.originalName && <p className="settings-note">{t('integrations.keepExistingSecret')}</p>}
      <button className="btn-primary" disabled={!mcpForm.name || !mcpForm.commandOrUrl || !environmentValid} onClick={() => void persistMcp()}>{mcpForm.originalName ? t('common.save') : t('integrations.addWithBobShell')}</button>
      {mcpForm.originalName && <button className="secondary-btn" onClick={cancelEdit}>{t('common.cancel')}</button>}
    </>
  )
}
