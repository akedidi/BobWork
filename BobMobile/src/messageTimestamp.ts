import { formatMessageTimestamp as formatSharedTimestamp } from '@bob-work/chat-display'
import { languageLocales, type Language } from './i18n'

/** Format a conversation message date using the shared Desktop display rule. */
export function formatMessageTimestamp(
  value: string,
  language: Language,
  now: Date = new Date(),
): string {
  return formatSharedTimestamp(value, languageLocales[language], now)
}
