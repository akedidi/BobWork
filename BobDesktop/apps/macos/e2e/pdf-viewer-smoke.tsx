// Development-only fixture: real viewer/worker/PDF, with just the native file bridge mocked.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { mockIPC } from '@tauri-apps/api/mocks'
import { PdfViewer } from '../src/components/PdfViewer/PdfViewer'
mockIPC(command => {
  if (command === 'prepare_file_preview') return { kind: 'pdf', path: '/e2e/fixtures/native-documents.pdf' }
  throw new Error(`Unexpected native command: ${command}`)
})
;(window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string } }).__TAURI_INTERNALS__.convertFileSrc = path => path
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 740, margin: '24px auto', fontFamily: 'system-ui' }}><PdfViewer path="/e2e/fixtures/native-documents.pdf" title="LaTeX · Bob Work" /></main>)
