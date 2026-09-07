import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExecutionPlanCard } from './ExecutionPlanCard'

const plan = {
  id: 'plan-1',
  title: 'Créer le projet',
  steps: [
    { id: 'step-1', title: 'Initialiser les fichiers', status: 'completed' as const },
    { id: 'step-2', title: 'Construire l’interface', detail: 'Créer la navigation principale', status: 'running' as const },
    { id: 'step-3', title: 'Valider le projet', status: 'pending' as const },
  ],
}

describe('ExecutionPlanCard', () => {
  it('shows a compact pinned plan with live progress and step statuses', () => {
    render(<ExecutionPlanCard plan={plan} live />)

    expect(screen.getByRole('region', { name: 'Plan d’exécution' })).toHaveClass('is-live')
    expect(screen.getByText('Créer le projet')).toBeVisible()
    expect(screen.getByText('1/3 terminées')).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33')
    expect(screen.getByText(/Construire l’interface/)).toBeVisible()
    expect(screen.getByText('Créer la navigation principale')).toBeVisible()
    expect(screen.getByText('En cours')).toBeVisible()
  })

  it('only collapses after an explicit user action', () => {
    render(<ExecutionPlanCard plan={plan} live={false} />)

    const toggle = screen.getByRole('button', { name: /Créer le projet/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Initialiser les fichiers/)).toBeVisible()
    expect(screen.getByText('Interrompue')).toBeVisible()
    expect(screen.getByText(/Construire l’interface/).closest('li')).toHaveClass('is-paused')
    expect(screen.queryByText('En cours')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Initialiser les fichiers/)).not.toBeInTheDocument()
  })
})
