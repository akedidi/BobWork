

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
  

export default function ModesSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')

  return (
    <>
      <Heading title={t('modes.title')} description={t('settings.modesDesc')} />
          <ModesView embedded />
    </>
  )
}