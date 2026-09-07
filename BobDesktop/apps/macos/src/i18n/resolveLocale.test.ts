import { describe, expect, it } from 'vitest'
import { resolveLocale } from './resolveLocale'
import { translate } from './translate'

describe('resolveLocale', () => {
  it('honours an explicit preference', () => {
    expect(resolveLocale('fr', 'en-US')).toBe('fr')
    expect(resolveLocale('en', 'fr-FR')).toBe('en')
    expect(resolveLocale('es', 'de-DE')).toBe('es')
  })

  it('detects the system language when preference is auto', () => {
    expect(resolveLocale('auto', 'fr-FR')).toBe('fr')
    expect(resolveLocale('auto', 'en-GB')).toBe('en')
    expect(resolveLocale('auto', 'es-MX')).toBe('es')
  })

  it('falls back to English when the system language is unsupported', () => {
    expect(resolveLocale('auto', 'de-DE')).toBe('en')
    expect(resolveLocale('auto', 'ja-JP')).toBe('en')
    expect(resolveLocale('pt', 'pt-BR')).toBe('en')
    expect(resolveLocale('', '')).toBe('en')
  })
})

describe('translate', () => {
  it('interpolates params and falls back to English keys', () => {
    expect(translate('fr', 'approval.risk', { level: 'Moyen' })).toBe('Risque Moyen')
    expect(translate('en', 'nav.newChat')).toBe('New chat')
    expect(translate('es', 'nav.tasks')).toBe('Tareas')
  })
})
