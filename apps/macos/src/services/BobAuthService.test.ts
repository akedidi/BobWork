import { describe, expect, it } from 'vitest'
import { resolveSessionApiKeyStatus } from './BobAuthService'

describe('resolveSessionApiKeyStatus', () => {
  it('shows a vault API key even when SSO is also available', () => {
    expect(resolveSessionApiKeyStatus({
      authenticated: true,
      authenticationMethod: 'api_key_session',
    }, false)).toEqual({
      active: true,
      source: 'session',
      vaultKeyPresent: true,
    })
  })

  it('treats has_session_secret as a vault key', () => {
    expect(resolveSessionApiKeyStatus({
      authenticated: true,
      authenticationMethod: 'sso_session_detected',
    }, true).vaultKeyPresent).toBe(true)
  })

  it('does not pretend a vault key exists for SSO-only auth', () => {
    expect(resolveSessionApiKeyStatus({
      authenticated: true,
      authenticationMethod: 'sso_session_detected',
    }, false)).toEqual({
      active: true,
      source: 'sso',
      vaultKeyPresent: false,
    })
  })

  it('reports no credentials when nothing is configured', () => {
    expect(resolveSessionApiKeyStatus({
      authenticated: false,
      authenticationMethod: 'required',
    }, false).vaultKeyPresent).toBe(false)
  })
})
