import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChromeSnapshotCard } from './ChromeSnapshotCard'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

const baseSnapshot = {
  id: 'browser:https://example.com',
  url: 'https://example.com',
  title: 'Example Domain',
  headings: ['Example Domain'],
  actions: [],
  text: '',
  pending: false,
  failed: false,
}

describe('ChromeSnapshotCard', () => {
  it('uses a captured local image when the snapshot provides one', () => {
    render(<ChromeSnapshotCard snapshot={{ ...baseSnapshot, imagePath: '/tmp/example.jpg' }} />)
    expect(screen.getByRole('img', { name: 'Aperçu de Example Domain' })).toHaveAttribute(
      'src',
      'asset:///tmp/example.jpg',
    )
  })

  it('keeps protected pages compact when no visual exists', () => {
    const { container } = render(<ChromeSnapshotCard snapshot={baseSnapshot} />)
    expect(container.querySelector('.chrome-snapshot-card')).toHaveClass('is-compact')
    expect(container.querySelector('.chrome-snapshot-preview')).toBeNull()
    expect(screen.getByText('Aperçu externe protégé')).toBeVisible()
  })

  it('opens the page from the compact fallback', () => {
    const onOpen = vi.fn()
    render(<ChromeSnapshotCard snapshot={baseSnapshot} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir dans le panneau' }))
    expect(onOpen).toHaveBeenCalledWith('https://example.com', 'Example Domain')
  })

  it('labels silent web retrieval without implying that Chrome was opened', () => {
    render(<ChromeSnapshotCard snapshot={{ ...baseSnapshot, background: true }} />)
    expect(screen.getByText('Contenu récupéré en arrière-plan')).toBeVisible()
    expect(screen.queryByText('Aperçu externe protégé')).not.toBeInTheDocument()
  })
})
