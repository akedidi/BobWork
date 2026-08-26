import { useEffect, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
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
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => setImageFailed(false), [snapshot.imagePath, snapshot.url])
  // Persisted activity from native apps may predate the extractor guard.
  // Native schemes and empty snapshots must never become Chrome cards.
  if (!/^https?:\/\//i.test(snapshot.url)) return null
  const hostname = (() => {
    try { return snapshot.url ? new URL(snapshot.url).hostname : '' } catch { return '' }
  })()
  const open = () => {
    if (snapshot.url) onOpen?.(snapshot.url, snapshot.title)
  }
  const trustedForEmbedding = Boolean(snapshot.url && isTrustedEmbeddedBrowserUrl(snapshot.url))
  const localDevelopment = Boolean(snapshot.url && isLocalDevelopmentBrowserUrl(snapshot.url))
  const remoteImage = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(snapshot.url)
    ? snapshot.url
    : ''
  let visualSource = snapshot.imagePath || remoteImage
  if (snapshot.imagePath) {
    try { visualSource = convertFileSrc(snapshot.imagePath) } catch { /* Browser tests use the path directly. */ }
  }
  const hasImage = Boolean(visualSource && !imageFailed)
  const hasFrame = !hasImage && trustedForEmbedding
  const compactLabel = snapshot.background
    ? t('chromeSnapshot.backgroundFetched')
    : t('chromeSnapshot.externalProtected')
  return (
    <article className={`chrome-snapshot-card ${snapshot.pending ? 'is-pending' : ''} ${snapshot.failed ? 'is-failed' : ''} ${!hasImage && !hasFrame ? 'is-compact' : ''}`}>
      <header className="chrome-snapshot-bar">
        <span className="chrome-snapshot-dot" aria-hidden="true" />
        <span className="chrome-snapshot-url" title={snapshot.url || undefined}>
          {hostname || snapshot.url || 'Chrome'}
        </span>
        {snapshot.pending ? <span className="chrome-snapshot-state">{t('chromeSnapshot.reading')}</span> : null}
        {snapshot.failed ? <span className="chrome-snapshot-state is-failed">{t('chromeSnapshot.failed')}</span> : null}
      </header>
      {(hasImage || hasFrame) && <div className="chrome-snapshot-preview">
        {hasImage ? (
          <img
            src={visualSource}
            alt={`Aperçu de ${snapshot.title}`}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <iframe
            src={snapshot.url}
            title={snapshot.title}
            sandbox={localDevelopment
              ? 'allow-forms allow-modals allow-popups allow-scripts allow-same-origin'
              : 'allow-forms allow-scripts'}
            referrerPolicy={localDevelopment ? 'strict-origin-when-cross-origin' : 'no-referrer'}
            tabIndex={-1}
          />
        )}
      </div>}
      <div className="chrome-snapshot-meta">
        <strong>{snapshot.title}</strong>
        {snapshot.headings.length > 0 ? (
          <p className="chrome-snapshot-outline">{snapshot.headings.slice(0, 4).join(' · ')}</p>
        ) : snapshot.text ? (
          <p className="chrome-snapshot-outline">{snapshot.text.slice(0, 160)}</p>
        ) : (
          <p className="chrome-snapshot-outline">
            {!hasImage && !hasFrame && snapshot.url
              ? compactLabel
              : t('chromeSnapshot.previewOutline')}
          </p>
        )}
        {!hasImage && !hasFrame && snapshot.url ? (
          <span className="chrome-snapshot-visual-state">{compactLabel}</span>
        ) : null}
        {snapshot.url ? (
          <button type="button" className="chrome-snapshot-open" onClick={open}>
            {t('chromeSnapshot.openPanel')}
          </button>
        ) : null}
      </div>
    </article>
  )
}
