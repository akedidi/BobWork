

import { Suspense, lazy } from 'react'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { open as chooseFile, save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { useNavigate } from 'react-router-dom'
import type { DatabaseBackup } from '../../lib/ipc'
import { importConversations, exportConversations, openDataDir, exportDiagnostics, purgeAppCache, createDatabaseBackup, restoreDatabaseBackup, listDatabaseBackups, requestNotificationAuthorization, openMacosPrivacyPane, requestVoiceDictationPermission, requestMicrophonePermission, requestChromeAutomationPermission, requestAccessibilityPermission } from '../../lib/ipc'
import { useT } from '../../i18n'
import { UsageMeter } from '../../components/UsageMeter/UsageMeter'
import { LoadErrorBanner } from '../../components/LoadErrorBanner'
import ModesView from '../ModesView'
import { useAppDialog } from '../../components/AppDialog'
import { errorMessage } from '../../lib/errorMessage'
import { Heading, Card, SectionLoader, SettingsFields, ToggleRow, SelectRow, NumberRow, StatusRow, authenticationLabel, chromeAutomationLabel, computerUseAccessibilityLabel } from './SettingsShared'

const BobalyticsPanel = lazy(() => import('../BobalyticsPanel'))
  

export default function DataSettingsTab(props: any) {
  const { t, settings, change, settingsError, updateInfo, updateBusy, checkUpdate, installUpdate, notificationBundleHint, usageLoading, usage, profileLoading, installationFound, installationLabel, authReady, authMethod, profile, authSnapshot, sessionKeyStatus, install, refreshProfile, apiKey, setApiKey, saveKey, bobExtrasReady, grantsLoading, grants, grantsError, revokeGrant, mcpEnabled, subagentsEnabled, computerUseEnabled, chromeControlEnabled, sandboxMode, chromeLoading, chromeStatus, chromeError, refreshChromeStatus, chromeTools, computerUseLoading, computerUseStatus, computerUseError, refreshComputerUseStatus, computerUseTools, exportFormat, setExportFormat, databaseBackups, setStatus, setDatabaseBackups, showTransientStatus } = props
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const loadingLabel = t('common.loading')

  return (
    <>
      <Heading title={t('settings.localDataHeading')} description={t('settings.localDataDesc')} />
          <Card>
            <SelectRow
              title={t('settings.exportFormat')}
              description={t('settings.exportFormatDesc')}
              value={exportFormat}
              onChange={value => setExportFormat(value as typeof exportFormat)}
            >
              <option value="chatgpt">ChatGPT (conversations.json)</option>
              <option value="claude-cowork">Claude / Cowork</option>
              <option value="bob-work-export-v1">Bob Work (complet)</option>
            </SelectRow>
            <div className="settings-actions">
              <button className="secondary-btn" onClick={async () => {
                const path = await chooseFile({ multiple: false, directory: false, filters: [{ name: 'Export conversations JSON', extensions: ['json'] }] })
                if (typeof path === 'string') { const result = await importConversations(path); setStatus(t('settings.importComplete', { conversations: result.conversations, messages: result.messages, format: result.detectedFormat })) }
              }}>{t('settings.importConversations')}</button>
              <button className="secondary-btn" onClick={async () => {
                const defaultPath = exportFormat === 'chatgpt'
                  ? 'conversations.json'
                  : exportFormat === 'claude-cowork'
                    ? 'claude-conversations.json'
                    : 'bob-work-conversations.json'
                const path = await chooseSavePath({ defaultPath, filters: [{ name: 'JSON', extensions: ['json'] }] })
                if (path) {
                  const result = await exportConversations(path, exportFormat)
                  const label = exportFormat === 'chatgpt'
                    ? 'ChatGPT'
                    : exportFormat === 'claude-cowork'
                      ? 'Claude / Cowork'
                      : 'Bob Work'
                  setStatus(t('settings.exportComplete', { conversations: result.conversations, messages: result.messages, format: label }))
                }
              }}>{t('settings.exportConversations')}</button>
              <button className="secondary-btn" onClick={() => { void openDataDir() }}>{t('settings.openDataFolder')}</button>
              <button className="secondary-btn" onClick={async () => setStatus(t('settings.diagnosticExported', { path: await exportDiagnostics() }))}>{t('settings.exportDiagnostic')}</button>
            </div>
          </Card>
          <Card title={t('settings.backupsHeading')}>
            <p className="settings-note">{t('settings.backupsDesc')}</p>
            <div className="settings-actions">
              <button className="secondary-btn" onClick={async () => {
                try {
                  const backup = await createDatabaseBackup()
                  setDatabaseBackups(await listDatabaseBackups())
                  setStatus(t('settings.backupCreated', { name: backup.name }))
                } catch (error) {
                  setStatus(errorMessage(error))
                }
              }}>{t('settings.createBackup')}</button>
            </div>
            {databaseBackups.length > 0 && <div className="settings-list">
              {databaseBackups.map((backup: DatabaseBackup) => <div className="settings-list-row" key={backup.name}>
                <div><strong>{backup.name}</strong><small>{(backup.sizeBytes / (1024 * 1024)).toFixed(1)} MB</small></div>
                <button className="secondary-btn" onClick={async () => {
                  if (!await dialog.confirm({ message: t('settings.restoreConfirm', { name: backup.name }), confirmLabel: t('settings.restoreBackup'), destructive: true })) return
                  try {
                    await restoreDatabaseBackup(backup.name)
                    await relaunch()
                  } catch (error) {
                    setStatus(errorMessage(error))
                  }
                }}>{t('settings.restoreBackup')}</button>
              </div>)}
            </div>}
          </Card>
          <Card title={t('settings.cacheHeading')}>
            <p className="settings-note">{t('settings.cacheDesc')}</p>
            <div className="settings-actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  void (async () => {
                    try {
                      if (!await dialog.confirm({ message: t('settings.cachePurgeConfirm'), confirmLabel: t('settings.purgeCache'), destructive: true })) return
                      const result = await purgeAppCache()
                      const mb = (result.freedBytes / (1024 * 1024)).toFixed(1)
                      setStatus(t('settings.cachePurged', { mb, count: result.clearedPaths.length }))
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  })()
                }}
              >
                {t('settings.purgeCache')}
              </button>
            </div>
          </Card>
    </>
  )
}
