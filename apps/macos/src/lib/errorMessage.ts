export function errorMessage(error: unknown, fallback = 'Une erreur inconnue est survenue.'): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) return record.message
    if (typeof record.error === 'string' && record.error.trim()) return record.error

    for (const value of Object.values(record)) {
      if (typeof value === 'string' && value.trim()) return value
      if (value && typeof value === 'object') {
        const nested = errorMessage(value, '')
        if (nested) return nested
      }
    }
  }

  return fallback
}
