

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
  

export default function ExtensionsSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')

  return (
    <>
      <Heading title="Accès et contrôle" description="MCP, sous-agents / orchestrateur, web, Computer Use et Chrome. Les skills se gèrent dans la barre latérale (Skills) — ce n’est pas cet onglet." />
          <Card>
            <SettingsFields settings={settings} error={settingsError} loadingLabel={loadingLabel}>
              {s => <>
                <ToggleRow title="Serveurs MCP" value={s.mcpEnabled} onChange={value => change('mcpEnabled', value)} />
                <ToggleRow
                  title="Sous-agents / orchestrateur"
                  description={profile && !profile.supportsSubagents
                    ? 'Ce Bob Shell n’expose pas les sous-agents (--disable-subagents). Mettez à jour Bob Shell pour les activer.'
                    : 'Autorise Bob Shell à lancer des sous-agents. Désactiver ajoute --disable-subagents à bob run.'}
                  value={s.subagentsEnabled}
                  onChange={value => change('subagentsEnabled', value)}
                  disabled={Boolean(profile && !profile.supportsSubagents)}
                />
                <ToggleRow title="Accès web" description="Soumis aux permissions et aux capacités réellement disponibles dans Bob Shell." value={s.webEnabled} onChange={value => change('webEnabled', value)} />
                <ToggleRow
                  title="Contrôle de l’ordinateur"
                  description="Installe le MCP bob-work-computer-use. Les clics et la saisie passent par l’app Bob Work — autorisez Bob Work (pas python3) dans Accessibilité."
                  value={s.computerUseEnabled}
                  onChange={value => change('computerUseEnabled', value)}
                  disabled={s.sandboxMode}
                />
                <ToggleRow
                  title="Contrôle de Chrome"
                  description={t('settings.chromeControlPermissionTiming')}
                  value={s.chromeControlEnabled}
                  onChange={value => change('chromeControlEnabled', value)}
                  disabled={s.sandboxMode}
                />
                {s.sandboxMode && <p className="settings-note">{t('settings.sandboxBlocksElevated')}</p>}
              </>}
            </SettingsFields>
          </Card>
          {settings?.computerUseEnabled && computerUseLoading && !computerUseStatus && !computerUseError && (
            <Card title="Statut Computer Use">
              <SectionLoader label={loadingLabel} />
            </Card>
          )}
          {settings?.computerUseEnabled && computerUseError && !computerUseStatus && (
            <Card title="Statut Computer Use">
              <LoadErrorBanner
                error={computerUseError}
                onRetry={() => void refreshComputerUseStatus()}
                fallback={t('settings.computerUseLoadFailed')}
              />
            </Card>
          )}
          {settings?.computerUseEnabled && computerUseStatus && <Card title="Statut Computer Use">
            <StatusRow title="Serveur MCP intégré" value={computerUseStatus.mcpEnabled ? 'bob-work-computer-use actif' : computerUseStatus.mcpConfigured ? 'Configuré mais désactivé' : 'Non configuré'} ok={computerUseStatus.mcpEnabled} />
            <StatusRow title="Accessibilité macOS" value={computerUseAccessibilityLabel(computerUseStatus.accessibility)} ok={computerUseStatus.accessibility === 'granted'} />
            <StatusRow
              title="Outils MCP"
              value={computerUseTools?.ok
                ? `${computerUseTools.tools.length} outil${computerUseTools.tools.length > 1 ? 's' : ''} : ${computerUseTools.tools.join(', ')}`
                : computerUseTools
                  ? computerUseTools.message
                  : computerUseStatus.mcpEnabled ? 'Test en cours…' : 'Activez le MCP pour lister les outils'}
              ok={Boolean(computerUseTools?.ok)}
            />
            <p className="settings-note">{computerUseStatus.accessibilityMessage}</p>
            <div className="settings-actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      const trusted = await requestAccessibilityPermission()
                      showTransientStatus(
                        trusted
                          ? t('settings.accessibilityGranted')
                          : t('settings.accessibilityPrompted'),
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
              <button className="secondary-btn" onClick={() => void refreshComputerUseStatus()}>Revérifier</button>
            </div>
          </Card>}
          {settings?.chromeControlEnabled && chromeLoading && !chromeStatus && !chromeError && (
            <Card title="Statut Chrome">
              <SectionLoader label={loadingLabel} />
            </Card>
          )}
          {settings?.chromeControlEnabled && chromeError && !chromeStatus && (
            <Card title="Statut Chrome">
              <LoadErrorBanner
                error={chromeError}
                onRetry={() => void refreshChromeStatus()}
                fallback={t('settings.chromeLoadFailed')}
              />
            </Card>
          )}
          {settings?.chromeControlEnabled && chromeStatus && <Card title="Statut Chrome">
            <StatusRow title="Google Chrome" value={chromeStatus.chromeInstalled ? 'Installé' : 'Non installé'} ok={chromeStatus.chromeInstalled} />
            <StatusRow title="Serveur MCP intégré" value={chromeStatus.mcpEnabled ? 'bob-work-chrome-control actif' : chromeStatus.mcpConfigured ? 'Configuré mais désactivé' : 'Non configuré'} ok={chromeStatus.mcpEnabled} />
            <StatusRow
              title="Outils MCP"
              value={chromeTools?.ok
                ? `${chromeTools.tools.length} outil${chromeTools.tools.length > 1 ? 's' : ''} : ${chromeTools.tools.join(', ')}`
                : chromeTools
                  ? chromeTools.message
                  : chromeStatus.mcpEnabled ? 'Test en cours…' : 'Activez le MCP pour lister les outils'}
              ok={Boolean(chromeTools?.ok)}
            />
            <StatusRow title="Automatisation macOS" value={chromeAutomationLabel(chromeStatus.automation)} ok={chromeStatus.automation === 'granted'} />
            <p className="settings-note">{chromeStatus.automationMessage}</p>
            <div className="settings-actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      await requestChromeAutomationPermission()
                      showTransientStatus(t('settings.automationGranted'))
                      await refreshChromeStatus()
                    } catch (error) {
                      setStatus(errorMessage(error))
                      void openMacosPrivacyPane('automation').catch(() => undefined)
                      await refreshChromeStatus()
                    }
                  })()
                }}
              >
                {t('settings.requestAutomation')}
              </button>
              <button className="secondary-btn" onClick={() => void refreshChromeStatus()}>Revérifier</button>
            </div>
          </Card>}
          <div className="settings-actions">
            <button className="secondary-btn" onClick={() => void openMacosPrivacyPane('accessibility').catch(error => setStatus(errorMessage(error)))}>
              Ouvrir Accessibilité (Réglages Système)
            </button>
            <button className="secondary-btn" onClick={() => void openMacosPrivacyPane('automation').catch(error => setStatus(errorMessage(error)))}>
              Ouvrir Automatisation (Réglages Système)
            </button>
          </div>
          <div className="settings-actions"><button className="btn-primary" onClick={() => navigate('/skills')}>Gérer les skills</button><button className="secondary-btn" onClick={() => navigate('/integrations')}>Gérer les intégrations et MCP</button><button className="secondary-btn" onClick={() => navigate('/plugins')}>Gérer les plugins</button></div>
    </>
  )
}