import { describe, expect, it } from 'vitest'
import { restorableRoute } from './App'

describe('restorableRoute', () => {
  it('restores a selected conversation after an application restart', () => {
    expect(restorableRoute('/chat/89c68d99-0796-42b3-918f-1c9948ea9682'))
      .toBe('/chat/89c68d99-0796-42b3-918f-1c9948ea9682')
  })

  it('falls back safely for malformed or external routes', () => {
    expect(restorableRoute('https://example.com')).toBe('/')
    expect(restorableRoute('/chat/a/b')).toBe('/')
    expect(restorableRoute(null)).toBe('/')
  })
})
