import { describe, expect, it } from 'vitest'
import {
  formatFileSize,
  getActiveComposerMentions,
  normalizeComposerCapabilityMentions,
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
    expect(getFileVisualKind('/tmp/meeting-recording.m4a')).toBe('audio')
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
    expect(getSuggestedBuiltinPluginId('/tmp/scan.png')).toBe('builtin-docling')
    expect(getSuggestedBuiltinPluginId('/tmp/image.jpg')).toBe('builtin-docling')
    expect(getSuggestedBuiltinPluginId('/tmp/image.gif')).toBeNull()
  })

  it('detects active plugin mentions in composer text', () => {
    expect(getActivePluginMention('Analyse @plugin:builtin-word ce DOCX')).toBe('builtin-word')
    expect(getActivePluginMention('Sans plugin')).toBeNull()
  })

  it('recognizes plugin mentions even when prompt text is attached without a space', () => {
    const catalog = { pluginIds: ['builtin-word', 'bob-work-cto-invest'] }
    expect(getActivePluginMentions('@plugin:builtin-wordAnalyse ce DOCX', catalog)).toEqual(['builtin-word'])
    expect(normalizeComposerCapabilityMentions('@plugin:builtin-wordAnalyse ce DOCX', catalog))
      .toBe('@plugin:builtin-word Analyse ce DOCX')
    expect(getActiveComposerMentions('@plugin:builtin-wordAnalyse @skill:bob-work-github go', catalog)).toEqual([
      { kind: 'plugin', id: 'builtin-word' },
      { kind: 'skill', id: 'bob-work-github' },
    ])
  })

  it('detects multiple plugin, skill and mcp mentions for preview chips', () => {
    const text = '@plugin:bob-work-ibm-pursuit @skill:bob-work-github @integration:github @api:tmdb @plugin:bob-work-cto-invest @mcp:custom-tools @db:sales go'
    expect(getActivePluginMentions(text)).toEqual(['bob-work-ibm-pursuit', 'bob-work-cto-invest'])
    expect(getActiveComposerMentions(text)).toEqual([
      { kind: 'plugin', id: 'bob-work-ibm-pursuit' },
      { kind: 'skill', id: 'bob-work-github' },
      { kind: 'integration', id: 'github' },
      { kind: 'api', id: 'tmdb' },
      { kind: 'plugin', id: 'bob-work-cto-invest' },
      { kind: 'mcp', id: 'custom-tools' },
      { kind: 'db', id: 'sales' },
    ])
    expect(removeComposerMention(text, 'plugin', 'bob-work-ibm-pursuit')).toBe(
      '@skill:bob-work-github @integration:github @api:tmdb @plugin:bob-work-cto-invest @mcp:custom-tools @db:sales go',
    )
    expect(removeComposerMention(text, 'db', 'sales')).toBe(
      '@plugin:bob-work-ibm-pursuit @skill:bob-work-github @integration:github @api:tmdb @plugin:bob-work-cto-invest @mcp:custom-tools go',
    )
  })

  it('canonicalise et déduplique les anciens noms du plugin Cloud Architect', () => {
    expect(normalizeComposerCapabilityMentions(
      '@plugin:agentic-cloud-architect Crée le diagramme @plugin:builtin-cloud-architect @plugin:agentic-senior-cloud-architect',
    )).toBe('@plugin:agentic-cloud-architect Crée le diagramme')
  })
})
