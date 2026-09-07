import { useCallback, useEffect, useState } from 'react'
import type { RuntimeRecord, RuntimeStorageReport } from '@bob-work/shared-types'
import {
  cancelRuntimeProcess,
  getRuntimeInstallationPlan,
  getRuntimeStorage,
  installExternalRuntime,
  removeExternalRuntime,
} from '../../lib/ipc'
import { useT } from '../../i18n'
import { useAppDialog } from '../../components/AppDialog'
import { errorMessage } from '../../lib/errorMessage'
import { Card } from './SettingsShared'

function formatBytes(value?: number) {
  if (!value) return '0 MB'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit < 2 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}

export function RuntimeStorageCard({ setStatus }: { setStatus: (message: string) => void }) {
  const t = useT()
  const dialog = useAppDialog()
  const [report, setReport] = useState<RuntimeStorageReport | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const runtimeStatus = (status: RuntimeRecord['status']) => {
    switch (status) {
      case 'installing': return t('settings.runtimeStatusInstalling')
      case 'installed': return t('settings.runtimeStatusInstalled')
      case 'updating': return t('settings.runtimeStatusUpdating')
      case 'broken': return t('settings.runtimeStatusBroken')
      case 'removing': return t('settings.runtimeStatusRemoving')
      default: return t('settings.runtimeStatusNotInstalled')
    }
  }
  const pythonMode = (mode: RuntimeRecord['pythonMode']) => {
    switch (mode) {
      case 'shared': return t('settings.runtimePythonShared')
      case 'isolated': return t('settings.runtimePythonIsolated')
      default: return t('settings.runtimePythonNone')
    }
  }
  const runtimeType = (type: RuntimeRecord['runtimeType']) => {
    switch (type) {
      case 'shared': return t('settings.runtimeTypeShared')
      case 'external_managed': return t('settings.runtimeTypeExternalManaged')
      case 'plugin_private': return t('settings.runtimeTypePluginPrivate')
    }
  }

  const refresh = useCallback(async () => {
    try {
      setReport(await getRuntimeStorage())
      setLoadError(false)
    } catch {
      setLoadError(true)
      setStatus(t('settings.runtimeLoadFailed'))
    }
  }, [setStatus, t])

  useEffect(() => { void refresh() }, [refresh])

  const install = async (runtime: RuntimeRecord) => {
    try {
      const plan = await getRuntimeInstallationPlan(runtime.runtimeId)
      if (runtime.management === 'manual') {
        await dialog.alert({
          title: runtime.name,
          message: t('settings.runtimeManualInstructions', { instructions: plan.purpose }),
        })
        return
      }
      const accepted = await dialog.confirm({
        message: t('settings.runtimeInstallConfirm', {
          name: plan.name,
          version: plan.version,
          source: plan.source,
          size: formatBytes(plan.estimatedSizeBytes),
          purpose: plan.purpose,
        }),
        confirmLabel: t('settings.runtimeInstall'),
      })
      if (!accepted) return
      setBusy(runtime.runtimeId)
      await installExternalRuntime(runtime.runtimeId, true)
      setStatus(t('settings.runtimeInstalled', { name: runtime.name }))
      await refresh()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (runtime: RuntimeRecord) => {
    const confirmed = await dialog.confirm({
      message: t('settings.runtimeRemoveConfirm', { name: runtime.name }),
      confirmLabel: t('settings.runtimeRemove'),
      destructive: true,
    })
    if (!confirmed) return
    try {
      setBusy(runtime.runtimeId)
      await removeExternalRuntime(runtime.runtimeId, true)
      setStatus(t('settings.runtimeRemoved', { name: runtime.name }))
      await refresh()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const cancelProcess = async (processId: string) => {
    try {
      setBusy(processId)
      await cancelRuntimeProcess(processId)
      setStatus(t('settings.runtimeProcessCancelled'))
      await refresh()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title={t('settings.runtimeCatalogHeading')}>
      <div className="runtime-catalog-toolbar">
        <p className="settings-note">{t('settings.runtimeCatalogDesc')}</p>
        <button className="secondary-btn" disabled={busy !== null} onClick={() => void refresh()}>
          {t('settings.runtimeRefresh')}
        </button>
      </div>
      {!report && !loadError && <div className="settings-section-loader" role="status"><span className="task-spinner" aria-hidden="true" />{t('common.loading')}</div>}
      {!report && loadError && <div className="runtime-load-error" role="alert"><span>{t('settings.runtimeLoadFailed')}</span><button className="secondary-btn" onClick={() => void refresh()}>{t('settings.runtimeRetry')}</button></div>}
      {report && <>
        <div className="runtime-storage-summary">
          <span>{t('settings.runtimeCore')}<strong>{formatBytes(report.coreBytes)}</strong></span>
          <span>{t('settings.runtimeShared')}<strong>{formatBytes(report.sharedBytes)}</strong></span>
          <span>{t('settings.runtimeExternal')}<strong>{formatBytes(report.externalBytes)}</strong></span>
          <span>{t('settings.runtimePrivate')}<strong>{formatBytes(report.privateBytes)}</strong></span>
          <span>{t('settings.runtimeArtifacts')}<strong>{formatBytes(report.artifactBytes)}</strong></span>
          <span>{t('settings.runtimeCache')}<strong>{formatBytes(report.cacheBytes)}</strong></span>
          <span>{t('settings.runtimeActiveProcesses')}<strong>{report.activeProcesses.length}</strong></span>
        </div>
        {report.activeProcesses.length > 0 && <div className="settings-list runtime-process-list">
          {report.activeProcesses.map(process => <div className="settings-list-row" key={process.processId}>
            <div>
              <strong>{process.executableName}</strong>
              <small>{t('settings.runtimeProcessDetails', {
                runtime: process.runtimeId,
                plugin: process.pluginId,
                timeout: process.timeoutSeconds,
              })}</small>
            </div>
            <button className="danger-link" disabled={busy === process.processId} onClick={() => void cancelProcess(process.processId)}>
              {t('settings.runtimeProcessCancel')}
            </button>
          </div>)}
        </div>}
        <div className="settings-list runtime-list">
          {report.runtimes.map(runtime => <div className="settings-list-row" key={runtime.runtimeId}>
            <div className="runtime-details">
              <div className="runtime-title-line">
                <strong>{runtime.name}</strong>
                <span className={`runtime-status runtime-status--${runtime.status}`}>{runtimeStatus(runtime.status)}</span>
              </div>
              <small>
                {runtimeType(runtime.runtimeType)}{' · '}{runtime.installedVersion && runtime.installedVersion !== runtime.version
                  ? t('settings.runtimeVersionUpdate', { installed: runtime.installedVersion, available: runtime.version })
                  : runtime.version}{' · '}{formatBytes(runtime.sizeBytes)}{' · '}
                {runtime.platform}
              </small>
              <small>{t('settings.runtimePythonMode', { mode: pythonMode(runtime.pythonMode) })}</small>
              <small>{runtime.consumers.length
                ? t('settings.runtimeConsumers', { consumers: runtime.consumers.join(', ') })
                : t('settings.runtimeUnused')}</small>
              {runtime.error && <small className="runtime-error">{runtime.error}</small>}
            </div>
            <div className="runtime-actions">
              {runtime.runtimeType === 'external_managed' && runtime.management !== 'manual' &&
                (runtime.status !== 'installed' || runtime.installedVersion !== runtime.version) &&
                <button className="secondary-btn" disabled={busy === runtime.runtimeId} onClick={() => void install(runtime)}>
                  {runtime.status === 'installed' ? t('settings.runtimeUpdate') : t('settings.runtimeInstall')}
                </button>}
              {runtime.runtimeType === 'external_managed' && runtime.management !== 'manual' && runtime.status === 'installed' && runtime.removable &&
                <button className="danger-link" disabled={busy === runtime.runtimeId} onClick={() => void remove(runtime)}>
                  {t('settings.runtimeRemove')}
                </button>}
              {runtime.runtimeType !== 'external_managed' && <small className="runtime-managed-label">
                {runtime.runtimeType === 'shared' ? t('settings.runtimeManagedByBob') : t('settings.runtimeManagedByPlugin')}
              </small>}
              {runtime.management === 'manual' && <button className="secondary-btn" disabled={busy !== null} onClick={() => void install(runtime)}>
                {t('settings.runtimeManualAction')}
              </button>}
            </div>
          </div>)}
          {report.runtimes.length === 0 && <p className="settings-note runtime-empty">{t('settings.runtimeEmpty')}</p>}
        </div>
      </>}
    </Card>
  )
}
