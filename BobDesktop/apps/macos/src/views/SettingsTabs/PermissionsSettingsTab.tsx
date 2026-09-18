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
import { LoadErrorBanner } from '../../components/LoadErrorBanner'
import {
  Heading,
  Card,
  SectionLoader,
  SettingsFields,
  ToggleRow,
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

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
    profile,
    chromeStatus,
    chromeLoading,
    chromeError,
    refreshChromeStatus,
    chromeTools,
    computerUseStatus,
    computerUseLoading,
    computerUseError,
    refreshComputerUseStatus,
    computerUseTools,
    orcaCliStatus,
    orcaCliLoading,
    orcaCliError,
    refreshOrcaCliStatus,
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

  const requestComputerUseAccessibility = () => {
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
          await openMacosPrivacyPane('accessibility')
        }
      } catch (error) {
        setStatus(errorMessage(error))
      }
    })()
  }

  const requestChromeAutomation = () => {
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
  }

  const sections = [
    { id: 'settings-capabilities', label: t('settings.sectionCapabilities') },
    { id: 'settings-execution', label: t('settings.sectionExecution') },
    { id: 'settings-macos', label: t('settings.sectionMacos') },
    { id: 'settings-task-approvals', label: t('settings.sectionTaskApprovals') },
  ]

  return (
    <>
      <Heading title={t('settings.permissionsHeading')} description={t('settings.permissionsDesc')} />

      <nav className="settings-section-nav" aria-label={t('settings.sectionNavLabel')}>
        {sections.map(section => (
          <button
            key={section.id}
            type="button"
            className="settings-section-nav-btn"
            onClick={() => scrollToSection(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <section id="settings-capabilities" className="settings-section">
        <header className="settings-section-header">
          <h2>{t('settings.sectionCapabilities')}</h2>
          <p>{t('settings.sectionCapabilitiesDesc')}</p>
        </header>

        <Card>
          <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
            {s => (
              <>
                <ToggleRow
                  title={t('settings.mcpServers')}
                  value={s.mcpEnabled}
                  onChange={value => change('mcpEnabled', value)}
                />
                <ToggleRow
                  title={t('settings.subagentsOrchestrator')}
                  description={profile && !profile.supportsSubagents
                    ? t('settings.subagentsUnsupported')
                    : t('settings.subagentsDesc')}
                  value={s.subagentsEnabled}
                  onChange={value => change('subagentsEnabled', value)}
                  disabled={Boolean(profile && !profile.supportsSubagents)}
                />
                <ToggleRow
                  title={t('settings.webAccess')}
                  description={t('settings.webAccessDesc')}
                  value={s.webEnabled}
                  onChange={value => change('webEnabled', value)}
                />
                <ToggleRow
                  title={t('settings.computerControl')}
                  description={s.sandboxMode
                    ? t('settings.computerUseSandboxBlocked')
                    : t('settings.computerControlDesc', { appName: app })}
                  value={s.computerUseEnabled}
                  onChange={value => change('computerUseEnabled', value)}
                  disabled={s.sandboxMode}
                />
                <ToggleRow
                  title={t('settings.chromeControl')}
                  description={t('settings.chromeControlPermissionTiming')}
                  value={s.chromeControlEnabled}
                  onChange={value => change('chromeControlEnabled', value)}
                />
                {s.sandboxMode && <p className="settings-note">{t('settings.sandboxBlocksElevated')}</p>}
              </>
            )}
          </SettingsFields>
        </Card>

        {settings?.computerUseEnabled && computerUseLoading && !computerUseStatus && !computerUseError && (
          <Card title={t('settings.computerUseStatus')}>
            <SectionLoader label={loadingLabel} />
          </Card>
        )}
        {settings?.computerUseEnabled && computerUseError && !computerUseStatus && (
          <Card title={t('settings.computerUseStatus')}>
            <LoadErrorBanner
              error={computerUseError}
              onRetry={() => void refreshComputerUseStatus()}
              fallback={t('settings.computerUseLoadFailed')}
            />
          </Card>
        )}
        {settings?.computerUseEnabled && computerUseStatus && (
          <Card title={t('settings.computerUseStatus')}>
            <StatusRow
              title={t('settings.integratedMcpServer')}
              value={computerUseStatus.mcpEnabled
                ? t('settings.mcpActive', { name: 'bob-work-computer-use' })
                : computerUseStatus.mcpConfigured
                  ? t('settings.configuredDisabled')
                  : t('settings.notConfigured')}
              ok={computerUseStatus.mcpEnabled}
            />
            <StatusRow
              title={t('settings.macosAccessibility')}
              value={computerUseAccessibilityLabel(computerUseStatus.accessibility, t)}
              ok={computerUseStatus.accessibility === 'granted'}
            />
            <StatusRow
              title={t('settings.mcpTools')}
              value={computerUseTools?.ok
                ? t('settings.mcpToolsCount', { count: computerUseTools.tools.length, tools: computerUseTools.tools.join(', ') })
                : computerUseTools
                  ? computerUseTools.message
                  : computerUseStatus.mcpEnabled
                    ? t('settings.testInProgress')
                    : t('settings.enableMcpToListTools')}
              ok={Boolean(computerUseTools?.ok)}
            />
            <p className="settings-note">{computerUseStatus.accessibilityMessage}</p>
            <div className="settings-actions">
              {computerUseStatus.accessibility !== 'granted' && (
                <button type="button" className="secondary-btn" onClick={requestComputerUseAccessibility}>
                  {t('settings.requestAccessibility')}
                </button>
              )}
              <button type="button" className="secondary-btn" onClick={() => void refreshComputerUseStatus()}>
                {t('settings.recheck')}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void openMacosPrivacyPane('accessibility').catch(error => setStatus(errorMessage(error)))}
              >
                {t('settings.openAccessibilityForComputerUse')}
              </button>
            </div>
          </Card>
        )}

        {settings?.chromeControlEnabled && chromeLoading && !chromeStatus && !chromeError && (
          <Card title={t('settings.chromeStatus')}>
            <SectionLoader label={loadingLabel} />
          </Card>
        )}
        {settings?.chromeControlEnabled && chromeError && !chromeStatus && (
          <Card title={t('settings.chromeStatus')}>
            <LoadErrorBanner
              error={chromeError}
              onRetry={() => void refreshChromeStatus()}
              fallback={t('settings.chromeLoadFailed')}
            />
          </Card>
        )}
        {settings?.chromeControlEnabled && chromeStatus && (
          <Card title={t('settings.chromeStatus')}>
            <StatusRow
              title="Google Chrome"
              value={chromeStatus.chromeInstalled ? t('settings.statusInstalled') : t('settings.statusNotInstalled')}
              ok={chromeStatus.chromeInstalled}
            />
            <StatusRow
              title={t('settings.integratedMcpServer')}
              value={chromeStatus.mcpEnabled
                ? t('settings.mcpActive', { name: 'bob-work-chrome-control' })
                : chromeStatus.mcpConfigured
                  ? t('settings.configuredDisabled')
                  : t('settings.notConfigured')}
              ok={chromeStatus.mcpEnabled}
            />
            <StatusRow
              title={t('settings.mcpTools')}
              value={chromeTools?.ok
                ? t('settings.mcpToolsCount', { count: chromeTools.tools.length, tools: chromeTools.tools.join(', ') })
                : chromeTools
                  ? chromeTools.message
                  : chromeStatus.mcpEnabled
                    ? t('settings.testInProgress')
                    : t('settings.enableMcpToListTools')}
              ok={Boolean(chromeTools?.ok)}
            />
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
            <div className="settings-actions">
              {chromeStatus.automation !== 'granted' && (
                <button type="button" className="secondary-btn" onClick={requestChromeAutomation}>
                  {t('settings.requestAutomation')}
                </button>
              )}
              <button type="button" className="secondary-btn" onClick={() => void refreshChromeStatus()}>
                {t('settings.recheck')}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void openMacosPrivacyPane('automation').catch(error => setStatus(errorMessage(error)))}
              >
                {t('settings.openAutomationForChrome')}
              </button>
            </div>
          </Card>
        )}

        {orcaCliLoading && !orcaCliStatus && !orcaCliError && (
          <Card title={t('settings.orcaCliStatus')}>
            <SectionLoader label={loadingLabel} />
          </Card>
        )}
        {orcaCliError && !orcaCliStatus && (
          <Card title={t('settings.orcaCliStatus')}>
            <LoadErrorBanner
              error={orcaCliError}
              onRetry={() => void refreshOrcaCliStatus()}
              fallback={t('settings.orcaCliLoadFailed')}
            />
          </Card>
        )}
        {orcaCliStatus && (
          <Card title={t('settings.orcaCliStatus')}>
            <StatusRow
              title={t('settings.orcaCliBinary')}
              value={orcaCliStatus.installed
                ? (orcaCliStatus.path ?? t('settings.orcaCliInstalled'))
                : t('settings.orcaCliNotInstalled')}
              ok={orcaCliStatus.installed}
            />
            {orcaCliStatus.installed && (
              <StatusRow
                title={t('settings.orcaCliSkillsGet')}
                value={orcaCliStatus.supportsSkillsGet ? t('settings.orcaCliSkillsGetYes') : t('settings.orcaCliSkillsGetNo')}
                ok={orcaCliStatus.supportsSkillsGet}
              />
            )}
            <p className="settings-note">{orcaCliStatus.message}</p>
            {!orcaCliStatus.installed && (
              <p className="settings-note">{t('settings.orcaCliInstallHint')}</p>
            )}
            <div className="settings-actions">
              <button type="button" className="secondary-btn" onClick={() => void refreshOrcaCliStatus()}>
                {t('settings.recheck')}
              </button>
            </div>
          </Card>
        )}
      </section>

      <section id="settings-execution" className="settings-section">
        <header className="settings-section-header">
          <h2>{t('settings.sectionExecution')}</h2>
          <p>{t('settings.sectionExecutionDesc')}</p>
        </header>
        <Card>
          <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
            {s => (
              <fieldset className="execution-mode-picker" aria-label={t('settings.executionModeHeading')}>
                <legend className="sr-only">{t('settings.executionModeHeading')}</legend>
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
      </section>

      <section id="settings-macos" className="settings-section">
        <header className="settings-section-header">
          <h2>{t('settings.sectionMacos')}</h2>
          <p>{t('settings.sectionMacosDesc', { appName: app })}</p>
        </header>

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
      </section>

      <section id="settings-task-approvals" className="settings-section">
        <header className="settings-section-header">
          <h2>{t('settings.sectionTaskApprovals')}</h2>
          <p>{t('settings.sectionTaskApprovalsDesc')}</p>
        </header>
        <Card>
          <div className="settings-permissions-panel">
            <TaskPermissionsPanel
              selectedMode={AGENT_MODE_FOR_PERMISSIONS}
              mcpEnabled={mcpEnabled}
              subagentsEnabled={subagentsEnabled}
            />
          </div>
        </Card>
      </section>
    </>
  )
}
