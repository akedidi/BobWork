import { useT } from '../../i18n'
import type { ConnectionTestSummary } from '@bob-work/shared-types'

function formatTestedAt(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(document.documentElement.lang || 'en', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export function ConnectionTestBadge({ test, compact = false }: { test?: ConnectionTestSummary | null; compact?: boolean }) {
  const t = useT()
  if (!test) {
    return <span className={`plugin-mcp-state untested${compact ? ' compact' : ''}`}>{t('integrations.untested')}</span>
  }
  const when = formatTestedAt(test.testedAt)
  return (
    <span
      className={`plugin-mcp-state ${test.ok ? 'connected' : 'failed'}${compact ? ' compact' : ''}`}
      title={when ? `${test.message} · ${when}` : test.message}
    >
      {test.ok ? t('integrations.testOk') : t('integrations.testFail')}{when && !compact ? ` · ${when}` : ''}
    </span>
  )
}
