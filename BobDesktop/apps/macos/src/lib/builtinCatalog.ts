import type { Plugin, WorkspaceSkill } from '@bob-work/shared-types'

/** Canonical slugs that also identify a native plugin. */
const BUILTIN_PLUGIN_SLUGS = new Set([
  'bob-work-computer-use',
  'bob-work-chrome-control',
  'bob-work-documents',
  'bob-work-docling',
  'bob-work-microsoft-word',
  'bob-work-microsoft-powerpoint',
  'bob-work-microsoft-excel',
  'bob-work-microsoft-onenote',
  'ibm-agentic-designer',
  'ibm-agentic-consultant',
  'ibm-agentic-rfp',
  'ibm-agentic-product-manager',
  'ibm-agentic-delivery-manager',
  'ibm-agentic-change-manager',
  'ibm-agentic-solution-architect',
  'bob-work-github',
  'bob-work-slack',
  'bob-work-monday',
  'bob-work-outlook-mail',
  'bob-work-outlook-calendar',
  'bob-work-teams',
  'bob-work-onedrive',
  'bob-work-meeting-minutes',
  'codegraph',
  'map-tools',
])

/** Native skills, including first-party aliases deployed by older plugin versions. */
export const BUILTIN_SKILL_SLUGS = new Set([
  ...BUILTIN_PLUGIN_SLUGS,
  'excel-helper',
  'bob-work-ibm-pursuit',
  'cloud-architect-agent',
  'docling',
  'bob-rh-recruiting',
  'hr-recruiting',
  'redacteur-juridique',
])

export function isBuiltinSkill(skill: Pick<WorkspaceSkill, 'slug' | 'builtin'>): boolean {
  // Product rule: every installed skill is managed by Bob Work. CTO
  // Investissements is the sole user-owned exception.
  return skill.slug !== 'bob-work-cto-invest'
}

export function isBuiltinPlugin(plugin: Pick<Plugin, 'id' | 'manifest'>): boolean {
  if (plugin.id.startsWith('builtin-')) return true
  const manifest = plugin.manifest as { builtin?: boolean; slug?: string } | undefined
  if (manifest?.builtin) return true
  return Boolean(manifest?.slug && BUILTIN_PLUGIN_SLUGS.has(manifest.slug))
}

/** Non-builtin plugins first (newest updatedAt), then builtins (newest updatedAt). */
export function sortPluginsForDisplay<T extends Pick<Plugin, 'id' | 'manifest' | 'createdAt' | 'name'> & { updatedAt?: string }>(plugins: T[]): T[] {
  return [...plugins].sort((left, right) => {
    const leftBuiltin = isBuiltinPlugin(left)
    const rightBuiltin = isBuiltinPlugin(right)
    if (leftBuiltin !== rightBuiltin) return leftBuiltin ? 1 : -1
    const leftStamp = left.updatedAt || left.createdAt || ''
    const rightStamp = right.updatedAt || right.createdAt || ''
    const byUpdated = rightStamp.localeCompare(leftStamp)
    if (byUpdated !== 0) return byUpdated
    return left.name.localeCompare(right.name)
  })
}

/** Non-builtin skills first (newest updatedAt/createdAt), then builtins. */
export function sortSkillsForDisplay<T extends Pick<WorkspaceSkill, 'slug' | 'name' | 'builtin' | 'createdAt' | 'updatedAt'>>(
  skills: T[],
): T[] {
  return [...skills].sort((left, right) => {
    const leftBuiltin = isBuiltinSkill(left)
    const rightBuiltin = isBuiltinSkill(right)
    if (leftBuiltin !== rightBuiltin) return leftBuiltin ? 1 : -1
    const leftStamp = left.updatedAt || left.createdAt || ''
    const rightStamp = right.updatedAt || right.createdAt || ''
    const byUpdated = rightStamp.localeCompare(leftStamp)
    if (byUpdated !== 0) return byUpdated
    return left.name.localeCompare(right.name)
  })
}
