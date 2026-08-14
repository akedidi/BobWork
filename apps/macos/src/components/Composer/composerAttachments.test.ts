import { describe, expect, it } from 'vitest'
import {
  formatFileSize,
  getActiveComposerMentions,
  getActivePluginMention,
  getActivePluginMentions,
  getFileExtension,
  getFileTypeLabel,
  getFileVisualKind,
  getSuggestedBuiltinPluginId,
  mergeAttachmentPaths,
  removeComposerMention,
} from './composerAttachments'

describe('composerAttachments', () => {
  it('classifies common file extensions', () => {
    expect(getFileVisualKind('/tmp/report.pdf')).toBe('pdf')
    expect(getFileVisualKind('/tmp/report.docx')).toBe('document')
    expect(getFileVisualKind('/tmp/data.xlsx')).toBe('spreadsheet')
    expect(getFileVisualKind('/tmp/slides.pptx')).toBe('presentation')
    expect(getFileVisualKind('/tmp/photo.png')).toBe('image')
    expect(getFileVisualKind('/tmp/project', true)).toBe('folder')
  })

  it('formats readable file sizes', () => {
    expect(formatFileSize(512)).toBe('512 o')
    expect(formatFileSize(2048)).toBe('2.0 Ko')
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 Mo')
  })

  it('deduplicates attachment paths', () => {
    expect(mergeAttachmentPaths(['/a', '/b'], ['/b', '/c'])).toEqual(['/a', '/b', '/c'])
  })

  it('returns extension labels for chips', () => {
    expect(getFileExtension('/tmp/report.pdf')).toBe('pdf')
    expect(getFileTypeLabel('/tmp/report.pdf')).toBe('PDF')
    expect(getFileTypeLabel('/tmp/project', true)).toBe('DOSSIER')
    expect(getFileTypeLabel('/tmp/a.PDF')).toBe('PDF')
  })

  it('suggests builtin plugins from office file extensions', () => {
    expect(getSuggestedBuiltinPluginId('/tmp/report.docx')).toBe('builtin-word')
    expect(getSuggestedBuiltinPluginId('/tmp/data.xlsx')).toBe('builtin-excel')
    expect(getSuggestedBuiltinPluginId('/tmp/deck.pptx')).toBe('builtin-powerpoint')
    expect(getSuggestedBuiltinPluginId('/tmp/notes.pdf')).toBe('builtin-documents')
    expect(getSuggestedBuiltinPluginId('/tmp/image.png')).toBeNull()
  })

  it('detects active plugin mentions in composer text', () => {
    expect(getActivePluginMention('Analyse @plugin:builtin-word ce DOCX')).toBe('builtin-word')
    expect(getActivePluginMention('Sans plugin')).toBeNull()
  })

  it('detects multiple plugin, skill and mcp mentions for preview chips', () => {
    const text = '@plugin:bob-work-ibm-pursuit @skill:bob-work-github @plugin:bob-work-cto-invest @mcp:custom-tools go'
    expect(getActivePluginMentions(text)).toEqual(['bob-work-ibm-pursuit', 'bob-work-cto-invest'])
    expect(getActiveComposerMentions(text)).toEqual([
      { kind: 'plugin', id: 'bob-work-ibm-pursuit' },
      { kind: 'skill', id: 'bob-work-github' },
      { kind: 'plugin', id: 'bob-work-cto-invest' },
      { kind: 'mcp', id: 'custom-tools' },
    ])
    expect(removeComposerMention(text, 'plugin', 'bob-work-ibm-pursuit')).toBe(
      '@skill:bob-work-github @plugin:bob-work-cto-invest @mcp:custom-tools go',
    )
  })
})
