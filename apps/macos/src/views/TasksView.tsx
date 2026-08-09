import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { cancelTask, getTaskDetail, getTasks, updateTaskPinned } from '../lib/ipc'
import type { Task, TaskDetail, TaskEvent, TaskIO } from '@bob-work/shared-types'

const ACTIVE_STATES = ['draft', 'queued', 'starting', 'running', 'awaiting_info', 'awaiting_approval', 'paused']
const DONE_STATES = ['completed', 'failed', 'cancelled', 'expired']

const STATE_LABEL: Record<string, string> = {
  draft: 'Brouillon', queued: 'En attente', starting: 'Démarrage', running: 'En cours',
  awaiting_info: 'Information requise', awaiting_approval: 'Approbation requise', paused: 'En pause',
  completed: 'Terminée', failed: 'Échec', cancelled: 'Annulée', expired: 'Expirée',
}

export default function TasksView() {
  const location = useLocation()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pinned' | 'active' | 'done'>('all')
  const requestedTaskId = (location.state as { taskId?: string } | null)?.taskId
  const [selectedId, setSelectedId] = useState<string | null>(requestedTaskId ?? null)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const refresh = useCallback(async () => {
    const next = await getTasks()
    setTasks(next)
    if (selectedId) setDetail(await getTaskDetail(selectedId))
  }, [selectedId])

  useEffect(() => {
    refresh().catch(() => {}).finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    let disposed = false
    let unlisten: UnlistenFn | undefined
    listen('task-updated', () => refresh().catch(() => {})).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    const timer = window.setInterval(() => {
      if (tasks.some(task => ACTIVE_STATES.includes(task.state))) refresh().catch(() => {})
    }, 2500)
    return () => { disposed = true; unlisten?.(); window.clearInterval(timer) }
  }, [refresh, tasks])

  const openDetail = async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    try { setDetail(await getTaskDetail(id)) } finally { setDetailLoading(false) }
  }

  const handleCancel = async (task: Task) => {
    if (!confirm(`Annuler la tâche « ${task.objective.slice(0, 80)} » ?`)) return
    await cancelTask(task.id)
    await refresh()
  }

  const handlePin = async (task: Task) => {
    const next = !task.pinned
    setTasks(current => current.map(item => item.id === task.id ? { ...item, pinned: next } : item))
    setDetail(current => current?.task.id === task.id ? { ...current, task: { ...current.task, pinned: next } } : current)
    try {
      await updateTaskPinned(task.id, next)
      await refresh()
    } catch {
      setTasks(current => current.map(item => item.id === task.id ? { ...item, pinned: task.pinned } : item))
      setDetail(current => current?.task.id === task.id ? { ...current, task: { ...current.task, pinned: task.pinned } } : current)
    }
  }

  const visible = useMemo(() => tasks.filter(task => {
    if (filter === 'pinned') return task.pinned
    if (filter === 'active') return ACTIVE_STATES.includes(task.state)
    if (filter === 'done') return DONE_STATES.includes(task.state)
    return true
  }), [tasks, filter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="topbar titlebar-drag">
        <span className="titlebar-no-drag" style={{ fontWeight: 600, fontSize: 14 }}>Tâches</span>
        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{tasks.length}</span>
      </div>

      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6 }}>
        {([['all', 'Toutes'], ['pinned', 'Épinglées'], ['active', 'En cours'], ['done', 'Historique']] as const).map(([key, label]) => (
          <button key={key} className={`filter-pill ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
          {loading ? <Empty icon={<Spinner />} text="Chargement…" /> : visible.length === 0 ? (
            <Empty icon="✓" text="Aucune tâche" sub="Les exécutions Bob apparaîtront ici avec leur historique." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: detail ? 680 : 820 }}>
              {visible.map(task => (
                <TaskCard key={task.id} task={task} selected={selectedId === task.id}
                  onOpen={() => openDetail(task.id)} onPin={() => handlePin(task)} onCancel={() => handleCancel(task)} />
              ))}
            </div>
          )}
        </div>
        {selectedId && (
          <TaskDrawer detail={detail} loading={detailLoading} onPin={task => handlePin(task)} onClose={() => { setSelectedId(null); setDetail(null) }} />
        )}
      </div>
    </div>
  )
}

function TaskCard({ task, selected, onOpen, onPin, onCancel }: { task: Task; selected: boolean; onOpen: () => void; onPin: () => void; onCancel: () => void }) {
  const active = ACTIVE_STATES.includes(task.state)
  const failed = task.state === 'failed'
  return (
    <button className={`task-card ${selected ? 'selected' : ''}`} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {active ? <Spinner /> : <span className={`status-dot ${failed ? 'red' : task.state === 'completed' ? 'green' : 'gray'}`} style={{ marginTop: 5 }} />}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontWeight: 550, fontSize: 13.5, lineHeight: 1.4 }}>{task.objective}</div>
          <div style={{ display: 'flex', gap: 9, marginTop: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`task-state ${task.state}`}>{STATE_LABEL[task.state] ?? task.state}</span>
            {task.mode && <span className="meta-pill">{task.mode}</span>}
            {task.scheduleId && <span className="meta-pill">Planifiée</span>}
            <time style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 'auto' }}>{formatDate(task.updatedAt)}</time>
          </div>
          {task.summary && !active && <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '8px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.summary}</p>}
        </div>
        <span role="button" className={`icon-btn ${task.pinned ? 'active' : ''}`} title={task.pinned ? 'Désépingler la tâche' : 'Épingler la tâche'} aria-label={task.pinned ? 'Désépingler la tâche' : 'Épingler la tâche'} onClick={event => { event.stopPropagation(); onPin() }}><PinIcon filled={task.pinned} /></span>
        {active && <span role="button" className="icon-btn" title="Annuler" aria-label="Annuler la tâche" onClick={event => { event.stopPropagation(); onCancel() }}>×</span>}
      </div>
    </button>
  )
}

function TaskDrawer({ detail, loading, onPin, onClose }: { detail: TaskDetail | null; loading: boolean; onPin: (task: Task) => void; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <aside className="task-drawer">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <strong style={{ fontSize: 13, marginRight: 'auto' }}>Détail de la tâche</strong>
        {detail && <button className={`icon-btn ${detail.task.pinned ? 'active' : ''}`} onClick={() => onPin(detail.task)} title={detail.task.pinned ? 'Désépingler la tâche' : 'Épingler la tâche'} aria-label={detail.task.pinned ? 'Désépingler la tâche' : 'Épingler la tâche'}><PinIcon filled={detail.task.pinned} /></button>}
        <button className="icon-btn" onClick={onClose} aria-label="Fermer le détail">×</button>
      </div>
      {loading || !detail ? <Empty icon={<Spinner />} text="Chargement…" /> : <>
        <h2 style={{ fontSize: 15, lineHeight: 1.4, margin: '0 0 10px' }}>{detail.task.objective}</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className={`task-state ${detail.task.state}`}>{STATE_LABEL[detail.task.state] ?? detail.task.state}</span>
          {detail.task.mode && <span className="meta-pill">Mode {detail.task.mode}</span>}
          {detail.task.shellTaskId && <span className="meta-pill" title={detail.task.shellTaskId}>Reprenable Shell</span>}
        </div>
        {detail.task.conversationId && <button className="secondary-btn" style={{ marginTop: 12 }} onClick={() => navigate(`/chat/${detail.task.conversationId}`)}>Ouvrir la conversation</button>}
        {detail.task.conversationId && detail.task.resumable && detail.task.shellTaskId && !ACTIVE_STATES.includes(detail.task.state) && (
          <button className="primary-btn" style={{ marginTop: 12, marginLeft: 8 }} onClick={() => navigate(`/chat/${detail.task.conversationId}`, {
            state: {
              initialPrompt: 'Poursuis cette tâche à partir de son dernier état et vérifie le résultat.',
              mode: detail.task.mode ?? 'agent',
              projectId: detail.task.projectId,
              resumeTaskId: detail.task.id,
            },
          })}>Reprendre avec Bob</button>
        )}
        {detail.task.summary && <Section title="Résultat"><p className="task-detail-text">{detail.task.summary}</p></Section>}
        <Section title={`Tentatives (${detail.runs.length})`}>
          {detail.runs.map(run => <div key={run.id} className="task-run-row">
            <span>Tentative {run.attempt}</span><span>{STATE_LABEL[run.state] ?? run.state}</span><time>{formatDate(run.startedAt ?? run.createdAt)}</time>
            {run.error && <small>{run.error}</small>}
          </div>)}
        </Section>
        <IoList title="Entrées" items={detail.inputs} />
        <IoList title="Sorties et sources" items={detail.outputs} />
        <Section title={`Activité (${detail.events.length})`}>
          {detail.events.length === 0 ? <Muted text="Aucun événement structuré." /> : detail.events.map(event => <EventRow key={event.id} event={event} />)}
        </Section>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 16 }}>Activité explicite de Bob Shell uniquement ; aucune chaîne de pensée privée n’est exposée.</p>
      </>}
    </aside>
  )
}

function EventRow({ event }: { event: TaskEvent }) {
  return <div className="task-event-row">
    <span className="task-event-dot" />
    <div><strong>{event.title || event.toolName || event.eventType}</strong>{event.content && <p>{event.content}</p>}<time>{formatDate(event.createdAt)}</time></div>
  </div>
}

function IoList({ title, items }: { title: string; items: TaskIO[] }) {
  if (!items.length) return null
  return <Section title={`${title} (${items.length})`}>
    {items.map(item => <div className="task-io-row" key={item.id}>
      <span>{item.ioType === 'source' ? '↗' : item.direction === 'input' ? '→' : '←'}</span>
      <div><strong>{item.name}</strong>{item.pathOrUrl && <small>{item.pathOrUrl}</small>}</div>
    </div>)}
  </Section>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="task-detail-section"><h3>{title}</h3>{children}</section>
}

function Spinner() { return <span className="task-spinner" aria-label="En cours" /> }
function PinIcon({ filled = false }: { filled?: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="m5 17 3.5-3.5V6L7 4.5V3h10v1.5L15.5 6v7.5L19 17z"/></svg>
}
function Muted({ text }: { text: string }) { return <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{text}</p> }
function Empty({ icon, text, sub }: { icon: React.ReactNode; text: string; sub?: string }) {
  return <div className="task-empty"><span style={{ fontSize: 28, opacity: .5 }}>{icon}</span><span>{text}</span>{sub && <small>{sub}</small>}</div>
}
function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
