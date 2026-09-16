import { useMemo } from 'react'
import {
  Eye,
  Pencil,
  Terminal,
  Waypoints,
  Zap,
  ListTodo,
  GitBranch,
  Bot,
  RefreshCw,
} from 'lucide-react'
import type { BobMode } from '@bob-work/shared-types'
import {
  forbiddenTaskPermissionIds,
  getVisibleTaskPermissions,
  sanitizeTaskApproval,
  type TaskPermissionDefinition,
  type TaskPermissionId,
} from '../../lib/taskPermissions'
import { useTaskPermissionStore } from '../../stores/taskPermissionStore'
import { useT } from '../../i18n'

const ICONS: Record<TaskPermissionDefinition['icon'], typeof Eye> = {
  read: Eye,
  edit: Pencil,
  execute: Terminal,
  mcp: Waypoints,
  skill: Zap,
  todo: ListTodo,
  subtask: GitBranch,
  subagent: Bot,
  mode: RefreshCw,
}

export const AGENT_MODE_FOR_PERMISSIONS: BobMode = {
  slug: 'agent',
  name: 'Agent',
  description: 'Agent',
  groups: ['read', 'edit', 'execute', 'mcp', 'skill', 'todo', 'subtask', 'subagent', 'mode'],
  builtin: true,
  source: 'defaults',
}

interface Props {
  selectedMode: BobMode
  mcpEnabled: boolean
  subagentsEnabled: boolean
}

export default function TaskPermissionsPanel({
  selectedMode,
  mcpEnabled,
  subagentsEnabled,
}: Props) {
  const t = useT()
  const autoApprovalEnabled = useTaskPermissionStore(state => state.autoApprovalEnabled)
  const allowedPermissions = useTaskPermissionStore(state => state.allowedPermissions)
  const setAutoApprovalEnabled = useTaskPermissionStore(state => state.setAutoApprovalEnabled)
  const togglePermission = useTaskPermissionStore(state => state.togglePermission)
  const toggleAllPermissions = useTaskPermissionStore(state => state.toggleAllPermissions)

  const visiblePermissions = useMemo(
    () => getVisibleTaskPermissions(
      selectedMode,
      forbiddenTaskPermissionIds({ mcpEnabled, subagentsEnabled }),
    ),
    [selectedMode, mcpEnabled, subagentsEnabled],
  )

  const visibleIds = useMemo(
    () => visiblePermissions.map(permission => permission.id),
    [visiblePermissions],
  )

  const hasSelection = allowedPermissions.some(id => visibleIds.includes(id))
  const autoApproveActive = autoApprovalEnabled && hasSelection

  const toggleAutoApprove = () => {
    if (autoApproveActive) {
      setAutoApprovalEnabled(false)
      return
    }
    if (!hasSelection && visibleIds.length > 0) {
      toggleAllPermissions(true, visibleIds)
      return
    }
    setAutoApprovalEnabled(true)
  }

  return (
    <div className="permissions-popover">
      <div className="permissions-popover-header">
        <strong>{t('composer.permissions.title')}</strong>
      </div>

      <ul className="permissions-popover-list" role="group" aria-label={t('composer.permissions.title')}>
        {visiblePermissions.map(permission => {
          const Icon = ICONS[permission.icon]
          const checked = allowedPermissions.includes(permission.id)
          return (
            <li key={permission.id}>
              <button
                type="button"
                className="permissions-popover-row"
                aria-pressed={checked}
                onClick={() => togglePermission(permission.id, !checked)}
              >
                <span className="permissions-popover-row-main">
                  <Icon size={14} aria-hidden="true" />
                  <span>
                    <strong>{t(permission.labelKey)}</strong>
                    <small>{t(permission.descriptionKey)}</small>
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="permissions-popover-toggle">
        <span>{t('composer.permissions.autoApprove')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={autoApproveActive}
          className={`permissions-toggle${autoApproveActive ? ' is-on' : ''}`}
          onClick={toggleAutoApprove}
        >
          <span className="permissions-toggle-thumb" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export function taskApprovalSnapshot(
  visibleIds: TaskPermissionId[] = [],
): {
  autoApprovalEnabled: boolean
  allowedPermissions: TaskPermissionId[]
} {
  const state = useTaskPermissionStore.getState()
  const visible = visibleIds.length > 0 ? visibleIds : undefined
  const sanitized = visible
    ? sanitizeTaskApproval(state, visible)
    : state
  return {
    autoApprovalEnabled: sanitized.autoApprovalEnabled,
    allowedPermissions: [...sanitized.allowedPermissions],
  }
}
