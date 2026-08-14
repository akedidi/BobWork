// ============================================================
// Bob Work – Artifact Gallery View
// Browse, preview (right panel), reveal in Finder, delete
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  getArtifacts,
  deleteArtifact,
  generateArtifact,
  getConversations,
} from '../lib/ipc'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import WorkspacePanel, { type PreviewRequest } from '../components/WorkspacePanel/WorkspacePanel'
import { errorMessage } from '../lib/errorMessage'
import type { Artifact } from '@bob-work/shared-types'
import { useT } from '../i18n'
import { ModalOverlay, ModalPanel } from '../components/ModalOverlay'

const TYPE_ICON: Record<string, string> = {
  pptx: '📊', docx: '📄', xlsx: '📈', pdf: '📕',
  markdown: '📝', text: '📋', html: '🌐',
}
type SortKey = 'date' | 'name' | 'size'
type SortDir = 'asc' | 'desc'

function fmt(bytes: number | null | undefined) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1048576).toFixed(1)} Mo`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(document.documentElement.lang || 'en', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Generate modal ────────────────────────────────────────────

function GenerateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT()
  const [type, setType] = useState('pptx')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (!title.trim() || !content.trim()) return
    setLoading(true)
    setError('')
    try {
      await generateArtifact({ artifactType: type, title: title.trim(), content })
      onDone()
    } catch (e) {
      setError(errorMessage(e, t('artifacts.generateFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} closeOnBackdrop={!loading}>
      <ModalPanel style={{
        background: 'var(--bg-base)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', padding: 28, width: 520, maxWidth: '90vw',
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{t('artifacts.generateTitle')}</div>

        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          {t('artifacts.type')}
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {['pptx','docx','xlsx','pdf','markdown'].map(artifactType => (
            <button key={artifactType} onClick={() => setType(artifactType)} style={{
              padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              border: '1px solid var(--border)',
              background: type === artifactType ? 'var(--accent)' : 'var(--bg-surface)',
              color: type === artifactType ? '#fff' : 'var(--text-secondary)',
            }}>
              {TYPE_ICON[artifactType]} {artifactType === 'pptx' ? t('artifacts.presentation') : artifactType === 'docx' ? t('artifacts.document') : artifactType === 'xlsx' ? t('artifacts.spreadsheet') : artifactType === 'pdf' ? 'PDF' : 'Markdown'}
            </button>
          ))}
        </div>

        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          {t('artifacts.titleField')}
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('artifacts.titlePlaceholder')}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', background: 'var(--bg-surface)',
            fontSize: 13, color: 'var(--text-primary)', marginBottom: 14, boxSizing: 'border-box',
          }}
        />

        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          {t('artifacts.contentMarkdown')}
        </label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={7}
          placeholder="## Introduction&#10;- Point 1&#10;- Point 2"
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', background: 'var(--bg-surface)',
            fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary)',
            resize: 'vertical', marginBottom: 14, boxSizing: 'border-box',
          }}
        />

        {error && (
          <div style={{ fontSize: 12, color: 'var(--error, #ef4444)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn-secondary" disabled={loading}>{t('common.cancel')}</button>
          <button
            onClick={handleGenerate}
            disabled={loading || !title.trim() || !content.trim()}
            className="btn-primary"
          >
            {loading ? t('artifacts.generating') : t('artifacts.generate').replace(/^\+\s*/, '')}
          </button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  )
}

// ── Main view ─────────────────────────────────────────────────

export default function ArtifactGallery() {
  const t = useT()
  const typeLabel = (artifactType: string) => artifactType === 'pptx' ? t('artifacts.presentation')
    : artifactType === 'docx' ? t('artifacts.document')
    : artifactType === 'xlsx' ? t('artifacts.spreadsheet')
    : artifactType === 'text' ? t('artifacts.text')
    : artifactType === 'html' ? t('artifacts.htmlPage')
    : artifactType === 'pdf' ? 'PDF'
    : artifactType === 'markdown' ? 'Markdown'
    : artifactType
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [conversationTitles, setConversationTitles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [filter, setFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showModal, setShowModal] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Artifact | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadArtifacts = async () => {
    setLoadError(null)
    try {
      const [list, conversations] = await Promise.all([
        getArtifacts(),
        getConversations().catch(() => []),
      ])
      setArtifacts(list)
      const titles: Record<string, string> = {}
      for (const conv of conversations) {
        titles[conv.id] = conv.title
      }
      setConversationTitles(titles)
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadArtifacts() }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null
    listen('artifacts-updated', () => {
      if (!disposed) void loadArtifacts()
    }).then(fn => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const handlePreview = (artifact: Artifact) => {
    setSelectedId(artifact.id)
    setPanelOpen(true)
    setPreviewRequest({
      id: `${artifact.id}-${Date.now()}`,
      target: artifact.filePath,
      title: artifact.title,
      kind: 'file',
    })
  }

  const requestDelete = (artifact: Artifact) => {
    setPendingDelete(artifact)
  }

  const confirmDelete = async () => {
    const artifact = pendingDelete
    if (!artifact) return
    setPendingDelete(null)
    setDeleting(artifact.id)
    setActionError(null)
    try {
      await deleteArtifact(artifact.id)
      setArtifacts(prev => prev.filter(a => a.id !== artifact.id))
      if (selectedId === artifact.id) {
        setSelectedId(null)
        setPanelOpen(false)
        setPreviewRequest(null)
      }
    } catch (error) {
      setActionError(error)
    } finally {
      setDeleting(null)
    }
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const types = ['all', ...Array.from(new Set(artifacts.map(a => a.artifactType)))]
  const visible = useMemo(() => {
    const filtered = filter === 'all' ? [...artifacts] : artifacts.filter(a => a.artifactType === filter)
    const dir = sortDir === 'asc' ? 1 : -1
    filtered.sort((a, b) => {
      if (sortKey === 'name') {
        return a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }) * dir
      }
      if (sortKey === 'size') {
        return ((a.size ?? 0) - (b.size ?? 0)) * dir
      }
      return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
    })
    return filtered
  }, [artifacts, filter, sortKey, sortDir])

  const sortLabel = (key: SortKey, label: string) => {
    if (sortKey !== key) return label
    return `${label} ${sortDir === 'asc' ? '↑' : '↓'}`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Topbar */}
      <div className="topbar titlebar-drag" data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('artifacts.title')}</span>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary titlebar-no-drag"
          style={{ fontSize: 12, padding: '5px 14px' }}
        >
          {t('artifacts.generate')}
        </button>
      </div>

      {/* Filters + sort */}
      <div style={{
        padding: '0 20px 12px',
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        alignItems: 'center',
        flexShrink: 0,
        paddingRight: panelOpen ? 'min(540px, 48vw)' : 20,
        transition: 'padding-right 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}>
        {types.map(typeKey => (
          <button key={typeKey} onClick={() => setFilter(typeKey)} style={{
            padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: filter === typeKey ? 'var(--accent)' : 'var(--bg-surface)',
            color: filter === typeKey ? '#fff' : 'var(--text-secondary)',
          }}>
            {typeKey === 'all' ? t('artifacts.all') : `${TYPE_ICON[typeKey] ?? ''} ${typeLabel(typeKey)}`}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {([
            ['date', t('artifacts.date')],
            ['name', t('artifacts.name')],
            ['size', t('artifacts.size')],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSort(key)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: sortKey === key ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--text-secondary)',
              }}
            >
              {sortLabel(key, label)}
            </button>
          ))}
        </span>
      </div>

      <LoadErrorBanner
        error={loadError}
        onRetry={() => { setLoading(true); void loadArtifacts() }}
        fallback={t('artifacts.loadFailed')}
      />
      <LoadErrorBanner
        error={actionError}
        fallback={t('artifacts.actionFailed')}
      />

      {/* Grid */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 20px 24px',
        paddingRight: panelOpen ? 'min(540px, 48vw)' : 20,
        transition: 'padding-right 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}>
        {loading && !loadError ? (
          <EmptyMsg icon="⏳" text="Chargement…" />
        ) : loadError ? null : visible.length === 0 ? (
          <EmptyMsg
            icon="📁"
            text={t('artifacts.empty')}
            sub={t('artifacts.emptyHint')}
          />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
          }}>
            {visible.map(artifact => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                conversationTitle={artifact.origin ? conversationTitles[artifact.origin] : undefined}
                selected={selectedId === artifact.id}
                onOpen={() => handlePreview(artifact)}
                onDelete={() => requestDelete(artifact)}
                deleting={deleting === artifact.id}
              />
            ))}
          </div>
        )}
      </div>

      {panelOpen && (
        <WorkspacePanel
          detail={null}
          live={[]}
          running={false}
          variant="preview"
          request={previewRequest}
          onClose={() => {
            setPanelOpen(false)
            setSelectedId(null)
          }}
        />
      )}

      {showModal && (
        <GenerateModal
          onClose={() => setShowModal(false)}
          onDone={() => { setShowModal(false); void loadArtifacts() }}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          title={pendingDelete.title}
          busy={deleting === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  )
}

// ── Delete confirmation ───────────────────────────────────────

function DeleteConfirmModal({
  title, busy, onCancel, onConfirm,
}: {
  title: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ModalOverlay onClose={onCancel} closeOnBackdrop={!busy} zIndex={220}>
      <ModalPanel
        role="alertdialog"
        aria-labelledby="artifact-delete-title"
        aria-describedby="artifact-delete-desc"
        style={{
          background: 'var(--bg-base)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', padding: 24, width: 420, maxWidth: '90vw',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div id="artifact-delete-title" style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
          Supprimer l’artefact ?
        </div>
        <p id="artifact-delete-desc" style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          « {title} » sera définitivement retiré. Cette action est irréversible.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy}
            style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
          >
            {busy ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  )
}

// ── Artifact card ─────────────────────────────────────────────

function ArtifactCard({
  artifact, conversationTitle, selected, onOpen, onDelete, deleting,
}: {
  artifact: Artifact
  conversationTitle?: string
  selected: boolean
  onOpen: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const t = useT()
  const icon = TYPE_ICON[artifact.artifactType] ?? '📄'
  const typeLabel = artifact.artifactType === 'pptx' ? t('artifacts.presentation')
    : artifact.artifactType === 'docx' ? t('artifacts.document')
    : artifact.artifactType === 'xlsx' ? t('artifacts.spreadsheet')
    : artifact.artifactType === 'text' ? t('artifacts.text')
    : artifact.artifactType === 'html' ? t('artifacts.htmlPage')
    : artifact.artifactType === 'pdf' ? 'PDF'
    : artifact.artifactType === 'markdown' ? 'Markdown'
    : artifact.artifactType
  const showIssue = artifact.validationStatus === 'warning' || artifact.validationStatus === 'invalid'

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      style={{
        background: selected ? 'var(--bg-hover)' : 'var(--bg-surface)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: 'pointer',
      }}
      onClick={onOpen}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 28 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artifact.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {typeLabel} · {fmt(artifact.size)}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          disabled={deleting}
          title={t('common.delete')}
          aria-label={t('artifacts.deleteNamed', { name: artifact.title })}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 4, borderRadius: 4, flexShrink: 0,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
          </svg>
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {fmtDate(artifact.createdAt)}
        {conversationTitle && (
          <span style={{ display: 'block', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Conversation · {conversationTitle}
          </span>
        )}
      </div>

      {showIssue && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 8px', alignSelf: 'flex-start',
          borderRadius: 99,
          border: `1px solid ${artifact.validationStatus === 'warning' ? '#f59e0b' : '#ef4444'}`,
          color: artifact.validationStatus === 'warning' ? '#f59e0b' : '#ef4444',
        }}>
          {artifact.validationStatus === 'warning' ? '⚠ Avertissement' : '✗ Invalide'}
        </span>
      )}

      {artifact.validationNotes && showIssue && (
        <div style={{ fontSize: 11, color: '#f59e0b', fontStyle: 'italic' }}>
          {artifact.validationNotes}
        </div>
      )}
    </div>
  )
}

function EmptyMsg({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 260, gap: 8,
      color: 'var(--text-muted)', textAlign: 'center',
    }}>
      <span style={{ fontSize: 36, opacity: .4 }}>{icon}</span>
      <span style={{ fontSize: 14 }}>{text}</span>
      {sub && <span style={{ fontSize: 12, maxWidth: 280 }}>{sub}</span>}
    </div>
  )
}
