

import { Suspense, lazy } from 'react'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { open as chooseFile, save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { useNavigate } from 'react-router-dom'
import { importConversations, exportConversations, openDataDir, exportDiagnostics, purgeAppCache, createDatabaseBackup, restoreDatabaseBackup, requestNotificationAuthorization, openMacosPrivacyPane, requestVoiceDictationPermission, requestMicrophonePermission, requestChromeAutomationPermission, requestAccessibilityPermission } from '../../lib/ipc'
import { useT } from '../../i18n'
import { UsageMeter } from '../../components/UsageMeter/UsageMeter'
import { LoadErrorBanner } from '../../components/LoadErrorBanner'
import ModesView from '../ModesView'
import { useAppDialog } from '../../components/AppDialog'
import { errorMessage } from '../../lib/errorMessage'
import { Heading, Card, SectionLoader, SettingsFields, ToggleRow, SelectRow, NumberRow, StatusRow, authenticationLabel, chromeAutomationLabel, computerUseAccessibilityLabel } from './SettingsShared'

const BobalyticsPanel = lazy(() => import('../BobalyticsPanel'))
  

export default function InstructionsSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')

  return (
    <>
      <Heading title="Instructions personnalisées" description="Ajoutées localement au début de chaque demande, avant les instructions propres au projet." />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => (
                <textarea className="settings-textarea" rows={12} value={s.globalInstructions} onChange={event => change('globalInstructions', event.target.value)} placeholder="Ex. Répondre en français, citer les sources et demander confirmation avant un envoi externe…" />
              )}
            </SettingsFields>
          </Card>
          <Heading title={t('settings.contextHeading')} description={t('settings.contextDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow
                  title={t('settings.crossConversationContext')}
                  description={t('settings.crossConversationContextDesc')}
                  value={s.crossConversationContext}
                  onChange={value => change('crossConversationContext', value)}
                />
                <p className="settings-note">{t('settings.crossConversationContextHint')}</p>
              </>}
            </SettingsFields>
          </Card>
    </>
  )
}