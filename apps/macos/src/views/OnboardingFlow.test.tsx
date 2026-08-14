import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingFlow from './OnboardingFlow'

const mocks = vi.hoisted(() => ({
  detectInstallation: vi.fn(),
  getSessionApiKeyStatus: vi.fn(),
  setSessionApiKey: vi.fn(),
}))

vi.mock('../services/BobAuthService', () => ({
  bobAuthService: {
    detectInstallation: mocks.detectInstallation,
    getSessionApiKeyStatus: mocks.getSessionApiKeyStatus,
    setSessionApiKey: mocks.setSessionApiKey,
  },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../lib/ipc', () => ({
  installBobShell: vi.fn().mockResolvedValue(true),
  getSettings: vi.fn().mockResolvedValue({ computerUseEnabled: false, chromeControlEnabled: false }),
  updateSettings: vi.fn().mockResolvedValue({}),
}))

describe('OnboardingFlow session-only Bob configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detectInstallation.mockResolvedValue('BOB_READY')
    mocks.getSessionApiKeyStatus.mockResolvedValue({ active: false, source: 'none' })
    mocks.setSessionApiKey.mockResolvedValue(undefined)
  })

  it('configures bob run directly without proposing IBM browser SSO', async () => {
    render(
      <MemoryRouter>
        <OnboardingFlow />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Configurer IBM Bob' })).toBeVisible()
    expect(screen.queryByText(/Continuer avec IBM/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/IBMid/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/navigateur/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Clé d’inférence IBM Bob'), { target: { value: 'api-key-test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer dans le coffre' }))

    await waitFor(() => expect(mocks.setSessionApiKey).toHaveBeenCalledWith('api-key-test'))
    expect(await screen.findByRole('heading', { name: 'IBM Bob est prêt' })).toBeVisible()
  })

  it('recognizes an already active environment key without asking for a secret', async () => {
    mocks.getSessionApiKeyStatus.mockResolvedValue({ active: true, source: 'environment' })
    render(
      <MemoryRouter>
        <OnboardingFlow />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'IBM Bob est prêt' })).toBeVisible()
    expect(screen.queryByLabelText('Clé d’inférence IBM Bob')).not.toBeInTheDocument()
  })
})
