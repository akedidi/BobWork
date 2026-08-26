import { slugifyName } from '../../hooks/useConnectorForms'

const fieldLabelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 11.5, color: 'var(--text-secondary)' }
const fieldInputStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }

export function AddOauthMcpForm({ oauthMcpForm, setOauthMcpForm, persistOauthMcp }: any) {
  return (
    <section className="connector-panel" style={{ marginTop: 28, maxWidth: 640 }}>
      <h3 className="connector-section-title">Autre OAuth / MCP distant</h3>
      <p className="settings-note">
        Pour un fournisseur hors catalogue (MCP hébergé avec OAuth type Monday, ou endpoint streamable-http).
        Bob Work n’invente pas d’OAuth : le serveur distant gère l’autorisation.
      </p>
      <label style={fieldLabelStyle}>Nom
        <input value={oauthMcpForm.name} onChange={event => setOauthMcpForm((value: any) => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="mon-oauth-mcp" style={fieldInputStyle} />
      </label>
      <label style={fieldLabelStyle}>Transport
        <select value={oauthMcpForm.transport} onChange={event => setOauthMcpForm((value: any) => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
      </label>
      <label style={fieldLabelStyle}>URL HTTPS
        <input value={oauthMcpForm.url} onChange={event => setOauthMcpForm((value: any) => ({ ...value, url: event.target.value }))} placeholder="https://mcp.fournisseur.com/…" style={fieldInputStyle} />
      </label>
      <button className="btn-primary" disabled={!oauthMcpForm.name || !oauthMcpForm.url} onClick={() => void persistOauthMcp()}>
        Ajouter le connecteur
      </button>
    </section>
  )
}

export function AddPublicApiForm({ publicApiForm, setPublicApiForm, persistPublicApi }: any) {
  return (
    <>
      <label style={fieldLabelStyle}>Nom
        <input value={publicApiForm.name} onChange={event => setPublicApiForm((value: any) => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="stooq-public" style={fieldInputStyle} />
      </label>
      <label style={fieldLabelStyle}>Transport
        <select value={publicApiForm.transport} onChange={event => setPublicApiForm((value: any) => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
      </label>
      <label style={fieldLabelStyle}>URL HTTPS
        <input value={publicApiForm.url} onChange={event => setPublicApiForm((value: any) => ({ ...value, url: event.target.value }))} placeholder="https://…" style={fieldInputStyle} />
      </label>
      <button className="btn-primary" disabled={!publicApiForm.name || !publicApiForm.url} onClick={() => void persistPublicApi()}>
        Ajouter l’API publique
      </button>
    </>
  )
}

export function AddApiKeyForm({ apiKeyForm, setApiKeyForm, persistApiKey }: any) {
  return (
    <>
      <label style={fieldLabelStyle}>Nom
        <input value={apiKeyForm.name} onChange={event => setApiKeyForm((value: any) => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="tmdb" style={fieldInputStyle} />
      </label>
      <label style={fieldLabelStyle}>Transport
        <select value={apiKeyForm.transport} onChange={event => setApiKeyForm((value: any) => ({ ...value, transport: event.target.value }))} style={fieldInputStyle}>
          <option value="http">HTTP</option>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">SSE</option>
        </select>
      </label>
      <label style={fieldLabelStyle}>URL HTTPS
        <input value={apiKeyForm.url} onChange={event => setApiKeyForm((value: any) => ({ ...value, url: event.target.value }))} placeholder="https://api.themoviedb.org/3/configuration" style={fieldInputStyle} />
      </label>
      <label style={fieldLabelStyle}>Mode d’auth
        <select value={apiKeyForm.authMode} onChange={event => setApiKeyForm((value: any) => ({ ...value, authMode: event.target.value }))} style={fieldInputStyle}>
          <option value="query">Paramètre d’URL (?api_key=…)</option>
          <option value="bearer">Authorization: Bearer …</option>
          <option value="header">En-tête personnalisé</option>
          <option value="env">Variable d’environnement</option>
        </select>
      </label>
      {apiKeyForm.authMode === 'header' && (
        <label style={fieldLabelStyle}>Nom de l’en-tête
          <input value={apiKeyForm.headerName} onChange={event => setApiKeyForm((value: any) => ({ ...value, headerName: event.target.value }))} placeholder="X-Api-Key" style={fieldInputStyle} />
        </label>
      )}
      {apiKeyForm.authMode === 'query' && (
        <label style={fieldLabelStyle}>Nom du paramètre
          <input value={apiKeyForm.queryName} onChange={event => setApiKeyForm((value: any) => ({ ...value, queryName: event.target.value }))} placeholder="api_key" style={fieldInputStyle} />
        </label>
      )}
      {apiKeyForm.authMode === 'env' && (
        <label style={fieldLabelStyle}>Nom de la variable
          <input value={apiKeyForm.envName} onChange={event => setApiKeyForm((value: any) => ({ ...value, envName: event.target.value }))} placeholder="API_KEY" style={fieldInputStyle} />
        </label>
      )}
      <label style={fieldLabelStyle}>Clé / jeton
        <input type="password" value={apiKeyForm.secret} onChange={event => setApiKeyForm((value: any) => ({ ...value, secret: event.target.value }))} placeholder="sk-… / token" style={fieldInputStyle} />
      </label>
      <button className="btn-primary" disabled={!apiKeyForm.name || !apiKeyForm.url || !apiKeyForm.secret} onClick={() => void persistApiKey()}>
        Ajouter l’API avec clé
      </button>
    </>
  )
}

export function AddMcpForm({ mcpForm, setMcpForm, persistMcp }: any) {
  return (
    <>
      <label>Nom<input value={mcpForm.name} onChange={event => setMcpForm((value: any) => ({ ...value, name: slugifyName(event.target.value) }))} placeholder="mon-serveur" /></label>
      <label>Transport
        <select value={mcpForm.transport} onChange={event => setMcpForm((value: any) => ({ ...value, transport: event.target.value }))}>
          <option value="stdio">stdio (commande locale)</option>
          <option value="streamable-http">streamable-http</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
      </label>
      <label>{mcpForm.transport === 'stdio' ? 'Commande' : 'URL'}
        <input value={mcpForm.commandOrUrl} onChange={event => setMcpForm((value: any) => ({ ...value, commandOrUrl: event.target.value }))} placeholder={mcpForm.transport === 'stdio' ? 'python3' : 'https://…'} />
      </label>
      {mcpForm.transport === 'stdio' && (
        <label>Arguments<input value={mcpForm.args} onChange={event => setMcpForm((value: any) => ({ ...value, args: event.target.value }))} placeholder="server.py --flag" /></label>
      )}
      {mcpForm.transport === 'stdio' && (
        <label>Variables d’environnement (KEY=value)
          <textarea value={mcpForm.envText} onChange={event => setMcpForm((value: any) => ({ ...value, envText: event.target.value }))} placeholder={'API_TOKEN=\${API_TOKEN}\nDEBUG=1'} rows={3} />
        </label>
      )}
      {mcpForm.transport !== 'stdio' && (
        <label>En-têtes HTTP (Name: value)
          <textarea value={mcpForm.headersText} onChange={event => setMcpForm((value: any) => ({ ...value, headersText: event.target.value }))} placeholder={'Authorization: Bearer …\nX-Api-Key: …'} rows={3} />
        </label>
      )}
      {mcpForm.transport !== 'stdio' && (
        <label>Variables d’environnement (KEY=value)
          <textarea value={mcpForm.envText} onChange={event => setMcpForm((value: any) => ({ ...value, envText: event.target.value }))} placeholder="OPTIONNEL=valeur" rows={2} />
        </label>
      )}
      <button className="btn-primary" disabled={!mcpForm.name || !mcpForm.commandOrUrl} onClick={() => void persistMcp()}>Ajouter avec Bob Shell</button>
    </>
  )
}
