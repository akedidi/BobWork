// ============================================================
// Bob Work – Artifact Gallery View
// Browse, preview, open and delete generated artifacts
// ============================================================

import { useEffect, useState } from 'react'
import { getArtifacts, deleteArtifact, openArtifact, generateArtifact } from '../lib/ipc'
import type { Artifact } from '@bob-work/shared-types'

const TYPE_ICON: Record<string, string> = {
  pptx: '📊', docx: '📄', xlsx: '📈', pdf: '📕',
  markdown: '📝', text: '📋', html: '🌐',
}
const TYPE_LABEL: Record<string, string> = {
  pptx: 'Présentation', docx: 'Document', xlsx: 'Tableur', pdf: 'PDF',
  markdown: 'Markdown', text: 'Texte', html: 'Page HTML',
}

function fmt(bytes: number | null | undefined) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1048576).toFixed(1)} Mo`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Generate modal ────────────────────────────────────────────

function GenerateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-base)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', padding: 28, width: 520, maxWidth: '90vw',
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Générer un artefact</div>

        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          Type
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {['pptx','docx','xlsx','pdf','markdown'].map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              border: '1px solid var(--border)',
              background: type === t ? 'var(--accent)' : 'var(--bg-surface)',
              color: type === t ? '#fff' : 'var(--text-secondary)',
            }}>
              {TYPE_ICON[t]} {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          Titre
        </label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Ex : Rapport Q2 2024"
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', background: 'var(--bg-surface)',
            fontSize: 13, color: 'var(--text-primary)', marginBottom: 14, boxSizing: 'border-box',
          }}
        />

        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          Contenu (Markdown)
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
          <button onClick={onClose} className="btn-secondary" disabled={loading}>Annuler</button>
          <button
            onClick={handleGenerate}
            disabled={loading || !title.trim() || !content.trim()}
            className="btn-primary"
          >
            {loading ? 'Génération…' : 'Générer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────

export default function ArtifactGallery() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadArtifacts = async () => {
    try {
      const list = await getArtifacts()
      setArtifacts(list)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { loadArtifacts() }, [])

  const handleOpen = async (artifact: Artifact) => {
    try { await openArtifact(artifact.id) } catch { /* ignore */ }
  }

  const handleDelete = async (artifact: Artifact) => {
    if (!confirm(`Supprimer « ${artifact.title} » ? Cette action est irréversible.`)) return
    setDeleting(artifact.id)
    try {
      await deleteArtifact(artifact.id)
      setArtifacts(prev => prev.filter(a => a.id !== artifact.id))
    } catch { /* ignore */ } finally {
      setDeleting(null)
    }
  }

  const types = ['all', ...Array.from(new Set(artifacts.map(a => a.artifactType)))]
  const visible = filter === 'all' ? artifacts : artifacts.filter(a => a.artifactType === filter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topbar */}
      <div className="topbar titlebar-drag" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="titlebar-no-drag" style={{ fontWeight: 600, fontSize: 14 }}>Artefacts</span>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary titlebar-no-drag"
          style={{ fontSize: 12, padding: '5px 14px' }}
        >
          + Générer
        </button>
      </div>

      {/* Filter pills */}
      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        {types.map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{
            padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: filter === t ? 'var(--accent)' : 'var(--bg-surface)',
            color: filter === t ? '#fff' : 'var(--text-secondary)',
          }}>
            {t === 'all' ? 'Tous' : `${TYPE_ICON[t] ?? ''} ${TYPE_LABEL[t] ?? t}`}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
        {loading ? (
          <EmptyMsg icon="⏳" text="Chargement…" />
        ) : visible.length === 0 ? (
          <EmptyMsg
            icon="📁"
            text="Aucun artefact"
            sub='Cliquez sur "Générer" pour créer votre premier document.'
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
                onOpen={() => handleOpen(artifact)}
                onDelete={() => handleDelete(artifact)}
                deleting={deleting === artifact.id}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <GenerateModal
          onClose={() => setShowModal(false)}
          onDone={() => { setShowModal(false); loadArtifacts() }}
        />
      )}
    </div>
  )
}

// ── Artifact card ─────────────────────────────────────────────

function ArtifactCard({
  artifact, onOpen, onDelete, deleting,
}: {
  artifact: Artifact
  onOpen: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const icon = TYPE_ICON[artifact.artifactType] ?? '📄'

  const statusColorMap: Record<string, string> = {
    valid: 'var(--accent)',
    warning: '#f59e0b',
    invalid: '#ef4444',
    pending: 'var(--text-muted)',
  }
  const statusColor = statusColorMap[artifact.validationStatus] ?? 'var(--text-muted)'

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      cursor: 'pointer',
    }}
      onClick={onOpen}
    >
      {/* Icon + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 28 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {artifact.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {TYPE_LABEL[artifact.artifactType] ?? artifact.artifactType} · {fmt(artifact.size)}
          </div>
        </div>
      </div>

      {/* Meta */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {fmtDate(artifact.createdAt)}
      </div>

      {/* Validation badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 8px',
          borderRadius: 99, border: `1px solid ${statusColor}`, color: statusColor,
        }}>
          {artifact.validationStatus === 'valid' ? '✓ Valide'
            : artifact.validationStatus === 'warning' ? '⚠ Avertissement'
            : '✗ Invalide'}
        </span>

        {/* Delete button */}
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          disabled={deleting}
          title="Supprimer"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 4, borderRadius: 4,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
          </svg>
        </button>
      </div>

      {artifact.validationNotes && (
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
