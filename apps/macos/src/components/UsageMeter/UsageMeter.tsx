import type { UsageStatus } from '@bob-work/shared-types'

function formatAmount(value?: number) {
  if (value == null || Number.isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function usagePercent(usage: UsageStatus) {
  if (usage.usedAmount == null || usage.totalAmount == null || usage.totalAmount <= 0) return null
  return Math.min(100, Math.max(0, (usage.usedAmount / usage.totalAmount) * 100))
}

function barTone(percent: number | null) {
  if (percent == null) return 'neutral'
  if (percent >= 95) return 'critical'
  if (percent >= 80) return 'warning'
  return 'normal'
}

export function UsageMeter({
  usage,
  compact = false,
  onClick,
}: {
  usage: UsageStatus | null
  compact?: boolean
  onClick?: () => void
}) {
  if (!usage) return null

  const percent = usagePercent(usage)
  const tone = barTone(percent)
  const usedLabel = formatAmount(usage.usedAmount)
  const totalLabel = usage.totalAmount != null ? formatAmount(usage.totalAmount) : null
  const remainingLabel = formatAmount(usage.remainingAmount)
  const unit = usage.unit ?? 'Bobcoins'

  const body = (
    <>
      <div className="usage-meter-head">
        <span className="usage-meter-title">{unit}</span>
        {totalLabel != null ? (
          <span className="usage-meter-value">{usedLabel} / {totalLabel}</span>
        ) : usage.available && usage.usedAmount != null ? (
          <span className="usage-meter-value">{usedLabel} utilisés</span>
        ) : (
          <span className="usage-meter-value usage-meter-value-muted">Indisponible</span>
        )}
      </div>
      {percent != null && (
        <div className="usage-meter-track" aria-hidden="true">
          <div className={`usage-meter-fill usage-meter-fill--${tone}`} style={{ width: `${percent}%` }} />
        </div>
      )}
      {!compact && (
        <div className="usage-meter-meta">
          {usage.instanceLabel && <span>{usage.instanceLabel}</span>}
          {usage.remainingAmount != null && totalLabel != null && (
            <span>{remainingLabel} restants</span>
          )}
          {!usage.available && usage.message && <span>{usage.message}</span>}
        </div>
      )}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={`usage-meter ${compact ? 'usage-meter--compact' : ''}`} onClick={onClick} title={usage.message}>
        {body}
      </button>
    )
  }

  return <div className={`usage-meter ${compact ? 'usage-meter--compact' : ''}`}>{body}</div>
}
