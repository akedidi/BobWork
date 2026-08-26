import { useCallback, useMemo, useState } from 'react'
import { getMcpServers, testMcpServer } from '../lib/ipc'
import type { McpServer } from '@bob-work/shared-types'

export function hasStoredSecretField(value: unknown) {
  if (!value) return false
  if (typeof value === 'string') return value.length > 0 && value !== '{}'
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return false
}

export function hasAuthHeaders(server: McpServer) {
  return hasStoredSecretField(server.raw?.headers)
}

export function hasEnvSecrets(server: McpServer) {
  return hasStoredSecretField(server.raw?.env)
}

export function isRemoteTransport(transport: string) {
  return ['http', 'sse', 'streamable-http', 'streamable_http'].includes(transport)
}

export function useMcpServers({ setStatus }: { setStatus: (s: string) => void }) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [mcpTestBusy, setMcpTestBusy] = useState<string | null>(null)

  const loadMcp = useCallback(async () => {
    const next = await getMcpServers()
    setServers(next)
  }, [])

  const classified = useMemo(() => {
    const publicApis: McpServer[] = []
    const keyedApis: McpServer[] = []
    const protocols: McpServer[] = []
    for (const server of servers) {
      if (!isRemoteTransport(server.transport)) {
        protocols.push(server)
        continue
      }
      if (hasAuthHeaders(server) || hasEnvSecrets(server)) keyedApis.push(server)
      else publicApis.push(server)
    }
    return { publicApis, keyedApis, protocols }
  }, [servers])

  return {
    servers,
    loadMcp,
    mcpTestBusy,
    setMcpTestBusy,
    classified,
  }
}
