import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { RemoteControlStatus } from '../../lib/ipc'
import { getRemoteControlStatus, restartRemoteControl } from '../../lib/ipc'
import { errorMessage } from '../../lib/errorMessage'
import { Card, Heading, SettingsFields, ToggleRow } from './SettingsShared'

export default function RemoteSettingsTab(props: any) {
  const { t, settings, change } = props
  const [status, setStatus] = useState<RemoteControlStatus | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getRemoteControlStatus().then(setStatus).catch(error => {
      setStatus({ enabled: true, state: 'error', error: errorMessage(error) })
    })
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen<RemoteControlStatus>('remote-control-status', event => {
      if (!disposed) setStatus(event.payload)
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const copyLink = async () => {
    if (!status?.connectionUrl) return
    await navigator.clipboard.writeText(status.connectionUrl)
    setCopyDone(true)
    window.setTimeout(() => setCopyDone(false), 1800)
  }

  const restart = async () => {
    setBusy(true)
    try {
      setStatus(await restartRemoteControl())
    } catch (error) {
      setStatus({ enabled: true, state: 'error', error: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const stateLabel = status?.state === 'ready'
    ? t('settings.remoteReady')
    : status?.state === 'starting'
      ? t('settings.remoteStarting')
      : status?.state === 'error'
        ? t('settings.remoteError')
        : t('settings.remoteDisabled')

  return (
    <>
      <Heading title={t('settings.remoteHeading')} description={t('settings.remoteDesc')} />
      <Card>
        <SettingsFields settings={settings} error={null} loadingLabel={t('common.loading')}>
          {(value: any) => (
            <ToggleRow
              title={t('settings.remoteEnable')}
              description={t('settings.remoteEnableDesc')}
              value={value.remoteControlEnabled}
              onChange={enabled => change('remoteControlEnabled', enabled)}
            />
          )}
        </SettingsFields>
        {settings?.remoteControlEnabled && (
          <div className="remote-control-panel">
            <div className={`remote-control-state ${status?.state ?? 'starting'}`}>
              <span aria-hidden="true" />
              <strong>{stateLabel}</strong>
            </div>
            {status?.connectionUrl && (
              <div className="remote-control-link-row">
                <code>{status.connectionUrl}</code>
                <button className="btn btn-primary" onClick={copyLink}>
                  {copyDone ? t('settings.remoteCopied') : t('settings.remoteCopy')}
                </button>
              </div>
            )}
            {status?.error && <p className="settings-note" role="alert">{status.error}</p>}
            {status?.state === 'error' && (
              <button className="btn btn-secondary" disabled={busy} onClick={restart}>
                {busy ? t('settings.remoteStarting') : t('settings.remoteRetry')}
              </button>
            )}
            <p className="settings-hint">{t('settings.remoteSecurityHint')}</p>
          </div>
        )}
      </Card>
    </>
  )
}
