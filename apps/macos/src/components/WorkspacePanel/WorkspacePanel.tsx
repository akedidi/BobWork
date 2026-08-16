import { useEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open as chooseFile } from '@tauri-apps/plugin-dialog'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { openPreviewResource, prepareFilePreview, revealInFileManager } from '../../lib/ipc'
import type { FilePreview, TaskDetail } from '@bob-work/shared-types'
import { errorMessage } from '../../lib/errorMessage'
import { isLocalDevelopmentBrowserUrl, isTrustedEmbeddedBrowserUrl, normalizeBrowserUrl } from '../../lib/browserNavigation'

function safeFileSrc(path: string) {
  try {
    return convertFileSrc(path)
  } catch {
    return path
  }
}

export interface PanelActivity {
  eventType: string
  title?: string
  content?: string
  toolName?: string
  payload: Record<string, unknown>
}

export interface PreviewRequest {
  id: string
  target: string
  title?: string
  kind?: 'file' | 'web'
}

interface PanelTab {
  id: string
  kind: 'activity' | 'file' | 'web'
  title: string
  target?: string
  revision: number
}

export default function WorkspacePanel({ detail, live, running, request, onClose, variant = 'chat' }: {
  detail: TaskDetail | null
  live: PanelActivity[]
  running: boolean
  request?: PreviewRequest | null
  onClose: () => void
  /** `preview` hides the Activité tab (artifact gallery / standalone). */
  variant?: 'chat' | 'preview'
}) {
  const [tabs, setTabs] = useState<PanelTab[]>(() =>
    variant === 'preview'
      ? []
      : [{ id: 'activity', kind: 'activity', title: 'Activité', revision: 0 }],
  )
  const [activeId, setActiveId] = useState(variant === 'preview' ? '' : 'activity')
  const handledRequestId = useRef<string | null>(null)

  const openTarget = (target: string, title?: string, requestedKind?: 'file' | 'web') => {
    const kind = requestedKind ?? (/^https?:\/\//i.test(target) ? 'web' : 'file')
    let nextActive = ''
    setTabs(current => {
      const existing = target === 'about:blank'
        ? undefined
        : current.find(tab => tab.kind === kind && tab.target === target)
      if (existing) {
        nextActive = existing.id
        return current
      }
      const tab: PanelTab = {
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        target,
        title: title || resourceName(target),
        revision: 0,
      }
      nextActive = tab.id
      return [...current, tab]
    })
    if (nextActive) setActiveId(nextActive)
  }

  useEffect(() => {
    if (!request?.id || !request.target) return
    // React Strict Mode runs effects twice; ignore the duplicate for the same open action.
    if (handledRequestId.current === request.id) return
    handledRequestId.current = request.id
    openTarget(request.target, request.title, request.kind)
  }, [request?.id])

  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]
  const closeTab = (id: string) => {
    if (id === 'activity') return
    setTabs(current => {
      const index = current.findIndex(tab => tab.id === id)
      const next = current.filter(tab => tab.id !== id)
      if (activeId === id) setActiveId(next[Math.max(0, index - 1)]?.id ?? (variant === 'preview' ? next[0]?.id ?? '' : 'activity'))
      return next
    })
  }
  const updateTab = (id: string, update: Partial<PanelTab>) => setTabs(current => current.map(tab => tab.id === id ? { ...tab, ...update } : tab))

  return <aside className={`workspace-panel workspace-panel--${variant}`} aria-label="Aperçus et activité">
    <header className="workspace-panel-tabs">
      <div className="workspace-tab-strip" role="tablist" aria-label="Onglets du panneau">
        {tabs.map(tab => <div key={tab.id} role="tab" tabIndex={0} aria-selected={activeId === tab.id} className={`workspace-tab ${activeId === tab.id ? 'active' : ''}`} onClick={() => setActiveId(tab.id)} onKeyDown={event => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setActiveId(tab.id)
          }
        }} title={tab.target || tab.title}>
          <span className="workspace-tab-glyph" aria-hidden="true">{tab.kind === 'activity' ? '◌' : tab.kind === 'web' ? '◎' : fileGlyph(tab.title)}</span>
          <span className="workspace-tab-label">{tab.title}</span>
          {(tab.id !== 'activity' || variant === 'preview') && (
            <button
              type="button"
              className="workspace-tab-close"
              aria-label={`Fermer ${tab.title}`}
              onClick={event => { event.stopPropagation(); closeTab(tab.id) }}
            >×</button>
          )}
        </div>)}
      </div>
      <div className="workspace-panel-actions">
        <button type="button" className="workspace-tool-btn" title="Prévisualiser un fichier" aria-label="Prévisualiser un fichier" onClick={async () => {
          const selected = await chooseFile({ multiple: false, directory: false })
          if (typeof selected === 'string') openTarget(selected)
        }}>
          <PanelIcon kind="file" />
        </button>
        <button type="button" className="workspace-tool-btn" title="Nouvel onglet Web" aria-label="Nouvel onglet Web" onClick={() => openTarget('about:blank', 'Nouvel onglet', 'web')}>
          <PanelIcon kind="plus" />
        </button>
        <button type="button" className="workspace-tool-btn workspace-tool-btn--close" title="Fermer le panneau" aria-label="Fermer le panneau" onClick={onClose}>
          <PanelIcon kind="close" />
        </button>
      </div>
    </header>

    {!active ? <div className="workspace-panel-body"><EmptyPreview title="Aucun aperçu" text="Sélectionnez un document pour l’afficher ici." /></div>
      : active.kind === 'activity' ? <ActivityView detail={detail} live={live} running={running} onOpen={openTarget} />
        : active.kind === 'web' ? <BrowserView tab={active} onUpdate={update => updateTab(active.id, update)} />
          : <FileView tab={active} onOpen={openTarget} onRefresh={() => updateTab(active.id, { revision: active.revision + 1 })} />}
  </aside>
}

function ActivityView({ detail, live, running, onOpen }: {
  detail: TaskDetail | null
  live: PanelActivity[]
  running: boolean
  onOpen: (target: string, title?: string, kind?: 'file' | 'web') => void
}) {
  const persisted = detail?.events.map(event => ({
    eventType: event.eventType, title: event.title, content: event.content,
    toolName: event.toolName, payload: event.payload as Record<string, unknown>,
  })) ?? []
  // The backend persists activity before emitting it. A very fast hook can run
  // before the WebView listener is attached, while later live events still
  // arrive. Merge both sources so those early, persisted events remain visible.
  const events: PanelActivity[] = [...persisted]
  const eventKey = (event: PanelActivity) => [event.eventType, event.title, event.content, event.toolName].join('\u0000')
  const known = new Set(events.map(eventKey))
  for (const event of live) {
    const key = eventKey(event)
    if (!known.has(key)) {
      events.push(event)
      known.add(key)
    }
  }
  const subagents = events.filter(isSubagentEvent)
  return <div className="workspace-panel-body activity-view">
    <div className="workspace-panel-title"><strong>Activité de Bob</strong>{running && <span className="task-spinner" />}</div>
    {subagents.length > 0 && (
      <section className="subagent-timeline" aria-label="Sous-agents">
        <strong>Sous-agents</strong>
        <ul>
          {subagents.map((event, index) => (
            <li key={`subagent-${index}`} className={activityState(event.eventType)}>
              <span>{event.title || activityLabel(event.eventType)}</span>
              {event.content && <small>{event.content}</small>}
            </li>
          ))}
        </ul>
      </section>
    )}
    {events.length === 0 && <EmptyPreview title="Aucune activité" text="Les étapes, outils, sources, fichiers et sous-agents de Bob apparaîtront ici." />}
    <div className="activity-timeline">{events.map((event, index) => <div
      key={`${event.eventType}-${index}`}
      className={`activity-item ${activityState(event.eventType)}`}
      data-event-type={event.eventType}
    >
      <span className="activity-node" />
      <div><strong>{event.title || event.toolName || activityLabel(event.eventType)}</strong>
        {event.content && <p>{event.content}</p>}
      </div>
    </div>)}</div>
    {!!detail?.inputs.length && <ResourceSection title="Entrées" items={detail.inputs} onOpen={onOpen} />}
    {!!detail?.outputs.length && <ResourceSection title="Sorties et sources" items={detail.outputs} onOpen={onOpen} />}
    <p className="workspace-disclaimer">Événements explicitement fournis par Bob Shell, jamais une chaîne de pensée privée.</p>
  </div>
}

function ResourceSection({ title, items, onOpen }: {
  title: string
  items: TaskDetail['inputs']
  onOpen: (target: string, title?: string, kind?: 'file' | 'web') => void
}) {
  return <section className="resource-section"><strong>{title}</strong>{items.map(item => {
    const target = item.pathOrUrl
    return <button key={item.id} className="resource-row" disabled={!target} onClick={() => target && onOpen(target, item.name)}>
      <span className="resource-icon">{item.ioType === 'source' || target?.startsWith('http') ? '◎' : fileGlyph(item.name)}</span>
      <span><b>{item.name}</b><small>{target}</small></span><span className="resource-open">›</span>
    </button>
  })}</section>
}

function FileView({ tab, onOpen, onRefresh }: {
  tab: PanelTab
  onOpen: (target: string, title?: string, kind?: 'file' | 'web') => void
  onRefresh: () => void
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    if (!tab.target) return
    setLoading(true); setError(''); setZoom(1)
    prepareFilePreview(tab.target).then(setPreview).catch(value => setError(errorMessage(value, 'Impossible de préparer l’aperçu.'))).finally(() => setLoading(false))
  }, [tab.target, tab.revision])

  const canZoom = preview ? isZoomablePreview(preview.kind) : false
  const zoomPercent = Math.round(zoom * 100)

  return <div className="workspace-file-view">
    <div className="workspace-toolbar">
      <button type="button" className="workspace-tool-btn" onClick={onRefresh} title="Actualiser" aria-label="Actualiser">
        <PanelIcon kind="refresh" />
      </button>
      <div className="workspace-location" title={tab.target}>{shortPath(tab.target ?? '')}</div>
      {canZoom && (
        <div className="preview-zoom-controls" role="group" aria-label="Zoom de l’aperçu" title="Cmd + molette pour zoomer">
          <button
            type="button"
            className="workspace-tool-btn"
            title="Dézoomer"
            aria-label="Dézoomer"
            disabled={zoom <= PREVIEW_ZOOM_MIN}
            onClick={() => setZoom(value => clampPreviewZoom(value - PREVIEW_ZOOM_STEP))}
          >
            <PanelIcon kind="zoomOut" />
          </button>
          <button
            type="button"
            className="preview-zoom-label"
            title="Réinitialiser le zoom"
            aria-label={`Zoom ${zoomPercent} %, réinitialiser`}
            onClick={() => setZoom(1)}
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            className="workspace-tool-btn"
            title="Zoomer"
            aria-label="Zoomer"
            disabled={zoom >= PREVIEW_ZOOM_MAX}
            onClick={() => setZoom(value => clampPreviewZoom(value + PREVIEW_ZOOM_STEP))}
          >
            <PanelIcon kind="zoomIn" />
          </button>
        </div>
      )}
      <button
        type="button"
        className="workspace-action-btn"
        onClick={() => tab.target && void revealInFileManager(tab.target).catch(error => setError(errorMessage(error, 'Impossible d’afficher dans le Finder.')))}
        title="Afficher dans le Finder"
      >
        <PanelIcon kind="finder" />
        <span>Finder</span>
      </button>
      <button
        type="button"
        className="workspace-action-btn workspace-action-btn--accent"
        onClick={() => tab.target && void openPreviewResource(tab.target).catch(error => setError(errorMessage(error, 'Impossible d’ouvrir le fichier.')))}
        title="Ouvrir dans l’application par défaut"
      >
        <PanelIcon kind="external" />
        <span>Ouvrir</span>
      </button>
    </div>
    {loading ? <EmptyPreview loading title="Préparation de l’aperçu…" /> : error ? <EmptyPreview title="Aperçu indisponible" text={error} action={() => tab.target && openPreviewResource(tab.target)} actionLabel="Ouvrir le fichier" />
      : preview && <PreviewContent preview={preview} zoom={zoom} onZoomChange={setZoom} onOpen={onOpen} />}
  </div>
}

const PREVIEW_ZOOM_MIN = 0.5
const PREVIEW_ZOOM_MAX = 2.5
const PREVIEW_ZOOM_STEP = 0.1

function clampPreviewZoom(value: number) {
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Math.round(value * 10) / 10))
}

function isZoomablePreview(kind: FilePreview['kind']) {
  return kind === 'image' || kind === 'office' || kind === 'pdf' || kind === 'html' || kind === 'markdown' || kind === 'text'
}

function isPdfPreviewPath(path?: string | null) {
  return Boolean(path && /\.pdf$/i.test(path))
}

function isHtmlPreviewPath(path?: string | null) {
  return Boolean(path && /\.html?$/i.test(path))
}

function PreviewContent({
  preview, zoom, onZoomChange, onOpen,
}: {
  preview: FilePreview
  zoom: number
  onZoomChange: (zoom: number) => void
  onOpen: (target: string, title?: string) => void
}) {
  const htmlPages = useMemo(() => {
    const fromList = (preview.previewPaths ?? []).filter(isHtmlPreviewPath)
    if (fromList.length) return fromList
    if (isHtmlPreviewPath(preview.previewPath)) return [preview.previewPath as string]
    return [] as string[]
  }, [preview.previewPath, preview.previewPaths])

  const rasterPages = useMemo(() => {
    if (htmlPages.length) return [] as string[]
    if (preview.previewPaths && preview.previewPaths.length > 0) {
      return Array.from(new Set(preview.previewPaths.filter(path => !isHtmlPreviewPath(path) && !isPdfPreviewPath(path))))
    }
    if (preview.previewPath && !isPdfPreviewPath(preview.previewPath) && !isHtmlPreviewPath(preview.previewPath)) {
      return [preview.previewPath]
    }
    return [] as string[]
  }, [htmlPages.length, preview.previewPath, preview.previewPaths])

  const pdfSourcePath = htmlPages.length
    ? undefined
    : isPdfPreviewPath(preview.previewPath)
      ? preview.previewPath
      : preview.kind === 'pdf'
        ? (preview.previewPath || preview.path)
        : undefined

  const pageCount = Math.max(
    1,
    preview.pageCount && preview.pageCount > 0
      ? preview.pageCount
      : htmlPages.length > 0
        ? htmlPages.length
        : rasterPages.length > 0
          ? rasterPages.length
          : 1,
  )
  const pageUnit = preview.pageUnit === 'slide' || /\.(pptx?|key|odp)$/i.test(preview.name)
    ? 'slide'
    : 'page'
  const pageLabel = pageUnit === 'slide' ? 'Slide' : 'Page'

  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [preview.path, preview.previewPath, preview.pageCount])

  const canPaginate = pageCount > 1
  const safePage = Math.min(Math.max(1, page), pageCount)

  useEffect(() => {
    if (!canPaginate) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        setPage(value => Math.min(pageCount, value + 1))
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        setPage(value => Math.max(1, value - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canPaginate, pageCount])

  const rasterSource = rasterPages[safePage - 1]
    ? safeFileSrc(rasterPages[safePage - 1])
    : ''
  const htmlSource = htmlPages[safePage - 1]
    ? safeFileSrc(htmlPages[safePage - 1])
    : ''
  const pdfSource = pdfSourcePath
    ? `${safeFileSrc(pdfSourcePath)}#page=${safePage}`
    : preview.kind === 'html' && preview.previewPath
      ? safeFileSrc(preview.previewPath)
      : ''

  const meta = (
    <div className="preview-meta">
      <strong>{preview.name}</strong>
      <span>
        {preview.kind === 'directory'
          ? `${preview.entries.length} élément(s)`
          : formatBytes(preview.size)}
        {htmlPages.length ? ' · Aperçu local Bob Work' : preview.quickLook ? ' · Quick Look macOS' : ''}
        {canPaginate ? ` · ${pageCount} ${pageUnit === 'slide' ? 'slides' : 'pages'}` : ''}
      </span>
    </div>
  )
  const zoomable = isZoomablePreview(preview.kind)

  const onWheel = (event: WheelEvent) => {
    if (!zoomable || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    const direction = event.deltaY > 0 ? -PREVIEW_ZOOM_STEP : PREVIEW_ZOOM_STEP
    onZoomChange(clampPreviewZoom(zoom + direction))
  }

  if (preview.kind === 'directory') {
    return <div className="preview-scroll">{meta}<div className="directory-list">{preview.entries.map(entry => <button key={entry.path} onClick={() => onOpen(entry.path, entry.name)}><span>{entry.isDirectory ? '▰' : fileGlyph(entry.name)}</span><b>{entry.name}</b><small>{entry.size === undefined ? '' : formatBytes(entry.size)}</small></button>)}</div></div>
  }
  if (preview.kind === 'audio') {
    return <div className="preview-scroll">{meta}<audio src={rasterSource || (preview.previewPath ? safeFileSrc(preview.previewPath) : '')} controls /></div>
  }
  if (preview.kind === 'video') {
    return <div className="visual-preview">{meta}<video src={preview.previewPath ? safeFileSrc(preview.previewPath) : ''} controls /></div>
  }

  let body: ReactNode = null
  if (htmlSource) {
    body = (
      <iframe
        key={`${htmlPages[safePage - 1]}-${safePage}`}
        src={htmlSource}
        title={`${preview.name} — ${pageLabel} ${safePage}`}
        sandbox="allow-same-origin"
      />
    )
  } else if (pdfSourcePath || (preview.kind === 'pdf' && pdfSource)) {
    body = (
      <iframe
        key={`${pdfSourcePath}-${safePage}`}
        src={pdfSource}
        title={`${preview.name} — ${pageLabel} ${safePage}`}
      />
    )
  } else if (preview.kind === 'html') {
    body = (
      <iframe
        src={pdfSource || (preview.previewPath ? safeFileSrc(preview.previewPath) : '')}
        title={preview.name}
        sandbox=""
      />
    )
  } else if (preview.kind === 'image' || (preview.kind === 'office' && rasterSource)) {
    body = <img src={rasterSource} alt={`Aperçu de ${preview.name} — ${pageLabel} ${safePage}`} />
  } else if (preview.kind === 'markdown') {
    body = <div className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content ?? ''}</ReactMarkdown></div>
  } else if (preview.kind === 'text') {
    body = <pre className="text-preview">{preview.content}</pre>
  } else {
    return <EmptyPreview title={preview.name} text="Ce format n’a pas de rendu Quick Look disponible. Vous pouvez l’ouvrir dans son application macOS." action={() => openPreviewResource(preview.path)} actionLabel="Ouvrir le fichier" />
  }

  const shellClass = htmlSource || pdfSourcePath || preview.kind === 'pdf' || preview.kind === 'html'
    ? 'frame-preview'
    : preview.kind === 'markdown' || preview.kind === 'text'
      ? 'preview-scroll'
      : 'visual-preview'

  return (
    <div className={shellClass} onWheel={onWheel}>
      {meta}
      {canPaginate && (
        <div className="preview-page-controls" role="navigation" aria-label={`Navigation ${pageUnit === 'slide' ? 'des slides' : 'des pages'}`}>
          <button
            type="button"
            className="workspace-tool-btn"
            disabled={safePage <= 1}
            aria-label={`${pageLabel} précédente`}
            title={`${pageLabel} précédente`}
            onClick={() => setPage(value => Math.max(1, value - 1))}
          >
            ‹
          </button>
          <span className="preview-page-label" aria-live="polite">
            {pageLabel} {safePage} / {pageCount}
          </span>
          <button
            type="button"
            className="workspace-tool-btn"
            disabled={safePage >= pageCount}
            aria-label={`${pageLabel} suivante`}
            title={`${pageLabel} suivante`}
            onClick={() => setPage(value => Math.min(pageCount, value + 1))}
          >
            ›
          </button>
        </div>
      )}
      <div className="preview-zoom-viewport">
        <div
          className="preview-zoom-surface"
          style={{ zoom }}
        >
          {body}
        </div>
      </div>
    </div>
  )
}

function BrowserView({ tab, onUpdate }: { tab: PanelTab; onUpdate: (update: Partial<PanelTab>) => void }) {
  const [address, setAddress] = useState(tab.target ?? '')
  useEffect(() => setAddress(tab.target ?? ''), [tab.target])
  const navigate = () => {
    const target = normalizeBrowserUrl(address)
    onUpdate({ target, title: hostname(target), revision: tab.revision + 1 })
  }
  const normalizedTarget = useMemo(() => normalizeBrowserUrl(tab.target || ''), [tab.target])
  const trustedForEmbedding = isTrustedEmbeddedBrowserUrl(normalizedTarget)
  const localDevelopment = isLocalDevelopmentBrowserUrl(normalizedTarget)
  const canOpenExternally = normalizedTarget !== 'about:blank'
  return <div className="workspace-browser">
    <div className="workspace-toolbar browser-toolbar">
      <button type="button" className="workspace-tool-btn" onClick={() => onUpdate({ revision: tab.revision + 1 })} title="Recharger" aria-label="Recharger">
        <PanelIcon kind="refresh" />
      </button>
      <input value={address} onChange={event => setAddress(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') navigate() }} aria-label="Adresse Web" />
      <button
        type="button"
        className="workspace-action-btn"
        disabled={!canOpenExternally}
        onClick={() => canOpenExternally && openPreviewResource(normalizedTarget)}
        title="Ouvrir dans le navigateur par défaut"
      >
        <PanelIcon kind="external" />
        <span>Navigateur</span>
      </button>
    </div>
    <div className="browser-frame-wrap">
      {trustedForEmbedding ? (
        <iframe
          key={`${normalizedTarget}-${tab.revision}`}
          src={normalizedTarget}
          title={tab.title}
          sandbox={localDevelopment
            ? 'allow-forms allow-modals allow-popups allow-scripts allow-same-origin'
            : 'allow-forms allow-scripts'}
          referrerPolicy={localDevelopment ? 'strict-origin-when-cross-origin' : 'no-referrer'}
        />
      ) : (
        <div className="workspace-empty">
          <strong>Ouverture externe requise</strong>
          <p>Pour protéger vos fichiers et sessions, Bob Work n’intègre que quelques sites de documentation approuvés. Ouvrez cette adresse dans votre navigateur.</p>
        </div>
      )}
    </div>
    <div className="browser-hint">Les pages localhost sont autorisées pour le développement. Les connexions et domaines externes non approuvés restent dans votre navigateur par défaut.</div>
  </div>
}

function PanelIcon({ kind }: { kind: 'file' | 'plus' | 'close' | 'refresh' | 'finder' | 'external' | 'zoomIn' | 'zoomOut' }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  if (kind === 'file') return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  if (kind === 'plus') return <svg {...common}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  if (kind === 'close') return <svg {...common}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  if (kind === 'refresh') return <svg {...common}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
  if (kind === 'finder') return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
  if (kind === 'zoomIn') return <svg {...common}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
  if (kind === 'zoomOut') return <svg {...common}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
  return <svg {...common}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
}

function shortPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 3) return path
  return `…/${parts.slice(-3).join('/')}`
}

function EmptyPreview({ title, text, loading, action, actionLabel }: { title: string; text?: string; loading?: boolean; action?: () => void; actionLabel?: string }) {
  return <div className="empty-preview">{loading ? <span className="task-spinner" /> : <span className="empty-preview-icon">◇</span>}<strong>{title}</strong>{text && <p>{text}</p>}{action && <button className="secondary-btn" onClick={action}>{actionLabel}</button>}</div>
}

function resourceName(target: string) { try { return decodeURIComponent(new URL(target).hostname) } catch { return target.split('/').filter(Boolean).pop() || 'Aperçu' } }
function hostname(target: string) { try { return new URL(target).hostname } catch { return 'Web' } }
function fileGlyph(name: string) { const ext = name.split('.').pop()?.toLowerCase(); return ext === 'docx' || ext === 'doc' ? 'W' : ext === 'pptx' || ext === 'ppt' ? 'P' : ext === 'xlsx' || ext === 'xls' || ext === 'csv' ? 'X' : ext === 'one' ? 'N' : ext === 'pdf' ? 'PDF' : '◇' }
function formatBytes(value: number) { if (!value) return '0 octet'; const units = ['octets', 'Ko', 'Mo', 'Go']; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
function activityLabel(type: string) {
  return ({
    analysis: 'Analyse',
    tool_started: 'Outil démarré',
    tool_finished: 'Outil terminé',
    tool_error: 'Erreur outil',
    usage: 'Consommation',
    source: 'Source',
    step: 'Étape',
    subagent_started: 'Sous-agent démarré',
    subagent_finished: 'Sous-agent terminé',
    graph_started: 'Orchestration démarrée',
    graph_finished: 'Orchestration terminée',
  } as Record<string, string>)[type] ?? type.replace(/_/g, ' ')
}
function activityState(type: string) { return type === 'error' || type.endsWith('_error') ? 'failed' : type.endsWith('_finished') ? 'completed' : 'running' }
function isSubagentEvent(event: PanelActivity) {
  return event.eventType.includes('subagent')
    || event.eventType.includes('graph')
    || event.toolName === 'spawn_subagent'
}
