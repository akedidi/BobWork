import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModesView from './ModesView'
import type { ModeCatalogEntry } from '@bob-work/shared-types'

const mocks = vi.hoisted(() => ({
  listModeMarketplace: vi.fn(),
  installBobMode: vi.fn(),
  uninstallBobMode: vi.fn(),
  importBobModeYaml: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  listModeMarketplace: mocks.listModeMarketplace,
  installBobMode: mocks.installBobMode,
  uninstallBobMode: mocks.uninstallBobMode,
  importBobModeYaml: mocks.importBobModeYaml,
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</div>
}

const installed: ModeCatalogEntry = {
  slug: 'agent',
  name: 'Agent',
  description: 'Mode intégré Bob Shell.',
  groups: ['read', 'edit', 'command'],
  builtin: true,
  source: 'builtin',
  installed: true,
  catalog: false,
}

const catalog: ModeCatalogEntry = {
  slug: 'shell-debug',
  name: 'Shell Debugger',
  description: 'Diagnostiquer une session shell.',
  groups: ['read', 'command'],
  builtin: false,
  source: 'bob-work-catalog',
  installed: false,
  catalog: true,
}

describe('ModesView', () => {
  beforeEach(() => {
    mocks.listModeMarketplace.mockResolvedValue([installed, catalog])
    mocks.installBobMode.mockResolvedValue({
      slug: catalog.slug,
      name: catalog.name,
      description: catalog.description,
      groups: catalog.groups,
      builtin: false,
      source: '~/.bob/settings/custom_modes.yaml',
    })
    mocks.uninstallBobMode.mockResolvedValue(undefined)
    mocks.importBobModeYaml.mockResolvedValue({
      slug: 'my-custom',
      name: 'My Custom',
      description: null,
      groups: ['read'],
      builtin: false,
      source: '~/.bob/settings/custom_modes.yaml',
    })
  })

  it('affiche les sections installés et catalogue', async () => {
    render(
      <MemoryRouter>
        <ModesView />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Installés' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Catalogue' })).toBeVisible()
    expect(screen.getByText('Agent')).toBeVisible()
    expect(screen.getByText('Shell Debugger')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeVisible()
  })

  it('installe un mode du catalogue', async () => {
    render(
      <MemoryRouter>
        <ModesView />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Télécharger' }))

    await waitFor(() => {
      expect(mocks.installBobMode).toHaveBeenCalledWith('shell-debug')
    })
  })

  it('ouvre le chat avec le prompt de création de mode', async () => {
    render(
      <MemoryRouter initialEntries={['/modes']}>
        <Routes>
          <Route path="/modes" element={<ModesView />} />
          <Route path="/chat" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '+ Créer avec Bob' }))

    await waitFor(() => {
      const probe = screen.getByTestId('location').textContent ?? ''
      expect(probe.startsWith('/chat|')).toBe(true)
      expect(probe).toContain('custom_modes.yaml')
    })
  })

  it('en mode réglages, n’affiche pas la barre de titre autonome', async () => {
    render(
      <MemoryRouter>
        <ModesView embedded />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Installés' })).toBeVisible()
    expect(document.querySelector('.topbar')).toBeNull()
  })

  it('ouvre le dialogue d’import YAML', async () => {
    render(
      <MemoryRouter>
        <ModesView />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Importer YAML' }))

    expect(screen.getByRole('dialog', { name: 'Importer un mode YAML' })).toBeVisible()
    expect(screen.getByLabelText('YAML du mode')).toBeVisible()
  })
})
