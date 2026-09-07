type VisualizationMessageEvent = {
  nativeEvent?: { data?: unknown } | null
}

type VisualHeightSetter = (update: (previous: number) => number) => unknown

export function visualHeightFromMessage(value: unknown, fallback: number) {
  if (typeof value !== 'string') return fallback
  try {
    const message = JSON.parse(value) as { type?: string; height?: unknown }
    if (message.type !== 'bob-visual-size' || typeof message.height !== 'number') return fallback
    return Math.max(1, Math.ceil(message.height))
  } catch {
    return fallback
  }
}

export function updateVisualHeightFromEvent(
  event: VisualizationMessageEvent,
  setHeight: VisualHeightSetter,
) {
  // React Native Fabric may release the synthetic WebView event before the
  // queued state updater runs. Capture the primitive value synchronously.
  const data = event.nativeEvent?.data
  setHeight(previous => visualHeightFromMessage(data, previous))
}
