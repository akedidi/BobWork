export type StatusTone = 'neutral' | 'success' | 'error'

export function statusTone(message: string): StatusTone {
  if (/connexion mcp ok|test réussi|test passed/i.test(message)) return 'success'
  if (/échec|erreur|error|failed|timeout/i.test(message)) return 'error'
  return 'neutral'
}
