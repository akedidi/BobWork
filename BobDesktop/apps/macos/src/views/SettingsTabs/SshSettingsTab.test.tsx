import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SshSettingsTab from './SshSettingsTab'

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('../../lib/ipc', () => ({
  getSshServers: mocks.get, saveSshServer: mocks.save, deleteSshServer: vi.fn(),
  testSshServer: vi.fn(), browseSshDirectory: vi.fn().mockResolvedValue([]), sshRead: vi.fn(),
  startSshTerminal: vi.fn().mockResolvedValue('session'), stopSshTerminal: vi.fn().mockResolvedValue(undefined),
  writeSshTerminal: vi.fn().mockResolvedValue(undefined), syncSshWorkspace: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { loadAddon(){} open(){} writeln(){} write(){} onData(){ return { dispose(){} } } dispose(){} } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(){} } }))

const labels: Record<string,string> = {
  'settings.sshHeading':'Serveurs SSH','settings.sshDesc':'Machines distantes','settings.sshServers':'Serveurs configurés','settings.sshAdd':'Ajouter un serveur','settings.sshEmpty':'Aucun serveur SSH configuré.',
  'settings.sshName':'Nom','settings.sshHost':'Hôte','settings.sshPort':'Port','settings.sshUser':'Utilisateur','settings.sshKey':'Clé privée (facultative)','settings.sshRoot':'Racine distante autorisée','settings.sshSecurity':'Sécurité OpenSSH','common.cancel':'Annuler','common.save':'Enregistrer','settings.sshSaved':'Serveur enregistré',
}
const t = (key: string) => labels[key] ?? key

describe('SshSettingsTab', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue([]) })
  it('creates a key-based multi-server profile with an authorized root', async () => {
    mocks.save.mockResolvedValue({ id:'srv-1', name:'Production', host:'prod.example.com', port:22, user:'deploy', remoteRoot:'/srv/app', localMirrorPath:'/tmp/mirror', enabled:true })
    render(<SshSettingsTab t={t as any} />)
    expect(await screen.findByText('Aucun serveur SSH configuré.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un serveur/ }))
    fireEvent.change(screen.getByLabelText('Nom'), { target:{ value:'Production' } })
    fireEvent.change(screen.getByLabelText('Hôte'), { target:{ value:'prod.example.com' } })
    fireEvent.change(screen.getByLabelText('Utilisateur'), { target:{ value:'deploy' } })
    fireEvent.change(screen.getByLabelText('Racine distante autorisée'), { target:{ value:'/srv/app' } })
    fireEvent.click(screen.getByRole('button', { name:'Enregistrer' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ host:'prod.example.com', user:'deploy', remoteRoot:'/srv/app', port:22 })))
  })
})
