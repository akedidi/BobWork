import { getActiveLocale } from '../i18n'

/** Locale-aware short datetime for catalog detail panels (skills, plugins, …). */
export function formatCatalogDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(getActiveLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
