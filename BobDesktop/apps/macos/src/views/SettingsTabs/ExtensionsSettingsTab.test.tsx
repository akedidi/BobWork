import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppSettings } from '@bob-work/shared-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDialogProvider } from '../../components/AppDialog'
import { translate } from '../../i18n/translate'
import ExtensionsSettingsTab from './ExtensionsSettingsTab'

const mocks = vi.hoisted(() => ({
  openMacosPrivacyPane: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  openMacosPrivacyPane: mocks.openMacosPrivacyPane,
  requestChromeAutomationPermission: vi.fn(),
  requestAccessibilityPermission: vi.fn(),
  importConversations: vi.fn(),
  exportConversations: vi.fn(),
  openDataDir: vi.fn(),
  exportDiagnostics: vi.fn(),
  purgeAppCache: vi.fn(),
  createDatabaseBackup: vi.fn(),
  restoreDatabaseBackup: vi.fn(),
  requestNotificationAuthorization: vi.fn(),
  requestVoiceDictationPermission: vi.fn(),
  requestMicrophonePermission: vi.fn(),
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
  'Autorisez Bob Work-test → Google Chrome dans Réglages Système → Confidentialité et sécurité → Automatisation. Si Bob Work-test n’apparaît pas dans la liste, cliquez d’abord sur « Demander Automatisation Chrome » dans Réglages → Permissions (macOS n’affiche une app qu’après son premier ordre Apple Event). Bob Work et Bob Work-test sont des applications distinctes : une case cochée pour l’une ne couvre pas l’autre. C’est « Bob Work-test » qu’il faut autoriser.'

function renderChromeTab(overrides: Record<string, unknown> = {}) {
  const setStatus = vi.fn()
  const showTransientStatus = vi.fn()
  const refreshChromeStatus = vi.fn().mockResolvedValue(undefined)
  render(
    <AppDialogProvider>
      <ExtensionsSettingsTab
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
        setStatus={setStatus}
        showTransientStatus={showTransientStatus}
        {...overrides}
      />
    </AppDialogProvider>,
  )
  return { setStatus, showTransientStatus, refreshChromeStatus }
}

describe('ExtensionsSettingsTab Chrome automation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openMacosPrivacyPane.mockResolvedValue(undefined)
  })

  it('shows automation status and points requests to Permissions settings', () => {
    renderChromeTab()

    expect(screen.queryByRole('button', { name: 'Demander Automatisation Chrome' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ouvrir Automatisation (pour Chrome)' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.recheck') })).toBeVisible()
    expect(screen.getByText(t('settings.managePermissionsInSettings'))).toBeVisible()
    expect(screen.queryByText(/macOS n’affiche une app qu’après/)).not.toBeInTheDocument()
  })

  it('rechecks Chrome automation from Access & control without requesting it there', async () => {
    const { refreshChromeStatus, showTransientStatus } = renderChromeTab()

    fireEvent.click(screen.getByRole('button', { name: t('settings.recheck') }))

    await waitFor(() => {
      expect(refreshChromeStatus).toHaveBeenCalled()
    })
    expect(showTransientStatus).not.toHaveBeenCalled()
  })
})
