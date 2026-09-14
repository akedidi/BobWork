import { create } from 'zustand'
import { checkForUpdates, installAvailableUpdate, type UpdateCheckResult } from '../lib/ipc'

export const INITIAL_UPDATE_CHECK_DELAY_MS = 15_000
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000

interface UpdateState {
  checking: boolean
  installing: boolean
  available: boolean
  version: string | null
  notes: string | null
  currentVersion: string | null
  lastCheckedAt: string | null
  applyResult: (result: UpdateCheckResult) => void
  check: () => Promise<void>
  install: () => Promise<void>
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  checking: false,
  installing: false,
  available: false,
  version: null,
  notes: null,
  currentVersion: null,
  lastCheckedAt: null,
  applyResult: result => set({
    available: result.available,
    version: result.version ?? null,
    notes: result.notes ?? null,
    currentVersion: result.currentVersion,
    lastCheckedAt: new Date().toISOString(),
  }),
  check: async () => {
    if (get().checking || get().installing) return
    set({ checking: true })
    try {
      get().applyResult(await checkForUpdates())
    } catch {
      set({ available: false, lastCheckedAt: new Date().toISOString() })
    } finally {
      set({ checking: false })
    }
  },
  install: async () => {
    set({ installing: true })
    try {
      await installAvailableUpdate()
    } finally {
      set({ installing: false })
    }
  },
}))
