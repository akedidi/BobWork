import { describe, expect, it, vi } from 'vitest'
import {
  formatFileSize,
  getActiveComposerMentions,
  normalizeComposerCapabilityMentions,
  getActivePluginMention,
  getActivePluginMentions,
  getFileExtension,
  getFileTypeLabel,
  getFileVisualKind,
  mergeAttachmentPaths,
  removeComposerMention,
  clipboardLooksLikeAttachments,
  collectPasteAttachmentPaths,
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
    expect(mergeAttachmentPaths(
      [{ path: '/a', isDirectory: false }, { path: '/b', isDirectory: false }],
      [{ path: '/b', isDirectory: false }, { path: '/c', isDirectory: true }],
    )).toEqual([
      { path: '/a', isDirectory: false },
      { path: '/b', isDirectory: false },
      { path: '/c', isDirectory: true },
    ])
  })

  it('returns extension labels for chips', () => {
    expect(getFileExtension('/tmp/report.pdf')).toBe('pdf')
    expect(getFileTypeLabel('/tmp/report.pdf')).toBe('PDF')
    expect(getFileTypeLabel('/tmp/project')).toBe('')
    expect(getFileTypeLabel('/tmp/a.PDF')).toBe('PDF')
  })

  it('detects attachment pastes vs plain text', () => {
    expect(clipboardLooksLikeAttachments({ types: ['text/plain'], files: [], items: [] })).toBe(false)
    expect(clipboardLooksLikeAttachments({ types: ['Files'], files: [], items: [] })).toBe(true)
    expect(clipboardLooksLikeAttachments({
      types: ['image/png'],
      files: [{ type: 'image/png', name: 'clip.png' } as never],
      items: [],
    })).toBe(true)
  })

  it('collects Finder paths and clipboard images for paste', async () => {
    const writeImage = vi.fn(async () => '/tmp/paste-clipboard.png')
    const readClipboardPaths = vi.fn(async () => ['/tmp/from-finder.pdf'])
    const blob = {
      type: 'image/png',
      name: 'clip.png',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }
    const paths = await collectPasteAttachmentPaths({
      types: ['Files', 'image/png'],
      files: [blob as never],
      items: [{ type: 'image/png', getAsFile: () => blob as never }],
    }, { readClipboardPaths, writeImage })

    expect(writeImage).toHaveBeenCalled()
    expect(readClipboardPaths).toHaveBeenCalled()
    expect(paths).toEqual(['/tmp/paste-clipboard.png', '/tmp/from-finder.pdf'])
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
