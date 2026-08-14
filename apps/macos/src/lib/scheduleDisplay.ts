const FREQUENCY_LABELS: Record<string, string> = {
  'every day': 'Chaque jour',
  'every week': 'Chaque semaine',
  'every month': 'Chaque mois',
  'every hour': 'Chaque heure',
  'in 5 minutes': 'Dans 5 minutes (test)',
}

export function formatScheduleFrequency(cronOrEvent: string, runAt?: string | null): string {
  const base = FREQUENCY_LABELS[cronOrEvent] ?? cronOrEvent
  if (!runAt || cronOrEvent === 'in 5 minutes') return base
  if (cronOrEvent === 'every hour') return `${base} (minute :${runAt.split(':')[1] ?? '00'})`
  return `${base} à ${runAt}`
}

export function showRunAtField(cronOrEvent: string): boolean {
  return cronOrEvent !== 'in 5 minutes'
}
