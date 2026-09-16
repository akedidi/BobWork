import { describe, expect, it } from 'vitest'
import {
  extractLocalFilePaths,
  fileNameFromPath,
  linkifyLocalFilePaths,
  normalizeLocalFilePathKey,
  resolveDurableLocalPath,
} from './localFilePaths'

describe('localFilePaths', () => {
  it('extracts absolute pptx paths from Bob replies', () => {
    const text = '📂 Chemin absolu : /Users/aniskedidi/Desktop/IBM_AXA_Brief_Mission.pptx (Double-clic)'
    expect(extractLocalFilePaths(text)).toEqual([
      '/Users/aniskedidi/Desktop/IBM_AXA_Brief_Mission.pptx',
    ])
  })

  it('extracts absolute SVG diagrams from Bob replies', () => {
    const text = 'Diagramme : /tmp/azure-agentic-ai/architecture.svg'
    expect(extractLocalFilePaths(text)).toEqual([
      '/tmp/azure-agentic-ai/architecture.svg',
    ])
  })

  it('extracts the reproducible Python source next to an HTML visualization export', () => {
    const text = 'Fichiers : /tmp/bell_simulation.py et /tmp/bell_results.html'
    expect(extractLocalFilePaths(text)).toEqual([
      '/tmp/bell_simulation.py',
      '/tmp/bell_results.html',
    ])
  })

  it('extracts generated images from macOS paths containing spaces', () => {
    const text =
      'architecture.png\t/Users/aniskedidi/Library/Application Support/com.bobwork.desktop/workspaces/run/bob-e2e/architecture.png'
    expect(extractLocalFilePaths(text)).toEqual([
      '/Users/aniskedidi/Library/Application Support/com.bobwork.desktop/workspaces/run/bob-e2e/architecture.png',
    ])
  })

  it('dedupes absolute and ~/ forms of the same file', () => {
    const text = `
      Chemin : /Users/aniskedidi/Desktop/IBM_AXA_Brief_Mission.pptx
      qlmanage -p ~/Desktop/IBM_AXA_Brief_Mission.pptx
    `
    expect(extractLocalFilePaths(text)).toEqual([
      '/Users/aniskedidi/Desktop/IBM_AXA_Brief_Mission.pptx',
    ])
    expect(normalizeLocalFilePathKey('~/Desktop/IBM_AXA_Brief_Mission.pptx')).toBe(
      normalizeLocalFilePathKey('/Users/aniskedidi/Desktop/IBM_AXA_Brief_Mission.pptx'),
    )
  })

  it('dedupes and keeps several deliverables', () => {
    const text = `
      /tmp/a.docx and /tmp/a.docx again
      also ~/Documents/report.pdf
    `
    expect(extractLocalFilePaths(text)).toEqual([
      '/tmp/a.docx',
      '~/Documents/report.pdf',
    ])
  })

  it('linkifies bare paths for markdown', () => {
    const linked = linkifyLocalFilePaths('Fichier : /Users/me/Desktop/deck.pptx prêt.')
    expect(linked).toContain('[deck.pptx](/Users/me/Desktop/deck.pptx)')
    expect(fileNameFromPath('/Users/me/Desktop/deck.pptx')).toBe('deck.pptx')
  })

  it('wraps markdown destinations containing spaces', () => {
    const linked = linkifyLocalFilePaths(
      'Image : /Users/me/Library/Application Support/Bob/architecture.png',
    )
    expect(linked).toContain(
      '[architecture.png](</Users/me/Library/Application Support/Bob/architecture.png>)',
    )
  })

  it('does not linkify ~/ when absolute path already present', () => {
    const input =
      'Chemin : /Users/me/Desktop/deck.pptx (qlmanage -p ~/Desktop/deck.pptx)'
    const linked = linkifyLocalFilePaths(input)
    expect(linked).toContain('[deck.pptx](/Users/me/Desktop/deck.pptx)')
    expect(linked).toContain('~/Desktop/deck.pptx')
    expect(linked.match(/\[deck\.pptx\]/g)).toHaveLength(1)
  })

  it('does not double-wrap existing markdown links', () => {
    const input = 'Voir [deck.pptx](/Users/me/Desktop/deck.pptx).'
    expect(linkifyLocalFilePaths(input)).toBe(input)
  })

  it('never mistakes API URLs for local JSON files', () => {
    const input = 'Exemple : `https://api.weatherapi.com/v1/forecast.json?key=CLEF&q=Paris`'
    expect(extractLocalFilePaths(input)).toEqual([])
    expect(linkifyLocalFilePaths(input)).toBe(input)
  })

  it('collapses bob-isolated skill paths onto the host ~/.bob/skills key', () => {
    const isolated =
      '/private/var/folders/5n/8bqj71ls731721nymrrw18tc0000gn/T/bob-isolated-Edb9u5/.bob/skills/learning-path-sandbox-v2/SKILL.md'
    const host = '/Users/aniskedidi/.bob/skills/learning-path-sandbox-v2/SKILL.md'
    expect(normalizeLocalFilePathKey(isolated)).toBe(normalizeLocalFilePathKey(host))
    expect(normalizeLocalFilePathKey('~/.bob/skills/learning-path-sandbox-v2/SKILL.md')).toBe(
      normalizeLocalFilePathKey(host),
    )
  })

  it('rewrites bob-isolated and ~/ paths to a durable host path', () => {
    const home = '/Users/aniskedidi'
    expect(
      resolveDurableLocalPath(
        '/var/folders/5n/8bqj71ls731721nymrrw18tc0000gn/T/bob-isolated-xyz/.bob/skills/demo/SKILL.md',
        home,
      ),
    ).toBe('/Users/aniskedidi/.bob/skills/demo/SKILL.md')
    expect(resolveDurableLocalPath('~/.bob/skills/demo/SKILL.md', home)).toBe(
      '/Users/aniskedidi/.bob/skills/demo/SKILL.md',
    )
  })
})
