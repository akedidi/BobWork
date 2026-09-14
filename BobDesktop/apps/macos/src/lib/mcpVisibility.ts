import type { McpServer } from '@bob-work/shared-types'

/** MCP connector shipped with Bob Work or a built-in plugin (not user-managed). */
export function isPluginManagedMcp(server: Pick<McpServer, 'builtin' | 'name'>) {
  return server.builtin || server.name.startsWith('bob-work-')
}

/** MCP servers the user can add, edit or mention from Integrations / composer. */
export function userConfigurableMcpServers(servers: McpServer[]) {
  return servers.filter(server => !isPluginManagedMcp(server))
}
