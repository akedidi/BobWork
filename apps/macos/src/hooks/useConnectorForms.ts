import { useState } from 'react'
import { saveMcpServer } from '../lib/ipc'
import type { SaveMcpServerInput } from '@bob-work/shared-types'
import { errorMessage } from '../lib/errorMessage'

export function slugifyName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

export function useConnectorForms({ setStatus, loadMcp, setTab }: { setStatus: (s: string) => void, loadMcp: () => Promise<void>, setTab: (t: any) => void }) {
  const [mcpForm, setMcpForm] = useState({
    name: '',
    transport: 'stdio',
    commandOrUrl: '',
    args: '',
    envText: '',
    headersText: '',
  })
  const [publicApiForm, setPublicApiForm] = useState({
    name: '',
    url: '',
    transport: 'streamable-http',
  })
  const [apiKeyForm, setApiKeyForm] = useState({
    name: '',
    url: '',
    transport: 'http',
    authMode: 'query' as 'bearer' | 'header' | 'env' | 'query',
    headerName: 'X-Api-Key',
    queryName: 'api_key',
    secret: '',
    envName: 'API_KEY',
  })
  const [oauthMcpForm, setOauthMcpForm] = useState({
    name: '',
    url: '',
    transport: 'streamable-http',
  })

  const persistConnector = async (
    input: SaveMcpServerInput,
    successMessage: string,
    reset: () => void,
    options?: { stayOnTab?: any },
  ) => {
    setStatus('')
    try {
      await saveMcpServer(input)
      reset()
      await loadMcp()
      setStatus(successMessage)
      setTab(options?.stayOnTab ?? 'mcp')
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  const persistMcp = async () => {
    const env = parseEnvLines(mcpForm.envText)
    const headers = parseHeaderLines(mcpForm.headersText)
    await persistConnector(
      {
        name: slugifyName(mcpForm.name),
        transport: mcpForm.transport,
        commandOrUrl: mcpForm.commandOrUrl.trim(),
        args: mcpForm.args.split(/\\s+/).filter(Boolean),
        enabled: true,
        env: Object.keys(env).length ? env : undefined,
        headers: Object.keys(headers).length ? headers : undefined,
      },
      'Serveur MCP ajouté.',
      () => setMcpForm({ name: '', transport: 'stdio', commandOrUrl: '', args: '', envText: '', headersText: '' }),
    )
  }

  const persistPublicApi = async () => {
    await persistConnector(
      {
        name: slugifyName(publicApiForm.name),
        transport: publicApiForm.transport,
        commandOrUrl: publicApiForm.url.trim(),
        args: [],
        enabled: true,
      },
      'API publique enregistrée.',
      () => setPublicApiForm({ name: '', url: '', transport: 'streamable-http' }),
      { stayOnTab: 'apis' },
    )
  }

  const persistApiKey = async () => {
    const name = slugifyName(apiKeyForm.name)
    const secret = apiKeyForm.secret.trim()
    if (!secret) {
      setStatus('Indiquez la clé ou le jeton API.')
      return
    }
    let headers: Record<string, string> | undefined
    let env: Record<string, string> | undefined
    let commandOrUrl = apiKeyForm.url.trim()
    if (apiKeyForm.authMode === 'bearer') {
      headers = { Authorization: `Bearer ${secret}` }
    } else if (apiKeyForm.authMode === 'header') {
      headers = { [apiKeyForm.headerName.trim() || 'X-Api-Key']: secret }
    } else if (apiKeyForm.authMode === 'query') {
      const param = apiKeyForm.queryName.trim() || 'api_key'
      try {
        const parsed = new URL(commandOrUrl)
        parsed.searchParams.set(param, secret)
        commandOrUrl = parsed.toString()
      } catch {
        const join = commandOrUrl.includes('?') ? '&' : '?'
        commandOrUrl = `${commandOrUrl}${join}${encodeURIComponent(param)}=${encodeURIComponent(secret)}`
      }
      env = { [`${param.toUpperCase()}`]: secret }
    } else {
      env = { [apiKeyForm.envName.trim() || 'API_KEY']: secret }
    }
    await persistConnector(
      {
        name,
        transport: apiKeyForm.transport,
        commandOrUrl,
        args: [],
        enabled: true,
        headers,
        env,
      },
      `API « ${name} » enregistrée.`,
      () => setApiKeyForm({
        name: '',
        url: '',
        transport: 'http',
        authMode: 'query',
        headerName: 'X-Api-Key',
        queryName: 'api_key',
        secret: '',
        envName: 'API_KEY',
      }),
      { stayOnTab: 'apis' },
    )
  }

  const persistOauthMcp = async () => {
    await persistConnector(
      {
        name: slugifyName(oauthMcpForm.name),
        transport: oauthMcpForm.transport,
        commandOrUrl: oauthMcpForm.url.trim(),
        args: [],
        enabled: true,
      },
      'Connecteur OAuth / MCP distant ajouté. Autorisez-le ensuite si le serveur le demande.',
      () => setOauthMcpForm({ name: '', url: '', transport: 'streamable-http' }),
    )
  }

  return {
    mcpForm,
    setMcpForm,
    publicApiForm,
    setPublicApiForm,
    apiKeyForm,
    setApiKeyForm,
    oauthMcpForm,
    setOauthMcpForm,
    persistMcp,
    persistPublicApi,
    persistApiKey,
    persistOauthMcp,
  }
}
