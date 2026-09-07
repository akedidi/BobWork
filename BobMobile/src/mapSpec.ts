export type MapMarkerKind = 'place' | 'current-location' | 'origin' | 'destination'

export interface MapSpec {
  schemaVersion: 1
  kind: 'bob-map'
  title: string
  markers: Array<{ id: string; label: string; lat: number; lon: number; description?: string; kind?: MapMarkerKind }>
  route?: { coordinates: Array<{ lat: number; lon: number }>; distanceMeters: number; durationSeconds: number; mode: string }
  attribution: string
}

function findMapSpec(value: unknown, seen: Set<unknown>): MapSpec | undefined {
  if (typeof value === 'string') {
    if (value.length > 1_000_000 || !value.includes('bob-map')) return undefined
    try { return findMapSpec(JSON.parse(value), seen) } catch { return undefined }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined
  seen.add(value)
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'bob-map' && candidate.schemaVersion === 1 && Array.isArray(candidate.markers)) return candidate as unknown as MapSpec
  for (const key of ['payload', 'structuredContent', 'result', 'output', 'data', 'value']) {
    const found = findMapSpec(candidate[key], seen)
    if (found) return found
  }
  if (Array.isArray(candidate.content)) {
    for (const item of candidate.content) {
      const found = findMapSpec(item, seen)
      if (found) return found
    }
  }
  return undefined
}

export function mapSpecsFromToolsUsed(items: unknown[] | undefined): MapSpec[] {
  const maps: MapSpec[] = []
  const fingerprints = new Set<string>()
  for (const item of items ?? []) {
    const spec = findMapSpec(item, new Set())
    if (!spec) continue
    const fingerprint = JSON.stringify(spec)
    if (!fingerprints.has(fingerprint)) { fingerprints.add(fingerprint); maps.push(spec) }
  }
  return maps
}
