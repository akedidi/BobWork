

import { Suspense, lazy, useState } from 'react'
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
  

export default function GeneralSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')
  const [locationBusy, setLocationBusy] = useState(false)

  const captureLocation = () => {
    if (!navigator.geolocation) {
      showTransientStatus(t('settings.locationUnavailable'))
      return
    }
    setLocationBusy(true)
    navigator.geolocation.getCurrentPosition(position => {
      change('currentLatitude', position.coords.latitude)
      change('currentLongitude', position.coords.longitude)
      change('currentLocationUpdatedAt', new Date(position.timestamp).toISOString())
      change('locationEnabled', true)
      setLocationBusy(false)
      showTransientStatus(t('settings.locationUpdated'))
    }, () => {
      change('locationEnabled', false)
      setLocationBusy(false)
      showTransientStatus(t('settings.locationDenied'))
    }, { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 })
  }

  const setLocationEnabled = (enabled: boolean) => {
    if (enabled) captureLocation()
    else {
      change('locationEnabled', false)
      change('currentLatitude', undefined)
      change('currentLongitude', undefined)
      change('currentLocationUpdatedAt', undefined)
    }
  }

  return (
    <>
      <Heading title={t('settings.generalHeading')} description={t('settings.generalDesc')} />
          <Card>
            <SettingsFields settings={settings} error={null} loadingLabel={loadingLabel}>
              {s => <>
                <SelectRow title={t('settings.defaultMode')} description={t('settings.defaultModeDesc')} value={s.defaultMode} onChange={value => change('defaultMode', value)}>
                  <option value="agent">Agent</option><option value="plan">Plan</option><option value="ask">Ask</option>
                  {profile?.modes.filter((mode: any) => !['agent', 'plan', 'ask'].includes(mode.slug)).map((mode: any) => <option key={mode.slug} value={mode.slug}>{mode.name}</option>)}
                </SelectRow>
                <ToggleRow title={t('settings.launchAtLogin')} description={t('settings.launchAtLoginDesc')} value={s.launchAtLogin} onChange={value => change('launchAtLogin', value)} />
                <ToggleRow title={t('settings.menuBarIcon')} description={t('settings.menuBarIconDesc')} value={s.menuBarEnabled} onChange={value => change('menuBarEnabled', value)} />
              </>}
            </SettingsFields>
          </Card>
          <Heading title={t('settings.locationHeading')} description={t('settings.locationDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow
                  title={t('settings.locationEnabled')}
                  description={t('settings.locationEnabledDesc')}
                  value={Boolean(s.locationEnabled)}
                  onChange={setLocationEnabled}
                  disabled={locationBusy}
                />
                {s.locationEnabled && Number.isFinite(s.currentLatitude) && Number.isFinite(s.currentLongitude) ? <>
                  <StatusRow title={t('settings.locationStatus')} value={`${s.currentLatitude!.toFixed(4)}, ${s.currentLongitude!.toFixed(4)}`} ok />
                  <div className="settings-actions"><button className="secondary-btn" disabled={locationBusy} onClick={captureLocation}>{locationBusy ? loadingLabel : t('settings.locationRefresh')}</button></div>
                </> : null}
                <p className="settings-note">{t('settings.locationPrivacy')}</p>
              </>}
            </SettingsFields>
          </Card>
          <Heading title={t('settings.updatesHeading')} description={t('settings.updatesDesc')} />
          <Card>
            {updateInfo && (
              <StatusRow
                title={t('settings.currentVersion')}
                value={updateInfo.currentVersion}
                ok={!updateInfo.available}
              />
            )}
            {updateInfo?.available && (
              <>
                <StatusRow title={t('settings.availableVersion')} value={updateInfo.version ?? '—'} ok />
                {updateInfo.notes && <p className="settings-note">{updateInfo.notes}</p>}
              </>
            )}
            <div className="settings-actions">
              <button className="secondary-btn" disabled={updateBusy} onClick={() => void checkUpdate()}>
                {updateBusy ? t('common.loading') : t('settings.checkUpdates')}
              </button>
              {updateInfo?.available && (
                <button className="btn-primary" disabled={updateBusy} onClick={() => void installUpdate()}>
                  {t('settings.installAndRestart')}
                </button>
              )}
            </div>
          </Card>
          <Heading title={t('settings.notificationsHeading')} description={t('settings.notificationsDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow
                  title={t('settings.notificationsEnabled')}
                  description={t('settings.notificationsEnabledDesc')}
                  value={s.notificationsEnabled}
                  onChange={value => change('notificationsEnabled', value)}
                />
                <ToggleRow
                  title={t('settings.notifyTaskComplete')}
                  description={t('settings.notifyTaskCompleteDesc')}
                  value={s.notifyTaskComplete}
                  onChange={value => change('notifyTaskComplete', value)}
                  disabled={!s.notificationsEnabled}
                />
                <p className="settings-note">{t('settings.notificationsHint')}</p>
                {notificationBundleHint && <p className="settings-note" role="status">{notificationBundleHint}</p>}
              </>}
            </SettingsFields>
          </Card>
    </>
  )
}
