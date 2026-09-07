import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BobalyticsReport } from '@bob-work/shared-types'
import BobalyticsPanel from './BobalyticsPanel'

const mocks = vi.hoisted(() => ({
  getBobalytics: vi.fn(),
  exportBobalytics: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: mocks.save,
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getBobalytics: mocks.getBobalytics,
  exportBobalytics: mocks.exportBobalytics,
}))

const report: BobalyticsReport = {
  generatedAt: '2026-08-12T10:00:00Z',
  greetingName: 'Anis',
  instanceLabel: 'IBM Internal',
  scope: 'workspace',
  rangeDays: 30,
  source: 'local',
  seats: 4,
  today: {
    tasksToday: 181,
    streakDays: 7,
    momentum: 'Momentum looks good.',
    weeklyRhythm: [
      { day: 'S', label: 'S', value: 2 },
      { day: 'M', label: 'M', value: 8 },
      { day: 'T', label: 'T', value: 12 },
      { day: 'W', label: 'W', value: 104 },
      { day: 'T', label: 'T', value: 9 },
      { day: 'F', label: 'F', value: 6 },
      { day: 'S', label: 'S', value: 1 },
    ],
    peakDay: { day: 'W', label: 'W', value: 104 },
  },
  kpis: {
    avgDailyUsers: 11,
    seats: 4,
    adoptionPct: 0.4,
    bobFactorPct: 29,
    bobcoins: 25443,
  },
  patterns: {
    activityDays: 21,
    headline: '21 days with task activity',
    body: 'Task work appeared across multiple days.',
    reachHeadline: 'Reach is ahead of habit.',
    reachBody: '1 of 4 people showed recorded Bob usage.',
    bobUsers: 1,
    bobUsersPct: 25,
    typicalDayActive: 1,
    typicalDayPct: 100,
    usageFrequency: { weekly: 1, light: 0, inactive: 3 },
    recordedSpend: 25443,
    committedLines: 102057,
    insight: 'Bob appears in 29% of committed lines this month',
    teams: [
      { id: 'atlas', name: 'Atlas Platform', activeSharePct: 1, committedSharePct: 25, spendSharePct: 66, outputSharePct: 28, typicalDayActivePct: 1 },
      { id: 'beacon', name: 'Beacon Dashboard', activeSharePct: 5, committedSharePct: 27, spendSharePct: 5, outputSharePct: 27, typicalDayActivePct: 5 },
    ],
    highlightedTeamId: 'atlas',
  },
}

describe('BobalyticsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBobalytics.mockResolvedValue(report)
    mocks.exportBobalytics.mockResolvedValue(undefined)
    mocks.save.mockResolvedValue('/tmp/bobalytics.csv')
  })

  it('renders the Today landing with tasks, rhythm and KPIs', async () => {
    render(<BobalyticsPanel />)

    expect(await screen.findByRole('heading', { name: 'Bobalytics' })).toBeVisible()
    expect(screen.getByText('181')).toBeVisible()
    expect(screen.getByText('Momentum looks good.')).toBeVisible()
    expect(screen.getByText('25.4K')).toBeVisible()
    expect(screen.getByText('<1%')).toBeVisible()
    expect(screen.getByText('Les métriques ci-dessous portent sur 4 sièges.')).toBeVisible()
  })

  it('switches to Patterns editorial and KPI views', async () => {
    render(<BobalyticsPanel />)
    await screen.findByText('181')

    fireEvent.click(screen.getByRole('tab', { name: /Tendances/i }))
    expect(await screen.findByText('21 days with task activity')).toBeVisible()
    expect(screen.getByText('Reach is ahead of habit.')).toBeVisible()
    expect(screen.getAllByText('Atlas Platform').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Indicateurs/i }))
    expect(screen.getByText('Part des lignes commitées créées par Bob, ou intensité locale des tâches si la télémétrie d’organisation n’est pas disponible.')).toBeVisible()

    // Patterns toolbar should not leave the panel looking broken: editorial/KPI controls stay in-panel.
    expect(screen.getByRole('tab', { name: /Tendances/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Bobalytics' })).toBeVisible()
  })

  it('reloads when scope changes and exports CSV', async () => {
    render(<BobalyticsPanel />)
    await screen.findByText('181')

    fireEvent.click(screen.getByRole('button', { name: /Utilisateur/i }))
    await waitFor(() => {
      expect(mocks.getBobalytics).toHaveBeenCalledWith('user', 30)
    })

    fireEvent.click(screen.getByRole('button', { name: /Exporter/i }))
    await waitFor(() => {
      expect(mocks.exportBobalytics).toHaveBeenCalledWith('/tmp/bobalytics.csv', 'user', 30)
    })
  })
})
