import { useState } from 'react'
import { saveMcpServer } from '../lib/ipc'
import type { SaveMcpServerInput } from '@bob-work/shared-types'
import type { McpServer } from '@bob-work/shared-types'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../i18n'

export function slugifyName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export interface EnvironmentField {
  id: string
  key: string
  value: string
  persistedKey?: string
}

let environmentFieldSequence = 0

export function createEnvironmentField(key = '', persisted = false): EnvironmentField {
  environmentFieldSequence += 1
  return { id: `env-${environmentFieldSequence}`, key, value: '', persistedKey: persisted ? key : undefined }
}

export function environmentFieldsToRecord(fields: EnvironmentField[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of fields) {
    const key = field.key.trim()
    const value = field.value.trim()
    if (key && value) out[key] = value
  }
  return out
}

export function environmentFieldsAreValid(fields: EnvironmentField[]): boolean {
  const populatedKeys = fields.map(field => field.key.trim()).filter(Boolean)
  if (new Set(populatedKeys).size !== populatedKeys.length) return false
  return fields.every(field => {
    const key = field.key.trim()
    const value = field.value.trim()
    if (!key && !value) return true
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return false
    return Boolean(value) || field.persistedKey === key
  })
}

export function removedEnvironmentKeys(fields: EnvironmentField[], originalKeys: string[]): string[] {
  const currentKeys = new Set(fields.map(field => field.key.trim()).filter(Boolean))
  return originalKeys.filter(key => !currentKeys.has(key))
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
  const t = useT()
  const [mcpForm, setMcpForm] = useState({
    originalName: '',
    name: '',
    transport: 'stdio',
    commandOrUrl: '',
    args: '',
    envFields: [] as EnvironmentField[],
    originalEnvKeys: [] as string[],
    headersText: '',
  })
  const [publicApiForm, setPublicApiForm] = useState({
    originalName: '',
    name: '',
    url: '',
    transport: 'streamable-http',
  })
  const [apiKeyForm, setApiKeyForm] = useState({
    originalName: '',
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
    originalName: '',
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
    const env = environmentFieldsToRecord(mcpForm.envFields)
    const envRemove = removedEnvironmentKeys(mcpForm.envFields, mcpForm.originalEnvKeys)
    const headers = parseHeaderLines(mcpForm.headersText)
    await persistConnector(
      {
        originalName: mcpForm.originalName || undefined,
        name: slugifyName(mcpForm.name),
        transport: mcpForm.transport,
        commandOrUrl: mcpForm.commandOrUrl.trim(),
        args: mcpForm.args.split(/\s+/).filter(Boolean),
        enabled: true,
        env: Object.keys(env).length ? env : undefined,
        envRemove: envRemove.length ? envRemove : undefined,
        headers: Object.keys(headers).length ? headers : undefined,
      },
      mcpForm.originalName ? t('integrations.mcpUpdated') : t('integrations.mcpAdded'),
      () => setMcpForm({ originalName: '', name: '', transport: 'stdio', commandOrUrl: '', args: '', envFields: [], originalEnvKeys: [], headersText: '' }),
    )
  }

  const persistPublicApi = async () => {
    await persistConnector(
      {
        originalName: publicApiForm.originalName || undefined,
        name: slugifyName(publicApiForm.name),
        transport: publicApiForm.transport,
        commandOrUrl: publicApiForm.url.trim(),
        args: [],
        enabled: true,
      },
      publicApiForm.originalName ? t('integrations.publicApiUpdated') : t('integrations.publicApiSaved'),
      () => setPublicApiForm({ originalName: '', name: '', url: '', transport: 'streamable-http' }),
      { stayOnTab: 'apis' },
    )
  }

  const persistApiKey = async () => {
    const name = slugifyName(apiKeyForm.name)
    const secret = apiKeyForm.secret.trim()
    if (!secret && !apiKeyForm.originalName) {
      setStatus(t('integrations.missingApiKey'))
      return
    }
    let headers: Record<string, string> | undefined
    let env: Record<string, string> | undefined
    let commandOrUrl = apiKeyForm.url.trim()
    if (!secret) {
      // Editing with an empty field intentionally preserves the stored secret.
    } else if (apiKeyForm.authMode === 'bearer') {
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
        originalName: apiKeyForm.originalName || undefined,
        name,
        transport: apiKeyForm.transport,
        commandOrUrl,
        args: [],
        enabled: true,
        headers: secret ? headers : undefined,
        env: secret ? env : undefined,
      },
      apiKeyForm.originalName ? t('integrations.keyedApiUpdated', { name }) : t('integrations.keyedApiSaved', { name }),
      () => setApiKeyForm({
        originalName: '',
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
        originalName: oauthMcpForm.originalName || undefined,
        name: slugifyName(oauthMcpForm.name),
        transport: oauthMcpForm.transport,
        commandOrUrl: oauthMcpForm.url.trim(),
        args: [],
        enabled: true,
      },
      'Connecteur OAuth / MCP distant ajouté. Autorisez-le ensuite si le serveur le demande.',
      () => setOauthMcpForm({ originalName: '', name: '', url: '', transport: 'streamable-http' }),
    )
  }

  const editMcp = (server: McpServer) => {
    const envKeys = redactedFieldNames(server.raw?.env)
    setMcpForm({
      originalName: server.name,
      name: server.name,
      transport: server.transport,
      commandOrUrl: server.commandOrUrl,
      args: server.args.join(' '),
      envFields: envKeys.map(key => createEnvironmentField(key, true)),
      originalEnvKeys: envKeys,
      headersText: redactedFieldNames(server.raw?.headers).map(key => `${key}:`).join('\n'),
    })
  }

  const editPublicApi = (server: McpServer) => {
    setPublicApiForm({ originalName: server.name, name: server.name, url: server.commandOrUrl, transport: server.transport })
  }

  const editKeyedApi = (server: McpServer) => {
    const headerNames = redactedFieldNames(server.raw?.headers)
    const envNames = redactedFieldNames(server.raw?.env)
    const queryName = redactedQueryName(server.commandOrUrl)
    const authorization = headerNames.find(name => name.toLowerCase() === 'authorization')
    const customHeader = headerNames.find(name => name.toLowerCase() !== 'authorization')
    const authMode: 'bearer' | 'header' | 'env' | 'query' = queryName ? 'query' : authorization ? 'bearer' : customHeader ? 'header' : 'env'
    setApiKeyForm({
      originalName: server.name,
      name: server.name,
      url: server.commandOrUrl,
      transport: server.transport,
      authMode,
      headerName: customHeader || 'X-Api-Key',
      queryName: queryName || 'api_key',
      secret: '',
      envName: envNames[0] || 'API_KEY',
    })
  }

  const cancelMcpEdit = () => setMcpForm({ originalName: '', name: '', transport: 'stdio', commandOrUrl: '', args: '', envFields: [], originalEnvKeys: [], headersText: '' })
  const cancelPublicApiEdit = () => setPublicApiForm({ originalName: '', name: '', url: '', transport: 'streamable-http' })
  const cancelKeyedApiEdit = () => setApiKeyForm({ originalName: '', name: '', url: '', transport: 'http', authMode: 'query', headerName: 'X-Api-Key', queryName: 'api_key', secret: '', envName: 'API_KEY' })

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
    editMcp,
    editPublicApi,
    editKeyedApi,
    cancelMcpEdit,
    cancelPublicApiEdit,
    cancelKeyedApiEdit,
  }
}

export function redactedFieldNames(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  return Object.keys(value as Record<string, unknown>).filter(key => key !== '_redacted')
}

export function redactedQueryName(value: string): string {
  try {
    const url = new URL(value)
    for (const [key, item] of url.searchParams) if (item === '<redacted>') return key
  } catch { /* incomplete URL */ }
  return ''
}
