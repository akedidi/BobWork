export function pluginReference(pluginId: string) {
  return `@plugin:${pluginId}`
}

export function addPluginReference(prompt: string, pluginId: string) {
  const reference = pluginReference(pluginId)
  const referencePattern = new RegExp(`(^|\\s)${escapeRegExp(reference)}(?=\\s|$)`)
  if (referencePattern.test(prompt)) return prompt
  return prompt.trim() ? `${prompt.trimEnd()} ${reference}` : reference
}

export function removePluginReference(prompt: string, pluginId: string) {
  const reference = pluginReference(pluginId)
  const referencePattern = new RegExp(`(^|\\s)${escapeRegExp(reference)}(?=\\s|$)`, 'g')
  return prompt
    .replace(referencePattern, (_match, leading: string) => leading.includes('\n') ? '\n' : '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
