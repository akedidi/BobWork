import { useState } from 'react'
import { saveApiConnection, saveMcpServer } from '../lib/ipc'
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
  })
  const [apiKeyForm, setApiKeyForm] = useState({
    originalName: '',
    name: '',
    url: '',
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
    const name = slugifyName(publicApiForm.name)
    setStatus('')
    try {
      await saveApiConnection({ originalName: publicApiForm.originalName || undefined, name, url: publicApiForm.url.trim(), authMode: 'none', enabled: true })
      setPublicApiForm({ originalName: '', name: '', url: '' })
      await loadMcp()
      setStatus(publicApiForm.originalName ? t('integrations.publicApiUpdated') : t('integrations.publicApiSaved'))
      setTab('apis')
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  const persistApiKey = async () => {
    const name = slugifyName(apiKeyForm.name)
    const secret = apiKeyForm.secret.trim()
    if (!secret && !apiKeyForm.originalName) {
      setStatus(t('integrations.missingApiKey'))
      return
    }
    if (apiKeyForm.authMode === 'env') {
      await persistConnector(
        {
          originalName: apiKeyForm.originalName || undefined,
          name,
          transport: 'http',
          commandOrUrl: apiKeyForm.url.trim(),
          args: [],
          enabled: true,
          env: secret ? {
            [apiKeyForm.envName.trim() || 'API_KEY']: secret,
            BOB_WORK_API_CREDENTIAL_ONLY: '1',
          } : undefined,
        },
        apiKeyForm.originalName ? t('integrations.keyedApiUpdated', { name }) : t('integrations.keyedApiSaved', { name }),
        () => setApiKeyForm({ originalName: '', name: '', url: '', authMode: 'query', headerName: 'X-Api-Key', queryName: 'api_key', secret: '', envName: 'API_KEY' }),
        { stayOnTab: 'apis' },
      )
      return
    }
    const authName = apiKeyForm.authMode === 'query'
      ? (apiKeyForm.queryName.trim() || 'api_key')
      : apiKeyForm.authMode === 'header'
        ? (apiKeyForm.headerName.trim() || 'X-Api-Key')
        : ''
    setStatus('')
    try {
      await saveApiConnection({ originalName: apiKeyForm.originalName || undefined, name, url: apiKeyForm.url.trim(), authMode: apiKeyForm.authMode, authName, secret, enabled: true })
      setApiKeyForm({ originalName: '', name: '', url: '', authMode: 'query', headerName: 'X-Api-Key', queryName: 'api_key', secret: '', envName: 'API_KEY' })
      await loadMcp()
      setStatus(apiKeyForm.originalName ? t('integrations.keyedApiUpdated', { name }) : t('integrations.keyedApiSaved', { name }))
      setTab('apis')
    } catch (error) {
      setStatus(errorMessage(error))
    }
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
    const env = server.raw?.env as Record<string, unknown> | undefined
    const url = String(env?.BOB_WORK_API_BASE_URL || server.commandOrUrl)
    setPublicApiForm({ originalName: server.name, name: server.name, url })
  }

  const editKeyedApi = (server: McpServer) => {
    const apiEnv = server.raw?.env as Record<string, unknown> | undefined
    if (apiEnv?.BOB_WORK_API_KIND === 'rest') {
      const authMode = String(apiEnv.BOB_WORK_API_AUTH_MODE || 'query') as 'bearer' | 'header' | 'query'
      const authName = String(apiEnv.BOB_WORK_API_AUTH_NAME || '')
      setApiKeyForm({
        originalName: server.name,
        name: server.name,
        url: String(apiEnv.BOB_WORK_API_BASE_URL || ''),
        authMode,
        headerName: authMode === 'header' ? (authName || 'X-Api-Key') : 'X-Api-Key',
        queryName: authMode === 'query' ? (authName || 'api_key') : 'api_key',
        secret: '',
        envName: 'API_KEY',
      })
      return
    }
    const headerNames = redactedFieldNames(server.raw?.headers)
    const queryName = redactedQueryName(server.commandOrUrl)
    const authorization = headerNames.find(name => name.toLowerCase() === 'authorization')
    const customHeader = headerNames.find(name => name.toLowerCase() !== 'authorization')
    const credentialOnly = (server.raw?.env as Record<string, unknown> | undefined)?.BOB_WORK_API_CREDENTIAL_ONLY === '1'
    const authMode: 'bearer' | 'header' | 'env' | 'query' = credentialOnly ? 'env' : queryName ? 'query' : authorization ? 'bearer' : customHeader ? 'header' : 'env'
    setApiKeyForm({
      originalName: server.name,
      name: server.name,
      url: server.commandOrUrl,
      authMode,
      headerName: customHeader || 'X-Api-Key',
      queryName: queryName || 'api_key',
      secret: '',
      envName: redactedFieldNames(server.raw?.env).find(name => !name.startsWith('BOB_WORK_API_')) || 'API_KEY',
    })
  }

  const cancelMcpEdit = () => setMcpForm({ originalName: '', name: '', transport: 'stdio', commandOrUrl: '', args: '', envFields: [], originalEnvKeys: [], headersText: '' })
  const cancelPublicApiEdit = () => setPublicApiForm({ originalName: '', name: '', url: '' })
  const cancelKeyedApiEdit = () => setApiKeyForm({ originalName: '', name: '', url: '', authMode: 'query', headerName: 'X-Api-Key', queryName: 'api_key', secret: '', envName: 'API_KEY' })

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
