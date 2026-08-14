import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AppSettings } from '@bob-work/shared-types'
import { getSettings } from '../lib/ipc'
import { localeToBcp47, resolveLocale, type AppLocale } from './resolveLocale'
import { translate, type MessageKey } from './translate'

type TFunction = (key: MessageKey, params?: Record<string, string | number>) => string

interface I18nContextValue {
  locale: AppLocale
  t: TFunction
  setLocalePreference: (preference: string) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)
const fallbackContexts = new Map<AppLocale, I18nContextValue>()

function applyDocumentLang(locale: AppLocale) {
  document.documentElement.lang = locale
}

/** Optional override used by unit tests (e.g. force French). */
let testLocaleOverride: AppLocale | null = null

export function setTestLocale(locale: AppLocale | null) {
  testLocaleOverride = locale
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(() =>
    testLocaleOverride ?? resolveLocale('auto'),
  )

  const applyPreference = useCallback((preference: string) => {
    const next = testLocaleOverride ?? resolveLocale(preference)
    setLocale(next)
    applyDocumentLang(next)
  }, [])

  useEffect(() => {
    let disposed = false
    getSettings()
      .then(settings => {
        if (!disposed) applyPreference(settings.language)
      })
      .catch(() => {
        if (!disposed) applyPreference('auto')
      })

    const onSettings = (event: Event) => {
      const settings = (event as CustomEvent<AppSettings>).detail
      if (settings?.language) applyPreference(settings.language)
    }
    window.addEventListener('bob-settings-updated', onSettings)
    return () => {
      disposed = true
      window.removeEventListener('bob-settings-updated', onSettings)
    }
  }, [applyPreference])

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, params) => translate(locale, key, params),
    setLocalePreference: applyPreference,
  }), [locale, applyPreference])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    // Safe fallback for tests that forget the provider
    const locale = testLocaleOverride ?? resolveLocale('auto')
    const cached = fallbackContexts.get(locale)
    if (cached) return cached
    const fallback: I18nContextValue = {
      locale,
      t: (key, params) => translate(locale, key, params),
      setLocalePreference: () => {},
    }
    fallbackContexts.set(locale, fallback)
    return fallback
  }
  return ctx
}

export function useT(): TFunction {
  return useI18n().t
}

export { localeToBcp47, resolveLocale }
export type { AppLocale, MessageKey }
