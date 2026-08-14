import { describe, expect, it } from 'vitest'
import { statusTone } from './statusTone'

describe('statusTone', () => {
  it('marks successful MCP tests as success', () => {
    expect(statusTone('cto-market : Connexion MCP OK — 3 outil(s).')).toBe('success')
  })

  it('keeps ordinary information neutral and identifies failures', () => {
    expect(statusTone('Connexion en cours…')).toBe('neutral')
    expect(statusTone('cto-market — échec : timeout')).toBe('error')
  })
})
