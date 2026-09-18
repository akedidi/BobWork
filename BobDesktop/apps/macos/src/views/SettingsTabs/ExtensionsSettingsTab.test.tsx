import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppSettings } from '@bob-work/shared-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDialogProvider } from '../../components/AppDialog'
import { translate } from '../../i18n/translate'
import PermissionsSettingsTab from './PermissionsSettingsTab'

const mocks = vi.hoisted(() => ({
  openMacosPrivacyPane: vi.fn(),
  requestAccessibilityPermission: vi.fn(),
  requestChromeAutomationPermission: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  openMacosPrivacyPane: mocks.openMacosPrivacyPane,
  requestChromeAutomationPermission: mocks.requestChromeAutomationPermission,
  requestAccessibilityPermission: mocks.requestAccessibilityPermission,
  getNotificationAuthState: vi.fn().mockResolvedValue('authorized'),
  getMicrophoneAuthorizationState: vi.fn().mockResolvedValue('authorized'),
  getSpeechRecognitionAuthorizationState: vi.fn().mockResolvedValue('authorized'),
  isNotificationAuthGranted: (state: string) => state === 'authorized',
  requestNotificationAuthorization: vi.fn(),
  requestVoiceDictationPermission: vi.fn(),
  requestMicrophonePermission: vi.fn(),
  importConversations: vi.fn(),
  exportConversations: vi.fn(),
  openDataDir: vi.fn(),
  exportDiagnostics: vi.fn(),
  purgeAppCache: vi.fn(),
  createDatabaseBackup: vi.fn(),
  restoreDatabaseBackup: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))

const t = (key: string, params?: Record<string, string | number>) => translate('fr', key, params)

const settings = {
  chromeControlEnabled: true,
  computerUseEnabled: false,
  mcpEnabled: true,
  subagentsEnabled: true,
  webEnabled: true,
  sandboxMode: false,
} as AppSettings

const longDeniedMessage =
  'Autorisez Bob Work-test → Google Chrome dans Réglages Système → Confidentialité et sécurité → Automatisation.'

function renderChromeTab(overrides: Record<string, unknown> = {}) {
  const setStatus = vi.fn()
  const showTransientStatus = vi.fn()
  const refreshChromeStatus = vi.fn().mockResolvedValue(undefined)
  render(
    <AppDialogProvider>
      <PermissionsSettingsTab
        t={t}
        settings={settings}
        settingsError={null}
        change={vi.fn()}
        chromeStatus={{
          chromeInstalled: true,
          mcpConfigured: true,
          mcpEnabled: true,
          automation: 'denied',
          automationMessage: longDeniedMessage,
          appName: 'Bob Work-test',
        }}
        chromeLoading={false}
        chromeError={null}
        chromeTools={null}
        refreshChromeStatus={refreshChromeStatus}
        computerUseStatus={null}
        computerUseLoading={false}
        computerUseError={null}
        computerUseTools={null}
        refreshComputerUseStatus={vi.fn()}
        orcaCliStatus={null}
        orcaCliLoading={false}
        orcaCliError={null}
        refreshOrcaCliStatus={vi.fn()}
        mcpEnabled
        subagentsEnabled
        setStatus={setStatus}
        showTransientStatus={showTransientStatus}
        {...overrides}
      />
    </AppDialogProvider>,
  )
  return { setStatus, showTransientStatus, refreshChromeStatus }
}

function renderComputerUseTab(overrides: Record<string, unknown> = {}) {
  const setStatus = vi.fn()
  const showTransientStatus = vi.fn()
  const refreshComputerUseStatus = vi.fn().mockResolvedValue(undefined)
  render(
    <AppDialogProvider>
      <PermissionsSettingsTab
        t={t}
        settings={{ ...settings, chromeControlEnabled: false, computerUseEnabled: true }}
        settingsError={null}
        change={vi.fn()}
        chromeStatus={null}
        chromeLoading={false}
        chromeError={null}
        chromeTools={null}
        refreshChromeStatus={vi.fn()}
        computerUseStatus={{
          mcpConfigured: true,
          mcpEnabled: true,
          accessibility: 'denied',
          accessibilityMessage: 'Autorisez Bob Work dans Accessibilité.',
        }}
        computerUseLoading={false}
        computerUseError={null}
        computerUseTools={null}
        refreshComputerUseStatus={refreshComputerUseStatus}
        orcaCliStatus={null}
        orcaCliLoading={false}
        orcaCliError={null}
        refreshOrcaCliStatus={vi.fn()}
        mcpEnabled
        subagentsEnabled
        setStatus={setStatus}
        showTransientStatus={showTransientStatus}
        appName="Bob Work"
        {...overrides}
      />
    </AppDialogProvider>,
  )
  return { setStatus, showTransientStatus, refreshComputerUseStatus }
}

describe('PermissionsSettingsTab merged capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openMacosPrivacyPane.mockResolvedValue(undefined)
  })

  it('shows section navigation and capability toggles', () => {
    renderChromeTab()
    expect(screen.getByRole('navigation', { name: t('settings.sectionNavLabel') })).toBeVisible()
    expect(screen.getByRole('heading', { name: t('settings.sectionCapabilities'), level: 2 })).toBeVisible()
    expect(screen.getByText(t('settings.chromeControl'))).toBeVisible()
  })

  it('shows request and System Settings actions when Automation is denied', () => {
    renderChromeTab()

    expect(screen.getByRole('button', { name: t('settings.requestAutomation') })).toBeVisible()
    expect(screen.getByRole('button', { name: t('settings.openAutomationForChrome') })).toBeVisible()
    expect(screen.getAllByRole('button', { name: t('settings.recheck') }).length).toBeGreaterThan(0)
  })

  it('requests Chrome automation, refreshes status, and opens System Settings when denied', async () => {
    mocks.requestChromeAutomationPermission.mockRejectedValue(new Error('denied'))
    const { refreshChromeStatus, showTransientStatus } = renderChromeTab()

    fireEvent.click(screen.getByRole('button', { name: t('settings.requestAutomation') }))

    await waitFor(() => {
      expect(mocks.requestChromeAutomationPermission).toHaveBeenCalledTimes(1)
      expect(refreshChromeStatus).toHaveBeenCalledTimes(1)
      expect(mocks.openMacosPrivacyPane).toHaveBeenCalledWith('automation')
    })
    expect(showTransientStatus).toHaveBeenCalledWith(t('settings.automationDenied', { appName: 'Bob Work-test' }))
  })

  it('rechecks Chrome automation without requesting it', async () => {
    const { refreshChromeStatus, showTransientStatus } = renderChromeTab()

    fireEvent.click(screen.getAllByRole('button', { name: t('settings.recheck') })[0])

    await waitFor(() => {
      expect(refreshChromeStatus).toHaveBeenCalled()
    })
    expect(showTransientStatus).not.toHaveBeenCalled()
    expect(mocks.requestChromeAutomationPermission).not.toHaveBeenCalled()
  })
})

describe('PermissionsSettingsTab macOS Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openMacosPrivacyPane.mockResolvedValue(undefined)
  })

  it('shows request and System Settings actions when Accessibility is denied', () => {
    renderComputerUseTab()

    expect(screen.getByRole('button', { name: t('settings.requestAccessibility') })).toBeVisible()
    expect(screen.getByRole('button', { name: t('settings.openAccessibilityForComputerUse') })).toBeVisible()
  })

  it('requests Accessibility, refreshes status, and opens System Settings when still denied', async () => {
    mocks.requestAccessibilityPermission.mockResolvedValue(false)
    const { refreshComputerUseStatus, showTransientStatus } = renderComputerUseTab()

    fireEvent.click(screen.getByRole('button', { name: t('settings.requestAccessibility') }))

    await waitFor(() => {
      expect(mocks.requestAccessibilityPermission).toHaveBeenCalledTimes(1)
      expect(refreshComputerUseStatus).toHaveBeenCalledTimes(1)
      expect(mocks.openMacosPrivacyPane).toHaveBeenCalledWith('accessibility')
    })
    expect(showTransientStatus).toHaveBeenCalledWith(t('settings.accessibilityPrompted', { appName: 'Bob Work' }))
  })
})
