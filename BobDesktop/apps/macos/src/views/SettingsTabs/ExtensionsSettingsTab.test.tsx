import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppSettings } from '@bob-work/shared-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDialogProvider } from '../../components/AppDialog'
import { translate } from '../../i18n/translate'
import ExtensionsSettingsTab from './ExtensionsSettingsTab'

const mocks = vi.hoisted(() => ({
  requestChromeAutomationPermission: vi.fn(),
  openMacosPrivacyPane: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  requestChromeAutomationPermission: mocks.requestChromeAutomationPermission,
  openMacosPrivacyPane: mocks.openMacosPrivacyPane,
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
  'Autorisez Bob Work-test → Google Chrome dans Réglages Système → Confidentialité et sécurité → Automatisation. Si Bob Work-test n’apparaît pas dans la liste, cliquez d’abord sur « Demander Automatisation Chrome » dans Réglages → Accès et contrôle (macOS n’affiche une app qu’après son premier ordre Apple Event). Bob Work et Bob Work-test sont des applications distinctes : une case cochée pour l’une ne couvre pas l’autre. C’est « Bob Work-test » qu’il faut autoriser.'

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

  it('keeps Chrome automation actions and hides the sticky denied tutorial', () => {
    renderChromeTab()

    expect(screen.getByRole('button', { name: 'Demander Automatisation Chrome' })).toBeVisible()
    expect(screen.getByRole('button', { name: t('settings.recheck') })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ouvrir Automatisation (pour Chrome)' })).toBeVisible()
    expect(screen.queryByText(/macOS n’affiche une app qu’après/)).not.toBeInTheDocument()
    expect(screen.getByText(/activez Bob Work-test → Google Chrome/)).toBeVisible()
  })

  it('asks for permission from this app then opens Automation without a sticky overlay', async () => {
    mocks.requestChromeAutomationPermission.mockRejectedValue(new Error(longDeniedMessage))
    const { setStatus, showTransientStatus } = renderChromeTab()

    fireEvent.click(screen.getByRole('button', { name: 'Demander Automatisation Chrome' }))

    await waitFor(() => {
      expect(showTransientStatus).toHaveBeenCalledWith(
        t('settings.automationDenied', { appName: 'Bob Work-test' }),
      )
    })
    expect(setStatus).not.toHaveBeenCalled()
    expect(mocks.openMacosPrivacyPane).toHaveBeenCalledWith('automation')
  })
})
