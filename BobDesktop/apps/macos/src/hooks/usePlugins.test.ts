import { describe, expect, it } from 'vitest'
import type { Plugin } from '@bob-work/shared-types'
import {
  groupPluginsForDisplay,
  hideBuiltinShadows,
  isIbmCatalogPlugin,
  isIbmProductPlugin,
  isIbmProfessionPlugin,
} from './usePlugins'

function plugin(
  partial: Omit<Partial<Plugin>, 'manifest'> & Pick<Plugin, 'id' | 'name'> & { manifest?: Record<string, unknown> },
): Plugin {
  return {
    version: '1.0.0',
    description: '',
    scope: 'personal',
    category: 'recipe',
    installState: 'installed',
    validationState: 'valid',
    createdAt: '',
    updatedAt: '',
    ...partial,
    manifest: (partial.manifest ?? {}) as unknown as Plugin['manifest'],
  } as Plugin
}

describe('IBM catalog classification', () => {
  it('treats professions as Business, not IBM products', () => {
    const designer = plugin({
      id: 'builtin-ibm-agentic-designer',
      name: 'Designer',
      manifest: { builtin: true, slug: 'ibm-agentic-designer', productFamily: 'IBM Agentic' },
    })
    expect(isIbmProfessionPlugin(designer)).toBe(true)
    expect(isIbmProductPlugin(designer)).toBe(false)
    expect(isIbmCatalogPlugin(designer)).toBe(true)
  })

  it('treats Docling and BeeAI as IBM products', () => {
    expect(isIbmProductPlugin(plugin({
      id: 'builtin-docling',
      name: 'Docling',
      manifest: { builtin: true, slug: 'bob-work-docling' },
    }))).toBe(true)
    expect(isIbmProfessionPlugin(plugin({
      id: 'builtin-docling',
      name: 'Docling',
      manifest: { builtin: true, slug: 'bob-work-docling' },
    }))).toBe(false)
    expect(isIbmProductPlugin(plugin({
      id: 'builtin-beeai-framework',
      name: 'BeeAI Framework',
      manifest: { vendor: 'IBM', slug: 'ibm-beeai-framework' },
    }))).toBe(true)
  })

  it('does not treat Office builtins or the built-in IBM brief as IBM catalog products', () => {
    expect(isIbmCatalogPlugin(plugin({
      id: 'builtin-documents',
      name: 'Documents',
      manifest: { builtin: true, slug: 'bob-work-documents' },
    }))).toBe(false)
    expect(isIbmCatalogPlugin(plugin({
      id: 'bob-work-ibm-pursuit',
      name: 'Brief Mission IBM',
      manifest: { builtin: true, slug: 'bob-work-ibm-pursuit' },
    }))).toBe(false)
  })
})

describe('hideBuiltinShadows', () => {
  it('keeps the built-in Docling and drops the agentic alias copy', () => {
    const visible = hideBuiltinShadows([
      plugin({ id: 'builtin-docling', name: 'Docling', manifest: { builtin: true, slug: 'bob-work-docling' } }),
      plugin({ id: 'agentic-docling', name: 'Docling', manifest: { slug: 'docling', agentic: true } }),
    ])
    expect(visible.map(item => item.id)).toEqual(['builtin-docling'])
  })
})

describe('groupPluginsForDisplay', () => {
  it('splits IBM products and Business professions', () => {
    const sections = groupPluginsForDisplay([
      plugin({ id: 'builtin-documents', name: 'Documents', manifest: { builtin: true } }),
      plugin({ id: 'mine', name: 'Perso' }),
      plugin({ id: 'builtin-docling', name: 'Docling', manifest: { builtin: true, slug: 'bob-work-docling' } }),
      plugin({ id: 'builtin-ibm-agentic-designer', name: 'Designer', manifest: { builtin: true, slug: 'ibm-agentic-designer' } }),
    ])
    expect(sections.map(section => section.id)).toEqual(['personal', 'business', 'ibm', 'builtin'])
    expect(sections[0].plugins.map(item => item.id)).toEqual(['mine'])
    expect(sections[1].plugins.map(item => item.id)).toEqual(['builtin-ibm-agentic-designer'])
    expect(sections[2].plugins.map(item => item.id)).toEqual(['builtin-docling'])
    expect(sections[3].plugins.map(item => item.id)).toEqual(['builtin-documents'])
  })
})
