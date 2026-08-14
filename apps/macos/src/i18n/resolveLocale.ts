export type AppLocale = 'en' | 'fr' | 'es'

const SUPPORTED: AppLocale[] = ['en', 'fr', 'es']

/** Resolve UI locale from settings preference + system language. Default: English. */
export function resolveLocale(
  preference: string | null | undefined,
  systemLanguage: string = typeof navigator !== 'undefined' ? navigator.language : 'en',
): AppLocale {
  const pref = (preference ?? 'auto').trim().toLowerCase()
  if (SUPPORTED.includes(pref as AppLocale)) return pref as AppLocale

  const base = systemLanguage.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  if (SUPPORTED.includes(base as AppLocale)) return base as AppLocale
  return 'en'
}

export function localeToBcp47(locale: AppLocale): string {
  switch (locale) {
    case 'fr':
      return 'fr-FR'
    case 'es':
      return 'es-ES'
    default:
      return 'en-US'
  }
}
