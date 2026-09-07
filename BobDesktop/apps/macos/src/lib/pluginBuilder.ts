export const PLUGIN_BUILDER_STEPS = [
  'objectif',
  'declencheur',
  'outils',
  'permissions',
  'apercu',
] as const

export type PluginBuilderStep = (typeof PLUGIN_BUILDER_STEPS)[number]

export type PluginTrigger = 'manual' | 'schedule' | 'event'
export type PluginToolId =
  | 'mcp'
  | 'cli'
  | 'shell'
  | 'bundled-bin'
  | 'api'
  | 'oauth'
  | 'computer-use'
  | 'chrome'
  | 'web'
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
  { id: 'cli', label: 'CLI locale', hint: 'Python, Node, wrappers type Mermaid' },
  { id: 'shell', label: 'Script shell', hint: 'bash, zsh ou sh dans le bundle' },
  { id: 'bundled-bin', label: 'Binaire embarqué', hint: 'mermaid, d2, ffmpeg, pandoc… version épinglée' },
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
  'Je veux créer un plugin agentique Bob Work, dans cette conversation (sans formulaire, sans wizard).',
  'Prends l’initiative : si le métier a besoin de convertir, rendre, packager, extraire ou diagrammer, choisis toi-même un outil open source éprouvé (Mermaid, D2, PlantUML, pandoc, ffmpeg, jq, Graphviz, ImageMagick…), télécharge une release GitHub épinglée dans `vendor/<outil>/<version>/bin/` (schéma Bob Work), écris le wrapper dans `scripts/`, déclare `entrypoints` + `command.execute`.',
  'Ne me demande pas d’installer Homebrew ni de cocher une case dans le wizard. Pose-moi seulement les questions utiles si le bénéfice utilisateur est encore flou (objectif, déclencheur, OAuth).',
  'Quand c’est assez clair, génère le bundle local, déploie-le, et confirme qu’il apparaît dans Plugins.',
  'Si je donne une URL de base de données (postgres://, mysql://, jdbc:db2://host:50000/SAMPLE, fichier SQLite…) ou hôte/port/base/identifiants, Bob Work crée la connexion (coffre) et la lie au plugin — visible dans le détail. Ne recopie pas le mot de passe dans les fichiers.',
  'Livrables : `~/.bob/skills/<slug>/SKILL.md` + `.bob-work-plugin.json` (agentic), code MCP/CLI/shell/binaires réellement embarqués, permissions honnêtes, aucun secret en clair.',
  'La description doit rester fonctionnelle (1–2 phrases, bénéfice utilisateur, pas de jargon MCP/CLI).',
  'Icône : favicon web selon le métier.',
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
    '- code MCP / CLI / shell / binaires embarqués si des outils ont été cochés — tu les places dans le schéma Bob Work (`vendor/<outil>/<version>/bin/` + `scripts/`), SHA-256, pas Homebrew, pas le wizard',
    '- modèle Cloud Architect : wrapper + binaire épinglé, permission command.execute',
    '- permissions honnêtes ; aucun secret en clair',
    '- `icon` dans `.bob-work-plugin.json` : favicon HTTPS (google s2) aligné sur le métier / la description, ou clé locale Bob',
    '- Si une URL / hôte DB est fourni : déclare `resources.kind=database` ; Bob Work crée la connexion et la lie au plugin (secret dans le coffre, pas dans le bundle)',
  ].filter(Boolean).join('\n')
}
