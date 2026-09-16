import { useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { prepareFilePreview } from '../../lib/ipc'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import './PdfViewer.css'

/** One local PDF.js engine for conversation cards and the workspace panel. */
export function PdfViewer({ path, title, onOpen, zoom, onZoomChange }: {
  path: string; title: string; onOpen?: () => void
  zoom?: number; onZoomChange?: (zoom: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textLayer = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [localZoom, setLocalZoom] = useState(1)
  const [width, setWidth] = useState(600)
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(false)
  const scale = zoom ?? localZoom
  const changeZoom = (value: number) => (onZoomChange ?? setLocalZoom)(Math.min(3, Math.max(0.5, value)))

  useEffect(() => {
    const node = container.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = container.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setWidth(Math.max(180, entries[0].contentRect.width - 24)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let disposed = false
    let task: { destroy: () => Promise<void> } | undefined
    setDocument(null); setPage(1); setError('')
    void (async () => {
      const [pdfjs, preview] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), prepareFilePreview(path)])
      if (disposed) return
      if (preview.kind !== 'pdf' && !preview.previewPath?.toLowerCase().endsWith('.pdf')) throw new Error('Aperçu PDF indisponible')
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      const loading = pdfjs.getDocument({
        url: convertFileSrc(preview.previewPath || preview.path),
        cMapUrl: '/runtime-pdf/cmaps/', cMapPacked: true,
        standardFontDataUrl: '/runtime-pdf/standard_fonts/', wasmUrl: '/runtime-pdf/wasm/',
      })
      task = loading
      const pdf = await loading.promise
      if (!disposed) setDocument(pdf)
    })().catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : 'Impossible de charger le PDF') })
    return () => { disposed = true; void task?.destroy().catch(() => {}) }
  }, [path, visible])

  useEffect(() => {
    if (!document || !canvas.current || !textLayer.current) return
    let disposed = false
    let renderTask: { cancel: () => void } | undefined
    let layer: { cancel: () => void } | undefined
    const surface = canvas.current
    const text = textLayer.current
    text.replaceChildren()
    setRendering(true); setError('')
    void (async () => {
      const pdfPage = await document.getPage(page)
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      if (disposed) return
      const original = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: width / original.width * scale })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      surface.width = Math.floor(viewport.width * ratio)
      surface.height = Math.floor(viewport.height * ratio)
      surface.style.width = `${viewport.width}px`
      surface.style.height = `${viewport.height}px`
      text.style.setProperty('--total-scale-factor', String(viewport.scale))
      text.style.width = `${viewport.width}px`; text.style.height = `${viewport.height}px`
      const renderingTask = pdfPage.render({ canvas: surface, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      renderTask = renderingTask
      const textRendering = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: text, viewport })
      layer = textRendering
      await Promise.all([renderingTask.promise, textRendering.render()])
      if (!disposed) setRendering(false)
    })().catch(reason => {
      if (!disposed) { setRendering(false); setError(reason instanceof Error ? reason.message : 'Impossible d’afficher cette page') }
    })
    return () => { disposed = true; renderTask?.cancel(); layer?.cancel() }
  }, [document, page, scale, width])

  return <section className="bob-pdf-viewer" aria-label={`PDF : ${title}`} ref={container}>
    <div className="bob-pdf-toolbar">
      <strong title={title}>{title}</strong>
      <button type="button" disabled={!document || page <= 1} aria-label="Page précédente" onClick={() => setPage(value => value - 1)}>‹</button>
      <span aria-live="polite">{page} / {document?.numPages ?? '…'}</span>
      <button type="button" disabled={!document || page >= document.numPages} aria-label="Page suivante" onClick={() => setPage(value => value + 1)}>›</button>
      <button type="button" aria-label="Réduire le PDF" disabled={scale <= 0.5} onClick={() => changeZoom(scale - 0.25)}>−</button>
      <button type="button" aria-label="Ajuster le PDF à la largeur" onClick={() => changeZoom(1)}>{Math.round(scale * 100)} %</button>
      <button type="button" aria-label="Agrandir le PDF" disabled={scale >= 3} onClick={() => changeZoom(scale + 0.25)}>+</button>
      {onOpen && <button type="button" onClick={onOpen}>Ouvrir</button>}
    </div>
    {error ? <p role="alert" className="bob-pdf-error">{error}</p> : (!document || rendering) && <p role="status" className="bob-pdf-loading">Chargement du PDF…</p>}
    <div className="bob-pdf-scroll">
      <div className="bob-pdf-page" style={{ visibility: document ? 'visible' : 'hidden' }}>
        <canvas ref={canvas} aria-label={`${title} — page ${page}`} />
        <div ref={textLayer} className="textLayer" />
      </div>
    </div>
  </section>
}
