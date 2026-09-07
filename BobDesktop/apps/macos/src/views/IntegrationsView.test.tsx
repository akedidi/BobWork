import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDialogProvider } from '../components/AppDialog'
import IntegrationsView from './IntegrationsView'

const mocks = vi.hoisted(() => ({
  getIntegrationStatuses: vi.fn(),
  getMcpServers: vi.fn(),
  getOAuthClientConfig: vi.fn(),
  setOAuthClientConfig: vi.fn(),
  startIntegrationOAuth: vi.fn(),
  connectIntegrationToken: vi.fn(),
  disconnectIntegration: vi.fn(),
  saveMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  deleteMcpServer: vi.fn(),
  testMcpServer: vi.fn(),
  getDbConnections: vi.fn(),
  saveDbConnection: vi.fn(),
  setDbConnectionEnabled: vi.fn(),
  deleteDbConnection: vi.fn(),
  testDbConnection: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

vi.mock('../lib/ipc', () => ({
  getIntegrationStatuses: mocks.getIntegrationStatuses,
  getMcpServers: mocks.getMcpServers,
  getOAuthClientConfig: mocks.getOAuthClientConfig,
  setOAuthClientConfig: mocks.setOAuthClientConfig,
  startIntegrationOAuth: mocks.startIntegrationOAuth,
  connectIntegrationToken: mocks.connectIntegrationToken,
  disconnectIntegration: mocks.disconnectIntegration,
  saveMcpServer: mocks.saveMcpServer,
  setMcpServerEnabled: mocks.setMcpServerEnabled,
  deleteMcpServer: mocks.deleteMcpServer,
  testMcpServer: mocks.testMcpServer,
  getDbConnections: mocks.getDbConnections,
  saveDbConnection: mocks.saveDbConnection,
  setDbConnectionEnabled: mocks.setDbConnectionEnabled,
  deleteDbConnection: mocks.deleteDbConnection,
  testDbConnection: mocks.testDbConnection,
}))

function renderView(initialEntries: string[] = ['/integrations']) {
  return render(
    <AppDialogProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <IntegrationsView />
      </MemoryRouter>
    </AppDialogProvider>,
  )
}

const sqliteConnection = {
  id: 'db-1',
  name: 'sales',
  engine: 'sqlite' as const,
  config: { filePath: '/tmp/sales.sqlite' },
  hasSecret: false,
  enabled: true,
  createdAt: '2026-08-28T00:00:00Z',
  updatedAt: '2026-08-28T00:00:00Z',
}

describe('IntegrationsView', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(fn => fn.mockReset())
    mocks.getIntegrationStatuses.mockResolvedValue([])
    mocks.getMcpServers.mockResolvedValue([])
    mocks.getDbConnections.mockResolvedValue([])
    mocks.getOAuthClientConfig.mockResolvedValue(null)
  })

  it('affiche le catalogue après chargement', async () => {
    renderView()
    expect(await screen.findByText('GitHub')).toBeVisible()
    expect(screen.getByText('Calendrier Outlook')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('montre une erreur de chargement et permet de réessayer', async () => {
    mocks.getIntegrationStatuses.mockRejectedValueOnce(new Error('backend offline'))
    renderView()

    expect(await screen.findByRole('alert')).toHaveTextContent('backend offline')
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument()

    mocks.getIntegrationStatuses.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeVisible()
    })
  })

  it('explique qu’un client Entra est requis si Microsoft n’est pas configuré', async () => {
    mocks.getIntegrationStatuses.mockResolvedValue([
      { integrationId: 'outlook-mail', connected: false, oauthClientConfigured: false, lastTest: null },
      { integrationId: 'teams', connected: false, oauthClientConfigured: false, lastTest: null },
      { integrationId: 'outlook-calendar', connected: false, oauthClientConfigured: false, lastTest: null },
      { integrationId: 'onedrive', connected: false, oauthClientConfigured: false, lastTest: null },
      { integrationId: 'onenote', connected: false, oauthClientConfigured: false, lastTest: null },
    ])
    renderView()
    expect(await screen.findByRole('status')).toHaveTextContent(/Client Entra requis/)
  })

  it('colore le badge de test MCP en vert si réussi et en rouge si échec', async () => {
    mocks.getMcpServers.mockResolvedValue([
      {
        name: 'ok-server',
        transport: 'stdio',
        commandOrUrl: 'python3',
        enabled: true,
        lastTest: { ok: true, message: 'Connexion OK', testedAt: '2026-08-11T11:36:00Z' },
      },
      {
        name: 'bad-server',
        transport: 'http',
        commandOrUrl: 'https://example.com',
        enabled: true,
        lastTest: { ok: false, message: 'Timeout', testedAt: '2026-08-11T11:30:00Z' },
      },
    ])
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Serveurs MCP' }))

    const okBadge = await screen.findByText(/Test réussi/)
    const failBadge = screen.getByText(/Échec/)
    expect(okBadge).toHaveClass('connected')
    expect(failBadge).toHaveClass('failed')
    expect(screen.getByTestId('connection-test-ok')).toBeVisible()
    expect(okBadge.querySelector('.status-dot.green')).toBeTruthy()
    expect(failBadge.querySelector('.status-dot.red')).toBeTruthy()
  })

  it('place les MCP personnels en premier et protège les connecteurs intégrés', async () => {
    mocks.getMcpServers.mockResolvedValue([
      {
        name: 'bob-work-computer-use', transport: 'stdio', commandOrUrl: 'python3',
        enabled: true, builtin: true,
      },
      {
        name: 'airline-operations', transport: 'http', commandOrUrl: 'https://example.test/mcp',
        enabled: true, builtin: false,
      },
    ])
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Serveurs MCP' }))

    const personal = await screen.findByTestId('mcp-server-airline-operations')
    const builtin = screen.getByTestId('mcp-server-bob-work-computer-use')
    expect(personal.compareDocumentPosition(builtin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(builtin).getByText('Intégré')).toBeVisible()
    expect(within(builtin).getByText('Géré par Bob Work')).toBeVisible()
    expect(within(builtin).queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument()
    expect(within(builtin).queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument()
    expect(within(builtin).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(personal).getByRole('button', { name: 'Modifier' })).toBeVisible()
    expect(within(personal).getByRole('button', { name: 'Supprimer' })).toBeVisible()
    expect(within(personal).getByRole('checkbox')).toBeVisible()
  })

  it('affiche une pastille verte sur une intégration dont le test a réussi', async () => {
    mocks.getIntegrationStatuses.mockResolvedValue([{
      integrationId: 'github',
      connected: true,
      oauthClientConfigured: true,
      deviceFlowAvailable: true,
      scopeSatisfied: true,
      lastTest: { ok: true, message: 'MCP OK', testedAt: '2026-08-11T11:36:00Z' },
    }])
    renderView()
    const card = (await screen.findByText('GitHub')).closest('[data-provider="github"]')
    expect(card).toBeTruthy()
    expect(within(card as HTMLElement).getByTestId('connection-test-ok')).toBeVisible()
  })

  it('affiche une pastille verte sur une API testée avec succès', async () => {
    mocks.getMcpServers.mockResolvedValue([{
      name: 'open-meteo',
      transport: 'http',
      commandOrUrl: 'https://api.open-meteo.com',
      enabled: true,
      lastTest: { ok: true, message: 'HTTP 200', testedAt: '2026-08-11T11:36:00Z' },
    }])
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'APIs' }))
    expect((await screen.findAllByTestId('connection-test-ok')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('open-meteo').length).toBeGreaterThan(0)
  })

  it('préremplit le formulaire API depuis la navigation plugin', async () => {
    render(
      <MemoryRouter
        initialEntries={[{
          pathname: '/integrations',
          state: {
            tab: 'apis',
            apiKeyPreset: {
              name: 'Finnhub',
              envName: 'FINNHUB_API_KEY',
              authMode: 'env',
              url: 'https://finnhub.io/api/v1/quote',
              transport: 'http',
            },
          },
        }]}

      >
        <IntegrationsView />
      </MemoryRouter>,
    )

    expect(await screen.findByText('API protégée par clé')).toBeVisible()
    expect(screen.getByDisplayValue('finnhub')).toBeVisible()
    expect(screen.getByDisplayValue('FINNHUB_API_KEY')).toBeVisible()
    expect(screen.getByText(/Formulaire prérempli pour FINNHUB_API_KEY/)).toBeVisible()
  })

  it('affiche l’onglet DB et enregistre une connexion SQLite', async () => {
    mocks.saveDbConnection.mockResolvedValue({
      id: 'db-1',
      name: 'sales',
      engine: 'sqlite',
      config: { filePath: '/tmp/sales.sqlite' },
      hasSecret: false,
      enabled: true,
      createdAt: '2026-08-28T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    })
    mocks.getDbConnections
      .mockResolvedValueOnce([])
      .mockResolvedValue([{
        id: 'db-1',
        name: 'sales',
        engine: 'sqlite',
        config: { filePath: '/tmp/sales.sqlite' },
        hasSecret: false,
        enabled: true,
        createdAt: '2026-08-28T00:00:00Z',
        updatedAt: '2026-08-28T00:00:00Z',
      }])
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'DB' }))
    expect(await screen.findByText('Ajouter une connexion DB')).toBeVisible()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sqlite' } })
    expect(screen.getByText('Fichier SQLite')).toBeVisible()
    fireEvent.change(screen.getByPlaceholderText('sales'), { target: { value: 'sales' } })
    fireEvent.change(screen.getByPlaceholderText('/chemin/vers/data.sqlite'), { target: { value: '/tmp/sales.sqlite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la connexion' }))
    await waitFor(() => {
      expect(mocks.saveDbConnection).toHaveBeenCalled()
    })
    expect(await screen.findByText('sales')).toBeVisible()
  })

  it('propose IBM Db2 avec le port 50000', async () => {
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'DB' }))
    const engine = await screen.findByRole('combobox')
    expect(engine).toHaveTextContent('IBM Db2')
    fireEvent.change(engine, { target: { value: 'db2' } })
    expect(screen.getByText(/IBM Db2 : hôte, port 50000/)).toBeVisible()
    expect(screen.getByText('Hôte')).toBeVisible()
    expect(screen.getByLabelText('Port')).toHaveValue(50000)
    expect(screen.getByText('Base')).toBeVisible()
    expect(screen.getByText('Mot de passe')).toBeVisible()
  })

  it('affiche les champs hôte pour PostgreSQL', async () => {
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'DB' }))
    expect(await screen.findByText('Hôte')).toBeVisible()
    expect(screen.getByText('Port')).toBeVisible()
    expect(screen.getByText('Base')).toBeVisible()
    expect(screen.getByText('Mot de passe')).toBeVisible()
    expect(screen.queryByText('Fichier SQLite')).not.toBeInTheDocument()
  })

  it('change les champs du formulaire pour BigQuery', async () => {
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'DB' }))
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'bigquery' } })
    expect(screen.getByText('ID projet')).toBeVisible()
    expect(screen.getByText('JSON compte de service')).toBeVisible()
    expect(screen.queryByText('Hôte')).not.toBeInTheDocument()
  })

  it('teste, active et supprime une connexion DB', async () => {
    mocks.getDbConnections.mockResolvedValue([{
      ...sqliteConnection,
      lastTest: { ok: true, message: 'SQLite ouvert', testedAt: '2026-08-28T00:00:00Z' },
    }])
    mocks.testDbConnection.mockResolvedValue({ ok: true, message: 'SQLite ouvert', testedAt: '2026-08-28T00:00:00Z' })
    mocks.deleteDbConnection.mockResolvedValue(undefined)
    mocks.setDbConnectionEnabled.mockResolvedValue(undefined)
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'DB' }))
    expect(await screen.findByText('sales')).toBeVisible()
    expect(screen.getByTestId('connection-test-ok')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Tester' }))
    await waitFor(() => expect(mocks.testDbConnection).toHaveBeenCalledWith('db-1'))
    fireEvent.click(screen.getByRole('checkbox', { name: /Actif/ }))
    await waitFor(() => expect(mocks.setDbConnectionEnabled).toHaveBeenCalledWith('db-1', false))
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(mocks.deleteDbConnection).toHaveBeenCalledWith('db-1'))
  })
})
