import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_APPROVAL,
  forbiddenTaskPermissionIds,
  getVisibleTaskPermissions,
  sanitizeTaskApproval,
  approvalGroupFromActionType,
  isComposerPermissionAction,
} from './taskPermissions'

describe('taskPermissions', () => {
  it('filters permissions by mode groups', () => {
    const visible = getVisibleTaskPermissions({
      slug: 'plan',
      name: 'Plan',
      groups: ['read'],
      builtin: true,
      source: 'test',
    })
    expect(visible.map(item => item.id)).toEqual(['read'])
  })

  it('hides mcp and subagents when disabled in settings', () => {
    const forbidden = forbiddenTaskPermissionIds({ mcpEnabled: false, subagentsEnabled: false })
    const visible = getVisibleTaskPermissions(undefined, forbidden)
    expect(visible.map(item => item.id)).not.toContain('mcp')
    expect(visible.map(item => item.id)).not.toContain('subagent')
    expect(visible.map(item => item.id)).not.toContain('subtask')
  })

  it('sanitizes allowed permissions against visible ids', () => {
    expect(sanitizeTaskApproval(
      { autoApprovalEnabled: true, allowedPermissions: ['read', 'execute'] },
      ['read'],
    )).toEqual({ autoApprovalEnabled: true, allowedPermissions: ['read'] })

    expect(sanitizeTaskApproval(
      DEFAULT_TASK_APPROVAL,
      [],
    )).toEqual({ autoApprovalEnabled: false, allowedPermissions: [] })
  })

  it('maps Bob Shell action types to composer groups', () => {
    expect(approvalGroupFromActionType('file.write')).toBe('edit')
    expect(approvalGroupFromActionType('execute_command')).toBe(null)
    expect(approvalGroupFromActionType('command.execute')).toBe('execute')
    expect(isComposerPermissionAction('mcp.connect')).toBe(true)
    expect(isComposerPermissionAction('computer.use')).toBe(false)
  })
})
