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

  it('shows a spinning loader while a CLI runtime is installing', async () => {
    let resolveInstall: (value: unknown) => void = () => {}
    mocks.installExternalRuntime.mockImplementation(() => new Promise(resolve => {
      resolveInstall = resolve
    }))
    render(<AppDialogProvider><RuntimeStorageCard setStatus={vi.fn()} /></AppDialogProvider>)

    const row = (await screen.findByText('Qiskit Runtime')).closest('.settings-list-row') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Installer le runtime' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Installer le runtime' }))

    await waitFor(() => {
      expect(within(row).getByRole('status')).toHaveTextContent('Installation du runtime en cours')
    })
    expect(row.querySelectorAll('.task-spinner').length).toBeGreaterThan(0)
    expect(within(row).getByRole('button', { name: 'Installation en cours' })).toBeDisabled()
    expect(row).toHaveAttribute('aria-busy', 'true')

    resolveInstall({ runtimeId: 'external.qiskit' })
    await waitFor(() => expect(within(row).queryByRole('status')).not.toBeInTheDocument())
  })

  it('shows the spinning loader when the backend reports an in-progress install', async () => {
    const report = await mocks.getRuntimeStorage()
    mocks.getRuntimeStorage.mockResolvedValue({
      ...report,
      runtimes: [{ ...report.runtimes[0], status: 'installing', error: undefined }],
    })
    render(<RuntimeStorageCard setStatus={vi.fn()} />)

    const row = (await screen.findByText('Qiskit Runtime')).closest('.settings-list-row') as HTMLElement
    expect(await within(row).findByRole('status')).toHaveTextContent('Installation du runtime en cours')
    expect(row.querySelector('.task-spinner')).not.toBeNull()
    expect(within(row).getByRole('button', { name: 'Installation en cours' })).toBeDisabled()
  })

  it('does not mark non-installed runtimes with the installed status badge', async () => {
    render(<RuntimeStorageCard setStatus={vi.fn()} />)

    const row = (await screen.findByText('Qiskit Runtime')).closest('.settings-list-row') as HTMLElement
    expect(within(row).getByText('Attention requise')).toHaveClass('runtime-status--broken')
    expect(row.querySelector('.runtime-status--installed')).toBeNull()
  })

  it('marks only the Installed label green, not the whole row', async () => {
    const report = await mocks.getRuntimeStorage()
    mocks.getRuntimeStorage.mockResolvedValue({
      ...report,
      runtimes: [{ ...report.runtimes[0], status: 'installed', installedVersion: '2.5.2', error: undefined }],
    })
    render(<RuntimeStorageCard setStatus={vi.fn()} />)

    const row = (await screen.findByText('Qiskit Runtime')).closest('.settings-list-row') as HTMLElement
    expect(row).not.toHaveClass('settings-list-row--installed')
    expect(within(row).getByText('Installé')).toHaveClass('runtime-status--installed')
  })

  it('filters the runtime list from the search field', async () => {
    const report = await mocks.getRuntimeStorage()
    mocks.getRuntimeStorage.mockResolvedValue({
      ...report,
      runtimes: [
        report.runtimes[0],
        {
          ...report.runtimes[0],
          runtimeId: 'external.docling-cli',
          name: 'Docling CLI',
          status: 'installed',
          installedVersion: '2.123.0',
          error: undefined,
        },
      ],
    })
    render(<RuntimeStorageCard setStatus={vi.fn()} />)

    await screen.findByText('Qiskit Runtime')
    expect(screen.getByText('Docling CLI')).toBeInTheDocument()
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Rechercher un runtime (nom, id, plugin…)' }),
      { target: { value: 'docling' } },
    )
    expect(screen.getByText('Docling CLI')).toBeInTheDocument()
    expect(screen.queryByText('Qiskit Runtime')).not.toBeInTheDocument()
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Rechercher un runtime (nom, id, plugin…)' }),
      { target: { value: 'zzz-no-match' } },
    )
    expect(screen.getByText('Aucun runtime ne correspond à cette recherche.')).toBeInTheDocument()
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
