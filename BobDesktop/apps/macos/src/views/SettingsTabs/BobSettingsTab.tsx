

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
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')

  return (
    <>
      <Heading title="IBM Bob Shell" description="Bob Work pilote l’installation locale et injecte la clé API uniquement dans le processus bob run." />
          {(usageLoading || usage?.available) && (
            <Card title="Consommation Bobcoins">
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
            <StatusRow title="Installation" value={installationLabel} ok={profileLoading ? undefined : installationFound} loading={profileLoading} />
            <StatusRow
              title="Authentification · bob run"
              value={authReady
                ? authenticationLabel(authMethod)
                : profileLoading ? 'Vérification…' : 'Authentification requise'}
              ok={profileLoading ? undefined : authReady}
              loading={profileLoading && !authReady}
            />
            <StatusRow title="Emplacement" value={profile?.detection.path ?? authSnapshot?.path ?? (profileLoading ? loadingLabel : '—')} loading={profileLoading && !profile && !authSnapshot} />
            <div className="settings-actions">
              {!installationFound && !profileLoading && <button type="button" className="btn-primary" onClick={install}>Installer la version officielle</button>}
              <button
                type="button"
                className="btn-primary"
                disabled={profileLoading}
                aria-busy={profileLoading}
                onClick={() => void refreshProfile(true)}
              >
                {profileLoading
                  ? <><span className="task-spinner" aria-hidden="true" />Vérification…</>
                  : 'Revérifier'}
              </button>
            </div>
          </Card>
          <Card title="Clé IBM Bob">
            <p className="settings-note">
              Si vous êtes déjà connecté à IBM Bob (IDE / Shell), Bob Work réutilise cette session pour <code>bob run</code> et les Bobcoins.
              Vous pouvez aussi enregistrer une clé d’inférence dans le coffre local chiffré (injection uniquement dans le processus <code>bob run</code>).
            </p>
            <StatusRow
              title="Coffre local"
              value={profileLoading ? loadingLabel : sessionKeyStatus.vaultKeyPresent ? 'Clé d’inférence présente' : 'Aucune clé enregistrée'}
              ok={profileLoading ? undefined : sessionKeyStatus.vaultKeyPresent}
              loading={profileLoading}
            />
            {!profileLoading && sessionKeyStatus.source === 'environment' && (
              <StatusRow title="Environnement" value="Clé fournie au lancement de l’app" ok />
            )}
            {!profileLoading && (sessionKeyStatus.source === 'sso' || (sessionKeyStatus.active && !sessionKeyStatus.vaultKeyPresent && sessionKeyStatus.source !== 'environment')) && (
              <StatusRow title="Session IBM Bob" value="SSO détectée (~/.bob/settings/auth-secrets.json)" ok />
            )}
            {sessionKeyStatus.vaultKeyPresent && <div className="settings-actions">
              <button className="danger-link" onClick={async () => { await bobAuthService.clearSessionApiKey(); setStatus('Clé effacée du coffre local.'); await refreshProfile() }}>Effacer du coffre</button>
            </div>}
            <div className="vault-secret-fields">
              <strong>
                {sessionKeyStatus.vaultKeyPresent
                  ? 'Remplacer la clé enregistrée'
                  : 'Enregistrer une clé IBM Bob'}
              </strong>
              <input type="password" aria-label={t('onboarding.apiKeyLabel')} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={t('onboarding.apiKeyLabel')} />
              <button className="btn-primary" disabled={!apiKey.trim()} onClick={() => void saveKey()}>Enregistrer dans le coffre</button>
            </div>
            <button className="link-btn" onClick={() => openUrl('https://bob.ibm.com/')}>Ouvrir bob.ibm.com ↗</button>
          </Card>
          <div className="settings-warning">La clé et les jetons d’intégration restent disponibles après redémarrage de Bob Work tant qu’ils n’ont pas été effacés du coffre. Les planifications peuvent donc réutiliser ces secrets, y compris lorsque l’écran est verrouillé.</div>
          {!usageLoading && !usage?.available && (
            <Card title="Consommation Bobcoins">
              <UsageMeter usage={usage} />
              <p className="settings-note">{usage?.message ?? 'Indisponible'}</p>
              <div className="settings-actions">
                <button className="secondary-btn" onClick={() => void refreshProfile(false, true)}>Actualiser</button>
              </div>
            </Card>
          )}
          {!usageLoading && usage?.available && (
            <div className="settings-actions">
              <button className="secondary-btn" onClick={() => void refreshProfile(false, true)}>Actualiser la consommation</button>
            </div>
          )}
          {bobExtrasReady ? (
            <Suspense fallback={<SectionLoader label={loadingLabel} />}>
              <BobalyticsPanel />
            </Suspense>
          ) : (
            <SectionLoader label={loadingLabel} />
          )}
    </>
  )
}