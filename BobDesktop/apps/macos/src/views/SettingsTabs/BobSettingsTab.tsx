

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
import { bobAuthService } from '../../services/BobAuthService'
import { errorMessage } from '../../lib/errorMessage'
import { Heading, Card, SectionLoader, SettingsFields, ToggleRow, SelectRow, NumberRow, StatusRow, authenticationLabel, chromeAutomationLabel, computerUseAccessibilityLabel } from './SettingsShared'

const BobalyticsPanel = lazy(() => import('../BobalyticsPanel'))
  

export default function BobSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, installingBob, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')

  return (
    <>
      <Heading title={t('settings.bobHeading')} description={t('settings.bobDesc')} />
          {authReady && (usageLoading || usage?.available) && (
            <Card title={t('settings.bobcoinsUsage')}>
              {usageLoading ? (
                <SectionLoader label={loadingLabel} />
              ) : (
                <>
                  <UsageMeter usage={usage} />
                  {usage?.instanceLabel && <p className="settings-note">{usage.instanceLabel}</p>}
                </>
              )}
            </Card>
          )}
          <Card>
            <StatusRow title={t('settings.installation')} value={installationLabel} ok={profileLoading ? undefined : installationFound} loading={profileLoading} />
            <StatusRow
              title={t('settings.bobRunAuthentication')}
              value={authReady
                ? authenticationLabel(authMethod, t)
                : profileLoading ? t('settings.checking') : t('settings.authRequired')}
              ok={profileLoading ? undefined : authReady}
              loading={profileLoading && !authReady}
            />
            <StatusRow title={t('settings.locationPath')} value={profile?.detection.path ?? authSnapshot?.path ?? (profileLoading ? loadingLabel : '—')} loading={profileLoading && !profile && !authSnapshot} />
            <div className="settings-actions">
              {(!installationFound || installingBob) && !profileLoading && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={installingBob}
                  aria-busy={installingBob}
                  onClick={() => void install()}
                >
                  {installingBob
                    ? <><span className="task-spinner" aria-hidden="true" />{t('settings.bobInstalling')}</>
                    : t('settings.installOfficial')}
                </button>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={profileLoading || installingBob}
                aria-busy={profileLoading}
                onClick={() => void refreshProfile(true)}
              >
                {profileLoading
                  ? <><span className="task-spinner" aria-hidden="true" />{t('settings.checking')}</>
                  : t('settings.recheck')}
              </button>
            </div>
          </Card>
          <Card title={t('settings.bobKeyHeading')}>
            <p className="settings-note">
              {t('settings.bobKeyDesc')}
            </p>
            <StatusRow
              title={t('settings.localVault')}
              value={profileLoading ? loadingLabel : sessionKeyStatus.vaultKeyPresent ? t('settings.inferenceKeyPresent') : t('settings.noSavedKey')}
              ok={profileLoading ? undefined : sessionKeyStatus.vaultKeyPresent}
              loading={profileLoading}
            />
            {!profileLoading && sessionKeyStatus.source === 'environment' && (
              <StatusRow title={t('settings.environment')} value={t('settings.keyProvidedAtLaunch')} ok />
            )}
            {!profileLoading && (sessionKeyStatus.source === 'sso' || (sessionKeyStatus.active && !sessionKeyStatus.vaultKeyPresent && sessionKeyStatus.source !== 'environment')) && (
              <StatusRow title={t('settings.bobSession')} value={t('settings.ssoDetected')} ok />
            )}
            {sessionKeyStatus.vaultKeyPresent && <div className="settings-actions">
              <button className="danger-link" onClick={async () => {
                if (!await dialog.confirm({
                  message: t('settings.clearVaultConfirm'),
                  confirmLabel: t('settings.clearVault'),
                  destructive: true,
                })) return
                await bobAuthService.clearSessionApiKey()
                setStatus(t('settings.vaultKeyCleared'))
                await refreshProfile()
              }}>{t('settings.clearVault')}</button>
            </div>}
            <div className="vault-secret-fields">
              <strong>
                {sessionKeyStatus.vaultKeyPresent
                  ? t('settings.replaceSavedKey')
                  : t('settings.saveBobKey')}
              </strong>
              <input type="password" aria-label={t('onboarding.apiKeyLabel')} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={t('onboarding.apiKeyLabel')} />
              <button className="btn-primary" disabled={!apiKey.trim()} onClick={() => void saveKey()}>{t('settings.saveInVault')}</button>
            </div>
            <button className="link-btn" onClick={() => openUrl('https://bob.ibm.com/')}>{t('settings.openBobWebsite')}</button>
          </Card>
          <div className="settings-warning">{t('settings.secretsPersistenceWarning')}</div>
          {authReady && !usageLoading && !usage?.available && (
            <Card title={t('settings.bobcoinsUsage')}>
              <UsageMeter usage={usage} />
              <p className="settings-note">{usage?.message ?? t('settings.statusUnavailable')}</p>
              <div className="settings-actions">
                <button className="secondary-btn" onClick={() => void refreshProfile(false, true)}>{t('settings.refresh')}</button>
              </div>
            </Card>
          )}
          {authReady && !usageLoading && usage?.available && (
            <div className="settings-actions">
              <button className="secondary-btn" onClick={() => void refreshProfile(false, true)}>{t('settings.refreshUsage')}</button>
            </div>
          )}
          {authReady && (bobExtrasReady ? (
            <Suspense fallback={<SectionLoader label={loadingLabel} />}>
              <BobalyticsPanel />
            </Suspense>
          ) : (
            <SectionLoader label={loadingLabel} />
          ))}
    </>
  )
}
