import { describe, expect, it } from 'vitest'
import { mapSpecsFromActivities } from './mapSpec'

const spec = { schemaVersion: 1, kind: 'bob-map', title: 'Paris', markers: [{ id: '1', label: 'Paris', lat: 48.85, lon: 2.35 }], attribution: '© OpenStreetMap contributors' }

describe('mapSpecsFromActivities', () => {
  it('extracts a structured MCP result nested in activity output', () => {
    expect(mapSpecsFromActivities([{ payload: { result: { structuredContent: spec } } }])).toEqual([spec])
  })

  it('extracts JSON text and deduplicates persisted protocol events', () => {
    const text = JSON.stringify(spec)
    expect(mapSpecsFromActivities([{ payload: { output: text } }, { payload: { result: text } }])).toHaveLength(1)
  })

  it('ignores unrelated tool output', () => {
    expect(mapSpecsFromActivities([{ payload: { result: { ok: true } } }])).toEqual([])
  })
})
