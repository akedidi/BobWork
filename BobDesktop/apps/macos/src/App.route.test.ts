import { describe, expect, it } from 'vitest'
import { LAUNCH_ROUTE } from './App'

describe('app launch route', () => {
  it('always opens on the main New Chat home surface', () => {
    expect(LAUNCH_ROUTE).toBe('/')
  })
})
