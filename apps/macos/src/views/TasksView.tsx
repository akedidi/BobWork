import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { cancelTask, getTaskDetail, getTasks, updateTaskPinned } from '../lib/ipc'
import { LoadErrorBanner } from '../components/LoadErrorBanner'
import type { Task, TaskDetail, TaskEvent, TaskIO } from '@bob-work/shared-types'
import { useT } from '../i18n'
import { useAppDialog } from '../components/AppDialog'

const ACTIVE_STATES = ['draft', 'queued', 'starting', 'running', 'awaiting_info', 'awaiting_approval', 'paused']
const DONE_STATES = ['completed', 'failed', 'cancelled', 'expired']

function useTaskStateLabels(): Record<string, string> {
  const t = useT()
  return {
    draft: t('tasks.draft'),
    queued: t('tasks.queued'),
    starting: t('tasks.starting'),
    running: t('tasks.running'),
    awaiting_info: t('tasks.awaitingInfo'),
    awaiting_approval: t('tasks.awaitingApproval'),
    paused: t('tasks.paused'),
    completed: t('tasks.completed'),
    failed: t('tasks.failed'),
    cancelled: t('tasks.cancelled'),
    expired: t('tasks.expired'),
  }
}

export default function TasksView() {
  const t = useT()
  const dialog = useAppDialog()
  const stateLabel = useTaskStateLabels()
  const location = useLocation()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [filter, setFilter] = useState<'all' | 'pinned' | 'active' | 'done'>('all')
  const requestedTaskId = (location.state as { taskId?: string } | null)?.taskId
  const [selectedId, setSelectedId] = useState<string | null>(requestedTaskId ?? null)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)

  useEffect(() => {
    if (!requestedTaskId || requestedTaskId === selectedId) return
    void openDetail(requestedTaskId)
  }, [requestedTaskId])

  const refresh = useCallback(async () => {
    try {
      const next = await getTasks()
      setTasks(next)
      setLoadError(null)
      if (selectedId) setDetail(await getTaskDetail(selectedId))
    } catch (error) {
      setLoadError(error)
    }
  }, [selectedId])

  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    let disposed = false
    let unlisten: UnlistenFn | undefined
    listen('task-updated', () => { void refresh() }).then(fn => {
      if (disposed) fn(); else unlisten = fn
    })
    const timer = window.setInterval(() => {
      if (tasks.some(task => ACTIVE_STATES.includes(task.state))) void refresh()
    }, 2500)
    return () => { disposed = true; unlisten?.(); window.clearInterval(timer) }
  }, [refresh, tasks])

  const openDetail = async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    setActionError(null)
    try {
      setDetail(await getTaskDetail(id))
    } catch (error) {
      setActionError(error)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleCancel = async (task: Task) => {
    if (!await dialog.confirm({ message: t('tasks.cancelConfirm', { objective: task.objective.slice(0, 80) }), confirmLabel: t('tasks.cancelTask'), destructive: true })) return
    setActionError(null)
    try {
      await cancelTask(task.id)
      await refresh()
    } catch (error) {
      setActionError(error)
    }
  }

  const handlePin = async (task: Task) => {
    const next = !task.pinned
    setActionError(null)
    setTasks(current => current.map(item => item.id === task.id ? { ...item, pinned: next } : item))
    setDetail(current => current?.task.id === task.id ? { ...current, task: { ...current.task, pinned: next } } : current)
    try {
      await updateTaskPinned(task.id, next)
      await refresh()
    } catch (error) {
      setActionError(error)
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
      <div className="topbar titlebar-drag" data-tauri-drag-region>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('tasks.title')}</span>
        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{tasks.length}</span>
      </div>

      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 6 }}>
        {([['all', t('tasks.filterAll')], ['pinned', t('tasks.filterPinned')], ['active', t('tasks.filterActive')], ['done', t('tasks.filterDone')]] as const).map(([key, label]) => (
          <button key={key} className={`filter-pill ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>

      <LoadErrorBanner
        error={loadError}
        onRetry={() => { setLoading(true); void refresh().finally(() => setLoading(false)) }}
        fallback={t('tasks.loadFailed')}
      />
      <LoadErrorBanner error={actionError} fallback={t('tasks.actionFailed')} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
          {loading && !loadError ? <Empty icon={<Spinner />} text={t('common.loading')} /> : loadError ? null : visible.length === 0 ? (
            <Empty icon="✓" text={t('tasks.empty')} sub={t('tasks.emptyHint')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: detail ? 680 : 820 }}>
              {visible.map(task => (
                <TaskCard key={task.id} task={task} selected={selectedId === task.id} stateLabel={stateLabel}
                  onOpen={() => openDetail(task.id)} onPin={() => handlePin(task)} onCancel={() => handleCancel(task)} />
              ))}
            </div>
          )}
        </div>
        {selectedId && (
          <TaskDrawer detail={detail} loading={detailLoading} stateLabel={stateLabel} onPin={task => handlePin(task)} onClose={() => { setSelectedId(null); setDetail(null) }} />
        )}
      </div>
    </div>
  )
}

function TaskCard({ task, selected, stateLabel, onOpen, onPin, onCancel }: { task: Task; selected: boolean; stateLabel: Record<string, string>; onOpen: () => void; onPin: () => void; onCancel: () => void }) {
  const t = useT()
  const active = ACTIVE_STATES.includes(task.state)
  const failed = task.state === 'failed'
  return (
    <div
      className={`task-card ${selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {active ? <Spinner /> : <span className={`status-dot ${failed ? 'red' : task.state === 'completed' ? 'green' : 'gray'}`} style={{ marginTop: 5 }} />}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontWeight: 550, fontSize: 13.5, lineHeight: 1.4 }}>{task.objective}</div>
          <div style={{ display: 'flex', gap: 9, marginTop: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`task-state ${task.state}`}>{stateLabel[task.state] ?? task.state}</span>
            {task.mode && <span className="meta-pill">{task.mode}</span>}
            {task.scheduleId && <span className="meta-pill">{t('tasks.scheduled')}</span>}
            <time style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 'auto' }}>{formatDate(task.updatedAt)}</time>
          </div>
          {task.summary && !active && <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '8px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.summary}</p>}
        </div>
        <button type="button" className={`icon-btn ${task.pinned ? 'active' : ''}`} title={task.pinned ? t('tasks.unpin') : t('tasks.pin')} aria-label={task.pinned ? t('tasks.unpin') : t('tasks.pin')} onClick={event => { event.stopPropagation(); onPin() }}><PinIcon filled={task.pinned} /></button>
        {active && <button type="button" className="icon-btn" title={t('common.cancel')} aria-label={t('tasks.cancelTask')} onClick={event => { event.stopPropagation(); onCancel() }}>×</button>}
      </div>
    </div>
  )
}

function TaskDrawer({ detail, loading, stateLabel, onPin, onClose }: { detail: TaskDetail | null; loading: boolean; stateLabel: Record<string, string>; onPin: (task: Task) => void; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  return (
    <aside className="task-drawer">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <strong style={{ fontSize: 13, marginRight: 'auto' }}>{t('tasks.detail')}</strong>
        {detail && <button className={`icon-btn ${detail.task.pinned ? 'active' : ''}`} onClick={() => onPin(detail.task)} title={detail.task.pinned ? t('tasks.unpin') : t('tasks.pin')} aria-label={detail.task.pinned ? t('tasks.unpin') : t('tasks.pin')}><PinIcon filled={detail.task.pinned} /></button>}
        <button className="icon-btn" onClick={onClose} aria-label={t('tasks.closeDetail')}>×</button>
      </div>
      {loading || !detail ? <Empty icon={<Spinner />} text={t('common.loading')} /> : <>
        <h2 style={{ fontSize: 15, lineHeight: 1.4, margin: '0 0 10px' }}>{detail.task.objective}</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className={`task-state ${detail.task.state}`}>{stateLabel[detail.task.state] ?? detail.task.state}</span>
          {detail.task.mode && <span className="meta-pill">{t('tasks.mode')} {detail.task.mode}</span>}
          {detail.task.shellTaskId && <span className="meta-pill" title={detail.task.shellTaskId}>{t('tasks.shellResumable')}</span>}
        </div>
        {detail.task.conversationId && <button className="secondary-btn" style={{ marginTop: 12 }} onClick={() => navigate(`/chat/${detail.task.conversationId}`)}>{t('tasks.openConversation')}</button>}
        {detail.task.conversationId && detail.task.resumable && detail.task.shellTaskId && !ACTIVE_STATES.includes(detail.task.state) && (
          <button className="primary-btn" style={{ marginTop: 12, marginLeft: 8 }} onClick={() => navigate(`/chat/${detail.task.conversationId}`, {
            state: {
              initialPrompt: t('tasks.resumePrompt'),
              mode: detail.task.mode ?? 'agent',
              projectId: detail.task.projectId,
              resumeTaskId: detail.task.id,
            },
          })}>{t('tasks.resumeWithBob')}</button>
        )}
        {detail.task.summary && <Section title={t('tasks.result')}><p className="task-detail-text">{detail.task.summary}</p></Section>}
        <Section title={t('tasks.attempts', { count: detail.runs.length })}>
          {detail.runs.map(run => <div key={run.id} className="task-run-row">
            <span>{t('tasks.attempt', { count: run.attempt })}</span><span>{stateLabel[run.state] ?? run.state}</span><time>{formatDate(run.startedAt ?? run.createdAt)}</time>
            {run.error && <small>{run.error}</small>}
          </div>)}
        </Section>
        <IoList title={t('tasks.inputs')} items={detail.inputs} />
        <IoList title={t('tasks.outputs')} items={detail.outputs} />
        <Section title={t('tasks.activity', { count: detail.events.length })}>
          {detail.events.length === 0 ? <Muted text={t('tasks.noEvents')} /> : detail.events.map(event => <EventRow key={event.id} event={event} />)}
        </Section>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 16 }}>{t('tasks.activityPrivacy')}</p>
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

function Spinner() { const t = useT(); return <span className="task-spinner" aria-label={t('tasks.running')} /> }
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
