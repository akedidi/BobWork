import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArtifactGallery from './ArtifactGallery'

const mocks = vi.hoisted(() => ({
  getArtifacts: vi.fn(),
  deleteArtifact: vi.fn(),
  openArtifact: vi.fn(),
  generateArtifact: vi.fn(),
  getConversations: vi.fn(),
  prepareFilePreview: vi.fn(),
  openPreviewResource: vi.fn(),
  revealInFileManager: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getArtifacts: mocks.getArtifacts,
  deleteArtifact: mocks.deleteArtifact,
  openArtifact: mocks.openArtifact,
  generateArtifact: mocks.generateArtifact,
  getConversations: mocks.getConversations,
  prepareFilePreview: mocks.prepareFilePreview,
  openPreviewResource: mocks.openPreviewResource,
  revealInFileManager: mocks.revealInFileManager,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

describe('ArtifactGallery', () => {
  beforeEach(() => {
    mocks.getArtifacts.mockReset()
    mocks.deleteArtifact.mockReset()
    mocks.openArtifact.mockReset()
    mocks.generateArtifact.mockReset()
    mocks.getConversations.mockReset()
    mocks.prepareFilePreview.mockReset()
    mocks.openPreviewResource.mockReset()
    mocks.revealInFileManager.mockReset()
    mocks.getConversations.mockResolvedValue([])
    mocks.prepareFilePreview.mockResolvedValue({
      path: '/tmp/a1.docx',
      name: 'a1.docx',
      kind: 'office',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 1200,
      modifiedAt: null,
      previewPath: null,
      content: null,
      entries: [],
      quickLook: false,
    })
  })

  it('montre un état vide après un chargement réussi', async () => {
    mocks.getArtifacts.mockResolvedValue([])
    render(<ArtifactGallery />)

    expect(await screen.findByText('Aucun artefact')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('montre une bannière d’erreur au lieu d’un vide trompeur', async () => {
    mocks.getArtifacts.mockRejectedValue(new Error('disque inaccessible'))
    render(<ArtifactGallery />)

    expect(await screen.findByRole('alert')).toHaveTextContent('disque inaccessible')
    expect(screen.queryByText('Aucun artefact')).not.toBeInTheDocument()

    mocks.getArtifacts.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => {
      expect(screen.getByText('Aucun artefact')).toBeVisible()
    })
  })

  it('génère un document Word via le modal', async () => {
    mocks.getArtifacts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'a1',
        artifactType: 'docx',
        title: 'Rapport test',
        filePath: '/tmp/a1.docx',
        version: 1,
        sources: [],
        validationStatus: 'valid',
        exported: false,
        createdAt: new Date().toISOString(),
        size: 1200,
      }])
    mocks.generateArtifact.mockResolvedValue({
      id: 'a1',
      artifactType: 'docx',
      title: 'Rapport test',
      filePath: '/tmp/a1.docx',
      version: 1,
      sources: [],
      validationStatus: 'valid',
      exported: false,
      createdAt: new Date().toISOString(),
      size: 1200,
    })

    render(<ArtifactGallery />)
    expect(await screen.findByText('Aucun artefact')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '+ Générer' }))
    fireEvent.click(screen.getByRole('button', { name: /Document/ }))
    fireEvent.change(screen.getByPlaceholderText('Ex : Rapport Q2 2024'), {
      target: { value: 'Rapport test' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Introduction/), {
      target: { value: '## Intro\n- Point 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Générer' }))

    await waitFor(() => {
      expect(mocks.generateArtifact).toHaveBeenCalledWith({
        artifactType: 'docx',
        title: 'Rapport test',
        content: '## Intro\n- Point 1',
      })
    })
    expect(await screen.findByText('Rapport test')).toBeVisible()
  })

  it('ouvre l’aperçu dans le panneau droit au clic, sans ouvrir le fichier externe', async () => {
    mocks.getArtifacts.mockResolvedValue([{
      id: 'a1',
      artifactType: 'docx',
      title: 'Rapport test',
      filePath: '/tmp/a1.docx',
      version: 1,
      sources: [],
      origin: 'c1',
      validationStatus: 'valid',
      exported: false,
      createdAt: new Date().toISOString(),
      size: 1200,
    }])
    mocks.getConversations.mockResolvedValue([{
      id: 'c1',
      title: 'Brief Q2',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pinned: false,
      archived: false,
    }])

    render(<ArtifactGallery />)
    expect(await screen.findByText('Rapport test')).toBeVisible()
    expect(screen.getByText(/Conversation · Brief Q2/)).toBeVisible()
    expect(screen.queryByText('✓ Valide')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Rapport test'))

    expect(mocks.openArtifact).not.toHaveBeenCalled()
    expect(await screen.findByLabelText('Aperçus et activité')).toBeVisible()
    await waitFor(() => {
      expect(mocks.prepareFilePreview).toHaveBeenCalledWith('/tmp/a1.docx')
    })
    expect(screen.getByTitle('Afficher dans le Finder')).toBeVisible()
  })

  it('agrandit et réduit réellement une image avec les contrôles de zoom', async () => {
    mocks.getArtifacts.mockResolvedValue([{
      id: 'a1',
      artifactType: 'png',
      title: 'Image test',
      filePath: '/tmp/image.png',
      version: 1,
      sources: [],
      validationStatus: 'valid',
      exported: false,
      createdAt: new Date().toISOString(),
      size: 1200,
    }])
    mocks.prepareFilePreview.mockResolvedValue({
      path: '/tmp/image.png',
      name: 'image.png',
      kind: 'image',
      mimeType: 'image/png',
      size: 1200,
      modifiedAt: null,
      previewPath: '/tmp/image.png',
      previewPaths: ['/tmp/image.png'],
      content: null,
      entries: [],
      quickLook: false,
    })

    const { container } = render(<ArtifactGallery />)
    fireEvent.click(await screen.findByText('Image test'))

    const zoomIn = await screen.findByRole('button', { name: 'Zoomer' })
    const zoomOut = screen.getByRole('button', { name: 'Dézoomer' })
    const surface = container.querySelector<HTMLElement>('.preview-zoom-surface')
    expect(surface).not.toBeNull()
    expect(screen.getByRole('button', { name: /Zoom 100 %/ })).toBeVisible()
    expect(surface?.style.getPropertyValue('--preview-image-max-width')).toBe('100%')

    fireEvent.click(zoomIn)
    expect(screen.getByRole('button', { name: /Zoom 110 %/ })).toBeVisible()
    expect(surface?.style.getPropertyValue('--preview-image-max-width')).toBe('110%')

    fireEvent.click(zoomOut)
    fireEvent.click(zoomOut)
    expect(screen.getByRole('button', { name: /Zoom 90 %/ })).toBeVisible()
    expect(surface?.style.getPropertyValue('--preview-image-max-width')).toBe('90%')
  })

  it('redimensionne le panneau d’aperçu à la souris sans changer sa largeur par défaut', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    mocks.getArtifacts.mockResolvedValue([{
      id: 'a1',
      artifactType: 'docx',
      title: 'Rapport test',
      filePath: '/tmp/a1.docx',
      version: 1,
      sources: [],
      validationStatus: 'valid',
      exported: false,
      createdAt: new Date().toISOString(),
      size: 1200,
    }])

    render(<ArtifactGallery />)
    fireEvent.click(await screen.findByText('Rapport test'))

    const panel = await screen.findByLabelText('Aperçus et activité')
    const resizer = screen.getByRole('separator', { name: 'Redimensionner l’aperçu' })
    expect(panel).not.toHaveAttribute('style')

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      width: 520,
      height: 700,
      top: 48,
      right: 1000,
      bottom: 748,
      left: 480,
      x: 480,
      y: 48,
      toJSON: () => ({}),
    })
    vi.spyOn(panel.parentElement!, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 748,
      top: 0,
      right: 1000,
      bottom: 748,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(resizer, { button: 0, pointerId: 1, clientX: 480 })
    fireEvent.pointerMove(resizer, { pointerId: 1, clientX: 380 })
    fireEvent.pointerUp(resizer, { pointerId: 1, clientX: 380 })

    expect(panel).toHaveStyle({ width: '620px' })
    fireEvent.doubleClick(resizer)
    expect(panel.style.width).toBe('')
    vi.unstubAllGlobals()
  })

  it('demande confirmation avant de supprimer un artefact', async () => {
    mocks.getArtifacts.mockResolvedValue([{
      id: 'a1',
      artifactType: 'docx',
      title: 'Rapport test',
      filePath: '/tmp/a1.docx',
      version: 1,
      sources: [],
      validationStatus: 'valid',
      exported: false,
      createdAt: new Date().toISOString(),
      size: 1200,
    }])
    mocks.deleteArtifact.mockResolvedValue(undefined)

    render(<ArtifactGallery />)
    expect(await screen.findByText('Rapport test')).toBeVisible()

    fireEvent.click(screen.getByTitle('Supprimer'))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Supprimer l’artefact ?')
    expect(mocks.deleteArtifact).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByTitle('Supprimer'))
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => {
      expect(mocks.deleteArtifact).toHaveBeenCalledWith('a1')
    })
    await waitFor(() => {
      expect(screen.queryByText('Rapport test')).not.toBeInTheDocument()
    })
  })

  it('montre une erreur visible si la suppression échoue', async () => {
    mocks.getArtifacts.mockResolvedValue([{
      id: 'a1',
      artifactType: 'docx',
      title: 'Rapport test',
      filePath: '/tmp/a1.docx',
      version: 1,
      sources: [],
      validationStatus: 'valid',
      exported: false,
      createdAt: new Date().toISOString(),
      size: 1200,
    }])
    mocks.deleteArtifact.mockRejectedValue(new Error('fichier verrouillé'))

    render(<ArtifactGallery />)
    expect(await screen.findByText('Rapport test')).toBeVisible()
    fireEvent.click(screen.getByTitle('Supprimer'))
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('fichier verrouillé')
    expect(screen.getByText('Rapport test')).toBeVisible()
  })
})
