import { describe, expect, it } from 'vitest'
import { extractChromeSnapshot, isChromeSnapshotTool, upsertChromeSnapshot } from './chromeSnapshot'

describe('chromeSnapshot', () => {
  it('recognizes namespaced Chrome MCP snapshot tools', () => {
    expect(isChromeSnapshotTool('mcp__bob-work-chrome-control_6001__browser_snapshot')).toBe(true)
    expect(isChromeSnapshotTool('chrome_read_front_tab')).toBe(true)
    expect(isChromeSnapshotTool('read_file')).toBe(false)
  })

  it('builds a pending card from tool_started url', () => {
    const snap = extractChromeSnapshot({
      eventType: 'tool_started',
      toolName: 'mcp__bob-work-chrome-control_6001__browser_snapshot',
      title: 'Aperçu Chrome : https://example.com',
      payload: { parameters: { url: 'https://example.com' } },
    })
    expect(snap).toMatchObject({
      url: 'https://example.com',
      pending: true,
      failed: false,
    })
  })

  it('parses finished JSON output into title, headings and text', () => {
    const snap = extractChromeSnapshot({
      eventType: 'tool_finished',
      toolName: 'browser_snapshot',
      content: JSON.stringify({
        title: 'Example Domain',
        url: 'https://example.com/',
        headings: ['Example Domain'],
        text: 'This domain is for use in illustrative examples.',
        snapshot: true,
      }),
      payload: {},
    })
    expect(snap).toMatchObject({
      title: 'Example Domain',
      url: 'https://example.com/',
      headings: ['Example Domain'],
      pending: false,
    })
    expect(snap?.text).toContain('illustrative')
  })

  it('ignores empty previews and native application URIs', () => {
    expect(extractChromeSnapshot({
      eventType: 'tool_started',
      toolName: 'browser_snapshot',
      title: 'Aperçu Chrome…',
      payload: {},
    })).toBeNull()
    expect(extractChromeSnapshot({
      eventType: 'tool_finished',
      toolName: 'browser_snapshot',
      payload: { url: 'spotify:search:Me Gustas Tu Manu Chao' },
    })).toBeNull()
  })

  it('upgrades a pending snapshot when the tool finishes', () => {
    const pending = extractChromeSnapshot({
      eventType: 'tool_started',
      toolName: 'browser_snapshot',
      payload: { parameters: { url: 'https://example.com' } },
    })!
    const finished = extractChromeSnapshot({
      eventType: 'tool_finished',
      toolName: 'browser_snapshot',
      payload: { title: 'Example Domain', url: 'https://example.com', headings: ['Example Domain'] },
    })!
    const merged = upsertChromeSnapshot([pending], finished)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ title: 'Example Domain', pending: false })
  })
})
