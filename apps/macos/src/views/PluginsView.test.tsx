import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PluginsView from './PluginsView'
import { useAppStore } from '../stores/appStore'
import { AppDialogProvider } from '../components/AppDialog'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</div>
}

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  togglePlugin: vi.fn(),
  getPluginMcpStatus: vi.fn(),
  getPluginExtensionStatus: vi.fn(),
  getPluginResourceStatus: vi.fn(),
  getPluginVersions: vi.fn(),
  comparePluginVersion: vi.fn(),
  installPluginUpdate: vi.fn(),
  rollbackPluginVersion: vi.fn(),
  deletePlugin: vi.fn(),
  validatePlugin: vi.fn(),
  exportPluginZip: vi.fn(),
  importPluginZip: vi.fn(),
  testPluginMcp: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getPlugins: mocks.getPlugins,
  togglePlugin: mocks.togglePlugin,
  getPluginMcpStatus: mocks.getPluginMcpStatus,
  getPluginExtensionStatus: mocks.getPluginExtensionStatus,
  getPluginResourceStatus: mocks.getPluginResourceStatus,
  getPluginVersions: mocks.getPluginVersions,
  comparePluginVersion: mocks.comparePluginVersion,
  installPluginUpdate: mocks.installPluginUpdate,
  rollbackPluginVersion: mocks.rollbackPluginVersion,
  createPlugin: vi.fn(),
  updatePlugin: vi.fn(),
  deletePlugin: mocks.deletePlugin,
  validatePlugin: mocks.validatePlugin,
  exportPluginZip: mocks.exportPluginZip,
  importPluginZip: mocks.importPluginZip,
  testPluginMcp: mocks.testPluginMcp,
}))

const plugins = [{
  id: 'builtin-documents', name: 'Documents', version: '1.0.0', description: 'Créer et lire des documents.', scope: 'system', category: 'recipe', installState: 'installed', validationState: 'valid', createdAt: '', updatedAt: '',
  manifest: { builtin: true, icon: 'document', slug: 'bob-work-documents', capabilities: ['document.read', 'document.create'], permissions: [{ type: 'file.read' }, { type: 'file.write' }] },
}, {
  id: 'cloud', name: 'Cloud Architect', version: '1.0.0', availableVersion: '1.1.0', description: 'Analyser une architecture cloud.', scope: 'personal', category: 'executable', installState: 'disabled', validationState: 'valid', createdAt: '', updatedAt: '',
  manifest: { agentic: true, runtime: { python: '>=3.9', cli: true }, instructions: 'Analyser et vérifier.', permissions: [{ type: 'command.execute' }, { type: 'mcp.connect' }], mcpServers: { architecture: { command: 'python3' } }, integrations: [{ provider: 'cloud' }], browserExtensions: [{ id: 'browser' }], hooks: [{ id: 'prepare' }], scheduledTaskTemplates: [{ id: 'review' }], resources: [
    { kind: 'api-public', label: 'Stooq', optional: false, notes: 'Sans clé' },
    { kind: 'api-key', label: 'Finnhub', optional: true, notes: 'FINNHUB_API_KEY' },
  ] },
}]

describe('PluginsView', () => {
  beforeEach(() => {
    mocks.getPlugins.mockResolvedValue(plugins)
    mocks.togglePlugin.mockResolvedValue(undefined)
    mocks.getPluginMcpStatus.mockResolvedValue([{ id: 'architecture', name: 'Outils architecture', description: 'Analyse structurée', transport: 'stdio', tools: ['assess_architecture'], configured: true, enabled: true, required: true }])
    mocks.getPluginResourceStatus.mockImplementation((pluginId: string) => Promise.resolve(pluginId === 'cloud' ? [
      { id: 'api-public-0', label: 'Stooq', kind: 'api-public', optional: false, state: 'ready', message: 'Prêt · API publique, aucune clé requise.', setupHint: null },
      { id: 'api-key-1', label: 'Finnhub', kind: 'api-key', optional: true, state: 'needs_key', message: 'Optionnel · définissez FINNHUB_API_KEY pour activer cette source.', setupHint: 'Configurez FINNHUB_API_KEY dans Intégrations → APIs', configureTab: 'apis', envKey: 'FINNHUB_API_KEY', configureUrl: 'https://finnhub.io/api/v1/quote' },
    ] : []))
    mocks.getPluginExtensionStatus.mockResolvedValue({
      integrations: [{ provider: 'cloud', name: 'Compte cloud', authType: 'mcp', scopes: ['architecture.read'], state: 'connected', required: true, message: 'Outils MCP actifs.' }],
      browserExtensions: [{ id: 'browser', name: 'Sources cloud', capability: 'browser', state: 'ready', required: false, message: 'Capacité autorisée.' }],
      hooks: [{ id: 'prepare', name: 'Préparation du contexte', event: 'before_task', enabled: true, required: true }],
      scheduledTaskTemplates: [{ id: 'review', name: 'Revue hebdomadaire', instructions: 'Analyse les écarts.', cronOrEvent: 'every week', offlineBehavior: 'run_on_wake', overlapPolicy: 'queue' }],
    })
    mocks.getPluginVersions.mockImplementation((pluginId: string) => Promise.resolve(pluginId === 'cloud' ? [
      { pluginId: 'cloud', version: '1.1.0', releaseNotes: 'Ajout du contrôle de résilience.', createdAt: '2026-08-09T08:00:00Z', state: 'available' },
      { pluginId: 'cloud', version: '1.0.0', createdAt: '2026-08-08T08:00:00Z', installedAt: '2026-08-08T08:00:00Z', state: 'current' },
    ] : [{ pluginId, version: '1.0.0', createdAt: '2026-08-08T08:00:00Z', state: 'current' }]))
    mocks.comparePluginVersion.mockResolvedValue({ fromVersion: '1.0.0', toVersion: '1.1.0', changes: ['Ajout du contrôle de résilience.'], warnings: ['Nouvelle autorisation demandée : network.request'], permissionsChanged: true })
    mocks.installPluginUpdate.mockResolvedValue({ ...plugins[1], version: '1.1.0', availableVersion: undefined })
    mocks.rollbackPluginVersion.mockResolvedValue(plugins[1])
    mocks.deletePlugin.mockResolvedValue(undefined)
    mocks.validatePlugin.mockResolvedValue({ valid: true, warnings: [], errors: [], riskLevel: 'low' })
    mocks.exportPluginZip.mockResolvedValue(undefined)
    mocks.importPluginZip.mockResolvedValue(plugins[1])
    mocks.testPluginMcp.mockResolvedValue([])
  })

  it('uses a simple enabled/disabled interface without technical categories', async () => {
    render(<MemoryRouter><PluginsView /></MemoryRouter>)

    expect(await screen.findByText('Documents')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Tous' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Activés' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Désactivés' })).toBeVisible()
    expect(screen.queryByText('Recette')).not.toBeInTheDocument()
    expect(screen.queryByText('Exécutable')).not.toBeInTheDocument()
    expect(screen.queryByText('Python')).not.toBeInTheDocument()
    expect(screen.queryByText('CLI')).not.toBeInTheDocument()
  })

  it('shows friendly capabilities and permissions when a plugin is selected', async () => {
    render(<MemoryRouter><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Documents Créer et lire des documents/ }))

    expect(await screen.findByRole('complementary', { name: 'Détails du plugin Documents' })).toBeVisible()
    expect(screen.getByText('Ce plugin peut faire')).toBeVisible()
    expect(screen.getByText('Lire des documents')).toBeVisible()
    expect(screen.getByText('Lire les fichiers que vous avez autorisés')).toBeVisible()
  })

  it('ouvre le chat pour créer un plugin, sans wizard ni popup', async () => {
    useAppStore.setState({ builderSession: null })
    render(
      <MemoryRouter initialEntries={['/plugins']}>
        <Routes>
          <Route path="/plugins" element={<PluginsView />} />
          <Route path="/chat" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: 'Assistant guidé' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '+ Nouveau plugin' }))

    await waitFor(() => {
      const probe = screen.getByTestId('location').textContent ?? ''
      expect(probe.startsWith('/chat|')).toBe(true)
      expect(probe).toContain('plugin_builder')
      expect(probe).not.toContain('initialPrompt')
    })
    expect(useAppStore.getState().builderSession).toMatchObject({ kind: 'plugin_builder', guided: false })
    expect(screen.queryByRole('dialog', { name: 'Nouveau plugin' })).not.toBeInTheDocument()
  })

  it('ouvre le wizard uniquement via Assistant guidé', async () => {
    render(
      <MemoryRouter initialEntries={['/plugins']}>
        <Routes>
          <Route path="/plugins" element={<PluginsView />} />
          <Route path="/plugins/new" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Assistant guidé' }))
    expect(screen.getByTestId('location').textContent).toMatch(/^\/plugins\/new\|/)
  })

  it('toggles a plugin from the list', async () => {
    render(<MemoryRouter><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Activer le plugin Cloud Architect' }))
    await waitFor(() => expect(mocks.togglePlugin).toHaveBeenCalledWith('cloud', true))
  })

  it('shows MCP tools as an integrated part of an agentic plugin', async () => {
    render(<MemoryRouter><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Cloud Architect Analyser une architecture cloud/ }))

    expect(await screen.findByText('Outils connectés')).toBeVisible()
    expect(await screen.findByText('Outils architecture')).toBeVisible()
    expect(screen.getByText('Installé · non testé')).toBeVisible()
    expect(screen.getByText('assess architecture')).toBeVisible()
    expect(screen.getByText('Utiliser les outils connectés fournis par ce plugin')).toBeVisible()
    expect(screen.getByText('Sources')).toBeVisible()
    expect(screen.getByText('Finnhub')).toBeVisible()
    expect(screen.getByText(/Clé API manquante/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Configurer dans APIs' })).toBeVisible()
    expect(screen.getByText(/Configurez FINNHUB_API_KEY dans Intégrations → APIs/)).toBeVisible()
  })

  it('shows authenticated connections, browser capability, hooks and schedule templates together', async () => {
    render(<MemoryRouter><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Cloud Architect Analyser une architecture cloud/ }))

    expect(await screen.findByText('Connexions')).toBeVisible()
    expect(screen.getByText('Compte cloud')).toBeVisible()
    expect(screen.getByText('Connecté')).toBeVisible()
    expect(screen.getByText('Navigateur')).toBeVisible()
    expect(screen.getByText('Sources cloud')).toBeVisible()
    expect(screen.getByText('Actions automatiques')).toBeVisible()
    expect(screen.getByText(/Préparation du contexte/)).toBeVisible()
    expect(screen.getByText('Automatisations')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Planifier' })).toBeVisible()
  })

  it('shows an available version, its changes and installs it explicitly', async () => {
    render(<MemoryRouter><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Cloud Architect Analyser une architecture cloud/ }))

    expect(await screen.findByText('Version 1.1.0 disponible')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Voir les changements' }))
    expect(await screen.findByText('1.0.0 → 1.1.0')).toBeVisible()
    expect(screen.getAllByText('Ajout du contrôle de résilience.')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Mettre à jour' })[0])
    await waitFor(() => expect(mocks.installPluginUpdate).toHaveBeenCalledWith('cloud', '1.1.0'))
  })

  it('keeps Intégré and Mise à jour badges readable side by side', async () => {
    render(<MemoryRouter><PluginsView /></MemoryRouter>)

    const documentsRow = await screen.findByRole('button', { name: /Documents Créer et lire des documents/ })
    expect(documentsRow).toHaveTextContent('Intégré')
    expect(documentsRow).not.toHaveTextContent(/^In…$|In\.\.\./)

    const cloudRow = screen.getByRole('button', { name: /Cloud Architect Analyser une architecture cloud/ })
    expect(cloudRow).toHaveTextContent('Mise à jour')
    expect(cloudRow).toHaveTextContent('Agentique')
  })

  it('allows deleting non-builtin plugins from the list', async () => {
    render(<AppDialogProvider><MemoryRouter><PluginsView /></MemoryRouter></AppDialogProvider>)

    expect(await screen.findByText('Cloud Architect')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le plugin Cloud Architect' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(mocks.deletePlugin).toHaveBeenCalledWith('cloud'))
    expect(screen.queryByRole('button', { name: 'Supprimer le plugin Documents' })).not.toBeInTheDocument()
  })

  it('allows deleting non-builtin plugins and protects builtins', async () => {
    render(<AppDialogProvider><MemoryRouter><PluginsView /></MemoryRouter></AppDialogProvider>)

    fireEvent.click(await screen.findByRole('button', { name: /Documents Créer et lire des documents/ }))
    expect(await screen.findByText(/Plugin intégré : désactivation possible/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Cloud Architect Analyser une architecture cloud/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(mocks.deletePlugin).toHaveBeenCalledWith('cloud'))
  })

  it('hides Restaurer for built-in plugins and keeps it for agentic ones', async () => {
    mocks.getPluginVersions.mockImplementation((pluginId: string) => Promise.resolve(pluginId === 'cloud' ? [
      { pluginId: 'cloud', version: '1.1.0', createdAt: '2026-08-09T08:00:00Z', installedAt: '2026-08-09T08:00:00Z', state: 'current' },
      { pluginId: 'cloud', version: '1.0.0', createdAt: '2026-08-08T08:00:00Z', installedAt: '2026-08-08T08:00:00Z', state: 'previous' },
    ] : [
      { pluginId, version: '1.0.0', createdAt: '2026-08-08T08:00:00Z', installedAt: '2026-08-08T08:00:00Z', state: 'current' },
      { pluginId, version: '0.9.0', createdAt: '2026-08-01T08:00:00Z', installedAt: '2026-08-01T08:00:00Z', state: 'previous' },
    ]))
    render(<MemoryRouter><PluginsView /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: /Documents Créer et lire des documents/ }))
    expect(await screen.findByText(/Plugin intégré : la version livrée/)).toBeVisible()
    await waitFor(() => expect(screen.getByText('Version 0.9.0')).toBeVisible())
    expect(screen.queryByRole('button', { name: 'Restaurer' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Cloud Architect Analyser une architecture cloud/ }))
    await waitFor(() => expect(screen.getByText('Version 1.0.0')).toBeVisible())
    expect(screen.getByRole('button', { name: 'Restaurer' })).toBeVisible()
  })

  it('montre une erreur de chargement au lieu d’un catalogue vide', async () => {
    mocks.getPlugins.mockRejectedValueOnce(new Error('plugins IPC failed'))
    render(<MemoryRouter><PluginsView /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('plugins IPC failed')
    expect(screen.queryByText('Aucun plugin.')).not.toBeInTheDocument()
  })
})
