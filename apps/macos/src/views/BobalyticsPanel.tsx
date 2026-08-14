import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import {
  Activity, BookOpen, Building2, Calendar, Download, LayoutGrid, Sun, User, Users,
} from 'lucide-react'
import { exportBobalytics, getBobalytics } from '../lib/ipc'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../i18n'
import type { BobalyticsReport, BobalyticsScope, BobalyticsTeamPoint } from '@bob-work/shared-types'

type Tab = 'today' | 'patterns'
type PatternMode = 'editorial' | 'kpis'
type RangeDays = 7 | 30 | 90
type Translate = (key: string, params?: Record<string, string | number>) => string

export default function BobalyticsPanel() {
  const t = useT()
  const [tab, setTab] = useState<Tab>('today')
  const [scope, setScope] = useState<BobalyticsScope>('workspace')
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [patternMode, setPatternMode] = useState<PatternMode>('editorial')
  const [report, setReport] = useState<BobalyticsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await getBobalytics(scope, rangeDays)
      setReport(next)
      setSelectedTeamId(next.patterns.highlightedTeamId ?? next.patterns.teams[0]?.id ?? null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [scope, rangeDays])

  useEffect(() => { void load() }, [load])

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    const part = hour < 12 ? t('bobalytics.morning') : hour < 18 ? t('bobalytics.afternoon') : t('bobalytics.evening')
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    return `${part}, ${report?.greetingName ?? '—'} · ${date}`
  }, [report?.greetingName, t])

  const selectedTeam = report?.patterns.teams.find(team => team.id === selectedTeamId) ?? null

  const exportCsv = async () => {
    const path = await chooseSavePath({
      defaultPath: `bobalytics-${scope}-${rangeDays}d.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!path) return
    try {
      await exportBobalytics(path, scope, rangeDays)
      setStatus(t('bobalytics.exported'))
      window.setTimeout(() => setStatus(''), 2500)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section className="bobalytics-panel settings-card" aria-label="Bobalytics">
      <header className="bobalytics-head">
        <div className="bobalytics-title-row">
          <h2>Bobalytics</h2>
          <button type="button" className="secondary-btn compact" onClick={() => void exportCsv()}>
            <Download size={13} aria-hidden="true" /> {t('bobalytics.export')}
          </button>
        </div>
        <div className="bobalytics-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'today'} className={tab === 'today' ? 'is-active' : ''} onClick={() => setTab('today')}>
            <Sun size={14} aria-hidden="true" /> {t('bobalytics.today')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'patterns'} className={tab === 'patterns' ? 'is-active' : ''} onClick={() => setTab('patterns')}>
            <Activity size={14} aria-hidden="true" /> {t('bobalytics.patterns')}
          </button>
        </div>
      </header>

      <div className="bobalytics-controls">
        <div className="bobalytics-scope" role="group" aria-label={t('bobalytics.scope')}>
          <ScopeButton id="workspace" icon={<Building2 size={13} />} label={t('bobalytics.workspace')} current={scope} onSelect={setScope} />
          <ScopeButton id="team" icon={<Users size={13} />} label={t('bobalytics.team')} current={scope} onSelect={setScope} />
          <ScopeButton id="user" icon={<User size={13} />} label={t('bobalytics.user')} current={scope} onSelect={setScope} />
        </div>
        {tab === 'patterns' && (
          <div className="bobalytics-toolbar">
            <label className="bobalytics-range">
              <Calendar size={13} aria-hidden="true" />
              <select value={rangeDays} onChange={event => setRangeDays(Number(event.target.value) as RangeDays)} aria-label={t('bobalytics.range')}>
                <option value={7}>{t('bobalytics.range7')}</option>
                <option value={30}>{t('bobalytics.range30')}</option>
                <option value={90}>{t('bobalytics.range90')}</option>
              </select>
            </label>
            <div className="bobalytics-seg" role="group" aria-label={t('bobalytics.patternMode')}>
              <button type="button" className={patternMode === 'editorial' ? 'is-active' : ''} onClick={() => setPatternMode('editorial')}>
                <BookOpen size={13} aria-hidden="true" /> {t('bobalytics.editorial')}
              </button>
              <button type="button" className={patternMode === 'kpis' ? 'is-active' : ''} onClick={() => setPatternMode('kpis')}>
                <LayoutGrid size={13} aria-hidden="true" /> {t('bobalytics.kpis')}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="bobalytics-greeting">
        {tab === 'today' ? greeting : `${t('bobalytics.patterns')} · ${scopeLabel(scope, t)}`}
      </p>
      <p className="bobalytics-seats">{t('bobalytics.metricsAbout', { count: report?.seats ?? '—' })}</p>

      {loading && !report ? (
        <div className="bobalytics-loader" role="status"><span className="task-spinner" />{t('common.loading')}</div>
      ) : error && !report ? (
        <p className="settings-note" role="alert">{error}</p>
      ) : report ? (
        tab === 'today' ? (
          <TodayView report={report} t={t} />
        ) : patternMode === 'editorial' ? (
          <EditorialView
            report={report}
            selectedTeam={selectedTeam}
            onSelectTeam={setSelectedTeamId}
            t={t}
          />
        ) : (
          <KpiView report={report} t={t} />
        )
      ) : null}

      {tab === 'today' && (
        <div className="bobalytics-today-actions">
          <button type="button" className="link-btn" onClick={() => void openUrl('https://bob.ibm.com/')}>
            {t('bobalytics.openPortal')}
          </button>
        </div>
      )}
      {status && <p className="settings-note" role="status">{status}</p>}
      {report?.message && <p className="bobalytics-footnote">{report.message}</p>}
    </section>
  )
}

function ScopeButton({
  id, icon, label, current, onSelect,
}: {
  id: BobalyticsScope
  icon: ReactNode
  label: string
  current: BobalyticsScope
  onSelect: (scope: BobalyticsScope) => void
}) {
  return (
    <button type="button" className={current === id ? 'is-active' : ''} onClick={() => onSelect(id)}>
      {icon} {label}
    </button>
  )
}

function TodayView({ report, t }: { report: BobalyticsReport; t: Translate }) {
  const peak = report.today.peakDay
  return (
    <div className="bobalytics-today">
      <div className="bobalytics-hero">
        <div>
          <p className="bobalytics-streak">
            {report.today.streakDays} {t('bobalytics.daysStraight')}
          </p>
          <p className="bobalytics-momentum">{report.today.momentum}</p>
          <p className="bobalytics-kpi-label">{t('bobalytics.tasksToday')}</p>
          <p className="bobalytics-hero-number">{report.today.tasksToday}</p>
        </div>
        <div className="bobalytics-radar-wrap">
          <p className="bobalytics-kpi-label">{t('bobalytics.weeklyRhythm')}</p>
          <RadarChart points={report.today.weeklyRhythm} peak={peak} />
        </div>
      </div>
      <div className="bobalytics-kpis">
        <Kpi label={t('bobalytics.avgDailyUsers')} value={`${formatCount(report.kpis.avgDailyUsers)}/${report.kpis.seats}`} />
        <Kpi label={t('bobalytics.adoption')} value={formatPct(report.kpis.adoptionPct)} />
        <Kpi label={t('bobalytics.bobFactor')} value={report.kpis.bobFactorPct == null ? '—' : formatPct(report.kpis.bobFactorPct)} />
        <Kpi label={t('bobalytics.bobcoins')} value={formatCompact(report.kpis.bobcoins)} />
      </div>
    </div>
  )
}

function EditorialView({
  report, selectedTeam, onSelectTeam, t,
}: {
  report: BobalyticsReport
  selectedTeam: BobalyticsTeamPoint | null
  onSelectTeam: (id: string) => void
  t: Translate
}) {
  const freq = report.patterns.usageFrequency
  const freqTotal = Math.max(1, freq.weekly + freq.light + freq.inactive)
  return (
    <div className="bobalytics-editorial">
      <header className="bobalytics-story">
        <h3>{report.patterns.headline}</h3>
        <p>{report.patterns.body}</p>
      </header>

      <section className="bobalytics-block">
        <p className="bobalytics-section-label">01 · {t('bobalytics.reach')}</p>
        <h3>{report.patterns.reachHeadline}</h3>
        <p>{report.patterns.reachBody}</p>
        <div className="bobalytics-big-row">
          <div>
            <strong>{formatPct(report.patterns.bobUsersPct)}</strong>
            <small>{t('bobalytics.bobUsers')} · {report.patterns.bobUsers} / {report.seats}</small>
          </div>
          <div>
            <strong>{formatPct(report.patterns.typicalDayPct)}</strong>
            <small>{t('bobalytics.typicalDay')} · {formatCount(report.patterns.typicalDayActive)} / {report.patterns.bobUsers}</small>
          </div>
        </div>
        <ScatterCard report={report} selectedTeam={selectedTeam} onSelectTeam={onSelectTeam} t={t} />
      </section>

      <section className="bobalytics-block bobalytics-frequency">
        <p className="bobalytics-section-label">{t('bobalytics.usageFrequency')}</p>
        <p>{t('bobalytics.usageFrequencyBody', { count: freq.weekly })}</p>
        <div className="bobalytics-freq-bar" role="img" aria-label={t('bobalytics.usageFrequency')}>
          <span style={{ flexGrow: Math.max(freq.weekly, 0.001) }} className="is-weekly" />
          <span style={{ flexGrow: Math.max(freq.light, 0.001) }} className="is-light" />
          <span style={{ flexGrow: Math.max(freq.inactive, 0.001) }} className="is-inactive" />
        </div>
        <div className="bobalytics-freq-legend">
          <span>{t('bobalytics.weekly')} · {freq.weekly}</span>
          <span>{t('bobalytics.light')} · {freq.light}</span>
          <span>{t('bobalytics.inactive')} · {freq.inactive}</span>
        </div>
        <p className="bobalytics-freq-share">{Math.round((freq.inactive / freqTotal) * 100)}% {t('bobalytics.inactive').toLowerCase()}</p>
      </section>

      <section className="bobalytics-block">
        <p className="bobalytics-section-label">02 · {t('bobalytics.returnSignals')}</p>
        <h3>{t('bobalytics.returnHeadline')}</h3>
        <p>{t('bobalytics.returnBody')}</p>
        <aside className="bobalytics-insight">
          <p className="bobalytics-section-label">{t('bobalytics.editorialInsight')}</p>
          <p>{report.patterns.insight}</p>
        </aside>
        <div className="bobalytics-big-row">
          <div>
            <small>{t('bobalytics.recordedSpend')}</small>
            <strong>{formatCompact(report.patterns.recordedSpend)} BC</strong>
          </div>
          <div>
            <small>{t('bobalytics.committedLines')}</small>
            <strong>{report.patterns.committedLines == null ? '—' : formatInt(report.patterns.committedLines)}</strong>
          </div>
        </div>
        <p className="bobalytics-kpi-label">{t('bobalytics.teamInvestment')} · {report.patterns.teams.length}</p>
        <div className="bobalytics-team-bars">
          {report.patterns.teams.length === 0 ? (
            <p className="settings-note">{t('bobalytics.noTeams')}</p>
          ) : report.patterns.teams.map(team => (
            <button type="button" key={team.id} className={team.id === selectedTeam?.id ? 'is-active' : ''} onClick={() => onSelectTeam(team.id)}>
              <span className="bobalytics-team-name">{team.name}</span>
              <span className="bobalytics-dual" aria-hidden="true">
                <i style={{ width: `${Math.min(100, team.spendSharePct)}%` }} className="is-spend" />
                <i style={{ width: `${Math.min(100, team.outputSharePct)}%` }} className="is-output" />
              </span>
              <small>{Math.round(team.spendSharePct)}% BC · {Math.round(team.outputSharePct)}% {t('bobalytics.committedShort')}</small>
            </button>
          ))}
        </div>
        <p className="bobalytics-footnote">{t('bobalytics.returnDisclaimer')}</p>
      </section>
    </div>
  )
}

function KpiView({ report, t }: { report: BobalyticsReport; t: Translate }) {
  return (
    <div className="bobalytics-kpi-grid">
      <article>
        <p className="bobalytics-section-label">{t('bobalytics.adoption')}</p>
        <strong>{formatPct(report.kpis.adoptionPct)}</strong>
        <p>{t('bobalytics.adoptionHint')}</p>
        <small>{formatCount(report.kpis.avgDailyUsers)} / {report.kpis.seats}</small>
      </article>
      <article>
        <p className="bobalytics-section-label">{t('bobalytics.bobFactor')}</p>
        <strong>{report.kpis.bobFactorPct == null ? '—' : formatPct(report.kpis.bobFactorPct)}</strong>
        <p>{t('bobalytics.bobFactorHint')}</p>
      </article>
      <article>
        <p className="bobalytics-section-label">{t('bobalytics.bobcoins')}</p>
        <strong>{formatCompact(report.kpis.bobcoins)}</strong>
        <p>{t('bobalytics.bobcoinsHint')}</p>
      </article>
    </div>
  )
}

function ScatterCard({
  report, selectedTeam, onSelectTeam, t,
}: {
  report: BobalyticsReport
  selectedTeam: BobalyticsTeamPoint | null
  onSelectTeam: (id: string) => void
  t: Translate
}) {
  const teams = report.patterns.teams
  return (
    <div className="bobalytics-chart-card">
      <div className="bobalytics-card-head">
        <strong>{t('bobalytics.scatterTitle')}</strong>
        <small>{teams.length} {t('bobalytics.teamsShown')}</small>
      </div>
      <p className="bobalytics-card-help">{t('bobalytics.scatterHelp')}</p>
      <ScatterPlot teams={teams} selectedId={selectedTeam?.id ?? null} onSelect={onSelectTeam} />
      {selectedTeam && (
        <p className="bobalytics-card-foot">
          <strong>{selectedTeam.name}</strong>
          {' · '}
          {Math.round(selectedTeam.typicalDayActivePct)}% {t('bobalytics.typicalDay').toLowerCase()}
          {' · '}
          {Math.round(selectedTeam.committedSharePct)}% {t('bobalytics.committedShort')}
        </p>
      )}
    </div>
  )
}

function RadarChart({ points, peak }: { points: BobalyticsReport['today']['weeklyRhythm']; peak?: BobalyticsReport['today']['peakDay'] }) {
  const size = 180
  const cx = size / 2
  const cy = size / 2
  const radius = 62
  const max = Math.max(1, ...points.map(point => point.value))
  const coord = (index: number, value: number) => {
    const angle = (Math.PI * 2 * index) / 7 - Math.PI / 2
    const r = (value / max) * radius
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const
  }
  const polygon = points.map((point, index) => coord(index, point.value).join(',')).join(' ')
  const peakIndex = peak ? points.findIndex(point => point.day === peak.day && point.value === peak.value) : -1
  return (
    <svg className="bobalytics-radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Weekly rhythm">
      {[0.35, 0.7, 1].map(scale => (
        <polygon
          key={scale}
          className="bobalytics-radar-grid"
          fill="none"
          points={points.map((_, index) => coord(index, max * scale).join(',')).join(' ')}
        />
      ))}
      {points.map((_, index) => {
        const [x, y] = coord(index, max)
        return <line key={index} className="bobalytics-radar-axis" x1={cx} y1={cy} x2={x} y2={y} />
      })}
      <polygon className="bobalytics-radar-area" points={polygon} />
      {points.map((point, index) => {
        const [x, y] = coord(index, max + 16)
        return <text key={point.day + index} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{point.label}</text>
      })}
      {peakIndex >= 0 && (
        <>
          <circle className="bobalytics-radar-dot" cx={coord(peakIndex, peak!.value)[0]} cy={coord(peakIndex, peak!.value)[1]} r="3.5" />
          <text
            className="bobalytics-radar-peak"
            x={coord(peakIndex, peak!.value)[0] + 12}
            y={coord(peakIndex, peak!.value)[1]}
            dominantBaseline="middle"
          >
            {Math.round(peak!.value)}
          </text>
        </>
      )}
    </svg>
  )
}

function ScatterPlot({
  teams, selectedId, onSelect,
}: {
  teams: BobalyticsTeamPoint[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const width = 280
  const height = 180
  const pad = 24
  const avgX = average(teams.map(team => team.typicalDayActivePct))
  const avgY = average(teams.map(team => team.committedSharePct))
  const x = (value: number) => pad + (Math.min(100, value) / 100) * (width - pad * 2)
  const y = (value: number) => height - pad - (Math.min(100, value) / 100) * (height - pad * 2)
  return (
    <svg className="bobalytics-scatter" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Teams scatter">
      <line className="bobalytics-scatter-guide" x1={x(avgX)} y1={pad} x2={x(avgX)} y2={height - pad} strokeDasharray="4 4" />
      <line className="bobalytics-scatter-guide" x1={pad} y1={y(avgY)} x2={width - pad} y2={y(avgY)} strokeDasharray="4 4" />
      {teams.map(team => (
        <rect
          key={team.id}
          x={x(team.typicalDayActivePct) - 4}
          y={y(team.committedSharePct) - 4}
          width="8"
          height="8"
          rx="1"
          className={team.id === selectedId ? 'is-selected' : ''}
          onClick={() => onSelect(team.id)}
        />
      ))}
      <text x={width / 2} y={height - 4} textAnchor="middle">{'BOB USERS ACTIVE →'}</text>
      <text x={10} y={height / 2} transform={`rotate(-90 10 ${height / 2})`} textAnchor="middle">{'COMMITTED BOB-WRITTEN →'}</text>
    </svg>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  )
}

function scopeLabel(scope: BobalyticsScope, t: Translate) {
  return scope === 'team' ? t('bobalytics.team') : scope === 'user' ? t('bobalytics.user') : t('bobalytics.workspace')
}

function formatPct(value: number) {
  if (!Number.isFinite(value)) return '—'
  if (value > 0 && value < 1) return '<1%'
  return `${Math.round(value)}%`
}

function formatCount(value: number) {
  if (!Number.isFinite(value)) return '—'
  return value >= 10 ? String(Math.round(value)) : value.toFixed(value >= 1 ? 0 : 1)
}

function formatCompact(value: number) {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatInt(value: number) {
  return new Intl.NumberFormat().format(value)
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
