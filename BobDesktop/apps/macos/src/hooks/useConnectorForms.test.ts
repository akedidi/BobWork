import { describe, expect, it } from 'vitest'
import { parseEnvLines, parseHeaderLines, redactedFieldNames, redactedQueryName, slugifyName } from './useConnectorForms'

describe('connector form helpers', () => {
  it('keeps only valid populated environment and header values', () => {
    expect(parseEnvLines('TOKEN=next\nEXISTING=\n# ignored')).toEqual({ TOKEN: 'next' })
    expect(parseHeaderLines('Authorization: Bearer next\nX-Keep:\n# ignored')).toEqual({ Authorization: 'Bearer next' })
  })

  it('recovers secret field names without exposing values', () => {
    expect(redactedFieldNames({ Authorization: '<redacted>', 'X-Api-Key': '<redacted>' })).toEqual(['Authorization', 'X-Api-Key'])
    expect(redactedFieldNames({ _redacted: true })).toEqual([])
    expect(redactedQueryName('https://example.test/mcp?api_key=%3Credacted%3E')).toBe('api_key')
  })

  it('normalizes an edited connector name', () => {
    expect(slugifyName('Mon API Démo')).toBe('mon-api-d-mo')
  })
})
