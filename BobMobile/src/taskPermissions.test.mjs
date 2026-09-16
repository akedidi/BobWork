import test from 'node:test'
import assert from 'node:assert/strict'

import {
  approvalGroupFromActionType,
  forbiddenTaskPermissionIds,
  getVisibleTaskPermissions,
  groupsForMode,
  permissionStatusLabel,
  sanitizeTaskApproval,
} from './taskPermissions.ts'

test('filters permissions by mode groups and feature flags', () => {
  const ask = getVisibleTaskPermissions(
    groupsForMode('ask'),
    forbiddenTaskPermissionIds({ mcpEnabled: true, subagentsEnabled: true }),
  ).map(item => item.id)
  assert.deepEqual(ask, ['read', 'skill', 'todo', 'mode'])

  const agentWithoutMcp = getVisibleTaskPermissions(
    groupsForMode('agent'),
    forbiddenTaskPermissionIds({ mcpEnabled: false, subagentsEnabled: false }),
  ).map(item => item.id)
  assert.ok(!agentWithoutMcp.includes('mcp'))
  assert.ok(!agentWithoutMcp.includes('subagent'))
  assert.ok(!agentWithoutMcp.includes('subtask'))
})

test('maps approval action types to composer groups', () => {
  assert.equal(approvalGroupFromActionType('bob.execute.edit'), 'edit')
  assert.equal(approvalGroupFromActionType('spawn_subagent'), 'subagent')
  assert.equal(approvalGroupFromActionType('unknown'), null)
})

test('status labels reflect checkbox and auto-approve', () => {
  assert.equal(permissionStatusLabel(true, true), 'permStatusAuto')
  assert.equal(permissionStatusLabel(true, false), 'permStatusAsk')
  assert.equal(permissionStatusLabel(false, true), 'permStatusAsk')
})

test('sanitize drops invisible permissions and disables auto-approve when empty', () => {
  const sanitized = sanitizeTaskApproval(
    { autoApprovalEnabled: true, allowedPermissions: ['read', 'mcp'] },
    ['read'],
  )
  assert.deepEqual(sanitized, { autoApprovalEnabled: true, allowedPermissions: ['read'] })
  assert.deepEqual(
    sanitizeTaskApproval({ autoApprovalEnabled: true, allowedPermissions: ['mcp'] }, ['read']),
    { autoApprovalEnabled: false, allowedPermissions: [] },
  )
})
