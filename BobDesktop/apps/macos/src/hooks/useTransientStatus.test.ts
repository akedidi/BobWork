import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransientStatus } from './useTransientStatus'

describe('useTransientStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the toast after 3 seconds', () => {
    const { result } = renderHook(() => useTransientStatus(3000))
    act(() => {
      result.current[1]('Ansible removed. Plugins and artifacts were kept.')
    })
    expect(result.current[0]).toBe('Ansible removed. Plugins and artifacts were kept.')
    act(() => {
      vi.advanceTimersByTime(2999)
    })
    expect(result.current[0]).toBe('Ansible removed. Plugins and artifacts were kept.')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current[0]).toBe('')
  })

  it('resets the timer when a new toast replaces the previous one', () => {
    const { result } = renderHook(() => useTransientStatus(3000))
    act(() => {
      result.current[1]('first')
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => {
      result.current[1]('second')
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current[0]).toBe('second')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current[0]).toBe('')
  })

  it('re-arms dismiss after effect cleanup (Strict Mode)', () => {
    const { result, unmount, rerender } = renderHook(() => useTransientStatus(3000))
    act(() => {
      result.current[1]('sticky candidate')
    })
    // Simulate Strict Mode: cleanup clears the timer, then effect runs again.
    rerender()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current[0]).toBe('')
    unmount()
  })

  it('restarts the timer when the same message is set again', () => {
    const { result } = renderHook(() => useTransientStatus(3000))
    act(() => {
      result.current[1]('same')
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => {
      result.current[1]('same')
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current[0]).toBe('same')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current[0]).toBe('')
  })
})
