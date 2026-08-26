

import { Suspense, lazy } from 'react'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { open as chooseFile, save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { useNavigate } from 'react-router-dom'
import type { PermissionGrant } from '@bob-work/shared-types'
import { getNotificationAuthState, isNotificationAuthGranted, revokePermissionGrant, getPermissionGrants, importConversations, exportConversations, openDataDir, exportDiagnostics, purgeAppCache, createDatabaseBackup, restoreDatabaseBackup, requestNotificationAuthorization, openMacosPrivacyPane, requestVoiceDictationPermission, requestMicrophonePermission, requestChromeAutomationPermission, requestAccessibilityPermission } from '../../lib/ipc'
import { useT } from '../../i18n'
import { UsageMeter } from '../../components/UsageMeter/UsageMeter'
import { LoadErrorBanner } from '../../components/LoadErrorBanner'
import ModesView from '../ModesView'
import { useAppDialog } from '../../components/AppDialog'
import { errorMessage } from '../../lib/errorMessage'
import { Heading, Card, SectionLoader, SettingsFields, ToggleRow, SelectRow, NumberRow, StatusRow, authenticationLabel, chromeAutomationLabel, computerUseAccessibilityLabel } from './SettingsShared'

const BobalyticsPanel = lazy(() => import('../BobalyticsPanel'))
  

export default function PermissionsSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')

  return (
    <>
      <Heading title={t('settings.permissionsHeading')} description={t('settings.permissionsDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow
                  title={t('settings.sandboxMode')}
                  description={t('settings.sandboxModeDesc')}
                  value={s.sandboxMode}
                  onChange={value => change('sandboxMode', value)}
                />
                <SelectRow
                  title={t('settings.permissionPolicy')}
                  description={t('settings.permissionPolicyDesc')}
                  value={s.permissionPolicy}
                  onChange={value => change('permissionPolicy', value)}
                >
                  <option value="always_ask">{t('settings.policyAlwaysAsk')}</option>
                  <option value="ask_for_modifications">{t('settings.policyAskModifications')}</option>
                  <option value="ask_for_important">{t('settings.policyAskImportant')}</option>
                  <option value="never_ask">{t('settings.policyNeverAsk')}</option>
                </SelectRow>
                <p className="settings-note">{t('settings.permissionPolicyHint')}</p>
                <p className="settings-warning">{t('settings.scheduledPolicyHint')}</p>
              </>}
            </SettingsFields>
          </Card>
          <Card title={t('settings.macosPermissionsHeading')}>
            <p className="settings-note">{t('settings.macosPermissionsDesc')}</p>
            <div className="settings-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      const current = await getNotificationAuthState()
                      if (current === 'unavailable') {
                        setStatus(t('settings.notificationsUnavailable'))
                        return
                      }
                      if (isNotificationAuthGranted(current)) {
                        await requestNotificationAuthorization()
                        showTransientStatus(t('settings.notificationsTestSent'))
                        return
                      }
                      const state = await requestNotificationAuthorization()
                      if (isNotificationAuthGranted(state)) {
                        showTransientStatus(t('settings.notificationsGranted'))
                        return
                      }
                      showTransientStatus(t('settings.notificationsDenied'))
                      if (state === 'denied') {
                        void openMacosPrivacyPane('notifications').catch(() => undefined)
                      }
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  })()
                }}
              >
                {t('settings.requestNotifications')}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  void openMacosPrivacyPane('notifications').catch(error => setStatus(errorMessage(error)))
                }}
              >
                {t('settings.openNotificationsSettings')}
              </button>
            </div>
          </Card>
          <Card title={t('settings.voicePermissionsHeading')}>
            <p className="settings-note">{t('settings.voicePermissionsDesc')}</p>
            <div className="settings-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      const permissions = await requestVoiceDictationPermission()
                      if (permissions.microphone === 'authorized' && permissions.speechRecognition === 'authorized') {
                        showTransientStatus(t('settings.voicePermissionsGranted'))
                        return
                      }
                      showTransientStatus(t('settings.voicePermissionsDenied'))
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  })()
                }}
              >
                {t('settings.requestVoicePermissions')}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      const state = await requestMicrophonePermission()
                      if (state === 'authorized') {
                        showTransientStatus(t('settings.microphoneGranted'))
                        return
                      }
                      showTransientStatus(t('settings.microphoneDenied'))
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  })()
                }}
              >
                {t('settings.requestMicrophone')}
              </button>
              <button type="button" className="secondary-btn" onClick={() => void openMacosPrivacyPane('microphone').catch(error => setStatus(errorMessage(error)))}>
                {t('settings.openMicrophoneSettings')}
              </button>
              <button type="button" className="secondary-btn" onClick={() => void openMacosPrivacyPane('speech').catch(error => setStatus(errorMessage(error)))}>
                {t('settings.openSpeechSettings')}
              </button>
            </div>
          </Card>
          <Card title={grantsLoading ? 'Autorisations mémorisées' : `Autorisations mémorisées (${grants.length})`}>
            {grantsLoading ? (
              <SectionLoader label={loadingLabel} />
            ) : grantsError ? (
              <p className="settings-note" role="alert">{errorMessage(grantsError, t('settings.grantsLoadFailed'))}</p>
            ) : grants.length === 0 ? (
              <p className="settings-note">Aucune autorisation persistante. Choisissez « Pour cette tâche » ou « Toujours » dans une carte d’approbation pour en créer.</p>
            ) : grants.map((grant: PermissionGrant) => (
              <div className="grant-row" key={grant.id}>
                <div><strong>{grant.actionType}</strong><small>{grant.scope} · {grant.resource}</small></div>
                <button className="danger-link" onClick={() => revokeGrant(grant.id)}>Révoquer</button>
              </div>
            ))}
          </Card>
          <p className="settings-note">
            {t('settings.scheduledPolicyHint')}
          </p>
    </>
  )
}