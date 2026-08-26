import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { UsageStatus } from '@bob-work/shared-types'

export function useTauriEvent<T>(
  event: string,
  handler: (payload: T) => void
) {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let mounted = true

    listen<T>(event, (e) => {
      if (mounted) handlerRef.current(e.payload)
    }).then(fn => {
      if (mounted) {
        unlisten = fn
      } else {
        fn()
      }
    }).catch(console.error)

    return () => {
      mounted = false
      if (unlisten) unlisten()
    }
  }, [event])
}

export function useConversationUpdated(handler: (id: string) => void) {
  useTauriEvent<string>('conversation-updated', handler)
}

export function useConversationMessagesChanged(handler: (id: string) => void) {
  useTauriEvent<string>('conversation-messages-changed', handler)
}

export function useTaskUpdated(handler: (id: string) => void) {
  useTauriEvent<string>('task-updated', handler)
}

export function useUsageUpdated(handler: (usage: UsageStatus) => void) {
  useTauriEvent<UsageStatus>('usage-updated', handler)
}

export function useBobSessionDone(handler: (payload: any) => void) { // Any for now since payloads differ
  useTauriEvent<any>('bob-session-done', handler)
}
