

import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { open as chooseFile, save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { useNavigate } from 'react-router-dom'
import type { DatabaseBackup } from '../../lib/ipc'
import type { Conversation } from '@bob-work/shared-types'
import { importConversations, importConversationsFromBackup, exportConversations, openDataDir, exportDiagnostics, purgeAppCache, createDatabaseBackup, restoreDatabaseBackup, exportDatabaseBackup, listDatabaseBackups, getConversations, getArchivedConversations, updateConversation, deleteConversation, requestNotificationAuthorization, openMacosPrivacyPane, requestVoiceDictationPermission, requestMicrophonePermission, requestChromeAutomationPermission, requestAccessibilityPermission } from '../../lib/ipc'
import { useI18n, useT } from '../../i18n'
import { databaseBackupKind, formatDatabaseBackupDate } from '../../lib/databaseBackups'
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
  const { locale } = useI18n()
  const loadingLabel = t('common.loading')
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([])
  const [archivesLoading, setArchivesLoading] = useState(true)
  const [archivesError, setArchivesError] = useState<string | null>(null)
  const [deletingAllConversations, setDeletingAllConversations] = useState(false)

  const loadArchives = useCallback(async () => {
    setArchivesLoading(true)
    try {
      setArchivedConversations(await getArchivedConversations())
      setArchivesError(null)
    } catch (error) {
      setArchivesError(errorMessage(error, t('settings.archivedConversationsLoadError')))
    } finally {
      setArchivesLoading(false)
    }
  }, [t])

  useEffect(() => { void loadArchives() }, [loadArchives])

  return (
    <>
      <Heading title={t('settings.localDataHeading')} description={t('settings.localDataDesc')} />
          <Card title={t('settings.archivedConversationsHeading')}>
            <p className="settings-note">{t('settings.archivedConversationsDesc')}</p>
            {archivesLoading && <SectionLoader label={loadingLabel} />}
            {archivesError && <LoadErrorBanner error={archivesError} onRetry={() => void loadArchives()} />}
            {!archivesLoading && !archivesError && archivedConversations.length === 0 && (
              <p className="settings-note">{t('settings.archivedConversationsEmpty')}</p>
            )}
            {archivedConversations.length > 0 && <div className="settings-list">
              {archivedConversations.map(conversation => <div className="settings-list-row" key={conversation.id}>
                <div>
                  <strong>{conversation.title}</strong>
                  <small>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(conversation.date))}</small>
                </div>
                <div className="settings-actions">
                  <button className="secondary-btn" onClick={async () => {
                    try {
                      await updateConversation(conversation.id, { archived: false })
                      setArchivedConversations(current => current.filter(item => item.id !== conversation.id))
                      showTransientStatus(t('settings.conversationRestored'))
                    } catch (error) {
                      setArchivesError(errorMessage(error, t('settings.conversationRestoreError')))
                    }
                  }}>{t('settings.restoreConversation')}</button>
                  <button className="danger-link" aria-label={t('settings.deleteArchivedConversationLabel', { name: conversation.title })} onClick={async () => {
                    const confirmed = await dialog.confirm({
                      message: t('settings.deleteArchivedConversationConfirm', { name: conversation.title }),
                      confirmLabel: t('common.delete'),
                      destructive: true,
                    })
                    if (!confirmed) return
                    try {
                      await deleteConversation(conversation.id)
                      setArchivedConversations(current => current.filter(item => item.id !== conversation.id))
                      showTransientStatus(t('settings.archivedConversationDeleted'))
                    } catch (error) {
                      setArchivesError(errorMessage(error, t('settings.archivedConversationDeleteError')))
                    }
                  }}>{t('common.delete')}</button>
                </div>
              </div>)}
            </div>}
          </Card>
          <Card title={t('settings.deleteAllConversationsHeading')}>
            <p className="settings-note">{t('settings.deleteAllConversationsDesc')}</p>
            <div className="settings-actions">
              <button
                type="button"
                className="danger-btn"
                disabled={deletingAllConversations}
                aria-busy={deletingAllConversations}
                onClick={() => {
                  void (async () => {
                    const confirmed = await dialog.confirm({
                      message: t('settings.deleteAllConversationsConfirm'),
                      confirmLabel: t('settings.deleteAllConversations'),
                      destructive: true,
                    })
                    if (!confirmed) return
                    setDeletingAllConversations(true)
                    try {
                      const [active, archived] = await Promise.all([
                        getConversations(),
                        getArchivedConversations(),
                      ])
                      const ids = Array.from(
                        new Set([...active, ...archived].map(conversation => conversation.id)),
                      )
                      for (const id of ids) {
                        await deleteConversation(id)
                      }
                      setArchivedConversations([])
                      showTransientStatus(
                        t('settings.deleteAllConversationsDone', { count: ids.length }),
                      )
                      if (ids.length > 0) {
                        navigate('/chat', { replace: true })
                      }
                    } catch (error) {
                      setStatus(errorMessage(error, t('settings.deleteAllConversationsError')))
                    } finally {
                      setDeletingAllConversations(false)
                      void loadArchives()
                    }
                  })()
                }}
              >
                {deletingAllConversations
                  ? t('common.loading')
                  : t('settings.deleteAllConversations')}
              </button>
            </div>
          </Card>
          <Card>
            <SelectRow
              title={t('settings.exportFormat')}
              description={t('settings.exportFormatDesc')}
              value={exportFormat}
              onChange={value => setExportFormat(value as typeof exportFormat)}
            >
                  <option value="chatgpt">{t('settings.exportFormatChatGpt')}</option>
                  <option value="claude-cowork">{t('settings.exportFormatClaude')}</option>
                  <option value="bob-work-export-v1">{t('settings.exportFormatBobWork')}</option>
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
                    ? 'OpenAI export'
                    : exportFormat === 'claude-cowork'
                      ? 'Anthropic export'
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
              <button className="secondary-btn" onClick={async () => {
                try {
                  const path = await chooseFile({
                    multiple: false,
                    directory: false,
                    filters: [{ name: 'Bob Work backup', extensions: ['sqlite'] }],
                  })
                  if (typeof path !== 'string') return
                  const result = await importConversationsFromBackup(path)
                  setStatus(t('settings.importBackupComplete', {
                    conversations: result.conversations,
                    messages: result.messages,
                    skipped: result.skipped,
                    name: result.detectedFormat,
                  }))
                } catch (error) {
                  setStatus(errorMessage(error))
                }
              }}>{t('settings.importBackup')}</button>
            </div>
            {databaseBackups.length > 0 && <div className="settings-list">
              {databaseBackups.map((backup: DatabaseBackup) => {
                const kind = databaseBackupKind(backup.name)
                const label = kind === 'automatic'
                  ? t('settings.backupAutomatic')
                  : kind === 'manual'
                    ? t('settings.backupManual')
                    : backup.name
                const createdLabel = formatDatabaseBackupDate(backup.createdAt, locale)
                return <div className="settings-list-row" key={backup.name}>
                <div>
                  <strong>{label}</strong>
                  <small>{createdLabel} · {(backup.sizeBytes / (1024 * 1024)).toFixed(1)} MB</small>
                </div>
                <div className="settings-actions">
                  <button className="secondary-btn compact" onClick={async () => {
                    try {
                      const path = await chooseSavePath({
                        defaultPath: backup.name,
                        filters: [{ name: 'SQLite backup', extensions: ['sqlite'] }],
                      })
                      if (!path) return
                      await exportDatabaseBackup(backup.name, path)
                      setStatus(t('settings.backupDownloaded', { path }))
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  }}>{t('settings.downloadBackup')}</button>
                  <button className="secondary-btn compact" onClick={async () => {
                    if (!await dialog.confirm({ message: t('settings.restoreConfirm', { name: backup.name }), confirmLabel: t('settings.restoreBackup'), destructive: true })) return
                    try {
                      await restoreDatabaseBackup(backup.name)
                      await relaunch()
                    } catch (error) {
                      setStatus(errorMessage(error))
                    }
                  }}>{t('settings.restoreBackup')}</button>
                </div>
              </div>
              })}
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
