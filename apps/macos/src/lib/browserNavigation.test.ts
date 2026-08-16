import { describe, expect, it } from 'vitest'
import { isLocalDevelopmentBrowserUrl, isTrustedEmbeddedBrowserUrl, normalizeBrowserUrl } from './browserNavigation'

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

describe('isTrustedEmbeddedBrowserUrl', () => {
  it.each([
    'https://bob.ibm.com/docs',
    'http://localhost:3000/',
    'http://dev:secret@localhost:3000/private',
    'https://127.0.0.1:8443/',
    'http://[::1]:5173/',
  ])('allows an explicitly trusted HTTPS documentation host: %s', value => {
    expect(isTrustedEmbeddedBrowserUrl(value)).toBe(true)
  })

  it.each([
    'http://github.com/openai/codex',
    'https://evil.github.com.example.test/',
    'https://login.microsoftonline.com/common/oauth2/authorize',
    'http://localhost.example.test:3000/',
    'about:blank',
  ])('keeps untrusted or sensitive navigation outside the WebView: %s', value => {
    expect(isTrustedEmbeddedBrowserUrl(value)).toBe(false)
  })

  it('classifies only exact loopback hosts as local development pages', () => {
    expect(isLocalDevelopmentBrowserUrl('http://localhost:1420/')).toBe(true)
    expect(isLocalDevelopmentBrowserUrl('http://dev:secret@localhost:1420/')).toBe(true)
    expect(isLocalDevelopmentBrowserUrl('http://127.0.0.1:5173/')).toBe(true)
    expect(isLocalDevelopmentBrowserUrl('https://example.com/')).toBe(false)
  })
})
