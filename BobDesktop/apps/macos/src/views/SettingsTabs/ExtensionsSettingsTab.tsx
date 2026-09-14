

import { Suspense, lazy } from 'react'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { open as chooseFile, save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { importConversations, exportConversations, openDataDir, exportDiagnostics, purgeAppCache, createDatabaseBackup, restoreDatabaseBackup, requestNotificationAuthorization, openMacosPrivacyPane, requestVoiceDictationPermission, requestMicrophonePermission } from '../../lib/ipc'
import { useT } from '../../i18n'
import { UsageMeter } from '../../components/UsageMeter/UsageMeter'
import { LoadErrorBanner } from '../../components/LoadErrorBanner'
import ModesView from '../ModesView'
import { useAppDialog } from '../../components/AppDialog'
import { errorMessage } from '../../lib/errorMessage'
import { Heading, Card, SectionLoader, SettingsFields, ToggleRow, SelectRow, NumberRow, StatusRow, authenticationLabel, chromeAutomationLabel, computerUseAccessibilityLabel } from './SettingsShared'

const BobalyticsPanel = lazy(() => import('../BobalyticsPanel'))
  

export default function ExtensionsSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, orcaCliStatus, orcaCliLoading, orcaCliError, refreshOrcaCliStatus, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus, appName } = props
  const dialog = useAppDialog()
  const loadingLabel = t('common.loading')
  const app = appName || 'Bob Work'

  return (
    <>
      <Heading title={t('settings.extensionsHeading')} description={t('settings.extensionsDesc')} />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
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
              </>}
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
          {settings?.computerUseEnabled && computerUseStatus && <Card title={t('settings.computerUseStatus')}>
            <StatusRow title={t('settings.integratedMcpServer')} value={computerUseStatus.mcpEnabled ? t('settings.mcpActive', { name: 'bob-work-computer-use' }) : computerUseStatus.mcpConfigured ? t('settings.configuredDisabled') : t('settings.notConfigured')} ok={computerUseStatus.mcpEnabled} />
            <StatusRow title={t('settings.macosAccessibility')} value={computerUseAccessibilityLabel(computerUseStatus.accessibility, t)} ok={computerUseStatus.accessibility === 'granted'} />
            <StatusRow
              title={t('settings.mcpTools')}
              value={computerUseTools?.ok
                ? t('settings.mcpToolsCount', { count: computerUseTools.tools.length, tools: computerUseTools.tools.join(', ') })
                : computerUseTools
                  ? computerUseTools.message
                  : computerUseStatus.mcpEnabled ? t('settings.testInProgress') : t('settings.enableMcpToListTools')}
              ok={Boolean(computerUseTools?.ok)}
            />
            <p className="settings-note">{computerUseStatus.accessibilityMessage}</p>
            <p className="settings-note">{t('settings.managePermissionsInSettings')}</p>
            <div className="settings-actions">
              <button className="secondary-btn" onClick={() => void refreshComputerUseStatus()}>{t('settings.recheck')}</button>
            </div>
          </Card>}
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
                <button className="secondary-btn" onClick={() => void refreshOrcaCliStatus()}>{t('settings.recheck')}</button>
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
          {settings?.chromeControlEnabled && chromeStatus && <Card title={t('settings.chromeStatus')}>
            <StatusRow title="Google Chrome" value={chromeStatus.chromeInstalled ? t('settings.statusInstalled') : t('settings.statusNotInstalled')} ok={chromeStatus.chromeInstalled} />
            <StatusRow title={t('settings.integratedMcpServer')} value={chromeStatus.mcpEnabled ? t('settings.mcpActive', { name: 'bob-work-chrome-control' }) : chromeStatus.mcpConfigured ? t('settings.configuredDisabled') : t('settings.notConfigured')} ok={chromeStatus.mcpEnabled} />
            <StatusRow
              title={t('settings.mcpTools')}
              value={chromeTools?.ok
                ? t('settings.mcpToolsCount', { count: chromeTools.tools.length, tools: chromeTools.tools.join(', ') })
                : chromeTools
                  ? chromeTools.message
                  : chromeStatus.mcpEnabled ? t('settings.testInProgress') : t('settings.enableMcpToListTools')}
              ok={Boolean(chromeTools?.ok)}
            />
            <StatusRow title={t('settings.macosAutomation')} value={chromeAutomationLabel(chromeStatus.automation, t)} ok={chromeStatus.automation === 'granted'} />
            {chromeStatus.automation !== 'denied' && chromeStatus.automationMessage ? (
              <p className="settings-note">{chromeStatus.automationMessage}</p>
            ) : null}
            <p className="settings-note">{t('settings.managePermissionsInSettings')}</p>
            <div className="settings-actions">
              <button className="secondary-btn" onClick={() => void refreshChromeStatus()}>{t('settings.recheck')}</button>
            </div>
          </Card>}
    </>
  )
}
