import { describe, expect, it } from 'vitest'
import type { DesignDocument } from '@bob-work/shared-types'
import { patchDesignDocument, validateDesignDocument } from '@bob-work/shared-types'
import { renderDesignPreview, renderDesignSvg } from './designPreview'

const document: DesignDocument = {
  version: '1.0',
  document: { id: 'document', name: 'Analytics dashboard', pages: [{ id: 'page', type: 'Page', layout: { mode: 'VERTICAL', gap: 16 }, children: [{ id: 'cta', type: 'Button', text: 'Create report', accessibleName: 'Create report', style: { background: '#0f62fe', color: '#fff', radius: 8 }, layout: { padding: 12 } }] }] },
  tokens: {}, components: {}, assets: {}, metadata: { title: 'Analytics dashboard' },
}

describe('Design IR preview', () => {
  it('renders a self-contained HTML preview without executable document content', () => {
    const html = renderDesignPreview(document)
    expect(html).toContain('data-design-node="cta"')
    expect(html).toContain('<button')
    expect(html).not.toContain('<script')
  })

  it('patches just the selected node', () => {
    const patched = patchDesignDocument(document, { nodeId: 'cta', changes: { text: 'Export report' } })
    expect(patched.document.pages[0].children?.[0].text).toBe('Export report')
    expect(patched.document.pages[0].id).toBe('page')
  })

  it('rejects duplicate node ids and produces an SVG fallback', () => {
    expect(() => validateDesignDocument({ ...document, document: { ...document.document, pages: [{ id: 'page', type: 'Page', children: [{ id: 'page', type: 'Text' }] }] } })).toThrow('Duplicate')
    expect(renderDesignSvg(document)).toContain('<svg')
  })
})
