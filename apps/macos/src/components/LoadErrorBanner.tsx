import { errorMessage } from '../lib/errorMessage'
import { useT } from '../i18n'

/** Inline banner when a view fails to load — never confuse with empty state. */
export function LoadErrorBanner({
  error,
  onRetry,
  fallback,
}: {
  error: unknown
  onRetry?: () => void
  fallback?: string
}) {
  const t = useT()
  if (!error) return null
  const message = errorMessage(error, fallback ?? t('common.loadFailed'))
  return (
    <div
      role="alert"
      className="load-error-banner"
      style={{
        margin: '12px 20px',
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-surface))',
        color: 'var(--text-primary)',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="secondary-btn compact" onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  )
}
