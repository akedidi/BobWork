import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeStorageReport } from '@bob-work/shared-types'
import { setTestLocale } from '../../i18n'
import { RuntimeStorageCard } from './RuntimeStorageCard'
import { AppDialogProvider } from '../../components/AppDialog'

const mocks = vi.hoisted(() => ({
  getRuntimeStorage: vi.fn(),
  getRuntimeInstallationPlan: vi.fn(),
  installExternalRuntime: vi.fn(),
  removeExternalRuntime: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  getRuntimeStorage: mocks.getRuntimeStorage,
  getRuntimeInstallationPlan: mocks.getRuntimeInstallationPlan,
  installExternalRuntime: mocks.installExternalRuntime,
  removeExternalRuntime: mocks.removeExternalRuntime,
  cancelRuntimeProcess: vi.fn(),
}))

describe('RuntimeStorageCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setTestLocale('fr')
    const report: RuntimeStorageReport = {
      coreBytes: 1,
      sharedBytes: 1024,
      externalBytes: 0,
      privateBytes: 0,
      artifactBytes: 0,
      cacheBytes: 0,
      activeProcesses: [],
      runtimes: [{
        runtimeId: 'external.qiskit',
        runtimeType: 'external_managed',
        name: 'Qiskit Runtime',
        version: '2.5.2',
        platform: 'darwin-arm64',
        architecture: 'arm64',
        sizeBytes: 0,
        status: 'broken',
        updatedAt: '2026-09-02T00:00:00Z',
        dependencies: [],
        pythonMode: 'isolated',
        capabilities: ['quantum.qiskit'],
        consumers: ['builtin-ibm-qiskit'],
        removable: true,
        error: 'Validation failed',
      }],
    }
    mocks.getRuntimeStorage.mockResolvedValue(report)
    mocks.getRuntimeInstallationPlan.mockResolvedValue({
      runtimeId: 'external.qiskit',
      name: 'Qiskit Runtime',
      version: '2.5.2',
      purpose: 'Calcul quantique local',
      source: 'PyPI',
      estimatedSizeBytes: 1024,
      pythonMode: 'isolated',
      packages: [],
    })
    mocks.installExternalRuntime.mockResolvedValue(report.runtimes[0])
    mocks.removeExternalRuntime.mockResolvedValue(undefined)
  })

  afterEach(() => setTestLocale(null))

  it('guides manual installation without calling the automatic installer or offering removal', async () => {
    const report = await mocks.getRuntimeStorage()
    mocks.getRuntimeStorage.mockResolvedValue({
      ...report,
      runtimes: [{ ...report.runtimes[0], management: 'manual', removable: false }],
    })
    render(<AppDialogProvider><RuntimeStorageCard setStatus={vi.fn()} /></AppDialogProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Installation manuelle / aide' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Installation automatique non prise en charge')
    expect(mocks.installExternalRuntime).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Supprimer le runtime' })).not.toBeInTheDocument()
  })

  it('localizes runtime status and Python mode without leaking enum labels', async () => {
    render(<RuntimeStorageCard setStatus={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Qiskit Runtime')).toBeInTheDocument())
    expect(screen.getByText(/Attention requise/)).toBeInTheDocument()
    expect(screen.getByText('Python : isolé')).toBeInTheDocument()
    expect(screen.queryByText(/external_managed|broken|isolated/)).not.toBeInTheDocument()
  })

  it('installs a managed external runtime after confirmation', async () => {
    render(<AppDialogProvider><RuntimeStorageCard setStatus={vi.fn()} /></AppDialogProvider>)

    const row = (await screen.findByText('Qiskit Runtime')).closest('.settings-list-row')
    expect(row).not.toBeNull()
    const refreshCount = mocks.getRuntimeStorage.mock.calls.length
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Installer le runtime' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Installer le runtime' }))

    await waitFor(() => expect(mocks.installExternalRuntime).toHaveBeenCalledWith('external.qiskit', true))
    await waitFor(() => expect(mocks.getRuntimeStorage.mock.calls.length).toBeGreaterThan(refreshCount))
  })

  it('removes an installed removable runtime after confirmation', async () => {
    const report = await mocks.getRuntimeStorage()
    mocks.getRuntimeStorage.mockResolvedValue({
      ...report,
      runtimes: [{ ...report.runtimes[0], status: 'installed', installedVersion: '2.5.2' }],
    })
    render(<AppDialogProvider><RuntimeStorageCard setStatus={vi.fn()} /></AppDialogProvider>)

    const row = (await screen.findByText('Qiskit Runtime')).closest('.settings-list-row')
    expect(row).not.toBeNull()
    const refreshCount = mocks.getRuntimeStorage.mock.calls.length
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Supprimer le runtime' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Supprimer le runtime' }))

    await waitFor(() => expect(mocks.removeExternalRuntime).toHaveBeenCalledWith('external.qiskit', true))
    await waitFor(() => expect(mocks.getRuntimeStorage.mock.calls.length).toBeGreaterThan(refreshCount))
  })
})
