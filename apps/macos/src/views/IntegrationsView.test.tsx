import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
}))

function renderView(initialEntries: string[] = ['/integrations']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <IntegrationsView />
    </MemoryRouter>,
  )
}

describe('IntegrationsView', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(fn => fn.mockReset())
    mocks.getIntegrationStatuses.mockResolvedValue([])
    mocks.getMcpServers.mockResolvedValue([])
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
})
