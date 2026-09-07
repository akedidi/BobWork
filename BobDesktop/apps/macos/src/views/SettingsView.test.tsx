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
  requestMicrophonePermission: vi.fn(),
  requestVoiceDictationPermission: vi.fn(),
  getRemoteControlStatus: vi.fn(),
  getMcpServers: vi.fn(),
  testMcpServer: vi.fn(),
  getRuntimeStorage: vi.fn(),
  getMemories: vi.fn(),
  getProjects: vi.fn(),
  createMemory: vi.fn(),
  forgetMemory: vi.fn(),
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
    maxCost: 0,
    mcpEnabled: true,
    subagentsEnabled: true,
    webEnabled: true,
    notificationsEnabled: true,
    notifyTaskComplete: true,
    voiceOnDevice: true,
    retainAudioRecordings: false,
    taskRetentionDays: 30,
    telemetryEnabled: false,
    computerUseEnabled: false,
    chromeControlEnabled: false,
    sandboxMode: false,
    crossConversationContext: false,
    persistentMemoryEnabled: false,
    persistentMemoryEngine: 'local',
    remoteControlEnabled: false,
    autoCondenseEnabled: true,
    autoCondenseThreshold: 0.85,
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
  testMcpServer: mocks.testMcpServer,
  isNotificationAuthGranted: vi.fn().mockReturnValue(false),
  requestNotificationAuthorization: vi.fn(),
  requestMicrophonePermission: mocks.requestMicrophonePermission,
  requestVoiceDictationPermission: mocks.requestVoiceDictationPermission,
  getRemoteControlStatus: mocks.getRemoteControlStatus,
  getMcpServers: mocks.getMcpServers,
  restartRemoteControl: vi.fn(),
  requestAccessibilityPermission: vi.fn(),
  requestChromeAutomationPermission: vi.fn(),
  installBobShell: vi.fn(),
  openDataDir: vi.fn(),
  exportDiagnostics: vi.fn(),
  purgeAppCache: vi.fn(),
  getRuntimeStorage: mocks.getRuntimeStorage,
  getRuntimeInstallationPlan: vi.fn(),
  installExternalRuntime: vi.fn(),
  removeExternalRuntime: vi.fn(),
  cancelRuntimeProcess: vi.fn(),
  getMemories: mocks.getMemories,
  getProjects: mocks.getProjects,
  createMemory: mocks.createMemory,
  forgetMemory: mocks.forgetMemory,
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
  maxCost: 0,
  mcpEnabled: true,
  subagentsEnabled: true,
  webEnabled: true,
  notificationsEnabled: true,
  notifyTaskComplete: true,
  voiceOnDevice: true,
  retainAudioRecordings: false,
  taskRetentionDays: 30,
  telemetryEnabled: false,
  computerUseEnabled: false,
  chromeControlEnabled: false,
  sandboxMode: false,
  crossConversationContext: false,
  persistentMemoryEnabled: false,
  persistentMemoryEngine: 'local',
  remoteControlEnabled: false,
  autoCondenseEnabled: true,
  autoCondenseThreshold: 0.85,
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
    mocks.getRemoteControlStatus.mockResolvedValue({
      enabled: true,
      state: 'ready',
      publicUrl: 'https://bob.trycloudflare.com',
      connectionUrl: 'https://very-long-subdomain-for-overflow-regression.trycloudflare.com/#token=abcdefghijklmnopqrstuvwxyz0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    })
    mocks.getMcpServers.mockResolvedValue([])
    mocks.testMcpServer.mockResolvedValue({ id: 'mcp', name: 'mcp', ok: true, message: '', tools: [] })
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
    mocks.requestMicrophonePermission.mockResolvedValue('authorized')
    mocks.requestVoiceDictationPermission.mockResolvedValue({ microphone: 'authorized', speechRecognition: 'authorized' })
    mocks.updateSettings.mockResolvedValue(undefined)
    mocks.getRuntimeStorage.mockResolvedValue({
      coreBytes: 0,
      sharedBytes: 0,
      externalBytes: 0,
      privateBytes: 0,
      artifactBytes: 0,
      cacheBytes: 0,
      activeProcesses: [],
      runtimes: [],
    })
    mocks.getMemories.mockResolvedValue([])
    mocks.getProjects.mockResolvedValue([])
    mocks.createMemory.mockResolvedValue({})
    mocks.forgetMemory.mockResolvedValue(undefined)
  })

  it('manages native persistent memory from its own settings section', async () => {
    mocks.getProjects.mockResolvedValue([{ id: 'p1', name: 'Projet Alpha' }])
    mocks.getMemories.mockResolvedValue([{
      id: 'm1', scope: 'user', content: 'Répondre en français', createdAt: '2026-09-05', updatedAt: '2026-09-05',
    }])
    renderSettings({ tab: 'memory' })

    expect(await screen.findByRole('heading', { name: 'Mémoire persistante', level: 1 })).toBeVisible()
    expect(screen.getByText('Répondre en français')).toBeVisible()
    expect(screen.getByText('Local · intégré')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Oublier' }))
    await waitFor(() => expect(mocks.forgetMemory).toHaveBeenCalledWith('m1'))
    expect(screen.queryByText('Répondre en français')).not.toBeInTheDocument()
  })

  it('opens runtimes in a dedicated settings section', async () => {
    renderSettings({ tab: 'runtimes' })

    expect(await screen.findByRole('heading', { name: 'Runtimes', level: 1 })).toBeVisible()
    expect(screen.getByText('Runtimes externes à Bob Work')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Runtimes' })).toHaveClass('active')
    expect(mocks.getRuntimeStorage).toHaveBeenCalledTimes(1)
  })

  it('shows the copyable Cloudflare link when remote control is enabled', async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, remoteControlEnabled: true })
    renderSettings({ tab: 'remote' })

    expect(await screen.findByText('https://very-long-subdomain-for-overflow-regression.trycloudflare.com/#token=abcdefghijklmnopqrstuvwxyz0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBeVisible()
    expect(screen.getByLabelText('Lien sécurisé Bob Mobile')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Copier le lien' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Arrêter' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recréer le lien' })).not.toBeInTheDocument()
    expect(screen.queryByText('API accessible depuis Internet')).not.toBeInTheDocument()
  })

  it('does not expose the link before Cloudflare has published a URL', async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, remoteControlEnabled: true })
    mocks.getRemoteControlStatus.mockResolvedValue({
      enabled: true,
      state: 'verifying',
      publicUrl: 'https://bob.trycloudflare.com',
      connectionUrl: null,
    })
    renderSettings({ tab: 'remote' })

    expect(await screen.findByRole('status')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Arrêter' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copier le lien' })).not.toBeInTheDocument()
    expect(screen.queryByText('Vérification de l’API via Cloudflare…')).not.toBeInTheDocument()
    expect(screen.queryByText(/15\s*s/)).not.toBeInTheDocument()
  })

  it('keeps the link hidden while the public API is still being verified', async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, remoteControlEnabled: true })
    mocks.getRemoteControlStatus.mockResolvedValue({
      enabled: true,
      state: 'verifying',
      publicUrl: 'https://bob.trycloudflare.com',
      connectionUrl: 'https://bob.trycloudflare.com/#token=pending-verification-token',
    })
    renderSettings({ tab: 'remote' })

    expect(await screen.findByRole('status')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Copier le lien' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrêter' })).not.toBeInTheDocument()
  })

  it('does not call the remote control disabled while the toggle is on', async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, remoteControlEnabled: true })
    mocks.getRemoteControlStatus.mockResolvedValue({
      enabled: false,
      state: 'disabled',
      publicUrl: null,
      connectionUrl: null,
    })
    renderSettings({ tab: 'remote' })

    expect(await screen.findByRole('status')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Arrêter' })).not.toBeInTheDocument()
    expect(screen.queryByText('Télécommande désactivée')).not.toBeInTheDocument()
    expect(screen.queryByText(/Création du lien sécurisé/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recréer le lien' })).not.toBeInTheDocument()
  })

  it('shows a loader again after disabling then enabling remote control', async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, remoteControlEnabled: true })
    mocks.updateSettings.mockImplementation(async (next: AppSettings) => {
      mocks.getSettings.mockResolvedValue(next)
    })
    renderSettings({ tab: 'remote' })
    expect(await screen.findByRole('button', { name: 'Copier le lien' })).toBeVisible()

    fireEvent.click(screen.getByRole('checkbox', { name: /Activer la télécommande/ }))
    expect(screen.queryByRole('button', { name: 'Copier le lien' })).not.toBeInTheDocument()

    mocks.getRemoteControlStatus.mockResolvedValue({
      enabled: false,
      state: 'disabled',
      publicUrl: null,
      connectionUrl: null,
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Activer la télécommande/ }))

    expect(await screen.findByRole('status')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Copier le lien' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrêter' })).not.toBeInTheDocument()
  })

  it('exposes only explicitly selected local MCP tools', async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, mcpGatewayEnabled: true, mcpGatewayTools: [] })
    mocks.getMcpServers.mockResolvedValue([{
      name: 'local-files', transport: 'stdio', commandOrUrl: '/usr/bin/node', args: [], enabled: true, status: 'configured', raw: {},
    }])
    mocks.testMcpServer.mockResolvedValue({ id: 'local-files', name: 'local-files', ok: true, message: '', tools: ['read_file', 'write_file'] })
    renderSettings({ tab: 'remote' })

    const readTool = await screen.findByRole('checkbox', { name: 'read_file' })
    expect(readTool).not.toBeChecked()
    fireEvent.click(readTool)

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      mcpGatewayEnabled: true,
      mcpGatewayTools: ['local-files::read_file'],
    })))
    expect(screen.getByText('https://bob.trycloudflare.com/mcp')).toBeVisible()
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

  it('demande explicitement les autorisations vocales depuis les permissions macOS', async () => {
    renderSettings({ tab: 'permissions' })

    const request = await screen.findByRole('button', { name: 'Autoriser microphone et dictée' })
    fireEvent.click(request)

    await waitFor(() => expect(mocks.requestVoiceDictationPermission).toHaveBeenCalledOnce())
    expect(await screen.findByText('Le Microphone et la Reconnaissance vocale sont autorisés pour Bob Work.')).toBeVisible()
  })

  it('masque le détail technique des autorisations persistantes', async () => {
    mocks.getPermissionGrants.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({
      id: `grant-${index}`,
      actionType: 'bob.run.full_disk',
      resource: `/private/internal/${index}`,
      scope: 'always',
      decision: 'allow',
      createdAt: '2026-09-04T10:00:00Z',
    })))
    renderSettings({ tab: 'permissions' })

    expect(await screen.findByRole('button', { name: 'Réinitialiser les choix d’autorisation' })).toBeVisible()
    expect(screen.queryByText('Autorisations mémorisées (5)')).not.toBeInTheDocument()
    expect(screen.queryByText('bob.run.full_disk')).not.toBeInTheDocument()
    expect(screen.queryByText('/private/internal/0')).not.toBeInTheDocument()
  })

  it('permet de choisir et persiste le mode sandbox ou l’accès direct au disque', async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, sandboxMode: false })
    renderSettings({ tab: 'permissions' })

    const sandbox = await screen.findByRole('radio', { name: /^Sandbox/ })
    const directDisk = screen.getByRole('radio', { name: /^Accès direct au disque/ })
    expect(directDisk).toBeChecked()
    expect(sandbox).not.toBeChecked()

    fireEvent.click(sandbox)
    expect(sandbox).toBeChecked()
    expect(screen.getAllByText(/Un refus ne nécessite pas de désactiver la protection/).length).toBeGreaterThan(0)
    expect(directDisk).not.toBeChecked()
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ sandboxMode: true })))

    mocks.updateSettings.mockClear()
    fireEvent.click(directDisk)
    expect(directDisk).toBeChecked()
    expect(sandbox).not.toBeChecked()
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ sandboxMode: false })))
  })
})
