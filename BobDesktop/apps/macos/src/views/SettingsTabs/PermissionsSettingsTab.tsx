import { useEffect, useMemo } from 'react'
import {
  getNotificationAuthState,
  isNotificationAuthGranted,
  requestNotificationAuthorization,
  openMacosPrivacyPane,
  requestVoiceDictationPermission,
  requestMicrophonePermission,
} from '../../lib/ipc'
import { errorMessage } from '../../lib/errorMessage'
import { Heading, Card, SettingsFields } from './SettingsShared'
import TaskPermissionsPanel, { AGENT_MODE_FOR_PERMISSIONS } from '../../components/Composer/TaskPermissionsPanel'
import { forbiddenTaskPermissionIds, getVisibleTaskPermissions } from '../../lib/taskPermissions'
import { useTaskPermissionStore } from '../../stores/taskPermissionStore'

export default function PermissionsSettingsTab(props: any) {
  const { t, settings, change, settingsError, appName, setStatus, showTransientStatus, mcpEnabled, subagentsEnabled } = props
  const loadingLabel = t('common.loading')
  const app = appName || 'Bob Work'
  const applyVisiblePermissions = useTaskPermissionStore(state => state.applyVisiblePermissions)
  const visiblePermissionIds = useMemo(
    () => getVisibleTaskPermissions(
      AGENT_MODE_FOR_PERMISSIONS,
      forbiddenTaskPermissionIds({ mcpEnabled, subagentsEnabled }),
    ).map(permission => permission.id),
    [mcpEnabled, subagentsEnabled],
  )

  useEffect(() => {
    applyVisiblePermissions(visiblePermissionIds)
  }, [applyVisiblePermissions, visiblePermissionIds])

  return (
    <>
      <Heading title={t('settings.permissionsHeading')} description={t('settings.permissionsDesc')} />
      <Card title={t('settings.taskPermissionsHeading')}>
        <p className="settings-note">{t('settings.taskPermissionsDesc')}</p>
        <div className="settings-permissions-panel">
          <TaskPermissionsPanel
            selectedMode={AGENT_MODE_FOR_PERMISSIONS}
            mcpEnabled={mcpEnabled}
            subagentsEnabled={subagentsEnabled}
          />
        </div>
      </Card>
      <Card>
        <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
          {s => (
            <fieldset className="execution-mode-picker" aria-label={t('settings.executionModeHeading')}>
              <legend>{t('settings.executionModeHeading')}</legend>
              <p className="settings-note">{t('settings.executionModeDesc')}</p>
              <div className="execution-mode-options">
                <label className={`execution-mode-option${s.sandboxMode ? ' is-selected' : ''}`}>
                  <input type="radio" name="execution-mode" value="sandbox" checked={s.sandboxMode} onChange={() => change('sandboxMode', true)} />
                  <span>
                    <strong>{t('settings.executionModeSandbox')}</strong>
                    <small>{t('settings.executionModeSandboxDesc')}</small>
                  </span>
                </label>
                <label className={`execution-mode-option${!s.sandboxMode ? ' is-selected' : ''}`}>
                  <input type="radio" name="execution-mode" value="direct_disk" checked={!s.sandboxMode} onChange={() => change('sandboxMode', false)} />
                  <span>
                    <strong>{t('settings.executionModeDirectDisk')}</strong>
                    <small>{t('settings.executionModeDirectDiskDesc')}</small>
                  </span>
                </label>
              </div>
              {s.sandboxMode
                ? (
                  <div className="settings-note sandbox-limits">
                    <strong>{t('settings.sandboxLimitsTitle')}</strong>
                    <pre className="sandbox-limits-body">{t('settings.sandboxLimitsBody')}</pre>
                    <p>{t('settings.sandboxBlocksElevated')}</p>
                  </div>
                )
                : <p className="settings-warning execution-mode-warning">{t('settings.executionModeDirectDiskWarning')}</p>}
            </fieldset>
          )}
        </SettingsFields>
      </Card>
      <Card title={t('settings.macosPermissionsHeading')}>
        <p className="settings-note">{t('settings.macosPermissionsDesc', { appName: app })}</p>
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              void (async () => {
                try {
                  const current = await getNotificationAuthState()
                  if (current === 'unavailable') {
                    setStatus(t('settings.notificationsUnavailable', { appName: app }))
                    return
                  }
                  if (isNotificationAuthGranted(current)) {
                    await requestNotificationAuthorization()
                    showTransientStatus(t('settings.notificationsTestSent'))
                    return
                  }
                  const state = await requestNotificationAuthorization()
                  if (isNotificationAuthGranted(state)) {
                    showTransientStatus(t('settings.notificationsGranted', { appName: app }))
                    return
                  }
                  showTransientStatus(t('settings.notificationsDenied', { appName: app }))
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
        <p className="settings-note">{t('settings.voicePermissionsDesc', { appName: app })}</p>
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              void (async () => {
                try {
                  const permissions = await requestVoiceDictationPermission()
                  if (permissions.microphone === 'authorized' && permissions.speechRecognition === 'authorized') {
                    showTransientStatus(t('settings.voicePermissionsGranted', { appName: app }))
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
                    showTransientStatus(t('settings.microphoneGranted', { appName: app }))
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
    </>
  )
}
