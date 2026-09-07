import type { MapSpec } from '@bob-work/shared-types'

type ActivityLike = { payload?: Record<string, unknown> }

function asMapSpec(value: unknown, seen: Set<unknown>): MapSpec | undefined {
  if (typeof value === 'string') {
    if (value.length > 1_000_000 || !value.includes('bob-map')) return undefined
    try { return asMapSpec(JSON.parse(value), seen) } catch { return undefined }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined
  seen.add(value)
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'bob-map' && candidate.schemaVersion === 1 && Array.isArray(candidate.markers)) {
    return candidate as unknown as MapSpec
  }
  for (const key of ['structuredContent', 'result', 'output', 'data', 'value']) {
    const found = asMapSpec(candidate[key], seen)
    if (found) return found
  }
  if (Array.isArray(candidate.content)) {
    for (const item of candidate.content) {
      const found = asMapSpec(item, seen)
      if (found) return found
      if (item && typeof item === 'object') {
        const foundInText = asMapSpec((item as Record<string, unknown>).text, seen)
        if (foundInText) return foundInText
      }
    }
  }
  return undefined
}

export function mapSpecsFromActivities(events: ActivityLike[] | undefined): MapSpec[] {
  const specs: MapSpec[] = []
  const fingerprints = new Set<string>()
  for (const event of events ?? []) {
    const spec = asMapSpec(event.payload, new Set())
    if (!spec) continue
    const fingerprint = JSON.stringify(spec)
    if (!fingerprints.has(fingerprint)) {
      fingerprints.add(fingerprint)
      specs.push(spec)
    }
  }
  return specs
}
