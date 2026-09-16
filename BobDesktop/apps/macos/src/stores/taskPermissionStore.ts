import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_TASK_APPROVAL,
  sanitizeTaskApproval,
  type TaskApprovalSettings,
  type TaskPermissionId,
} from '../lib/taskPermissions'

interface TaskPermissionStore extends TaskApprovalSettings {
  setAutoApprovalEnabled: (enabled: boolean) => void
  togglePermission: (id: TaskPermissionId, enabled: boolean) => void
  toggleAllPermissions: (enabled: boolean, visibleIds: TaskPermissionId[]) => void
  resetFromDefaults: (defaults?: TaskApprovalSettings) => void
  applyVisiblePermissions: (visibleIds: TaskPermissionId[]) => void
}

export const useTaskPermissionStore = create<TaskPermissionStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_TASK_APPROVAL,
      setAutoApprovalEnabled: enabled => set({ autoApprovalEnabled: enabled }),
      togglePermission: (id, enabled) => {
        const current = new Set(get().allowedPermissions)
        if (enabled) current.add(id)
        else current.delete(id)
        set({ allowedPermissions: [...current] })
      },
      toggleAllPermissions: (enabled, visibleIds) => {
        set({
          autoApprovalEnabled: enabled,
          allowedPermissions: enabled ? [...visibleIds] : [],
        })
      },
      resetFromDefaults: defaults => set({ ...(defaults ?? DEFAULT_TASK_APPROVAL) }),
      applyVisiblePermissions: visibleIds => {
        set(state => sanitizeTaskApproval(state, visibleIds))
      },
    }),
    {
      // v2: include subagent/subtask in the default allow-list so orchestration works.
      name: 'bob-work-task-permissions-v2',
      partialize: state => ({
        autoApprovalEnabled: state.autoApprovalEnabled,
        allowedPermissions: state.allowedPermissions,
      }),
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<TaskApprovalSettings>
        if (version < 2) {
          const allowed = new Set(state.allowedPermissions ?? DEFAULT_TASK_APPROVAL.allowedPermissions)
          for (const id of ['subagent', 'subtask', 'mode', 'todo', 'skill', 'execute', 'edit', 'mcp'] as const) {
            allowed.add(id)
          }
          return {
            autoApprovalEnabled: state.autoApprovalEnabled ?? true,
            allowedPermissions: [...allowed],
          }
        }
        return {
          autoApprovalEnabled: state.autoApprovalEnabled ?? DEFAULT_TASK_APPROVAL.autoApprovalEnabled,
          allowedPermissions: state.allowedPermissions ?? DEFAULT_TASK_APPROVAL.allowedPermissions,
        }
      },
      version: 2,
    },
  ),
)
