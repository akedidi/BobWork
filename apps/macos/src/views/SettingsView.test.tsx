import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@bob-work/shared-types'
import { I18nProvider } from '../i18n'
import SettingsView from './SettingsView'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  peekCachedSettings: vi.fn(() => null as AppSettings | null),
  getBobAuthSnapshot: vi.fn(),
  hasSessionSecret: vi.fn(),
  getBobProfile: vi.fn(),
  getUsageStatus: vi.fn(),
  getBobalytics: vi.fn(),
  exportBobalytics: vi.fn(),
  getPermissionGrants: vi.fn(),
  getNotificationAuthState: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  DEFAULT_APP_SETTINGS: {
    theme: 'system',
    language: 'fr',
    defaultMode: 'agent',
    sidebarWidth: 260,
    inspectorWidth: 340,
    sidebarVisible: true,
    inspectorVisible: true,
    fontSize: 15,
    reducedMotion: false,
    permissionPolicy: 'ask_for_important',
    launchAtLogin: false,
    menuBarEnabled: true,
    globalInstructions: '',
    maxTurns: 100,
    maxCost: 0,
    mcpEnabled: true,
    subagentsEnabled: true,
    webEnabled: true,
    notificationsEnabled: true,
    notifyTaskComplete: true,
    voiceOnDevice: true,
    taskRetentionDays: 30,
    telemetryEnabled: false,
    computerUseEnabled: false,
    chromeControlEnabled: false,
    sandboxMode: false,
    crossConversationContext: false,
  },
  getSettings: mocks.getSettings,
  peekCachedSettings: mocks.peekCachedSettings,
  getBobAuthSnapshot: mocks.getBobAuthSnapshot,
  hasSessionSecret: mocks.hasSessionSecret,
  getBobProfile: mocks.getBobProfile,
  getUsageStatus: mocks.getUsageStatus,
  getBobalytics: mocks.getBobalytics,
  exportBobalytics: mocks.exportBobalytics,
  getPermissionGrants: mocks.getPermissionGrants,
  getNotificationAuthState: mocks.getNotificationAuthState,
  updateSettings: mocks.updateSettings,
  revokePermissionGrant: vi.fn(),
  importConversations: vi.fn(),
  exportConversations: vi.fn(),
  openMacosPrivacyPane: vi.fn(),
  getChromeControlStatus: vi.fn().mockResolvedValue(null),
  getComputerUseStatus: vi.fn().mockResolvedValue(null),
  testMcpServer: vi.fn().mockResolvedValue({ id: 'mcp', name: 'mcp', ok: false, message: '', tools: [] }),
  isNotificationAuthGranted: vi.fn().mockReturnValue(false),
  requestNotificationAuthorization: vi.fn(),
  requestAccessibilityPermission: vi.fn(),
  requestChromeAutomationPermission: vi.fn(),
  installBobShell: vi.fn(),
  openDataDir: vi.fn(),
  exportDiagnostics: vi.fn(),
  purgeAppCache: vi.fn(),
}))

vi.mock('../services/BobAuthService', async () => {
  const actual = await vi.importActual<typeof import('../services/BobAuthService')>('../services/BobAuthService')
  return {
    ...actual,
    bobAuthService: {
      setSessionApiKey: vi.fn(),
      clearSessionApiKey: vi.fn(),
    },
  }
})

const settings: AppSettings = {
  theme: 'system',
  language: 'fr',
  defaultMode: 'agent',
  sidebarWidth: 260,
  inspectorWidth: 340,
  sidebarVisible: true,
  inspectorVisible: true,
  fontSize: 15,
  reducedMotion: false,
  permissionPolicy: 'ask_for_important',
  launchAtLogin: false,
  menuBarEnabled: true,
  globalInstructions: '',
  maxTurns: 100,
  maxCost: 0,
  mcpEnabled: true,
  subagentsEnabled: true,
  webEnabled: true,
  notificationsEnabled: true,
  notifyTaskComplete: true,
  voiceOnDevice: true,
  taskRetentionDays: 30,
  telemetryEnabled: false,
  computerUseEnabled: false,
  chromeControlEnabled: false,
  sandboxMode: false,
  crossConversationContext: false,
}

function renderSettings(state?: { tab?: string }) {
  return render(
    <I18nProvider>
      <MemoryRouter
        initialEntries={[{ pathname: '/settings', state }]}

      >
        <SettingsView />
      </MemoryRouter>
    </I18nProvider>,
  )
}

describe('SettingsView progressive loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.peekCachedSettings.mockReturnValue(null)
    mocks.getSettings.mockResolvedValue(settings)
    mocks.getBobAuthSnapshot.mockResolvedValue({
      found: true,
      path: '/usr/local/bin/bob',
      version: '2.0.0',
      authenticated: true,
      authenticationMethod: 'sso_session_detected',
    })
    mocks.hasSessionSecret.mockResolvedValue(false)
    mocks.getBobProfile.mockResolvedValue(null)
    mocks.getUsageStatus.mockResolvedValue({ available: false, message: 'Indisponible' })
    mocks.getBobalytics.mockResolvedValue({
      generatedAt: '',
      greetingName: 'Anis',
      scope: 'workspace',
      rangeDays: 30,
      source: 'local',
      seats: 1,
      today: {
        tasksToday: 3,
        streakDays: 2,
        momentum: 'Keep the rhythm.',
        weeklyRhythm: ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(day => ({ day, label: day, value: 0 })),
      },
      kpis: { avgDailyUsers: 1, seats: 1, adoptionPct: 100, bobcoins: 104.2 },
      patterns: {
        activityDays: 2,
        headline: '2 days with task activity',
        body: '',
        reachHeadline: 'Reach is ahead of habit.',
        reachBody: '',
        bobUsers: 1,
        bobUsersPct: 100,
        typicalDayActive: 1,
        typicalDayPct: 100,
        usageFrequency: { weekly: 1, light: 0, inactive: 0 },
        recordedSpend: 104.2,
        insight: 'Bob appears in 10% of committed lines this month',
        teams: [],
      },
    })
    mocks.getPermissionGrants.mockResolvedValue([])
    mocks.getNotificationAuthState.mockResolvedValue('granted')
    mocks.updateSettings.mockResolvedValue(undefined)
  })

  it('shows preference toggles immediately even before settings IPC resolves', async () => {
    const pending = deferred<AppSettings>()
    mocks.getSettings.mockReturnValue(pending.promise)

    renderSettings()

    expect(screen.getByRole('heading', { name: 'Réglages' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Général' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'IBM Bob Shell' })).toBeVisible()
    expect(screen.getByText('Lancer à l’ouverture de session')).toBeVisible()
    expect(screen.getByText('Icône de barre des menus')).toBeVisible()
    expect(screen.queryByText('Chargement des réglages…')).not.toBeInTheDocument()

    pending.resolve(settings)
    await waitFor(() => {
      expect(mocks.getSettings).toHaveBeenCalled()
    })
  })

  it('paints preference toggles immediately when settings are already cached', async () => {
    mocks.peekCachedSettings.mockReturnValue(settings)
    const pending = deferred<AppSettings>()
    mocks.getSettings.mockReturnValue(pending.promise)

    renderSettings()

    expect(screen.getByText('Lancer à l’ouverture de session')).toBeVisible()
    expect(screen.getByText('Icône de barre des menus')).toBeVisible()
    expect(screen.queryByText('Chargement…')).not.toBeInTheDocument()

    pending.resolve(settings)
    await waitFor(() => {
      expect(mocks.getSettings).toHaveBeenCalled()
    })
  })

  it('keeps the Bob tab usable while usage is still loading', async () => {
    const pendingUsage = deferred<{ available: boolean; message: string; usedAmount?: number; totalAmount?: number }>()
    mocks.getUsageStatus.mockReturnValue(pendingUsage.promise)

    renderSettings({ tab: 'bob' })

    expect(await screen.findByRole('heading', { name: 'IBM Bob Shell' })).toBeVisible()
    expect(screen.getByText('Installation')).toBeVisible()
    expect(screen.getByText('Clé IBM Bob')).toBeVisible()
    expect(screen.getByText('Consommation Bobcoins')).toBeVisible()
    expect(screen.queryByText('Indisponible')).not.toBeInTheDocument()

    pendingUsage.resolve({ available: true, message: '', usedAmount: 104.2, totalAmount: 500 })

    await waitFor(() => {
      expect(screen.getByText('104.2 / 500')).toBeVisible()
    })
  })

  it('lets the user switch tabs before settings finish loading', async () => {
    const pending = deferred<AppSettings>()
    mocks.getSettings.mockReturnValue(pending.promise)

    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Apparence et langue' }))
    expect(screen.getByRole('heading', { name: 'Apparence et langue' })).toBeVisible()
    expect(screen.getByText('Thème')).toBeVisible()

    pending.resolve(settings)
    await waitFor(() => {
      expect(mocks.getSettings).toHaveBeenCalled()
    })
  })

  it('aligne la recherche et la clé IBM Bob sur les libellés i18n', async () => {
    renderSettings({ tab: 'bob' })
    expect(screen.getByPlaceholderText('Rechercher dans les réglages…')).toBeVisible()
    expect(await screen.findByLabelText('Clé d’inférence IBM Bob')).toBeVisible()
  })

  it('propose auto, français, anglais et espagnol, avec repli anglais hors des 3 langues', async () => {
    renderSettings({ tab: 'appearance' })
    expect(await screen.findByRole('option', { name: 'Détecter automatiquement' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument()
    expect(screen.getByText('Automatique suit la langue du système', { exact: false })).toBeVisible()
    expect(screen.queryByText('Interface en français uniquement', { exact: false })).not.toBeInTheDocument()
  })
})
