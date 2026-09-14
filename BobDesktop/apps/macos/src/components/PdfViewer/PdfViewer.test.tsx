import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfViewer } from './PdfViewer'

const mock = vi.hoisted(() => ({
  prepare: vi.fn(), destroy: vi.fn(async () => {}), getPage: vi.fn(), getDocument: vi.fn(),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
}))
vi.mock('../../lib/ipc', () => ({ prepareFilePreview: mock.prepare }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {}, getDocument: mock.getDocument,
  TextLayer: class { render() { return Promise.resolve() } cancel() {} },
}))
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined)
  mock.prepare.mockResolvedValue({ kind: 'pdf', path: '/tmp/test.pdf', previewPath: '/tmp/test.pdf' })
  mock.getPage.mockImplementation(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render: mock.render, streamTextContent: () => ({}),
  }))
  mock.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 3, getPage: mock.getPage }), destroy: mock.destroy })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('PdfViewer', () => {
  it('uses PDF page count, navigates, zooms and releases its worker', async () => {
    const view = render(<PdfViewer path="/tmp/test.pdf" title="Rapport" />)
    await screen.findByText('1 / 3')
    await waitFor(() => expect(mock.render).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Page précédente' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Page suivante' }))
    await waitFor(() => expect(mock.getPage).toHaveBeenLastCalledWith(2))
    fireEvent.click(screen.getByRole('button', { name: 'Agrandir le PDF' }))
    expect(screen.getByText('125 %')).toBeVisible()
    view.unmount()
    expect(mock.destroy).toHaveBeenCalledOnce()
  })
  it('shows errors and retains the open action', async () => {
    mock.prepare.mockRejectedValueOnce(new Error('PDF introuvable'))
    const onOpen = vi.fn()
    render(<PdfViewer path="/tmp/missing.pdf" title="Absent" onOpen={onOpen} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF introuvable')
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })
  it('does not load a stale file after its preview resolves', async () => {
    let resolve: (preview: unknown) => void = () => {}
    mock.prepare.mockReturnValueOnce(new Promise(value => { resolve = value }))
    const view = render(<PdfViewer path="/tmp/old.pdf" title="Ancien" />)
    view.unmount()
    await act(async () => resolve({ kind: 'pdf', path: '/tmp/old.pdf' }))
    expect(mock.getDocument).not.toHaveBeenCalled()
  })
})
