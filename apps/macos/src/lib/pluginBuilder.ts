export const PLUGIN_BUILDER_STEPS = [
  'objectif',
  'declencheur',
  'outils',
  'permissions',
  'apercu',
] as const

export type PluginBuilderStep = (typeof PLUGIN_BUILDER_STEPS)[number]

export type PluginTrigger = 'manual' | 'schedule' | 'event'
export type PluginToolId = 'mcp' | 'cli' | 'api' | 'oauth' | 'computer-use' | 'chrome' | 'web'
export type PluginPermissionId =
  | 'file.read'
  | 'file.write'
  | 'network.request'
  | 'command.execute'
  | 'mcp.connect'
  | 'browser.control'

export interface PluginBuilderDraft {
  name: string
  description: string
  audience: string
  trigger: PluginTrigger
  schedule: string
  inputs: string
  outputs: string
  tools: PluginToolId[]
  permissions: PluginPermissionId[]
}

export const EMPTY_PLUGIN_DRAFT: PluginBuilderDraft = {
  name: '',
  description: '',
  audience: '',
  trigger: 'manual',
  schedule: '',
  inputs: '',
  outputs: '',
  tools: ['mcp'],
  permissions: ['mcp.connect'],
}

export const PLUGIN_TOOL_OPTIONS: Array<{ id: PluginToolId; label: string; hint: string }> = [
  { id: 'mcp', label: 'Serveur MCP local', hint: 'Outils stdio dans le bundle' },
  { id: 'cli', label: 'CLI Python', hint: 'Script exécutable local' },
  { id: 'api', label: 'API publique ou clé', hint: 'HTTP, secrets via coffre' },
  { id: 'oauth', label: 'OAuth / intégration', hint: 'GitHub, Slack, Microsoft…' },
  { id: 'web', label: 'Recherche web Bob', hint: 'Si l’accès web est activé' },
  { id: 'computer-use', label: 'Computer Use', hint: 'Contrôle du bureau' },
  { id: 'chrome', label: 'Contrôle Chrome', hint: 'Onglets et navigation' },
]

export const PLUGIN_PERMISSION_OPTIONS: Array<{ id: PluginPermissionId; label: string }> = [
  { id: 'file.read', label: 'Lire des fichiers autorisés' },
  { id: 'file.write', label: 'Créer / modifier des fichiers' },
  { id: 'network.request', label: 'Appels réseau' },
  { id: 'command.execute', label: 'Commandes locales (avec accord)' },
  { id: 'mcp.connect', label: 'Outils MCP du plugin' },
  { id: 'browser.control', label: 'Bureau ou navigateur' },
]

export function toggleList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
}

export function pluginBuilderStepIndex(step: PluginBuilderStep): number {
  return PLUGIN_BUILDER_STEPS.indexOf(step)
}

export function canAdvancePluginBuilder(step: PluginBuilderStep, draft: PluginBuilderDraft): boolean {
  if (step === 'objectif') return draft.name.trim().length >= 2 && draft.description.trim().length >= 8
  if (step === 'declencheur') return draft.trigger !== 'schedule' || draft.schedule.trim().length > 0
  if (step === 'outils') return draft.tools.length > 0
  if (step === 'permissions') return draft.permissions.length > 0
  return true
}

export function pluginBuilderPreview(draft: PluginBuilderDraft): {
  name: string
  description: string
  trigger: string
  tools: string[]
  permissions: string[]
  io: string
} {
  const trigger = draft.trigger === 'manual'
    ? 'Manuel (depuis le chat)'
    : draft.trigger === 'event'
      ? 'Événement Bob / déclencheur'
      : `Planifié : ${draft.schedule.trim() || 'à préciser'}`
  return {
    name: draft.name.trim() || 'Sans nom',
    description: draft.description.trim() || '—',
    trigger,
    tools: draft.tools.map(id => PLUGIN_TOOL_OPTIONS.find(item => item.id === id)?.label ?? id),
    permissions: draft.permissions.map(id => PLUGIN_PERMISSION_OPTIONS.find(item => item.id === id)?.label ?? id),
    io: [draft.inputs.trim() && `Entrées : ${draft.inputs.trim()}`, draft.outputs.trim() && `Sorties : ${draft.outputs.trim()}`]
      .filter(Boolean)
      .join('\n') || 'Non précisé',
  }
}

/** Seed for a free-form chat: Bob interviews, then generates. */
export const PLUGIN_CONVERSATION_PROMPT = [
  'Je veux créer un plugin agentique Bob Work, dans cette conversation (sans formulaire).',
  'Pose-moi les questions utiles : objectif / bénéfice utilisateur, déclencheur, outils (MCP, CLI, API, OAuth, web, Computer Use, Chrome), autorisations.',
  'Quand le cahier des charges est clair, génère le bundle local, déploie-le, et confirme qu’il apparaît dans Plugins.',
  'Livrables : `~/.bob/skills/<slug>/SKILL.md` + `.bob-work-plugin.json` (agentic), code MCP/CLI si besoin, permissions honnêtes, aucun secret en clair.',
  'La description doit rester fonctionnelle (1–2 phrases, bénéfice utilisateur, pas de jargon MCP/CLI).',
].join('\n')

/** Brief for Bob: generate the bundle from the wizard, do not re-interview. */
export function buildPluginGenerationPrompt(draft: PluginBuilderDraft): string {
  const preview = pluginBuilderPreview(draft)
  const audience = draft.audience.trim()
  return [
    'Génère maintenant un plugin agentique Bob Work à partir de ce cahier des charges validé.',
    'Ne relance pas l’entretien : les choix sont déjà faits. Écris le bundle, déploie-le, puis confirme qu’il apparaît dans Plugins.',
    '',
    `Nom : ${preview.name}`,
    `Description (bénéfice utilisateur, 1–2 phrases, sans jargon MCP/CLI) : ${preview.description}`,
    audience ? `Pour : ${audience}` : '',
    `Déclencheur : ${preview.trigger}`,
    `Outils à embarquer : ${preview.tools.join(', ')}`,
    `Autorisations : ${preview.permissions.join(', ')}`,
    preview.io,
    '',
    'Livrables obligatoires :',
    '- `~/.bob/skills/<slug>/SKILL.md` + `.bob-work-plugin.json` (agentic, specializedMode, resources, connectorStrategy)',
    '- code MCP/CLI Python si des outils ont été cochés',
    '- permissions honnêtes ; aucun secret en clair',
    '- après écriture : le plugin doit être détectable par Bob Work (sync agentique)',
  ].filter(Boolean).join('\n')
}
