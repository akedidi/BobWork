import { useEffect } from 'react'
import { INITIAL_UPDATE_CHECK_DELAY_MS, UPDATE_CHECK_INTERVAL_MS, useUpdateStore } from '../stores/updateStore'

/** Polls GitHub Releases for a signed update; local/dev builds stay silent when no channel is configured. */
export function UpdateController() {
  const check = useUpdateStore(state => state.check)

  useEffect(() => {
    let disposed = false
    const run = () => {
      if (!disposed) void check()
    }
    const initial = window.setTimeout(run, INITIAL_UPDATE_CHECK_DELAY_MS)
    const interval = window.setInterval(run, UPDATE_CHECK_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [check])

  return null
}
