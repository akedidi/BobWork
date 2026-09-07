import { useEffect, type RefObject } from 'react'

export function useChatScroll(
  bottomRef: RefObject<HTMLElement>,
  dependencies: unknown[]
) {
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, dependencies)
}
