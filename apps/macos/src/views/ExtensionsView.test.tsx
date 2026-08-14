import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExtensionsView from './ExtensionsView'

const mocks = vi.hoisted(() => ({
  getSkills: vi.fn(),
  saveSkill: vi.fn(),
  setSkillEnabled: vi.fn(),
  deleteSkill: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getSkills: mocks.getSkills,
  saveSkill: mocks.saveSkill,
  setSkillEnabled: mocks.setSkillEnabled,
  deleteSkill: mocks.deleteSkill,
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</div>
}

const skills = [{
  slug: 'analyse-contrats',
  name: 'Analyse contrats',
  description: 'Relit un contrat et liste les risques.',
  content: 'Étapes…',
  scope: 'global-bob',
  enabled: true,
  sourcePath: '/Users/me/.bob/skills/analyse-contrats/SKILL.md',
}]

describe('ExtensionsView', () => {
  beforeEach(() => {
    mocks.getSkills.mockResolvedValue(skills)
    mocks.saveSkill.mockResolvedValue(skills[0])
    mocks.setSkillEnabled.mockResolvedValue(undefined)
    mocks.deleteSkill.mockResolvedValue(undefined)
  })

  it('ouvre le chat pour créer un skill, sans wizard ni popup', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<ExtensionsView />} />
          <Route path="/chat" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: 'Formulaire' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Importer Claude' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '+ Nouveau skill' }))

    await waitFor(() => {
      const probe = screen.getByTestId('location').textContent ?? ''
      expect(probe.startsWith('/chat|')).toBe(true)
      expect(probe).toContain('skill_builder')
      expect(probe).not.toContain('initialPrompt')
    })
    expect(screen.queryByRole('dialog', { name: 'Nouveau skill' })).not.toBeInTheDocument()
  })

  it('ouvre le chat avec le prompt d’import Claude open-source', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<ExtensionsView />} />
          <Route path="/chat" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Importer Claude' }))

    await waitFor(() => {
      const probe = screen.getByTestId('location').textContent ?? ''
      expect(probe.startsWith('/chat|')).toBe(true)
      expect(probe).toContain('rapatrier un skill Claude')
      expect(probe).toContain('attribution')
    })
  })

  it('affiche les skills perso en haut, du plus récent au plus ancien', async () => {
    mocks.getSkills.mockResolvedValue([
      {
        slug: 'bob-work-computer-use',
        name: 'Computer Use',
        description: 'Contrôle le Mac.',
        content: '',
        scope: 'global-bob',
        enabled: true,
        sourcePath: '/Users/me/.bob/skills/bob-work-computer-use/SKILL.md',
        builtin: true,
        createdAt: '2026-08-11T12:00:00Z',
        updatedAt: '2026-08-11T12:00:00Z',
      },
      {
        slug: 'old-brief',
        name: 'Ancien brief',
        description: 'Skill perso ancien.',
        content: '',
        scope: 'global-bob',
        enabled: true,
        sourcePath: '/Users/me/.bob/skills/old-brief/SKILL.md',
        createdAt: '2026-08-01T10:00:00Z',
        updatedAt: '2026-08-01T10:00:00Z',
      },
      {
        slug: 'new-brief',
        name: 'Nouveau brief',
        description: 'Skill perso récent.',
        content: '',
        scope: 'global-bob',
        enabled: true,
        sourcePath: '/Users/me/.bob/skills/new-brief/SKILL.md',
        createdAt: '2026-08-10T10:00:00Z',
        updatedAt: '2026-08-12T09:00:00Z',
      },
    ])
    render(
      <MemoryRouter>
        <ExtensionsView />
      </MemoryRouter>,
    )
    await screen.findByText('Nouveau brief')
    const titles = document.querySelectorAll('.skill-row-copy strong')
    expect([...titles].map(node => node.textContent)).toEqual([
      'Nouveau brief',
      'Ancien brief',
      'Computer Use',
    ])
  })

  it('ouvre le formulaire manuel en option secondaire', async () => {
    render(
      <MemoryRouter>
        <ExtensionsView />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Formulaire' }))

    expect(screen.getByText('Skill — formulaire')).toBeVisible()
    expect(screen.getByPlaceholderText('analyse-contrats')).toBeVisible()
    expect(screen.getByPlaceholderText(/Relit un contrat/)).toBeVisible()
  })
})
