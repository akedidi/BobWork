import { describe, expect, it } from 'vitest'
import { isPluginManagedMcp, userConfigurableMcpServers } from './mcpVisibility'
import type { McpServer } from '@bob-work/shared-types'

const server = (name: string, builtin = false): McpServer => ({
  name,
  transport: 'stdio',
  commandOrUrl: 'python3',
  args: [],
  enabled: true,
  builtin,
  status: 'configured',
  raw: {},
})

describe('mcpVisibility', () => {
  it('treats bob-work namespace and builtin flag as plugin-managed', () => {
    expect(isPluginManagedMcp(server('bob-work-microsoft', false))).toBe(true)
    expect(isPluginManagedMcp(server('bw-custom', true))).toBe(true)
    expect(isPluginManagedMcp(server('mcp-custom-hub', false))).toBe(false)
  })

  it('filters plugin-managed servers from user-facing lists', () => {
    const visible = userConfigurableMcpServers([
      server('bob-work-github', true),
      server('airline-operations', false),
    ])
    expect(visible.map(item => item.name)).toEqual(['airline-operations'])
  })
})
