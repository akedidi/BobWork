const TODAY_LABELS: Record<string, string> = {
  en: 'Today',
  es: 'Hoy',
  fr: 'Aujourd’hui',
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function capitalize(value: string, locale: string): string {
  if (!value) return value
  return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1)
}

/** Format a conversation message date in the user's local timezone. */
export function formatMessageTimestamp(
  value: string,
  locale: string,
  now: Date = new Date(),
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)

  const language = locale.toLowerCase().split(/[-_]/)[0] ?? 'en'
  if (isSameLocalDay(date, now)) {
    return `${time} · ${TODAY_LABELS[language] ?? TODAY_LABELS.en}`
  }

  const dayAndDate = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
  }).format(date)

  return `${time} · ${capitalize(dayAndDate, locale)}`
}
