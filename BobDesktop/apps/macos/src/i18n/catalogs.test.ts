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

  it('defines every literal translation key used by the desktop interface', () => {
    const used = new Map<string, string[]>()
    const sources = import.meta.glob('../**/*.{ts,tsx}', {
      eager: true,
      import: 'default',
      query: '?raw',
    }) as Record<string, string>
    for (const [file, source] of Object.entries(sources)) {
      for (const match of source.matchAll(/\bt\(\s*(['"])([^'"\n]+)\1/g)) {
        const key = match[2]
        const line = source.slice(0, match.index).split('\n').length
        used.set(key, [...(used.get(key) ?? []), `${file}:${line}`])
      }
    }

    const missing = [...used]
      .filter(([key]) => !english[key])
      .map(([key, locations]) => `${key} (${locations.join(', ')})`)

    expect(missing).toEqual([])
  })

  it('includes DB connection and plugin file resource keys in fr/en/es', () => {
    const keys = [
      'integrations.tabDb',
      'integrations.dbHintDb2',
      'integrations.dbSave',
      'integrations.dbTest',
      'composer.databases',
      'composer.noDatabases',
      'plugins.fileResources',
      'plugins.linkedDatabases',
      'plugins.configureInDb',
      'plugins.resourceKindDatabase',
      'plugins.sectionIbm',
      'plugins.sectionBusiness',
      'plugins.sectionBuiltin',
      'plugins.filterBusiness',
    ]
    for (const catalog of [english, flatten(fr), flatten(es)]) {
      for (const key of keys) {
        expect(catalog[key]?.trim(), key).toBeTruthy()
      }
    }
  })
})
