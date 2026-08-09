import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PluginsView from './PluginsView'

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  togglePlugin: vi.fn(),
  getPluginMcpStatus: vi.fn(),
  getPluginExtensionStatus: vi.fn(),
  getPluginVersions: vi.fn(),
  comparePluginVersion: vi.fn(),
  installPluginUpdate: vi.fn(),
  rollbackPluginVersion: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getPlugins: mocks.getPlugins,
  togglePlugin: mocks.togglePlugin,
  getPluginMcpStatus: mocks.getPluginMcpStatus,
  getPluginExtensionStatus: mocks.getPluginExtensionStatus,
  getPluginVersions: mocks.getPluginVersions,
  comparePluginVersion: mocks.comparePluginVersion,
  installPluginUpdate: mocks.installPluginUpdate,
  rollbackPluginVersion: mocks.rollbackPluginVersion,
  createPlugin: vi.fn(),
  updatePlugin: vi.fn(),
  deletePlugin: vi.fn(),
}))

const plugins = [{
  id: 'documents', name: 'Documents', version: '1.0.0', description: 'Créer et lire des documents.', scope: 'system', category: 'recipe', installState: 'installed', validationState: 'valid', createdAt: '', updatedAt: '',
  manifest: { builtin: true, icon: 'document', capabilities: ['document.read', 'document.create'], permissions: [{ type: 'file.read' }, { type: 'file.write' }] },
}, {
  id: 'cloud', name: 'Cloud Architect', version: '1.0.0', availableVersion: '1.1.0', description: 'Analyser une architecture cloud.', scope: 'personal', category: 'executable', installState: 'disabled', validationState: 'valid', createdAt: '', updatedAt: '',
  manifest: { agentic: true, runtime: { python: '>=3.9', cli: true }, instructions: 'Analyser et vérifier.', permissions: [{ type: 'command.execute' }, { type: 'mcp.connect' }], mcpServers: { architecture: { command: 'python3' } }, integrations: [{ provider: 'cloud' }], browserExtensions: [{ id: 'browser' }], hooks: [{ id: 'prepare' }], scheduledTaskTemplates: [{ id: 'review' }] },
}]

describe('PluginsView', () => {
  beforeEach(() => {
    mocks.getPlugins.mockResolvedValue(plugins)
    mocks.togglePlugin.mockResolvedValue(undefined)
    mocks.getPluginMcpStatus.mockResolvedValue([{ id: 'architecture', name: 'Outils architecture', description: 'Analyse structurée', transport: 'stdio', tools: ['assess_architecture'], configured: true, enabled: true, required: true }])
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
  })

  it('uses a simple enabled/disabled interface without technical categories', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PluginsView /></MemoryRouter>)

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
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Documents Créer et lire des documents/ }))

    expect(await screen.findByRole('complementary', { name: 'Détails du plugin Documents' })).toBeVisible()
    expect(screen.getByText('Ce plugin peut faire')).toBeVisible()
    expect(screen.getByText('Lire des documents')).toBeVisible()
    expect(screen.getByText('Lire les fichiers que vous avez autorisés')).toBeVisible()
  })

  it('hides category and version fields from manual creation', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau plugin' }))

    expect(screen.getByText(/Les détails techniques sont gérés automatiquement/)).toBeVisible()
    expect(screen.queryByText('Catégorie')).not.toBeInTheDocument()
    expect(screen.queryByText('Version')).not.toBeInTheDocument()
  })

  it('toggles a plugin from the list', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Activer le plugin Cloud Architect' }))
    await waitFor(() => expect(mocks.togglePlugin).toHaveBeenCalledWith('cloud', true))
  })

  it('shows MCP tools as an integrated part of an agentic plugin', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Cloud Architect Analyser une architecture cloud/ }))

    expect(await screen.findByText('Outils connectés')).toBeVisible()
    expect(await screen.findByText('Outils architecture')).toBeVisible()
    expect(screen.getByText('Actif')).toBeVisible()
    expect(screen.getByText('assess architecture')).toBeVisible()
    expect(screen.getByText('Utiliser les outils connectés fournis par ce plugin')).toBeVisible()
  })

  it('shows authenticated connections, browser capability, hooks and schedule templates together', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PluginsView /></MemoryRouter>)
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
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PluginsView /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Cloud Architect Analyser une architecture cloud/ }))

    expect(await screen.findByText('Version 1.1.0 disponible')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Voir les changements' }))
    expect(await screen.findByText('1.0.0 → 1.1.0')).toBeVisible()
    expect(screen.getAllByText('Ajout du contrôle de résilience.')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }))
    await waitFor(() => expect(mocks.installPluginUpdate).toHaveBeenCalledWith('cloud', '1.1.0'))
  })
})
