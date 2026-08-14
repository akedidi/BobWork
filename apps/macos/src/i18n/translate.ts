import { en, type MessageTree } from './locales/en'
import { fr } from './locales/fr'
import { es } from './locales/es'
import type { AppLocale } from './resolveLocale'

const catalogs: Record<AppLocale, MessageTree> = { en, fr, es }

/** Dot-path keys such as `nav.newChat`. Kept as string to avoid deep type recursion. */
export type MessageKey = string

function lookup(tree: MessageTree, key: string): string | undefined {
  const parts = key.split('.')
  let current: unknown = tree
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

export function translate(
  locale: AppLocale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const raw =
    lookup(catalogs[locale], key)
    ?? lookup(catalogs.en, key)
    ?? key
  if (!params) return raw
  return raw.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    params[name] !== undefined ? String(params[name]) : `{{${name}}}`)
}
