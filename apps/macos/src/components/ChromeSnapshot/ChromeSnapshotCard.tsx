import type { ChromeSnapshot } from '../../lib/chromeSnapshot'

export function ChromeSnapshotCard({
  snapshot,
  onOpen,
}: {
  snapshot: ChromeSnapshot
  onOpen?: (url: string, title?: string) => void
}) {
  const hostname = (() => {
    try { return snapshot.url ? new URL(snapshot.url).hostname : '' } catch { return '' }
  })()
  const open = () => {
    if (snapshot.url) onOpen?.(snapshot.url, snapshot.title)
  }
  return (
    <article className={`chrome-snapshot-card ${snapshot.pending ? 'is-pending' : ''} ${snapshot.failed ? 'is-failed' : ''}`}>
      <header className="chrome-snapshot-bar">
        <span className="chrome-snapshot-dot" aria-hidden="true" />
        <span className="chrome-snapshot-url" title={snapshot.url || undefined}>
          {hostname || snapshot.url || 'Chrome'}
        </span>
        {snapshot.pending ? <span className="chrome-snapshot-state">Lecture…</span> : null}
        {snapshot.failed ? <span className="chrome-snapshot-state is-failed">Échec</span> : null}
      </header>
      <div className="chrome-snapshot-preview">
        {snapshot.url ? (
          <iframe
            src={snapshot.url}
            title={snapshot.title}
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
          />
        ) : (
          <span className="chrome-snapshot-empty">En attente de l’onglet Chrome…</span>
        )}
      </div>
      <div className="chrome-snapshot-meta">
        <strong>{snapshot.title}</strong>
        {snapshot.headings.length > 0 ? (
          <p className="chrome-snapshot-outline">{snapshot.headings.slice(0, 4).join(' · ')}</p>
        ) : snapshot.text ? (
          <p className="chrome-snapshot-outline">{snapshot.text.slice(0, 160)}</p>
        ) : (
          <p className="chrome-snapshot-outline">Aperçu de l’onglet Chrome utilisé par Bob.</p>
        )}
        {snapshot.url ? (
          <button type="button" className="chrome-snapshot-open" onClick={open}>
            Ouvrir dans le panneau
          </button>
        ) : null}
      </div>
    </article>
  )
}
