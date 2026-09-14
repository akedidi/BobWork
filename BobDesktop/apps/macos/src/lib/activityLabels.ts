import type { MessageKey } from '../i18n/translate'

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

const TYPE_KEYS: Record<string, MessageKey> = {
  analysis: 'chat.activity.analysis',
  tool_started: 'chat.activity.toolStarted',
  tool_finished: 'chat.activity.toolFinished',
  tool_error: 'chat.activity.toolError',
  tool_progress: 'chat.activity.toolProgress',
  usage: 'chat.activity.usage',
  source: 'chat.activity.source',
  step: 'chat.activity.step',
  user_input_required: 'chat.activity.userChoiceRequired',
  subagent_started: 'chat.activity.subagentStarted',
  subagent_finished: 'chat.activity.subagentFinished',
  graph_started: 'chat.activity.graphStarted',
  graph_finished: 'chat.activity.graphFinished',
  message_started: 'chat.activity.responseInProgress',
  message_finished: 'chat.activity.responseFinished',
  error: 'chat.activity.error',
  run_finished: 'chat.activity.taskFinished',
}

const EXACT_TITLE_KEYS: Record<string, MessageKey> = {
  'Analysis in progress': 'chat.activity.analysisInProgress',
  'Analysis': 'chat.activity.analysis',
  'Tool started': 'chat.activity.toolStarted',
  'Tool finished': 'chat.activity.toolFinished',
  'Tool failed': 'chat.activity.toolFailed',
  'Tool progress': 'chat.activity.toolProgress',
  'User choice required': 'chat.activity.userChoiceRequired',
  'Usage': 'chat.activity.usage',
  'Response in progress': 'chat.activity.responseInProgress',
  'Response finished': 'chat.activity.responseFinished',
  'Error': 'chat.activity.error',
  'Bob Shell error': 'chat.activity.shellError',
  'Task finished': 'chat.activity.taskFinished',
  'Updating plan': 'chat.activity.planUpdating',
  'Plan updated': 'chat.activity.planUpdated',
  'Could not update plan': 'chat.activity.planUpdateFailed',
  'Running tests': 'chat.activity.runningTests',
  'Tests complete': 'chat.activity.testsComplete',
  'Tests failed': 'chat.activity.testsFailed',
  'Search complete': 'chat.activity.searchComplete',
  'Search failed': 'chat.activity.searchFailed',
  'Command complete': 'chat.activity.commandComplete',
  'Command failed': 'chat.activity.commandFailed',
  'Delegating to subagent': 'chat.activity.delegatingSubagent',
  'Subagent finished': 'chat.activity.subagentFinished',
  'Subagent failed': 'chat.activity.subagentFailed',
  'Analyse en cours': 'chat.activity.analysisInProgress',
  'Analyse': 'chat.activity.analysis',
  'Outil démarré': 'chat.activity.toolStarted',
  'Outil terminé': 'chat.activity.toolFinished',
  'Outil en échec': 'chat.activity.toolFailed',
  'Progression de l’outil': 'chat.activity.toolProgress',
  'Progression de l\'outil': 'chat.activity.toolProgress',
  'Choix utilisateur requis': 'chat.activity.userChoiceRequired',
  'Consommation': 'chat.activity.usage',
  'Réponse en cours': 'chat.activity.responseInProgress',
  'Réponse terminée': 'chat.activity.responseFinished',
  'Erreur': 'chat.activity.error',
  'Erreur Bob Shell': 'chat.activity.shellError',
  'Tâche terminée': 'chat.activity.taskFinished',
  'Mise à jour du plan': 'chat.activity.planUpdating',
  'Plan mis à jour': 'chat.activity.planUpdated',
  'Mise à jour du plan impossible': 'chat.activity.planUpdateFailed',
  'Exécution des tests': 'chat.activity.runningTests',
  'Tests terminés': 'chat.activity.testsComplete',
  'Tests en échec': 'chat.activity.testsFailed',
  'Recherche terminée': 'chat.activity.searchComplete',
  'Recherche en échec': 'chat.activity.searchFailed',
  'Commande terminée': 'chat.activity.commandComplete',
  'Commande en échec': 'chat.activity.commandFailed',
  'Délégation à un sous-agent': 'chat.activity.delegatingSubagent',
  'Sous-agent terminé': 'chat.activity.subagentFinished',
  'Sous-agent en échec': 'chat.activity.subagentFailed',
}

const TITLE_PATTERNS: Array<{ re: RegExp; key: MessageKey; group?: number }> = [
  { re: /^(?:Reading|Lecture de) (.+)$/i, key: 'chat.activity.reading', group: 1 },
  { re: /^Read (.+)$/i, key: 'chat.activity.readComplete', group: 1 },
  { re: /^Fichier lu : (.+)$/i, key: 'chat.activity.readComplete', group: 1 },
  { re: /^Could not read (.+)$/i, key: 'chat.activity.readFailed', group: 1 },
  { re: /^Lecture impossible : (.+)$/i, key: 'chat.activity.readFailed', group: 1 },
  { re: /^(?:Searching|Recherche de) (.+)$/i, key: 'chat.activity.searching', group: 1 },
  { re: /^(?:Editing|Modification de) (.+)$/i, key: 'chat.activity.editing', group: 1 },
  { re: /^Edited (.+)$/i, key: 'chat.activity.editComplete', group: 1 },
  { re: /^Fichier modifié : (.+)$/i, key: 'chat.activity.editComplete', group: 1 },
  { re: /^Could not edit (.+)$/i, key: 'chat.activity.editFailed', group: 1 },
  { re: /^Modification impossible : (.+)$/i, key: 'chat.activity.editFailed', group: 1 },
  { re: /^(?:Command|Commande)\s*:\s*(.+)$/i, key: 'chat.activity.command', group: 1 },
  { re: /^(?:Reading web|Lecture web)\s*:\s*(.+)$/i, key: 'chat.activity.webReading', group: 1 },
  { re: /^(?:Web source read|Source web consultée)\s*:\s*(.+)$/i, key: 'chat.activity.webReadComplete', group: 1 },
  { re: /^(?:Could not read web|Lecture web impossible)\s*:\s*(.+)$/i, key: 'chat.activity.webReadFailed', group: 1 },
  { re: /^(?:Chrome preview|Aperçu Chrome)\s*:\s*(.+)$/i, key: 'chat.activity.chromePreview', group: 1 },
  { re: /^(?:Chrome preview failed|Aperçu Chrome impossible)\s*:\s*(.+)$/i, key: 'chat.activity.chromePreviewFailed', group: 1 },
  { re: /^(?:Tool started|Outil démarré)\s*:\s*(.+)$/i, key: 'chat.activity.toolStartedNamed', group: 1 },
  { re: /^(?:Tool finished|Outil terminé)\s*:\s*(.+)$/i, key: 'chat.activity.toolFinishedNamed', group: 1 },
  { re: /^(?:Tool failed|Outil en échec)\s*:\s*(.+)$/i, key: 'chat.activity.toolFailedNamed', group: 1 },
  { re: /^(?:Orchestration started|Orchestration démarrée)(?:\s*:\s*(.+))?$/i, key: 'chat.activity.graphStartedNamed', group: 1 },
  { re: /^(?:Orchestration finished|Orchestration terminée)(?:\s*:\s*(.+))?$/i, key: 'chat.activity.graphFinishedNamed', group: 1 },
  { re: /^(?:Subagent started|Sous-agent démarré)(?:\s*:\s*(.+))?$/i, key: 'chat.activity.subagentStartedNamed', group: 1 },
  { re: /^(?:Subagent finished|Sous-agent terminé)(?:\s*:\s*(.+))?$/i, key: 'chat.activity.subagentFinishedNamed', group: 1 },
]

export function isGenericFinishedTitleRaw(title: string | undefined): boolean {
  if (!title?.trim()) return true
  const normalized = title.trim()
  return /^(?:Outil terminé|Tool finished|Herramienta finalizada)(?:\s*:.*)?$/i.test(normalized)
}

export function activityTypeLabel(t: Translate, type: string): string {
  const key = TYPE_KEYS[type]
  return key ? t(key) : type.replace(/_/g, ' ')
}

export function localizeActivityTitle(
  t: Translate,
  event: { title?: string | null; toolName?: string | null; eventType: string },
): string {
  const title = event.title?.trim()
  if (title && EXACT_TITLE_KEYS[title]) {
    return t(EXACT_TITLE_KEYS[title])
  }
  if (title) {
    for (const pattern of TITLE_PATTERNS) {
      const match = title.match(pattern.re)
      if (!match) continue
      const value = pattern.group ? match[pattern.group]?.trim() : undefined
      if (value) {
        if (pattern.key.endsWith('Named')) {
          const baseKey = pattern.key.slice(0, -'Named'.length) as MessageKey
          return `${t(baseKey)}: ${value}`
        }
        return t(pattern.key, { target: value, name: value })
      }
      if (pattern.key.endsWith('Named')) {
        return t(pattern.key.slice(0, -'Named'.length) as MessageKey)
      }
    }
  }
  if (event.toolName === 'update_todo_list') {
    if (event.eventType === 'tool_finished') return t('chat.activity.planUpdated')
    if (event.eventType === 'tool_error') return t('chat.activity.planUpdateFailed')
    if (event.eventType === 'tool_started') return t('chat.activity.planUpdating')
  }
  if (title) return title
  return activityTypeLabel(t, event.eventType)
}

export function isGenericFinishedTitle(title: string | undefined, t: Translate): boolean {
  if (isGenericFinishedTitleRaw(title)) return true
  const normalized = title?.trim()
  if (!normalized) return true
  const localized = t('chat.activity.toolFinished')
  return normalized === localized || normalized.startsWith(`${localized}:`)
}
