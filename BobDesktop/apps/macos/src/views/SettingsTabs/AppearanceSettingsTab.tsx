

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
import type { AppSettings } from '@bob-work/shared-types'
import { Heading, Card, SectionLoader, SettingsFields, ToggleRow, SelectRow, NumberRow, StatusRow, authenticationLabel, chromeAutomationLabel, computerUseAccessibilityLabel } from './SettingsShared'

const BobalyticsPanel = lazy(() => import('../BobalyticsPanel'))
  

export default function AppearanceSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')

  return (
    <>
      <Heading title={t('settings.appearanceHeading')} description={t('settings.appearanceDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <SelectRow title={t('settings.theme')} value={s.theme} onChange={value => change('theme', value as AppSettings['theme'])}><option value="system">{t('settings.themeSystem')}</option><option value="light">{t('settings.themeLight')}</option><option value="dark">{t('settings.themeDark')}</option></SelectRow>
                <SelectRow title={t('settings.language')} value={s.language} onChange={value => change('language', value)}>
                  <option value="auto">{t('settings.languageAuto')}</option>
                  <option value="fr">{t('settings.languageFr')}</option>
                  <option value="en">{t('settings.languageEn')}</option>
                  <option value="es">{t('settings.languageEs')}</option>
                </SelectRow>
                <p className="settings-note">{t('settings.languageHint')}</p>
                <NumberRow title={t('settings.fontSize')} value={s.fontSize} min={12} onChange={value => change('fontSize', value)} />
                <ToggleRow title={t('settings.reducedMotion')} value={s.reducedMotion} onChange={value => change('reducedMotion', value)} />
                <ToggleRow title={t('settings.voiceOnDevice')} description={t('settings.voiceOnDeviceDesc')} value={s.voiceOnDevice} onChange={value => change('voiceOnDevice', value)} />
              </>}
            </SettingsFields>
          </Card>
    </>
  )
}
