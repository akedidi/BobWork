import type { TranslationKey } from './i18n'

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

export function taskStateLabel(state: string, t: Translate): string {
  return ({
    starting: t('taskStarting'), running: t('taskRunning'), queued: t('taskQueued'),
    awaiting_info: t('taskAwaitingInfo'), awaiting_approval: t('taskApproval'),
    paused: t('taskPaused'), completed: t('taskCompleted'), failed: t('taskFailed'),
    cancelled: t('taskCancelled'), expired: t('taskExpired'), draft: t('taskDraft'),
  } as Record<string, string>)[state] ?? state
}

export function modeLabel(mode: string | null | undefined, t: Translate): string {
  if (!mode || mode === 'agent' || mode === 'general_work') return t('modeAgent')
  if (mode === 'plan' || mode === 'planning') return t('modePlan')
  if (mode === 'ask' || mode === 'quick_chat') return t('modeAsk')
  return mode
}

export function scheduleStateLabel(state: string, t: Translate): string {
  if (state === 'active') return t('scheduleActive')
  if (state === 'paused') return t('taskPaused')
  if (state === 'completed') return t('taskCompleted')
  return state
}

export function permissionPolicyLabel(policy: string | null | undefined, t: Translate): string {
  if (!policy) return '—'
  if (policy === 'always_ask') return t('policyAlwaysAsk')
  if (policy === 'ask_for_important') return t('policyAskImportant')
  if (policy === 'ask_for_modifications') return t('policyAskModifications')
  if (policy === 'never_ask') return t('policyNeverAsk')
  return policy
}

export function riskLevelLabel(level: string, t: Translate): string {
  return ({
    low: t('riskLow'), medium: t('riskMedium'), high: t('riskHigh'), critical: t('riskCritical')
  } as Record<string, string>)[level] ?? level
}

export function eventTitleLabel(event: { type: string; title?: string | null; toolName?: string | null }, t: Translate): string {
  if (event.type.startsWith('tool_') && event.toolName) return event.toolName
  const labels: Record<string, string> = {
    analysis: t('eventAnalysis'), content: t('eventContent'), error: t('eventError'),
    hook_started: t('eventHookStarted'), message_started: t('eventMessageStarted'),
    message_finished: t('eventMessageFinished'), run_finished: t('eventRunFinished'),
    text: t('eventText'), tool_started: t('eventToolStarted'), tool_progress: t('eventToolProgress'),
    tool_finished: t('eventToolFinished'), tool_error: t('eventError'), usage: t('eventUsage'),
    task_started: t('eventTaskStarted'), task_completed: t('eventTaskCompleted'),
    task_failed: t('eventTaskFailed'), subagent_started: t('eventSubagentStarted'),
    subagent_finished: t('eventSubagentFinished')
  }
  return labels[event.type] ?? event.title ?? event.toolName ?? event.type
}
