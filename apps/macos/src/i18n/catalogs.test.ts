import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { fr } from './locales/fr'
import { es } from './locales/es'

function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') entries[path] = value
    else if (value && typeof value === 'object') Object.assign(entries, flatten(value as Record<string, unknown>, path))
  }
  return entries
}

describe('i18n catalogs', () => {
  const english = flatten(en)

  it.each([['fr', fr], ['es', es]])('%s contains every source key and no blank value', (_locale, catalog) => {
    const localized = flatten(catalog)
    expect(Object.keys(localized).sort()).toEqual(Object.keys(english).sort())
    expect(Object.entries(localized).filter(([, value]) => !value.trim())).toEqual([])
  })

  it('keeps interpolation variables aligned between languages', () => {
    const variables = (value: string) => [...value.matchAll(/{{(\w+)}}/g)].map(match => match[1]).sort()
    for (const catalog of [flatten(fr), flatten(es)]) {
      for (const [key, source] of Object.entries(english)) {
        expect(variables(catalog[key]), key).toEqual(variables(source))
      }
    }
  })
})
