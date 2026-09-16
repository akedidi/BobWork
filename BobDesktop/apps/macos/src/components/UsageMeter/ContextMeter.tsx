import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { listen } from '@tauri-apps/api/event'
import { localeToBcp47, useI18n } from '../../i18n'
import { useAppStore, useConversationStore } from '../../stores/appStore'
import { useContextDraftStore } from '../../stores/contextDraftStore'

const DEFAULT_WINDOW = 128_000 // Same fallback as bob_context.rs.
const estimate = (text: string) => Math.ceil(Array.from(text).length / 4)
interface ContextUsage { conversationId: string; tokens: number; window: number }

export function ContextMeter() {
  const { locale, t } = useI18n()
  const { pathname } = useLocation()
  const conversationId = pathname.match(/^\/chat\/([^/]+)/)?.[1]
  const conversation = useAppStore(s => s.conversations.find(c => c.id === conversationId))
  const messages = useConversationStore(s => conversationId ? s.messages[conversationId] : undefined)
  const draft = useContextDraftStore(s => s.text)
  const [live, setLive] = useState<Record<string, ContextUsage>>({})

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    listen<ContextUsage>('bob-context-usage', ({ payload }) => {
      if (!disposed) setLive(previous => ({ ...previous, [payload.conversationId]: payload }))
    }).then(fn => { if (disposed) fn(); else unlisten = fn }).catch(() => {})
    return () => { disposed = true; unlisten?.() }
  }, [])

  if (pathname !== '/' && pathname !== '/chat' && !conversationId) return null
  const state = conversation?.bobContextState
  const current = conversationId ? live[conversationId] : undefined
  const measured = current?.tokens ?? state?.lastContextTokens
  const window = current?.window ?? state?.lastContextWindow
  const maximum = typeof window === 'number' && window > 0 ? window : DEFAULT_WINDOW
  const hasMeasurement = typeof measured === 'number' && Number.isFinite(measured) && measured >= 0
  const tokens = (hasMeasurement ? measured : estimate((messages ?? []).map(m => m.content).join('\n'))) + estimate(draft)
  const numberLocale = localeToBcp47(locale)
  return (
    <div aria-label={t('usage.contextSize')} title={t('usage.contextTooltip')} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
      <span>{t('usage.context')}</span>
      <span>{tokens.toLocaleString(numberLocale)} / {maximum.toLocaleString(numberLocale)}</span>
    </div>
  )
}
