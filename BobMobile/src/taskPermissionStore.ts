import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import {
  DEFAULT_TASK_APPROVAL,
  isTaskPermissionId,
  type TaskApprovalSettings,
  type TaskPermissionId,
} from './taskPermissions'

const STORAGE_KEY = 'bob-mobile-task-permissions-v1'

let state: TaskApprovalSettings = { ...DEFAULT_TASK_APPROVAL, allowedPermissions: [...DEFAULT_TASK_APPROVAL.allowedPermissions] }
const listeners = new Set<() => void>()
let hydrated = false

function emit() {
  for (const listener of listeners) listener()
}

function persist() {
  void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined)
}

function parseStored(raw: string | null): TaskApprovalSettings | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<TaskApprovalSettings>
    const allowed = Array.isArray(value.allowedPermissions)
      ? value.allowedPermissions.filter((id): id is TaskPermissionId => typeof id === 'string' && isTaskPermissionId(id))
      : DEFAULT_TASK_APPROVAL.allowedPermissions
    return {
      autoApprovalEnabled: value.autoApprovalEnabled !== false,
      allowedPermissions: allowed.length > 0 ? allowed : [...DEFAULT_TASK_APPROVAL.allowedPermissions],
    }
  } catch {
    return null
  }
}

export async function hydrateTaskPermissionStore(): Promise<void> {
  if (hydrated) return
  hydrated = true
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY)
    const next = parseStored(raw)
    if (next) {
      state = next
      emit()
    }
  } catch {
    // Keep defaults when secure storage is unavailable (web / simulator edge cases).
  }
}

export function getTaskApprovalSnapshot(): TaskApprovalSettings {
  return {
    autoApprovalEnabled: state.autoApprovalEnabled,
    allowedPermissions: [...state.allowedPermissions],
  }
}

export function subscribeTaskPermissions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useTaskApprovalStore(): TaskApprovalSettings {
  return useSyncExternalStore(subscribeTaskPermissions, getTaskApprovalSnapshot, getTaskApprovalSnapshot)
}

export function setAutoApprovalEnabled(enabled: boolean) {
  state = { ...state, autoApprovalEnabled: enabled }
  persist()
  emit()
}

export function togglePermission(id: TaskPermissionId, enabled: boolean) {
  const set = new Set(state.allowedPermissions)
  if (enabled) set.add(id)
  else set.delete(id)
  state = { ...state, allowedPermissions: [...set] }
  persist()
  emit()
}

export function toggleAllPermissions(enabled: boolean, visibleIds: TaskPermissionId[]) {
  const set = new Set(state.allowedPermissions)
  for (const id of visibleIds) {
    if (enabled) set.add(id)
    else set.delete(id)
  }
  state = {
    autoApprovalEnabled: enabled ? true : state.autoApprovalEnabled,
    allowedPermissions: [...set],
  }
  persist()
  emit()
}

export function grantPermissionForTask(id: TaskPermissionId) {
  togglePermission(id, true)
  if (!state.autoApprovalEnabled) setAutoApprovalEnabled(true)
}
