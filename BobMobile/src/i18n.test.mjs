import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { catalogs, formatDate, formatDateTime, formatNumber, formatTime, translate } from './i18n.ts'

const languages = ['fr', 'en', 'es']
const variables = value => [...value.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort()

test('all interface labels exist in French, English and Spanish', () => {
  const sourceKeys = Object.keys(catalogs.fr).sort()
  assert.ok(sourceKeys.length > 0)
  for (const language of languages) {
    assert.deepEqual(Object.keys(catalogs[language]).sort(), sourceKeys)
    for (const key of sourceKeys) {
      assert.ok(catalogs[language][key].trim(), `${language}.${key} is blank`)
      assert.deepEqual(variables(catalogs[language][key]), variables(catalogs.fr[key]), `${language}.${key}`)
    }
  }
})

test('translation interpolation and locale-sensitive formats follow the selected language', () => {
  assert.equal(translate('es', 'selectedCount', { count: 3 }), '3 seleccionado(s)')
  const date = new Date(2026, 8, 4, 15, 7)
  assert.match(formatDate(date, 'fr'), /sept/)
  assert.match(formatDate(date, 'en'), /Sep/)
  assert.match(formatDateTime(date, 'es'), /sept/)
  assert.equal(formatTime(date, 'fr'), '15:07')
  assert.equal(formatNumber(1234.5, 'fr'), '1\u202f234,5')
  assert.equal(formatNumber(1234.5, 'en'), '1,234.5')
})

test('screens do not bypass the selected language for dates and times', () => {
  const screens = fs.readdirSync(path.join(import.meta.dirname, 'screens')).filter(file => file.endsWith('.tsx'))
  for (const file of screens) {
    const source = fs.readFileSync(path.join(import.meta.dirname, 'screens', file), 'utf8')
    assert.doesNotMatch(source, /\.toLocale(?:Date|Time)?String\s*\(/, file)
  }
})

test('native permission labels contain the same keys in all three languages', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const localeObjects = languages.map(language => JSON.parse(fs.readFileSync(path.join(root, 'locales', `${language}.json`), 'utf8')))
  const keys = Object.keys(localeObjects[0]).sort()
  for (const values of localeObjects) {
    assert.deepEqual(Object.keys(values).sort(), keys)
    assert.ok(keys.every(key => values[key].trim()))
  }
  for (const language of languages) {
    const native = fs.readFileSync(path.join(root, 'ios', 'BobMobile', `${language}.lproj`, 'InfoPlist.strings'), 'utf8')
    for (const key of keys) assert.match(native, new RegExp(`"${key}"\\s*=`), `${language}.${key}`)
  }
})
