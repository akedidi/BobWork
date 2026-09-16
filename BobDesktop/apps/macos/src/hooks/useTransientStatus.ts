import { useCallback, useEffect, useState } from 'react'

type ToastState = { message: string; id: number }

/**
 * Transient status toast that always clears after `timeoutMs` (default 3s).
 * Uses a monotonic id so repeated identical messages still restart the timer,
 * and so Strict Mode / effect cleanup re-arms dismiss instead of leaving a sticky toast.
 */
export function useTransientStatus(timeoutMs: number = 3000) {
  const [toast, setToast] = useState<ToastState>({ message: '', id: 0 })

  const setStatus = useCallback((message: string) => {
    setToast(current => (
      message
        ? { message, id: current.id + 1 }
        : { message: '', id: current.id + 1 }
    ))
  }, [])

  useEffect(() => {
    if (!toast.message) return
    const timer = window.setTimeout(() => {
      setToast(current => (
        current.id === toast.id ? { message: '', id: current.id } : current
      ))
    }, timeoutMs)
    return () => window.clearTimeout(timer)
  }, [toast, timeoutMs])

  return [toast.message, setStatus] as const
}
