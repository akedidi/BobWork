import { useCallback, useEffect, useState } from 'react'
import type { RuntimeRecord, RuntimeStorageReport } from '@bob-work/shared-types'
import { Square } from 'lucide-react'
import {
  cancelRuntimeOperation,
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

const RUNTIME_POLL_INTERVAL_MS = 5_000

type BusyAction = 'install' | 'update' | 'remove' | 'cancel'
type BusyState = { id: string; action: BusyAction } | null
type RuntimeWorkingAction = Exclude<BusyAction, 'cancel'>

function workingActionFor(
  runtime: RuntimeRecord,
  busy: BusyState,
  pendingRemoves: Set<string>,
): RuntimeWorkingAction | null {
  if (runtime.status === 'installing') return 'install'
  if (runtime.status === 'updating') return 'update'
  if (runtime.status === 'removing' || pendingRemoves.has(runtime.runtimeId)) return 'remove'
  if (busy?.id !== runtime.runtimeId || busy.action === 'cancel') return null
  return busy.action
}

function displayStatusFor(runtime: RuntimeRecord, working: RuntimeWorkingAction | null): RuntimeRecord['status'] {
  if (working === 'install') return 'installing'
  if (working === 'update') return 'updating'
  if (working === 'remove') return 'removing'
  return runtime.status
}

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

function runtimeMatchesQuery(runtime: RuntimeRecord, needle: string) {
  if (!needle) return true
  const haystack = [
    runtime.name,
    runtime.runtimeId,
    runtime.version,
    runtime.installedVersion ?? '',
    runtime.runtimeType,
    runtime.status,
    runtime.platform,
    runtime.pythonMode,
    runtime.error ?? '',
    ...runtime.consumers,
  ]
    .join(' ')
    .toLowerCase()
  return needle.split(/\s+/).filter(Boolean).every(token => haystack.includes(token))
}

export function RuntimeStorageCard({ setStatus }: { setStatus: (message: string) => void }) {
  const t = useT()
  const dialog = useAppDialog()
  const [report, setReport] = useState<RuntimeStorageReport | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<BusyState>(null)
  /** Survives poll races so Install never appears while a delete is still in flight. */
  const [pendingRemoves, setPendingRemoves] = useState<Set<string>>(() => new Set())
  const [searchQuery, setSearchQuery] = useState('')
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

  useEffect(() => {
    const poll = window.setInterval(() => { void refresh() }, RUNTIME_POLL_INTERVAL_MS)
    return () => window.clearInterval(poll)
  }, [refresh])

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
      const action = runtime.status === 'installed' ? 'update' as const : 'install' as const
      setBusy({ id: runtime.runtimeId, action })
      try {
        await installExternalRuntime(runtime.runtimeId, true)
        setStatus(t('settings.runtimeInstalled', { name: runtime.name }))
        await refresh()
      } finally {
        // Keep the row spinner if the backend still reports an in-progress status.
        setBusy(current => (
          current?.id === runtime.runtimeId && current.action === action ? null : current
        ))
      }
    } catch (error) {
      setStatus(errorMessage(error))
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
    setPendingRemoves(current => new Set(current).add(runtime.runtimeId))
    setBusy({ id: runtime.runtimeId, action: 'remove' })
    try {
      await removeExternalRuntime(runtime.runtimeId, true)
      setStatus(t('settings.runtimeRemoved', { name: runtime.name }))
      await refresh()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(current => (
        current?.id === runtime.runtimeId && current.action === 'remove' ? null : current
      ))
      setPendingRemoves(current => {
        if (!current.has(runtime.runtimeId)) return current
        const next = new Set(current)
        next.delete(runtime.runtimeId)
        return next
      })
    }
  }

  const cancelProcess = async (processId: string) => {
    try {
      setBusy({ id: processId, action: 'cancel' })
      await cancelRuntimeProcess(processId)
      setStatus(t('settings.runtimeProcessCancelled'))
      await refresh()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const stopOperation = async (runtime: RuntimeRecord) => {
    try {
      const cancelled = await cancelRuntimeOperation(runtime.runtimeId)
      if (cancelled) {
        setStatus(t('settings.runtimeInstallStopped', { name: runtime.name }))
      }
      await refresh()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(current => (
        current?.id === runtime.runtimeId
          && (current.action === 'install' || current.action === 'update')
          ? null
          : current
      ))
    }
  }

  const needle = searchQuery.trim().toLowerCase()
  const filteredRuntimes = report
    ? report.runtimes.filter(runtime => runtimeMatchesQuery(runtime, needle))
    : []
  const activeWork = report
    ? report.runtimes
      .map(runtime => ({ runtime, action: workingActionFor(runtime, busy, pendingRemoves) }))
      .find(item => item.action)
    : undefined
  const activeWorkLabel = activeWork?.action === 'install'
    ? t('settings.runtimeProgressInstall')
    : activeWork?.action === 'update'
      ? t('settings.runtimeProgressUpdate')
      : activeWork?.action === 'remove'
        ? t('settings.runtimeProgressRemove')
        : null

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
        <div className="runtime-catalog-search">
          <input
            type="search"
            className="runtime-search-input"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder={t('settings.runtimeSearchPlaceholder')}
            aria-label={t('settings.runtimeSearchPlaceholder')}
            autoComplete="off"
          />
        </div>
        {activeWork && activeWorkLabel && (
          <div className="settings-install-busy runtime-catalog-busy" role="status" aria-live="polite">
            <span className="task-spinner" aria-hidden="true" />
            <span>
              <strong>{activeWork.runtime.name}</strong>
              {' — '}
              {activeWorkLabel}
            </span>
          </div>
        )}
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
            <button
              className="danger-link"
              disabled={busy !== null}
              aria-busy={busy?.id === process.processId}
              onClick={() => void cancelProcess(process.processId)}
            >
              {busy?.id === process.processId
                ? <><span className="task-spinner" aria-hidden="true" />{t('settings.runtimeProcessCancel')}</>
                : t('settings.runtimeProcessCancel')}
            </button>
          </div>)}
        </div>}
        <div className="settings-list runtime-list">
          {filteredRuntimes.map(runtime => {
            const working = workingActionFor(runtime, busy, pendingRemoves)
            const displayStatus = displayStatusFor(runtime, working)
            const progressLabel = working === 'install'
              ? t('settings.runtimeProgressInstall')
              : working === 'update'
                ? t('settings.runtimeProgressUpdate')
                : working === 'remove'
                  ? t('settings.runtimeProgressRemove')
                  : null
            return <div
              className="settings-list-row"
              key={runtime.runtimeId}
              aria-busy={Boolean(working)}
            >
            <div className="runtime-details">
              <div className="runtime-title-line">
                <strong>{runtime.name}</strong>
                <span className={`runtime-status runtime-status--${displayStatus}`}>
                  {working && <span className="task-spinner" aria-hidden="true" />}
                  {runtimeStatus(displayStatus)}
                </span>
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
              {runtime.runtimeType === 'external_managed'
                && runtime.status === 'installed'
                && !runtime.removable
                && <small>{t('settings.runtimeSystemInstall')}</small>}
              {runtime.error && <small className="runtime-error">{runtime.error}</small>}
              {progressLabel && (
                <div className="settings-install-busy" role="status" aria-live="polite">
                  <span className="task-spinner" aria-hidden="true" />
                  {progressLabel}
                </div>
              )}
            </div>
            <div className="runtime-actions">
              {runtime.runtimeType === 'external_managed' && runtime.management !== 'manual' && (
                working === 'install' || working === 'update' ? (
                  <>
                    <button className="secondary-btn" disabled aria-busy>
                      <span className="task-spinner" aria-hidden="true" />
                      {working === 'update' ? t('settings.runtimeStatusUpdating') : t('settings.runtimeStatusInstalling')}
                    </button>
                    <button
                      type="button"
                      className="icon-btn runtime-stop-btn"
                      aria-label={t('settings.runtimeInstallStop')}
                      title={t('settings.runtimeInstallStop')}
                      onClick={() => void stopOperation(runtime)}
                    >
                      <Square size={12} fill="currentColor" aria-hidden="true" />
                    </button>
                  </>
                ) : working === 'remove' ? (
                  <button className="danger-link" disabled aria-busy>
                    <span className="task-spinner" aria-hidden="true" />
                    {t('settings.runtimeStatusRemoving')}
                  </button>
                ) : (
                  <>
                    {(runtime.status !== 'installed' || runtime.installedVersion !== runtime.version) && (
                      <button className="secondary-btn" disabled={busy !== null} onClick={() => void install(runtime)}>
                        {runtime.status === 'installed' ? t('settings.runtimeUpdate') : t('settings.runtimeInstall')}
                      </button>
                    )}
                    {runtime.status === 'installed' && runtime.removable && (
                      <button className="danger-link" disabled={busy !== null} onClick={() => void remove(runtime)}>
                        {t('settings.runtimeRemove')}
                      </button>
                    )}
                  </>
                )
              )}
              {runtime.runtimeType !== 'external_managed' && <small className="runtime-managed-label">
                {runtime.runtimeType === 'shared' ? t('settings.runtimeManagedByBob') : t('settings.runtimeManagedByPlugin')}
              </small>}
              {runtime.management === 'manual' && !working && <button className="secondary-btn" disabled={busy !== null} onClick={() => void install(runtime)}>
                {t('settings.runtimeManualAction')}
              </button>}
            </div>
          </div>})}
          {filteredRuntimes.length === 0 && <p className="settings-note runtime-empty">
            {report.runtimes.length === 0
              ? t('settings.runtimeEmpty')
              : t('settings.runtimeSearchEmpty')}
          </p>}
        </div>
      </>}
    </Card>
  )
}
