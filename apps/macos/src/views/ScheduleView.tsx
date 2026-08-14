// ============================================================
// Bob Work – Schedule View
// CRUD for recurring task schedules
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { getSchedules, createSchedule, updateScheduleState, deleteSchedule, getScheduleRuns, runScheduleNow, getBobModes, getProjects } from '../lib/ipc'
import type { Schedule, ScheduleRun, CreateScheduleInput, BobMode, Project } from '@bob-work/shared-types'
import { listen } from '@tauri-apps/api/event'
import { useLocation, useNavigate } from 'react-router-dom'
import type { PluginScheduleTemplate } from '@bob-work/shared-types'
import { useT } from '../i18n'
import { useAppDialog } from '../components/AppDialog'
import { formatScheduleFrequency, showRunAtField } from '../lib/scheduleDisplay'
import { ModalOverlay, ModalPanel } from '../components/ModalOverlay'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import { errorMessage } from '../lib/errorMessage'

type PluginTemplateState = PluginScheduleTemplate & { pluginId: string; pluginName: string }

function fmtDate(iso: string | undefined | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(document.documentElement.lang || 'en', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const OFFLINE_LABEL: Record<string, string> = {
  skip: 'Ignorer', run_on_wake: 'Exécuter au réveil', ask: 'Demander',
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

// ── Create modal ──────────────────────────────────────────────

export function CreateModal({ onClose, onDone, initialTemplate }: { onClose: () => void; onDone: () => void; initialTemplate?: PluginTemplateState }) {
  const [form, setForm] = useState<CreateScheduleInput>(() => ({
    name: initialTemplate?.name ?? '',
    instructions: initialTemplate?.instructions ?? '',
    cronOrEvent: initialTemplate?.cronOrEvent ?? 'every day',
    runAt: '09:00',
    timezone: 'Europe/Paris',
    offlineBehavior: initialTemplate?.offlineBehavior ?? 'run_on_wake',
    overlapPolicy: initialTemplate?.overlapPolicy ?? 'queue',
    pluginOrMode: initialTemplate ? `plugin:${initialTemplate.pluginId}` : undefined,
  }))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modes, setModes] = useState<BobMode[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    getBobModes().then(setModes).catch(() => setModes([]))
    getProjects().then(setProjects).catch(() => setProjects([]))
    setForm(current => ({ ...current, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }))
  }, [])

  const set = <K extends keyof CreateScheduleInput>(key: K, value: CreateScheduleInput[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const handleCreate = async () => {
    if (!form.name.trim() || !form.instructions.trim()) return
    setLoading(true)
    setError('')
    try {
      const payload: CreateScheduleInput = {
        ...form,
        projectId: form.projectId?.trim() || undefined,
        runAt: showRunAtField(form.cronOrEvent) ? form.runAt?.trim() || undefined : undefined,
      }
      await createSchedule(payload)
      onDone()
    } catch (e) {
      setError(errorMessage(e, 'Impossible de créer la planification.'))
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    fontSize: 13, color: 'var(--text-primary)', boxSizing: 'border-box' as const,
  }

  return (
    <ModalOverlay onClose={onClose} closeOnBackdrop={!loading}>
      <ModalPanel style={{
        background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', padding: 28, width: 480, maxWidth: '90vw',
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Nouvelle planification</div>

        <FormField label="Nom">
          <input value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="Ex : Rapport quotidien" style={inputStyle} />
        </FormField>

        <FormField label="Instructions pour Bob">
          <textarea value={form.instructions} onChange={e => set('instructions', e.target.value)}
            rows={4} placeholder="Génère un rapport des tickets en cours et envoie-le…"
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
        </FormField>

        <FormField label="Fréquence">
          <select value={form.cronOrEvent} onChange={e => set('cronOrEvent', e.target.value)} style={inputStyle}>
            <option value="every day">Chaque jour</option>
            <option value="every week">Chaque semaine</option>
            <option value="every month">Chaque mois</option>
            <option value="every hour">Chaque heure</option>
            <option value="in 5 minutes">Dans 5 minutes (test)</option>
          </select>
        </FormField>

        {showRunAtField(form.cronOrEvent) && (
          <FormField label="Heure d'exécution">
            <input
              type="time"
              value={form.runAt ?? '09:00'}
              onChange={e => set('runAt', e.target.value)}
              style={inputStyle}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>
              Fuseau : {form.timezone || 'UTC'}. S&apos;exécute même écran verrouillé si Bob Work tourne en arrière-plan
              (icône barre de menus) et le Mac reste éveillé.
            </p>
          </FormField>
        )}

        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <FormField label="Mode Bob Shell">
              <select value={form.pluginOrMode ?? 'agent'} onChange={e => set('pluginOrMode', e.target.value)} style={inputStyle}>
                {initialTemplate && <option value={`plugin:${initialTemplate.pluginId}`}>Plugin · {initialTemplate.pluginName}</option>}
                {(modes.length ? modes : [{ slug: 'agent', name: 'Agent' } as BobMode]).map(mode => <option key={mode.slug} value={mode.slug}>{mode.name}</option>)}
              </select>
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Projet">
              <select value={form.projectId ?? ''} onChange={e => set('projectId', e.target.value)} style={inputStyle}>
                <option value="">Sans projet</option>
                {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </FormField>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <FormField label="Si hors ligne">
              <select value={form.offlineBehavior} onChange={e => set('offlineBehavior', e.target.value as CreateScheduleInput['offlineBehavior'])} style={inputStyle}>
                <option value="skip">Ignorer</option>
                <option value="run_on_wake">Exécuter au réveil</option>
                <option value="ask">Demander</option>
              </select>
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Si chevauchement">
              <select value={form.overlapPolicy} onChange={e => set('overlapPolicy', e.target.value as CreateScheduleInput['overlapPolicy'])} style={inputStyle}>
                <option value="queue">Mettre en file</option>
                <option value="ignore">Ignorer</option>
                <option value="cancel_old">Annuler l'ancien</option>
              </select>
            </FormField>
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--error, #ef4444)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} className="btn-secondary" disabled={loading}>Annuler</button>
          <button
            onClick={handleCreate}
            disabled={loading || !form.name.trim() || !form.instructions.trim()}
            className="btn-primary"
          >
            {loading ? 'Création…' : 'Créer'}
          </button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  )
}

// ── Log Modal ──────────────────────────────────────────────────

function LogModal({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const t = useT()
  const [runs, setRuns] = useState<ScheduleRun[] | null>(null)
  const [runsError, setRunsError] = useState<unknown>(null)

  const loadRuns = () => {
    setRuns(null)
    setRunsError(null)
    getScheduleRuns(schedule.id)
      .then(items => {
        setRunsError(null)
        setRuns(items)
      })
      .catch(error => {
        setRuns([])
        setRunsError(error)
      })
  }

  useEffect(() => {
    loadRuns()
  }, [schedule.id])

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel style={{
        background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', padding: 24, width: 800, maxWidth: '90vw',
        display: 'flex', flexDirection: 'column', maxHeight: '85vh',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Historique · {schedule.name}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {runsError ? (
            <LoadErrorBanner error={runsError} onRetry={loadRuns} fallback={t('schedules.runsLoadFailed')} />
          ) : runs === null ? <div className="task-empty"><span className="task-spinner" />Chargement…</div> : runs.length === 0 ? <div className="task-empty">Aucune exécution.</div> : runs.map(run => (
            <div key={run.id} className="task-card" style={{ marginBottom: 8, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {run.state === 'running' && <span className="task-spinner" />}
                <strong style={{ fontSize: 12 }}>{run.state}</strong>
                <time style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(run.scheduledFor)}</time>
              </div>
              {run.summary && <p style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{run.summary}</p>}
              {run.error && <p style={{ fontSize: 12, color: 'var(--danger)' }}>{run.error}</p>}
              {run.taskId && <small style={{ color: 'var(--text-muted)' }}>Tâche : {run.taskId}</small>}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  )
}

// ── Main view ─────────────────────────────────────────────────

export default function ScheduleView() {
  const t = useT()
  const dialog = useAppDialog()
  const stateLabel: Record<string, string> = {
    active: t('schedules.active'),
    paused: t('schedules.paused'),
    completed: t('schedules.completed'),
  }
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [showModal, setShowModal] = useState(false)
  const [viewingLogsFor, setViewingLogsFor] = useState<Schedule | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const [initialTemplate, setInitialTemplate] = useState<PluginTemplateState | undefined>(() => (location.state as { pluginTemplate?: PluginTemplateState } | null)?.pluginTemplate)

  const load = async () => {
    setLoadError(null)
    try {
      const [list, projectList] = await Promise.all([
        getSchedules(),
        getProjects().catch(() => []),
      ])
      setSchedules(list)
      setProjects(projectList)
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }

  const projectNameById = useMemo(
    () => new Map(projects.map(project => [project.id, project.name])),
    [projects],
  )

  useEffect(() => { 
    load() 
    const unlisten = listen('schedule-updated', () => {
      load()
    })
    return () => {
      unlisten.then(f => f())
    }
  }, [])

  useEffect(() => {
    const template = (location.state as { pluginTemplate?: PluginTemplateState } | null)?.pluginTemplate
    if (!template) return
    setInitialTemplate(template)
    setShowModal(true)
    navigate('/schedules', { replace: true, state: null })
  }, [location.state, navigate])

  const handleToggle = async (s: Schedule) => {
    const next = s.state === 'active' ? 'paused' : 'active'
    setActionError(null)
    try {
      await updateScheduleState(s.id, next)
      setSchedules(prev => prev.map(x => x.id === s.id ? { ...x, state: next as Schedule['state'] } : x))
    } catch (error) {
      setActionError(error)
    }
  }

  const handleDelete = async (s: Schedule) => {
    if (!await dialog.confirm({ message: t('schedules.deleteConfirm', { name: s.name }), confirmLabel: t('common.delete'), destructive: true })) return
    setActionError(null)
    try {
      await deleteSchedule(s.id)
      setSchedules(prev => prev.filter(x => x.id !== s.id))
    } catch (error) {
      setActionError(error)
    }
  }

  const handleRunNow = async (schedule: Schedule) => {
    setRunningId(schedule.id)
    setActionError(null)
    try {
      await runScheduleNow(schedule.id)
      await load()
      setViewingLogsFor(schedule)
    } catch (error) {
      setActionError(error)
    } finally { setRunningId(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Topbar */}
      <div className="topbar titlebar-drag" data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('schedules.title')}</span>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary titlebar-no-drag"
          style={{ fontSize: 12, padding: '5px 14px' }}
        >
          + Nouvelle
        </button>
      </div>

      <LoadErrorBanner
        error={loadError}
        onRetry={() => { setLoading(true); void load() }}
        fallback={t('schedules.loadFailed')}
      />
      <LoadErrorBanner error={actionError} fallback={t('schedules.actionFailed')} />

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 24px' }}>
        {loading && !loadError ? (
          <EmptyMsg icon="⏳" text="Chargement…" />
        ) : loadError ? null : schedules.length === 0 ? (
          <EmptyMsg
            icon="🕐"
            text="Aucune planification"
            sub='Cliquez sur "+ Nouvelle" pour automatiser une tâche récurrente.'
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 700 }}>
            {schedules.map(s => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                projectName={s.projectId ? projectNameById.get(s.projectId) : undefined}
                stateLabel={stateLabel}
                onToggle={() => handleToggle(s)}
                onDelete={() => handleDelete(s)}
                onViewLogs={() => setViewingLogsFor(s)}
                onRunNow={() => handleRunNow(s)}
                running={runningId === s.id}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <CreateModal
          initialTemplate={initialTemplate}
          onClose={() => { setShowModal(false); setInitialTemplate(undefined) }}
          onDone={() => { setShowModal(false); setInitialTemplate(undefined); load() }}
        />
      )}

      {viewingLogsFor && (
        <LogModal
          schedule={viewingLogsFor}
          onClose={() => setViewingLogsFor(null)}
        />
      )}
    </div>
  )
}

// ── Schedule card ─────────────────────────────────────────────

function ScheduleCard({
  schedule, projectName, stateLabel, onToggle, onDelete, onViewLogs, onRunNow, running
}: {
  schedule: Schedule
  projectName?: string
  stateLabel: Record<string, string>
  onToggle: () => void
  onDelete: () => void
  onViewLogs: () => void
  onRunNow: () => void
  running: boolean
}) {
  const isActive = schedule.state === 'active'

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Toggle */}
        <button
          onClick={onToggle}
          title={isActive ? 'Mettre en pause' : 'Activer'}
          style={{
            flexShrink: 0,
            width: 36, height: 20, borderRadius: 10,
            background: isActive ? 'var(--accent)' : 'var(--bg-active)',
            border: 'none', cursor: 'pointer', position: 'relative',
            transition: 'background .2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: isActive ? 18 : 3,
            width: 14, height: 14, borderRadius: '50%',
            background: '#fff', transition: 'left .2s',
          }} />
        </button>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{schedule.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>
            {schedule.instructions.length > 100
              ? schedule.instructions.slice(0, 100) + '…'
              : schedule.instructions}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            <span>🔁 {formatScheduleFrequency(schedule.cronOrEvent, schedule.runAt)}</span>
            {projectName && <span>📁 {projectName}</span>}
            <span>🌍 {schedule.timezone}</span>
            <span>📶 Si hors ligne : {OFFLINE_LABEL[schedule.offlineBehavior] ?? schedule.offlineBehavior}</span>
            <span style={{
              fontWeight: 600,
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
            }}>
              {stateLabel[schedule.state] ?? schedule.state}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 11, color: 'var(--text-muted)', alignItems: 'center' }}>
            <span>Prochaine exécution : <strong>{fmtDate(schedule.nextRun)}</strong></span>
            {schedule.lastRun && (
              <span>Dernière : <strong>{fmtDate(schedule.lastRun)}</strong></span>
            )}
            <button
              onClick={onViewLogs}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: 4,
                padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: 'var(--text-secondary)'
              }}
            >
              Historique
            </button>
            <button onClick={onRunNow} disabled={running} className="secondary-btn">
              {running ? 'Démarrage…' : 'Exécuter maintenant'}
            </button>
          </div>
        </div>

        {/* Delete */}
        <button
          onClick={onDelete}
          title="Supprimer"
          style={{
            flexShrink: 0, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 4,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          </svg>
        </button>
      </div>
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
