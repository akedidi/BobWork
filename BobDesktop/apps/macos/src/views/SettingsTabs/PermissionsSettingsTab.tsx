import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getNotificationAuthState,
  getMicrophoneAuthorizationState,
  getSpeechRecognitionAuthorizationState,
  isNotificationAuthGranted,
  requestNotificationAuthorization,
  openMacosPrivacyPane,
  requestVoiceDictationPermission,
  requestMicrophonePermission,
  requestAccessibilityPermission,
  requestChromeAutomationPermission,
  type NotificationAuthState,
  type MicrophoneAuthorizationState,
} from '../../lib/ipc'
import { errorMessage } from '../../lib/errorMessage'
import {
  Heading,
  Card,
  SectionLoader,
  SettingsFields,
  StatusRow,
  computerUseAccessibilityLabel,
  chromeAutomationLabel,
} from './SettingsShared'
import TaskPermissionsPanel, { AGENT_MODE_FOR_PERMISSIONS } from '../../components/Composer/TaskPermissionsPanel'
import { forbiddenTaskPermissionIds, getVisibleTaskPermissions } from '../../lib/taskPermissions'
import { useTaskPermissionStore } from '../../stores/taskPermissionStore'

function authorizationLabel(
  state: MicrophoneAuthorizationState | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!state) return t('settings.statusUnknown')
  if (state === 'authorized') return t('settings.statusGranted')
  if (state === 'not_determined') return t('settings.statusUnknown')
  return t('settings.statusDenied')
}

function notificationLabel(
  state: NotificationAuthState | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!state || state === 'unavailable' || state === 'not_determined') return t('settings.statusUnknown')
  if (isNotificationAuthGranted(state)) return t('settings.statusGranted')
  return t('settings.statusDenied')
}

export default function PermissionsSettingsTab(props: any) {
  const {
    t,
    settings,
    change,
    settingsError,
    appName,
    setStatus,
    showTransientStatus,
    mcpEnabled,
    subagentsEnabled,
    chromeStatus,
    chromeLoading,
    chromeError,
    refreshChromeStatus,
    computerUseStatus,
    computerUseLoading,
    computerUseError,
    refreshComputerUseStatus,
  } = props
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

  const [notificationState, setNotificationState] = useState<NotificationAuthState | null>(null)
  const [microphoneState, setMicrophoneState] = useState<MicrophoneAuthorizationState | null>(null)
  const [speechState, setSpeechState] = useState<MicrophoneAuthorizationState | null>(null)
  const [voiceLoading, setVoiceLoading] = useState(true)

  const refreshLocalPermissionStatuses = useCallback(async () => {
    setVoiceLoading(true)
    try {
      const [notification, microphone, speech] = await Promise.all([
        getNotificationAuthState().catch(() => null),
        getMicrophoneAuthorizationState().catch(() => null),
        getSpeechRecognitionAuthorizationState().catch(() => null),
      ])
      setNotificationState(notification)
      setMicrophoneState(microphone)
      setSpeechState(speech)
    } finally {
      setVoiceLoading(false)
    }
  }, [])

  useEffect(() => {
    applyVisiblePermissions(visiblePermissionIds)
  }, [applyVisiblePermissions, visiblePermissionIds])

  useEffect(() => {
    void refreshLocalPermissionStatuses()
  }, [refreshLocalPermissionStatuses])

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
      <Card title={t('settings.notificationPermissionsHeading')}>
        <p className="settings-note">{t('settings.notificationPermissionsDesc', { appName: app })}</p>
        <StatusRow
          title={t('settings.notificationsPermission')}
          value={notificationLabel(notificationState, t)}
          ok={notificationState ? isNotificationAuthGranted(notificationState) : undefined}
          loading={voiceLoading && !notificationState}
        />
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              void (async () => {
                try {
                  const current = await getNotificationAuthState()
                  setNotificationState(current)
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
                  setNotificationState(state)
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
        <StatusRow
          title={t('settings.microphonePermission')}
          value={authorizationLabel(microphoneState, t)}
          ok={microphoneState === 'authorized'}
          loading={voiceLoading && !microphoneState}
        />
        <StatusRow
          title={t('settings.speechPermission')}
          value={authorizationLabel(speechState, t)}
          ok={speechState === 'authorized'}
          loading={voiceLoading && !speechState}
        />
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              void (async () => {
                try {
                  const permissions = await requestVoiceDictationPermission()
                  setMicrophoneState(permissions.microphone)
                  setSpeechState(permissions.speechRecognition)
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
                  setMicrophoneState(state)
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
      <Card title={t('settings.accessibilityPermissionHeading')}>
        <p className="settings-note">{t('settings.accessibilityPermissionDesc', { appName: app })}</p>
        {computerUseLoading && !computerUseStatus && !computerUseError && <SectionLoader label={loadingLabel} />}
        {computerUseError && !computerUseStatus && (
          <p className="settings-note" role="alert">{errorMessage(computerUseError) || t('settings.computerUseLoadFailed')}</p>
        )}
        {computerUseStatus && (
          <>
            <StatusRow
              title={t('settings.macosAccessibility')}
              value={computerUseAccessibilityLabel(computerUseStatus.accessibility, t)}
              ok={computerUseStatus.accessibility === 'granted'}
            />
            <p className="settings-note">{computerUseStatus.accessibilityMessage}</p>
          </>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              void (async () => {
                try {
                  const trusted = await requestAccessibilityPermission()
                  showTransientStatus(
                    trusted
                      ? t('settings.accessibilityGranted', { appName: app })
                      : t('settings.accessibilityPrompted', { appName: app }),
                  )
                  await refreshComputerUseStatus()
                  if (!trusted) {
                    void openMacosPrivacyPane('accessibility').catch(() => undefined)
                  }
                } catch (error) {
                  setStatus(errorMessage(error))
                }
              })()
            }}
          >
            {t('settings.requestAccessibility')}
          </button>
          <button type="button" className="secondary-btn" onClick={() => void refreshComputerUseStatus()}>{t('settings.recheck')}</button>
          <button type="button" className="secondary-btn" onClick={() => void openMacosPrivacyPane('accessibility').catch(error => setStatus(errorMessage(error)))}>
            {t('settings.openAccessibilityForComputerUse')}
          </button>
        </div>
      </Card>
      <Card title={t('settings.automationPermissionHeading')}>
        <p className="settings-note">{t('settings.automationPermissionDesc', { appName: app })}</p>
        {chromeLoading && !chromeStatus && !chromeError && <SectionLoader label={loadingLabel} />}
        {chromeError && !chromeStatus && (
          <p className="settings-note" role="alert">{errorMessage(chromeError) || t('settings.chromeLoadFailed')}</p>
        )}
        {chromeStatus && (
          <>
            <StatusRow
              title={t('settings.macosAutomation')}
              value={chromeAutomationLabel(chromeStatus.automation, t)}
              ok={chromeStatus.automation === 'granted'}
            />
            {chromeStatus.automation !== 'granted' && (
              <div className="settings-warning execution-mode-warning">
                <strong>{t('settings.chromeAutomationSetupTitle')}</strong>
                <p>{t('settings.chromeAutomationSetupSteps', { appName: chromeStatus.appName || app })}</p>
                <p>{t('settings.chromeAutomationVsAccessibility')}</p>
              </div>
            )}
            {chromeStatus.automation !== 'denied' && chromeStatus.automationMessage ? (
              <p className="settings-note">{chromeStatus.automationMessage}</p>
            ) : null}
          </>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              void (async () => {
                const chromeAppName = chromeStatus?.appName || app
                try {
                  await requestChromeAutomationPermission()
                  showTransientStatus(t('settings.automationGranted', { appName: chromeAppName }))
                  await refreshChromeStatus()
                } catch {
                  showTransientStatus(t('settings.automationDenied', { appName: chromeAppName }))
                  void openMacosPrivacyPane('automation').catch(() => undefined)
                  await refreshChromeStatus()
                }
              })()
            }}
          >
            {t('settings.requestAutomation')}
          </button>
          <button type="button" className="secondary-btn" onClick={() => void refreshChromeStatus()}>{t('settings.recheck')}</button>
          <button type="button" className="secondary-btn" onClick={() => void openMacosPrivacyPane('automation').catch(error => setStatus(errorMessage(error)))}>
            {t('settings.openAutomationForChrome')}
          </button>
        </div>
      </Card>
    </>
  )
}
