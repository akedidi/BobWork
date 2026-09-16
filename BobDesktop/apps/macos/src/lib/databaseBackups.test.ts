import { describe, expect, it } from 'vitest'
import {
  databaseBackupKind,
  formatDatabaseBackupDate,
  parseDatabaseBackupDate,
} from './databaseBackups'

describe('databaseBackups', () => {
  it('detects backup kind from filename', () => {
    expect(databaseBackupKind('bob-work-automatic-20260910T172120Z.sqlite')).toBe('automatic')
    expect(databaseBackupKind('bob-work-manual-20260910T172120Z.sqlite')).toBe('manual')
    expect(databaseBackupKind('other.sqlite')).toBe('unknown')
  })

  it('parses compact and ISO timestamps', () => {
    const compact = parseDatabaseBackupDate('20260910T172120Z')
    expect(compact?.toISOString()).toBe('2026-09-10T17:21:20.000Z')

    const iso = parseDatabaseBackupDate('2026-09-10T17:21:20+00:00')
    expect(iso?.toISOString()).toBe('2026-09-10T17:21:20.000Z')
  })

  it('formats backup date for the active locale', () => {
    const formatted = formatDatabaseBackupDate('20260910T172120Z', 'fr')
    expect(formatted).toContain('2026')
    expect(formatted).toMatch(/\d{1,2}:\d{2}/)
  })
})
