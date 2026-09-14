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
  labelKey: string
  descriptionKey: string
  icon: TaskPermissionId
}

export interface TaskApprovalSettings {
  autoApprovalEnabled: boolean
  allowedPermissions: TaskPermissionId[]
}

export const TASK_PERMISSIONS: TaskPermissionDefinition[] = [
  { id: 'read', labelKey: 'permRead', descriptionKey: 'permReadDesc', icon: 'read' },
  { id: 'edit', labelKey: 'permEdit', descriptionKey: 'permEditDesc', icon: 'edit' },
  { id: 'execute', labelKey: 'permExecute', descriptionKey: 'permExecuteDesc', icon: 'execute' },
  { id: 'mcp', labelKey: 'permMcp', descriptionKey: 'permMcpDesc', icon: 'mcp' },
  { id: 'skill', labelKey: 'permSkill', descriptionKey: 'permSkillDesc', icon: 'skill' },
  { id: 'todo', labelKey: 'permTodo', descriptionKey: 'permTodoDesc', icon: 'todo' },
  { id: 'subtask', labelKey: 'permSubtask', descriptionKey: 'permSubtaskDesc', icon: 'subtask' },
  { id: 'subagent', labelKey: 'permSubagent', descriptionKey: 'permSubagentDesc', icon: 'subagent' },
  { id: 'mode', labelKey: 'permMode', descriptionKey: 'permModeDesc', icon: 'mode' },
]

export const DEFAULT_TASK_APPROVAL: TaskApprovalSettings = {
  autoApprovalEnabled: true,
  allowedPermissions: ['read'],
}

const ALL_IDS = TASK_PERMISSIONS.map(item => item.id)

export function isTaskPermissionId(value: string): value is TaskPermissionId {
  return (ALL_IDS as string[]).includes(value)
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

export function getVisibleTaskPermissions(
  modeGroups: string[] | undefined,
  forbidden: TaskPermissionId[] = [],
): TaskPermissionDefinition[] {
  const forbiddenSet = new Set(forbidden)
  const allowedByMode = modeGroups?.length ? new Set(modeGroups) : null
  return TASK_PERMISSIONS.filter(permission => {
    if (forbiddenSet.has(permission.id)) return false
    if (!allowedByMode) return true
    return allowedByMode.has(permission.id)
  })
}

/** Default composer groups per built-in mode (Desktop BobMode.groups parity). */
export function groupsForMode(modeId: string): string[] | undefined {
  switch (modeId) {
    case 'ask':
      return ['read', 'skill', 'todo', 'mode']
    case 'plan':
      return ['read', 'edit', 'skill', 'todo', 'subtask', 'subagent', 'mode']
    case 'agent':
    default:
      return ['read', 'edit', 'execute', 'mcp', 'skill', 'todo', 'subtask', 'subagent', 'mode']
  }
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
    if (isTaskPermissionId(rest)) return rest
  }
  if (isTaskPermissionId(normalized)) return normalized
  return null
}

export function permissionStatusLabel(
  checked: boolean,
  autoApprovalEnabled: boolean,
): 'permStatusAuto' | 'permStatusAsk' {
  return checked && autoApprovalEnabled ? 'permStatusAuto' : 'permStatusAsk'
}
