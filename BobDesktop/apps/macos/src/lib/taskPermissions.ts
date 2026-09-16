import type { BobMode } from '@bob-work/shared-types'

export type TaskPermissionId =
  | 'read'
  | 'edit'
  | 'execute'
  | 'mcp'
  | 'skill'
  | 'todo'
  | 'subtask'
  | 'subagent'
  | 'mode'

export interface TaskPermissionDefinition {
  id: TaskPermissionId
  labelKey: `composer.permissions.${TaskPermissionId}`
  descriptionKey: `composer.permissions.${TaskPermissionId}Desc`
  icon: 'read' | 'edit' | 'execute' | 'mcp' | 'skill' | 'todo' | 'subtask' | 'subagent' | 'mode'
}

export interface TaskApprovalSettings {
  autoApprovalEnabled: boolean
  allowedPermissions: TaskPermissionId[]
}

export const TASK_PERMISSIONS: TaskPermissionDefinition[] = [
  { id: 'read', labelKey: 'composer.permissions.read', descriptionKey: 'composer.permissions.readDesc', icon: 'read' },
  { id: 'edit', labelKey: 'composer.permissions.edit', descriptionKey: 'composer.permissions.editDesc', icon: 'edit' },
  { id: 'execute', labelKey: 'composer.permissions.execute', descriptionKey: 'composer.permissions.executeDesc', icon: 'execute' },
  { id: 'mcp', labelKey: 'composer.permissions.mcp', descriptionKey: 'composer.permissions.mcpDesc', icon: 'mcp' },
  { id: 'skill', labelKey: 'composer.permissions.skill', descriptionKey: 'composer.permissions.skillDesc', icon: 'skill' },
  { id: 'todo', labelKey: 'composer.permissions.todo', descriptionKey: 'composer.permissions.todoDesc', icon: 'todo' },
  { id: 'subtask', labelKey: 'composer.permissions.subtask', descriptionKey: 'composer.permissions.subtaskDesc', icon: 'subtask' },
  { id: 'subagent', labelKey: 'composer.permissions.subagent', descriptionKey: 'composer.permissions.subagentDesc', icon: 'subagent' },
  { id: 'mode', labelKey: 'composer.permissions.mode', descriptionKey: 'composer.permissions.modeDesc', icon: 'mode' },
]

export const DEFAULT_TASK_APPROVAL: TaskApprovalSettings = {
  // Agent-mode baseline: keep orchestration (subagent/subtask) auto-approved so
  // Bob Shell can actually spawn children and the live status frame can appear.
  // Uncheck in the composer Permissions menu to require an ask-on-use card.
  autoApprovalEnabled: true,
  allowedPermissions: [
    'read',
    'edit',
    'execute',
    'mcp',
    'skill',
    'todo',
    'subtask',
    'subagent',
    'mode',
  ],
}

export function getVisibleTaskPermissions(mode: BobMode | undefined, forbidden: TaskPermissionId[] = []) {
  const forbiddenSet = new Set(forbidden)
  const allowedByMode = mode?.groups?.length
    ? new Set([...(mode.groups ?? []), mode.slug])
    : null

  return TASK_PERMISSIONS.filter(permission => {
    if (forbiddenSet.has(permission.id)) return false
    if (!allowedByMode) return true
    return allowedByMode.has(permission.id)
  })
}

export function forbiddenTaskPermissionIds(options: {
  mcpEnabled: boolean
  subagentsEnabled: boolean
}): TaskPermissionId[] {
  const forbidden: TaskPermissionId[] = []
  if (!options.mcpEnabled) forbidden.push('mcp')
  if (!options.subagentsEnabled) forbidden.push('subagent', 'subtask')
  return forbidden
}

export function approvalGroupFromActionType(actionType: string): TaskPermissionId | null {
  const normalized = actionType.trim()
  const mapped: Record<string, TaskPermissionId> = {
    read: 'read',
    'file.read': 'read',
    'bob.read': 'read',
    'bob.execute.read': 'read',
    edit: 'edit',
    'file.write': 'edit',
    'file.delete': 'edit',
    'bob.edit': 'edit',
    'bob.execute.edit': 'edit',
    execute: 'execute',
    'command.execute': 'execute',
    'bob.execute': 'execute',
    'bob.execute.command': 'execute',
    mcp: 'mcp',
    'mcp.connect': 'mcp',
    'bob.mcp': 'mcp',
    'bob.execute.mcp': 'mcp',
    skill: 'skill',
    'bob.skill': 'skill',
    'bob.execute.skill': 'skill',
    todo: 'todo',
    'bob.todo': 'todo',
    'bob.execute.todo': 'todo',
    subtask: 'subtask',
    'bob.subtask': 'subtask',
    'bob.execute.subtask': 'subtask',
    subagent: 'subagent',
    spawn_subagent: 'subagent',
    'bob.subagent': 'subagent',
    'bob.execute.subagent': 'subagent',
    mode: 'mode',
    'mode.switch': 'mode',
    'bob.mode': 'mode',
    'bob.execute.mode': 'mode',
  }
  if (mapped[normalized]) return mapped[normalized]
  if (normalized.startsWith('bob.execute.')) {
    const rest = normalized.slice('bob.execute.'.length)
    if ((TASK_PERMISSIONS.map(item => item.id) as string[]).includes(rest)) {
      return rest as TaskPermissionId
    }
  }
  if ((TASK_PERMISSIONS.map(item => item.id) as string[]).includes(normalized)) {
    return normalized as TaskPermissionId
  }
  return null
}

export function isComposerPermissionAction(actionType: string): boolean {
  return approvalGroupFromActionType(actionType) != null
}

export function sanitizeTaskApproval(
  settings: TaskApprovalSettings,
  visibleIds: TaskPermissionId[],
): TaskApprovalSettings {
  const visible = new Set(visibleIds)
  const allowedPermissions = settings.allowedPermissions.filter(id => visible.has(id))
  return {
    autoApprovalEnabled: settings.autoApprovalEnabled && allowedPermissions.length > 0,
    allowedPermissions,
  }
}
