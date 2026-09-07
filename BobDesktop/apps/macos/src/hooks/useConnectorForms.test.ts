import { describe, expect, it } from 'vitest'
import { createEnvironmentField, environmentFieldsAreValid, environmentFieldsToRecord, parseHeaderLines, redactedFieldNames, redactedQueryName, removedEnvironmentKeys, slugifyName } from './useConnectorForms'

describe('connector form helpers', () => {
  it('serializes only complete structured environment fields', () => {
    expect(environmentFieldsToRecord([
      { ...createEnvironmentField(), key: 'TOKEN', value: 'next' },
      createEnvironmentField(),
    ])).toEqual({ TOKEN: 'next' })
    expect(parseHeaderLines('Authorization: Bearer next\nX-Keep:\n# ignored')).toEqual({ Authorization: 'Bearer next' })
  })

  it('validates names, duplicates and preserved secret values', () => {
    expect(environmentFieldsAreValid([{ ...createEnvironmentField(), key: 'DEBUG', value: '1' }])).toBe(true)
    expect(environmentFieldsAreValid([createEnvironmentField('API_TOKEN', true)])).toBe(true)
    expect(environmentFieldsAreValid([{ ...createEnvironmentField(), key: 'BAD-NAME', value: '1' }])).toBe(false)
    expect(environmentFieldsAreValid([
      { ...createEnvironmentField(), key: 'DEBUG', value: '1' },
      { ...createEnvironmentField(), key: 'DEBUG', value: '0' },
    ])).toBe(false)
  })

  it('identifies a persisted variable removed by the user', () => {
    expect(removedEnvironmentKeys([createEnvironmentField('DEBUG', true)], ['API_TOKEN', 'DEBUG'])).toEqual(['API_TOKEN'])
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
