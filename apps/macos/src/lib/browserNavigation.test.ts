import { describe, expect, it } from 'vitest'
import { normalizeBrowserUrl } from './browserNavigation'

describe('normalizeBrowserUrl', () => {
  it('normalizes hostnames to HTTPS and preserves HTTP(S)', () => {
    expect(normalizeBrowserUrl('example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeBrowserUrl('http://localhost:3000/path')).toBe('http://localhost:3000/path')
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'not a valid host',
  ])('blocks hostile or unsupported navigation: %s', value => {
    expect(normalizeBrowserUrl(value)).toBe('about:blank')
  })
})
