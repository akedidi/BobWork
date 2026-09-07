import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { RemoteControlStatus } from '../../lib/ipc'
import { getMcpServers, getRemoteControlStatus, testMcpServer } from '../../lib/ipc'
import type { McpServer } from '@bob-work/shared-types'
import { errorMessage } from '../../lib/errorMessage'
import { Card, Heading, SettingsFields, ToggleRow } from './SettingsShared'

function preferRemoteStatus(
  toggleOn: boolean,
  current: RemoteControlStatus | null,
  next: RemoteControlStatus,
): RemoteControlStatus {
  if (!toggleOn) {
    return {
      enabled: false,
      state: 'disabled',
      connectionUrl: null,
      publicUrl: null,
      error: null,
    }
  }
  if (!next.enabled || next.state === 'disabled') {
    return current?.connectionUrl
      ? current
      : {
          enabled: true,
          state: 'starting',
          connectionUrl: null,
          publicUrl: null,
          error: current?.error ?? null,
        }
  }
  if (next.connectionUrl) return next
  if (current?.connectionUrl) {
    return {
      ...next,
      connectionUrl: current.connectionUrl,
      publicUrl: next.publicUrl ?? current.publicUrl,
      state: next.state === 'starting' ? current.state : next.state,
    }
  }
  return next
}

export default function RemoteSettingsTab(props: any) {
  const { t, settings, change } = props
  const [status, setStatus] = useState<RemoteControlStatus | null>(null)
  const [copyDone, setCopyDone] = useState(false)
  const enabled = Boolean(settings?.remoteControlEnabled)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const statusRef = useRef(status)
  statusRef.current = status

  const applyStatus = (next: RemoteControlStatus) => {
    setStatus(current => preferRemoteStatus(enabledRef.current, current, next))
  }

  useEffect(() => {
    if (!enabled) {
      setStatus({ enabled: false, state: 'disabled', connectionUrl: null, publicUrl: null, error: null })
      return
    }
    let disposed = false
    const load = () => {
      void getRemoteControlStatus().then(next => {
        if (!disposed) applyStatus(next)
      }).catch(error => {
        if (!disposed) applyStatus({ enabled: true, state: 'error', error: errorMessage(error) })
      })
    }
    setStatus(current => current?.connectionUrl ? current : {
      enabled: true,
      state: 'starting',
      connectionUrl: null,
      publicUrl: null,
      error: null,
    })
    load()
    let unlisten: (() => void) | undefined
    void listen<RemoteControlStatus>('remote-control-status', event => {
      if (!disposed && event.payload) applyStatus(event.payload)
    }).then(stopListen => {
      if (disposed) stopListen()
      else unlisten = stopListen
    })
    const poll = window.setInterval(load, 700)
    return () => {
      disposed = true
      unlisten?.()
      window.clearInterval(poll)
    }
  }, [enabled])

  const copyLink = async () => {
    if (!status?.connectionUrl) return
    await navigator.clipboard.writeText(status.connectionUrl)
    setCopyDone(true)
    window.setTimeout(() => setCopyDone(false), 1800)
  }

  const toggle = (on: boolean) => {
    change('remoteControlEnabled', on)
    setStatus(on
      ? { enabled: true, state: 'starting', connectionUrl: null, publicUrl: null, error: null }
      : { enabled: false, state: 'disabled', connectionUrl: null, publicUrl: null, error: null })
  }

  const waiting = enabled && status?.state !== 'ready' && !status?.error

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
              onChange={toggle}
            />
          )}
        </SettingsFields>
        {enabled && (
          <div className="remote-control-panel">
            {waiting && (
              <div className="remote-control-wait" role="status" aria-busy="true">
                <span className="task-spinner" aria-hidden="true" />
              </div>
            )}
            {status?.state === 'ready' && status.connectionUrl && (
              <div className="remote-control-link-row">
                <code
                  className="remote-control-link"
                  title={status.connectionUrl}
                  aria-label={t('settings.remoteLink')}
                  tabIndex={0}
                >
                  {status.connectionUrl}
                </code>
                <button className="btn btn-primary" onClick={copyLink}>
                  {copyDone ? t('settings.remoteCopied') : t('settings.remoteCopy')}
                </button>
              </div>
            )}
            {status?.error && <p className="settings-note" role="alert">{status.error}</p>}
          </div>
        )}
      </Card>
      <McpGatewaySettings settings={settings} change={change} t={t} />
    </>
  )
}

function McpGatewaySettings({ settings, change, t }: any) {
  const enabled = Boolean(settings?.mcpGatewayEnabled)
  const selected = new Set<string>(settings?.mcpGatewayTools ?? [])
  const [servers, setServers] = useState<McpServer[]>([])
  const [tools, setTools] = useState<Record<string, string[]>>({})
  const [gatewayStatus, setGatewayStatus] = useState<RemoteControlStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let disposed = false
    setLoading(true)
    void getMcpServers().then(async all => {
      const local = all.filter(server => server.enabled && !['http','sse','streamable-http','streamable_http'].includes(server.transport))
      if (!disposed) setServers(local)
      const results = await Promise.all(local.map(async server => [server.name, (await testMcpServer(server.name)).tools] as const).map(promise => promise.catch(() => null)))
      if (!disposed) setTools(Object.fromEntries(results.filter((value): value is readonly [string,string[]] => Boolean(value))))
    }).catch(() => undefined).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    if (!enabled) { setGatewayStatus(null); return }
    let disposed = false
    const refresh = () => void getRemoteControlStatus().then(value => { if (!disposed) setGatewayStatus(value) }).catch(() => undefined)
    refresh(); const timer = window.setInterval(refresh, 900)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [enabled])

  const updateTool = (qualified: string, checked: boolean) => {
    const next = new Set(selected); if (checked) next.add(qualified); else next.delete(qualified)
    change('mcpGatewayTools', [...next].sort())
  }
  const publicUrl = gatewayStatus?.publicUrl ? `${gatewayStatus.publicUrl}/mcp` : ''
  const token = gatewayStatus?.connectionUrl?.split('#token=')[1] ?? ''
  const copy = async (kind: 'url'|'token', value: string) => { await navigator.clipboard.writeText(value); setCopied(kind); window.setTimeout(()=>setCopied(''), 1600) }

  return <Card title={t('settings.mcpGatewayHeading')}>
    <ToggleRow title={t('settings.mcpGatewayEnable')} description={t('settings.mcpGatewayDesc')} value={enabled} disabled={Boolean(settings?.sandboxMode) && !enabled} onChange={(value)=>change('mcpGatewayEnabled', value)} />
    {settings?.sandboxMode && <p className="settings-note">{t('settings.mcpGatewaySandbox')}</p>}
    <div className="mcp-gateway-tools">
      <strong>{t('settings.mcpGatewayAllowlist')}</strong>
      <p>{t('settings.mcpGatewayAllowlistHint')}</p>
      {loading && <span className="settings-row-loader"><span className="task-spinner" />{t('common.loading')}</span>}
      {!loading && servers.length === 0 && <p className="settings-note">{t('settings.mcpGatewayEmpty')}</p>}
      {servers.map(server => <div key={server.name} className="mcp-gateway-server"><b>{server.name}</b>{(tools[server.name] ?? []).map(tool => { const id=`${server.name}::${tool}`; const sensitive=/computer|desktop|chrome|ssh|write|delete|execute|command/i.test(`${server.name} ${tool}`); return <label key={id}><input type="checkbox" checked={selected.has(id)} onChange={event=>updateTool(id,event.target.checked)}/><span>{tool}{sensitive && <small>{t('settings.mcpGatewaySensitive')}</small>}</span></label> })}</div>)}
    </div>
    {enabled && <div className="mcp-gateway-connection">
      {!publicUrl && <span className="settings-row-loader"><span className="task-spinner" />{t('settings.remoteStarting')}</span>}
      {publicUrl && <><label>{t('settings.mcpGatewayUrl')}<span><code>{publicUrl}</code><button className="secondary-btn" onClick={()=>void copy('url',publicUrl)}>{copied==='url'?t('settings.remoteCopied'):t('settings.remoteCopy')}</button></span></label><label>{t('settings.mcpGatewayToken')}<span><code>{token ? '••••••••••••••••' : ''}</code><button className="secondary-btn" disabled={!token} onClick={()=>void copy('token',token)}>{copied==='token'?t('settings.remoteCopied'):t('settings.remoteCopy')}</button></span></label></>}
    </div>}
  </Card>
}
