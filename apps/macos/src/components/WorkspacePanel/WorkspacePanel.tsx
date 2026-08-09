import { useEffect, useMemo, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open as chooseFile } from '@tauri-apps/plugin-dialog'
import ReactMarkdown from 'react-markdown'
import { openPreviewResource, prepareFilePreview } from '../../lib/ipc'
import type { FilePreview, TaskDetail } from '@bob-work/shared-types'

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

export default function WorkspacePanel({ detail, live, running, request, onClose }: {
  detail: TaskDetail | null
  live: PanelActivity[]
  running: boolean
  request?: PreviewRequest | null
  onClose: () => void
}) {
  const [tabs, setTabs] = useState<PanelTab[]>([{ id: 'activity', kind: 'activity', title: 'Activité', revision: 0 }])
  const [activeId, setActiveId] = useState('activity')

  const openTarget = (target: string, title?: string, requestedKind?: 'file' | 'web') => {
    const kind = requestedKind ?? (/^https?:\/\//i.test(target) ? 'web' : 'file')
    const existing = target === 'about:blank' ? undefined : tabs.find(tab => tab.kind === kind && tab.target === target)
    if (existing) { setActiveId(existing.id); return }
    const tab: PanelTab = {
      id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      target,
      title: title || resourceName(target),
      revision: 0,
    }
    setTabs(current => [...current, tab])
    setActiveId(tab.id)
  }

  useEffect(() => {
    if (request?.target) openTarget(request.target, request.title, request.kind)
    // request.id deliberately identifies each explicit open action.
  }, [request?.id])

  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]
  const closeTab = (id: string) => {
    if (id === 'activity') return
    setTabs(current => {
      const index = current.findIndex(tab => tab.id === id)
      const next = current.filter(tab => tab.id !== id)
      if (activeId === id) setActiveId(next[Math.max(0, index - 1)]?.id ?? 'activity')
      return next
    })
  }
  const updateTab = (id: string, update: Partial<PanelTab>) => setTabs(current => current.map(tab => tab.id === id ? { ...tab, ...update } : tab))

  return <aside className="workspace-panel" aria-label="Aperçus et activité">
    <header className="workspace-panel-tabs">
      <div className="workspace-tab-strip">
        {tabs.map(tab => <button key={tab.id} className={`workspace-tab ${activeId === tab.id ? 'active' : ''}`} onClick={() => setActiveId(tab.id)} title={tab.target || tab.title}>
          <span>{tab.kind === 'activity' ? '◌' : tab.kind === 'web' ? '◎' : fileGlyph(tab.title)}</span>
          <span className="workspace-tab-label">{tab.title}</span>
          {tab.id !== 'activity' && <span className="workspace-tab-close" role="button" onClick={event => { event.stopPropagation(); closeTab(tab.id) }}>×</span>}
        </button>)}
      </div>
      <button className="icon-btn" title="Prévisualiser un fichier" onClick={async () => {
        const selected = await chooseFile({ multiple: false, directory: false })
        if (typeof selected === 'string') openTarget(selected)
      }}>◇</button>
      <button className="icon-btn" title="Nouvel onglet Web" onClick={() => openTarget('about:blank', 'Nouvel onglet', 'web')}>＋</button>
      <button className="icon-btn" title="Fermer le panneau" onClick={onClose}>×</button>
    </header>

    {active.kind === 'activity' ? <ActivityView detail={detail} live={live} running={running} onOpen={openTarget} />
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
  const events = live.length ? live : persisted
  return <div className="workspace-panel-body activity-view">
    <div className="workspace-panel-title"><strong>Activité de Bob</strong>{running && <span className="task-spinner" />}</div>
    {events.length === 0 && <EmptyPreview title="Aucune activité" text="Les étapes, outils, sources et fichiers de Bob apparaîtront ici." />}
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
  useEffect(() => {
    if (!tab.target) return
    setLoading(true); setError('')
    prepareFilePreview(tab.target).then(setPreview).catch(value => setError(String(value))).finally(() => setLoading(false))
  }, [tab.target, tab.revision])

  return <div className="workspace-file-view">
    <div className="workspace-toolbar">
      <button className="toolbar-btn" onClick={onRefresh} title="Actualiser">↻</button>
      <div className="workspace-location" title={tab.target}>{tab.target}</div>
      <button className="toolbar-btn" onClick={() => tab.target && openPreviewResource(tab.target)} title="Ouvrir dans l’application par défaut">↗</button>
    </div>
    {loading ? <EmptyPreview loading title="Préparation de l’aperçu…" /> : error ? <EmptyPreview title="Aperçu indisponible" text={error} action={() => tab.target && openPreviewResource(tab.target)} actionLabel="Ouvrir le fichier" />
      : preview && <PreviewContent preview={preview} onOpen={onOpen} />}
  </div>
}

function PreviewContent({ preview, onOpen }: { preview: FilePreview; onOpen: (target: string, title?: string) => void }) {
  const source = preview.previewPath ? convertFileSrc(preview.previewPath) : ''
  const meta = <div className="preview-meta"><strong>{preview.name}</strong><span>{preview.kind === 'directory' ? `${preview.entries.length} élément(s)` : formatBytes(preview.size)}{preview.quickLook ? ' · Quick Look macOS' : ''}</span></div>
  if (preview.kind === 'directory') return <div className="preview-scroll">{meta}<div className="directory-list">{preview.entries.map(entry => <button key={entry.path} onClick={() => onOpen(entry.path, entry.name)}><span>{entry.isDirectory ? '▰' : fileGlyph(entry.name)}</span><b>{entry.name}</b><small>{entry.size === undefined ? '' : formatBytes(entry.size)}</small></button>)}</div></div>
  if (preview.kind === 'image' || (preview.kind === 'office' && source)) return <div className="visual-preview">{meta}<img src={source} alt={`Aperçu de ${preview.name}`} /></div>
  if (preview.kind === 'pdf') return <div className="frame-preview">{meta}<iframe src={source} title={preview.name} /></div>
  if (preview.kind === 'video') return <div className="visual-preview">{meta}<video src={source} controls /></div>
  if (preview.kind === 'audio') return <div className="preview-scroll">{meta}<audio src={source} controls /></div>
  if (preview.kind === 'html') return <div className="frame-preview">{meta}<iframe src={source} title={preview.name} sandbox="allow-scripts allow-forms allow-modals" /></div>
  if (preview.kind === 'markdown') return <div className="preview-scroll markdown-preview">{meta}<ReactMarkdown>{preview.content ?? ''}</ReactMarkdown></div>
  if (preview.kind === 'text') return <div className="preview-scroll">{meta}<pre className="text-preview">{preview.content}</pre></div>
  return <EmptyPreview title={preview.name} text="Ce format n’a pas de rendu Quick Look disponible. Vous pouvez l’ouvrir dans son application macOS." action={() => openPreviewResource(preview.path)} actionLabel="Ouvrir le fichier" />
}

function BrowserView({ tab, onUpdate }: { tab: PanelTab; onUpdate: (update: Partial<PanelTab>) => void }) {
  const [address, setAddress] = useState(tab.target ?? '')
  useEffect(() => setAddress(tab.target ?? ''), [tab.target])
  const navigate = () => {
    const target = normalizeUrl(address)
    onUpdate({ target, title: hostname(target), revision: tab.revision + 1 })
  }
  const src = useMemo(() => tab.target || 'about:blank', [tab.target, tab.revision])
  return <div className="workspace-browser">
    <div className="workspace-toolbar browser-toolbar">
      <button className="toolbar-btn" onClick={() => onUpdate({ revision: tab.revision + 1 })} title="Recharger">↻</button>
      <input value={address} onChange={event => setAddress(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') navigate() }} aria-label="Adresse Web" />
      <button className="toolbar-btn" disabled={!tab.target?.startsWith('http')} onClick={() => tab.target && openPreviewResource(tab.target)} title="Ouvrir dans le navigateur par défaut">↗</button>
    </div>
    <div className="browser-frame-wrap"><iframe key={`${src}-${tab.revision}`} src={src} title={tab.title} sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin" referrerPolicy="strict-origin-when-cross-origin" /></div>
    <div className="browser-hint">Certains sites refusent l’affichage intégré. Utilisez ↗ si la page reste vide. Ne saisissez vos identifiants que sur un domaine vérifié.</div>
  </div>
}

function EmptyPreview({ title, text, loading, action, actionLabel }: { title: string; text?: string; loading?: boolean; action?: () => void; actionLabel?: string }) {
  return <div className="empty-preview">{loading ? <span className="task-spinner" /> : <span className="empty-preview-icon">◇</span>}<strong>{title}</strong>{text && <p>{text}</p>}{action && <button className="secondary-btn" onClick={action}>{actionLabel}</button>}</div>
}

function resourceName(target: string) { try { return decodeURIComponent(new URL(target).hostname) } catch { return target.split('/').filter(Boolean).pop() || 'Aperçu' } }
function hostname(target: string) { try { return new URL(target).hostname } catch { return 'Web' } }
function normalizeUrl(value: string) { const trimmed = value.trim(); if (!trimmed || trimmed === 'about:blank') return 'about:blank'; return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}` }
function fileGlyph(name: string) { const ext = name.split('.').pop()?.toLowerCase(); return ext === 'docx' || ext === 'doc' ? 'W' : ext === 'pptx' || ext === 'ppt' ? 'P' : ext === 'xlsx' || ext === 'xls' || ext === 'csv' ? 'X' : ext === 'one' ? 'N' : ext === 'pdf' ? 'PDF' : '◇' }
function formatBytes(value: number) { if (!value) return '0 octet'; const units = ['octets', 'Ko', 'Mo', 'Go']; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
function activityLabel(type: string) { return ({ analysis: 'Analyse', tool_started: 'Outil démarré', tool_finished: 'Outil terminé', tool_error: 'Erreur outil', usage: 'Consommation', source: 'Source', step: 'Étape' } as Record<string, string>)[type] ?? type.replace(/_/g, ' ') }
function activityState(type: string) { return type === 'error' || type.endsWith('_error') ? 'failed' : type.endsWith('_finished') ? 'completed' : 'running' }
