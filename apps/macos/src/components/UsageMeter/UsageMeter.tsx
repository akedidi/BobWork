import type { UsageStatus } from '@bob-work/shared-types'

function formatAmount(value?: number) {
  if (value == null || Number.isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function resolvedTotal(usage: UsageStatus) {
  if (usage.totalAmount != null && usage.totalAmount > 0) return usage.totalAmount
  if (usage.usedAmount != null && usage.remainingAmount != null) {
    const total = usage.usedAmount + usage.remainingAmount
    return total > 0 ? total : null
  }
  return null
}

function usagePercent(usage: UsageStatus) {
  const total = resolvedTotal(usage)
  if (usage.usedAmount == null || total == null) return null
  return Math.min(100, Math.max(0, (usage.usedAmount / total) * 100))
}

function barTone(percent: number | null) {
  if (percent == null) return 'neutral'
  if (percent >= 95) return 'critical'
  if (percent >= 80) return 'warning'
  return 'normal'
}

const TONE_COLOR: Record<string, string> = {
  normal: 'var(--accent)',
  warning: 'var(--warning)',
  critical: 'var(--danger)',
  neutral: 'var(--text-muted)',
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
  const total = resolvedTotal(usage)
  const usedLabel = formatAmount(usage.usedAmount)
  const totalLabel = total != null ? formatAmount(total) : null
  const remainingLabel = formatAmount(usage.remainingAmount)
  const unit = usage.unit ?? 'Bobcoins'
  const fillColor = TONE_COLOR[tone] ?? TONE_COLOR.normal

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
        <div
          className={`usage-meter-track usage-meter-track--${tone}`}
          role="progressbar"
          aria-label={`${unit} ${usedLabel} / ${totalLabel}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          style={{
            backgroundImage: `linear-gradient(to right, ${fillColor} ${percent}%, var(--bg-active) ${percent}%)`,
          }}
        />
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

  const className = `usage-meter ${compact ? 'usage-meter--compact' : ''}`
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} title={usage.message}>
        {body}
      </button>
    )
  }

  return <div className={className}>{body}</div>
}
