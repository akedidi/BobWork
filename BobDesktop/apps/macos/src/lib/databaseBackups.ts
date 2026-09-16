import { localeToBcp47, type AppLocale } from '../i18n/resolveLocale'

export type DatabaseBackupKind = 'automatic' | 'manual' | 'unknown'

export function databaseBackupKind(name: string): DatabaseBackupKind {
  if (name.startsWith('bob-work-automatic-')) return 'automatic'
  if (name.startsWith('bob-work-manual-')) return 'manual'
  return 'unknown'
}

export function parseDatabaseBackupDate(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const iso = Date.parse(trimmed)
  if (!Number.isNaN(iso)) return new Date(iso)

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(trimmed)
  if (!match) return null

  const [, year, month, day, hour, minute, second] = match
  return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second))
}

export function formatDatabaseBackupDate(raw: string, locale: AppLocale): string {
  const date = parseDatabaseBackupDate(raw)
  if (!date) return raw
  return date.toLocaleString(localeToBcp47(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
