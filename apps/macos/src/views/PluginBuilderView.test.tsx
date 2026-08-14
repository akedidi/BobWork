import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../stores/appStore'
import PluginBuilderView from './PluginBuilderView'

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

describe('PluginBuilderView', () => {
  beforeEach(() => {
    navigate.mockReset()
    useAppStore.setState({ builderSession: null })
  })

  it('parcourt le wizard et lance la génération avec un brief structuré', () => {
    render(
      <MemoryRouter>
        <PluginBuilderView />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Que doit faire ce plugin ?' })).toBeVisible()
    fireEvent.change(screen.getByPlaceholderText('Ex. : Brief mission AXA'), { target: { value: 'Brief AXA' } })
    fireEvent.change(screen.getByPlaceholderText('Ex. : Prépare un brief client et liste les risques à vérifier.'), {
      target: { value: 'Prépare un brief client.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByRole('heading', { name: 'Quand s’exécute-t-il ?' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByRole('heading', { name: 'Quels outils embarquer ?' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByRole('heading', { name: 'Quelles autorisations ?' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByRole('heading', { name: 'Aperçu' })).toBeVisible()
    expect(screen.getByText('Brief AXA')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Générer le plugin' }))
    expect(useAppStore.getState().builderSession).toMatchObject({ kind: 'plugin_builder', guided: true })
    expect(useAppStore.getState().builderSession?.brief).toContain('Ne relance pas l’entretien')
    expect(navigate).toHaveBeenCalledWith('/chat', expect.objectContaining({
      state: expect.objectContaining({ mode: 'plugin_builder' }),
    }))
  })

  it('permet de quitter le wizard pour créer directement dans le chat', () => {
    render(
      <MemoryRouter>
        <PluginBuilderView />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'créer directement dans le chat' }))
    expect(useAppStore.getState().builderSession).toMatchObject({ kind: 'plugin_builder', guided: false })
    expect(useAppStore.getState().builderSession?.brief).toContain('sans formulaire')
    expect(navigate).toHaveBeenCalledWith('/chat', expect.objectContaining({
      state: expect.objectContaining({ mode: 'plugin_builder', initialPrompt: expect.stringContaining('sans formulaire') }),
    }))
  })
})
