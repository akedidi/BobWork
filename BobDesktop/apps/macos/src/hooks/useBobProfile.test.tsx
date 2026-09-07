import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBobProfile } from './useBobProfile'

const mocks = vi.hoisted(() => ({
  getBobProfile: vi.fn(),
  getPermissionGrants: vi.fn(),
  getUsageStatus: vi.fn(),
  getBobAuthSnapshot: vi.fn(),
  hasSessionSecret: vi.fn(),
  setBobStatus: vi.fn(),
  setBobInfo: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getBobProfile: mocks.getBobProfile,
  getPermissionGrants: mocks.getPermissionGrants,
  getUsageStatus: mocks.getUsageStatus,
  getBobAuthSnapshot: mocks.getBobAuthSnapshot,
  hasSessionSecret: mocks.hasSessionSecret,
  installBobShell: vi.fn(),
  revokePermissionGrant: vi.fn(),
}))

vi.mock('../stores/appStore', () => {
  const useAppStore = Object.assign(
    () => ({ setBobStatus: mocks.setBobStatus, setBobInfo: mocks.setBobInfo }),
    { getState: () => ({ bobInfo: null }) },
  )
  return { useAppStore }
})

vi.mock('./useTauriEvents', () => ({ useUsageUpdated: vi.fn() }))

const setStatus = vi.fn()
const showTransientStatus = vi.fn()

function Harness() {
  useBobProfile('remote', setStatus, showTransientStatus)
  return null
}

describe('useBobProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBobAuthSnapshot.mockResolvedValue({
      found: true,
      authenticated: true,
      authenticationMethod: 'sso_session_detected',
    })
    mocks.hasSessionSecret.mockResolvedValue(false)
    mocks.getUsageStatus.mockResolvedValue({ used: 1, limit: 100 })
    mocks.getPermissionGrants.mockResolvedValue([])
    mocks.getBobProfile.mockResolvedValue({
      detection: { found: true, authenticated: true },
      authenticationMethod: 'sso_session_detected',
    })
  })

  it('ne relance pas le profil lorsque ses propres résultats mettent à jour le state', async () => {
    render(<Harness />)

    await waitFor(() => expect(mocks.getBobProfile).toHaveBeenCalledTimes(1))
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 25)) })

    expect(mocks.getBobAuthSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.getUsageStatus).toHaveBeenCalledTimes(1)
    expect(mocks.getPermissionGrants).toHaveBeenCalledTimes(1)
    expect(mocks.getBobProfile).toHaveBeenCalledTimes(1)
  })
})
