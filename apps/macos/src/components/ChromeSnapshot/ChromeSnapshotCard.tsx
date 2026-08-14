import type { ChromeSnapshot } from '../../lib/chromeSnapshot'
import { isLocalDevelopmentBrowserUrl, isTrustedEmbeddedBrowserUrl } from '../../lib/browserNavigation'
import { useT } from '../../i18n'

export function ChromeSnapshotCard({
  snapshot,
  onOpen,
}: {
  snapshot: ChromeSnapshot
  onOpen?: (url: string, title?: string) => void
}) {
  const t = useT()
  const hostname = (() => {
    try { return snapshot.url ? new URL(snapshot.url).hostname : '' } catch { return '' }
  })()
  const open = () => {
    if (snapshot.url) onOpen?.(snapshot.url, snapshot.title)
  }
  const trustedForEmbedding = Boolean(snapshot.url && isTrustedEmbeddedBrowserUrl(snapshot.url))
  const localDevelopment = Boolean(snapshot.url && isLocalDevelopmentBrowserUrl(snapshot.url))
  return (
    <article className={`chrome-snapshot-card ${snapshot.pending ? 'is-pending' : ''} ${snapshot.failed ? 'is-failed' : ''}`}>
      <header className="chrome-snapshot-bar">
        <span className="chrome-snapshot-dot" aria-hidden="true" />
        <span className="chrome-snapshot-url" title={snapshot.url || undefined}>
          {hostname || snapshot.url || 'Chrome'}
        </span>
        {snapshot.pending ? <span className="chrome-snapshot-state">{t('chromeSnapshot.reading')}</span> : null}
        {snapshot.failed ? <span className="chrome-snapshot-state is-failed">{t('chromeSnapshot.failed')}</span> : null}
      </header>
      <div className="chrome-snapshot-preview">
        {trustedForEmbedding ? (
          <iframe
            src={snapshot.url}
            title={snapshot.title}
            sandbox={localDevelopment
              ? 'allow-forms allow-modals allow-popups allow-scripts allow-same-origin'
              : 'allow-forms allow-scripts'}
            referrerPolicy={localDevelopment ? 'strict-origin-when-cross-origin' : 'no-referrer'}
            tabIndex={-1}
          />
        ) : (
          <span className="chrome-snapshot-empty">
            {snapshot.url ? t('chromeSnapshot.externalProtected') : t('chromeSnapshot.waitingTab')}
          </span>
        )}
      </div>
      <div className="chrome-snapshot-meta">
        <strong>{snapshot.title}</strong>
        {snapshot.headings.length > 0 ? (
          <p className="chrome-snapshot-outline">{snapshot.headings.slice(0, 4).join(' · ')}</p>
        ) : snapshot.text ? (
          <p className="chrome-snapshot-outline">{snapshot.text.slice(0, 160)}</p>
        ) : (
          <p className="chrome-snapshot-outline">{t('chromeSnapshot.previewOutline')}</p>
        )}
        {snapshot.url ? (
          <button type="button" className="chrome-snapshot-open" onClick={open}>
            {t('chromeSnapshot.openPanel')}
          </button>
        ) : null}
      </div>
    </article>
  )
}
