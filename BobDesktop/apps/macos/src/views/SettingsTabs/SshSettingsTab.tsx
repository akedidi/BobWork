import { useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Folder, File, Server, TerminalSquare, RefreshCw, Download, Upload, Trash2, Plus } from 'lucide-react'
import type { SshRemoteEntry, SshServer } from '@bob-work/shared-types'
import { browseSshDirectory, deleteSshServer, getSshServers, saveSshServer, sshRead, startSshTerminal, stopSshTerminal, syncSshWorkspace, testSshServer, writeSshTerminal } from '../../lib/ipc'
import { errorMessage } from '../../lib/errorMessage'
import { Card, Heading } from './SettingsShared'
import '@xterm/xterm/css/xterm.css'

type FormState = { id?: string; name: string; host: string; port: string; user: string; identityFile: string; remoteRoot: string }
const EMPTY: FormState = { name: '', host: '', port: '22', user: '', identityFile: '', remoteRoot: '/home' }

export default function SshSettingsTab({ t }: { t: (key: any, params?: Record<string, string | number>) => string }) {
  const [servers, setServers] = useState<SshServer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<SshRemoteEntry[]>([])
  const [filePreview, setFilePreview] = useState<{ path: string; content: string } | null>(null)
  const terminalHost = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<any>(null)
  const fitRef = useRef<any>(null)
  const selected = useMemo(() => servers.find(item => item.id === selectedId) ?? null, [servers, selectedId])

  const load = async () => {
    const next = await getSshServers()
    setServers(next)
    setSelectedId(current => next.some(s => s.id === current) ? current : (next[0]?.id ?? ''))
  }

  useEffect(() => { void load().catch(error => setStatus(errorMessage(error))) }, [])

  useEffect(() => {
    let disposed = false
    let cleanup = async () => {}
    if (!terminalHost.current || !selectedId || !selected) return
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(async ([xterm, fit]) => {
      if (disposed || !terminalHost.current) return
      const terminal = new xterm.Terminal({ convertEol: true, cursorBlink: true, fontSize: 12, fontFamily: 'SFMono-Regular, Menlo, monospace', theme: { background: '#080c14', foreground: '#dbe5f5', cursor: '#78a9ff' } })
      const addon = new fit.FitAddon()
      terminal.loadAddon(addon); terminal.open(terminalHost.current); addon.fit()
      terminalRef.current = terminal; fitRef.current = addon
      terminal.writeln('Bob Work SSH — OpenSSH sécurisé\r\n')
      let sessionId: string = crypto.randomUUID()
      const unlisten = await listen<{ sessionId: string; data: string; stream: string }>('ssh-terminal-output', event => { if (event.payload.sessionId === sessionId) terminal.write(event.payload.stream === 'stderr' ? `\x1b[31m${event.payload.data}\x1b[0m` : event.payload.data) })
      try { await startSshTerminal(selectedId, sessionId) } catch (error) { sessionId = ''; terminal.writeln(`\x1b[31m${errorMessage(error)}\x1b[0m`) }
      if (disposed) { unlisten(); if (sessionId) await stopSshTerminal(sessionId).catch(()=>undefined); terminal.dispose(); return }
      const input = terminal.onData(data => { if (sessionId) void writeSshTerminal(sessionId, data).catch(error => terminal.writeln(`\r\n\x1b[31m${errorMessage(error)}\x1b[0m`)) })
      const resize = new ResizeObserver(() => addon.fit()); resize.observe(terminalHost.current)
      cleanup = async () => { input.dispose(); resize.disconnect(); unlisten(); if (sessionId) await stopSshTerminal(sessionId).catch(()=>undefined); terminal.dispose(); terminalRef.current = null }
    })
    return () => { disposed = true; void cleanup() }
  }, [selectedId, selected])

  const browse = async (nextPath = path) => {
    if (!selectedId) return
    setBusy('browse'); setFilePreview(null)
    try { setEntries(await browseSshDirectory(selectedId, nextPath)); setPath(nextPath) }
    catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy('') }
  }
  useEffect(() => { if (selectedId) void browse('') }, [selectedId])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('save')
    try {
      const saved = await saveSshServer({ id: form.id, name: form.name, host: form.host, port: Number(form.port) || 22, user: form.user, identityFile: form.identityFile || undefined, remoteRoot: form.remoteRoot, enabled: true })
      await load(); setSelectedId(saved.id); setEditing(false); setForm(EMPTY); setStatus(t('settings.sshSaved'))
    } catch (error) { setStatus(errorMessage(error)) } finally { setBusy('') }
  }

  const runTest = async (id: string) => {
    setBusy(`test:${id}`)
    try { const result = await testSshServer(id); setStatus(result.exitCode === 0 ? t('settings.sshTestOk') : (result.stderr || t('settings.sshTestFailed'))) }
    catch (error) { setStatus(errorMessage(error)) } finally { setBusy('') }
  }

  const sync = async (direction: 'pull' | 'push') => {
    if (!selected) return
    setBusy(`sync:${direction}`)
    try { const result = await syncSshWorkspace(selected.id, direction); setStatus(t(direction === 'pull' ? 'settings.sshPullDone' : 'settings.sshPushDone', { path: result.localPath })) }
    catch (error) { setStatus(errorMessage(error)) } finally { setBusy('') }
  }

  return <>
    <Heading title={t('settings.sshHeading')} description={t('settings.sshDesc')} />
    <Card>
      <div className="ssh-heading-row"><strong>{t('settings.sshServers')}</strong><button className="secondary-btn" onClick={() => { setForm(EMPTY); setEditing(true) }}><Plus size={14}/>{t('settings.sshAdd')}</button></div>
      {servers.length === 0 && !editing && <p className="settings-note">{t('settings.sshEmpty')}</p>}
      <div className="ssh-server-list">{servers.map(item => <div key={item.id} role="button" tabIndex={0} className={`ssh-server-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setSelectedId(item.id) }}>
        <Server size={17}/><span><strong>{item.name}</strong><small>{item.user}@{item.host}:{item.port} · {item.remoteRoot}</small></span>
        <span className="ssh-row-actions"><button type="button" onClick={event => { event.stopPropagation(); void runTest(item.id) }}>{busy === `test:${item.id}` ? '…' : t('common.test')}</button><button type="button" aria-label={t('common.edit')} onClick={event => { event.stopPropagation(); setForm({ id:item.id,name:item.name,host:item.host,port:String(item.port),user:item.user,identityFile:item.identityFile ?? '',remoteRoot:item.remoteRoot }); setEditing(true) }}>✎</button><button type="button" aria-label={t('common.delete')} onClick={event => { event.stopPropagation(); if (window.confirm(t('settings.sshDeleteConfirm'))) void deleteSshServer(item.id).then(load).catch(error => setStatus(errorMessage(error))) }}><Trash2 size={13}/></button></span>
      </div>)}</div>
      {editing && <form className="ssh-form" onSubmit={submit}>
        <label>{t('settings.sshName')}<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>{t('settings.sshHost')}<input required value={form.host} onChange={e=>setForm({...form,host:e.target.value})}/></label>
        <label>{t('settings.sshPort')}<input required type="number" min="1" max="65535" value={form.port} onChange={e=>setForm({...form,port:e.target.value})}/></label>
        <label>{t('settings.sshUser')}<input required value={form.user} onChange={e=>setForm({...form,user:e.target.value})}/></label>
        <label className="wide">{t('settings.sshKey')}<input placeholder="~/.ssh/id_ed25519" value={form.identityFile} onChange={e=>setForm({...form,identityFile:e.target.value})}/></label>
        <label className="wide">{t('settings.sshRoot')}<input required value={form.remoteRoot} onChange={e=>setForm({...form,remoteRoot:e.target.value})}/></label>
        <p className="ssh-security-note wide">{t('settings.sshSecurity')}</p>
        <div className="ssh-form-actions wide"><button type="button" className="secondary-btn" onClick={()=>setEditing(false)}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={busy==='save'}>{busy==='save' ? '…' : t('common.save')}</button></div>
      </form>}
    </Card>
    {selected && <Card>
      <div className="ssh-workspace-toolbar"><strong>{selected.name}</strong><code>{selected.localMirrorPath}</code><button className="secondary-btn" disabled={!!busy} onClick={()=>void sync('pull')}><Download size={14}/>{t('settings.sshPull')}</button><button className="secondary-btn" disabled={!!busy} onClick={()=>void sync('push')}><Upload size={14}/>{t('settings.sshPush')}</button></div>
      <p className="settings-note">{t('settings.sshMirrorHint')}</p>
      <div className="ssh-workspace">
        <section className="ssh-browser"><header><Folder size={15}/><strong>{t('settings.sshFiles')}</strong><button onClick={()=>void browse()} aria-label={t('common.retry')}><RefreshCw size={13}/></button></header><div className="ssh-path"><button disabled={!path} onClick={()=>void browse(path.split('/').slice(0,-1).join('/'))}>..</button><code>/{path}</code></div><div className="ssh-entries">{entries.map(entry=><button key={entry.path} onClick={()=>entry.kind==='directory' ? void browse(entry.path) : void sshRead(selected.id,entry.path).then(content=>setFilePreview({path:entry.path,content})).catch(error=>setStatus(errorMessage(error)))}>{entry.kind==='directory'?<Folder size={14}/>:<File size={14}/>}<span>{entry.name}</span>{entry.kind==='file'&&<small>{formatBytes(entry.size)}</small>}</button>)}</div></section>
        <section className="ssh-terminal"><header><TerminalSquare size={15}/><strong>{t('settings.sshTerminal')}</strong></header><div ref={terminalHost} className="ssh-terminal-host" /></section>
      </div>
      {filePreview && <section className="ssh-file-preview"><header><strong>{filePreview.path}</strong><button onClick={()=>setFilePreview(null)}>×</button></header><pre>{filePreview.content}</pre></section>}
    </Card>}
    {status && <p className="settings-note" role="status">{status}</p>}
  </>
}

function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024*1024) return `${Math.round(value/1024)} KB`; return `${(value/1024/1024).toFixed(1)} MB` }
