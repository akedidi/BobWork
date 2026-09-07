import assert from 'node:assert/strict'
import test from 'node:test'
import { mapSpecsFromToolsUsed } from './mapSpec.ts'

test('extracts a multi-marker map from persisted tool activity', () => {
  const spec = { schemaVersion: 1, kind: 'bob-map', title: 'POI', markers: [
    { id: '1', kind: 'place', label: 'A', lat: 48.85, lon: 2.35 },
    { id: '2', kind: 'place', label: 'B', lat: 48.86, lon: 2.36 },
  ], attribution: 'OpenStreetMap' }
  assert.deepEqual(mapSpecsFromToolsUsed([{ payload: { result: { structuredContent: spec } } }]), [spec])
})
