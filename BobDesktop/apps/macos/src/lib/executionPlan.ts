export type ExecutionPlanStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface ExecutionPlanStep {
  id: string
  title: string
  detail?: string
  status: ExecutionPlanStepStatus
}

export interface ExecutionPlan {
  id: string
  title?: string
  steps: ExecutionPlanStep[]
  updatedAt?: string
}

export interface PlanActivity {
  eventType?: string
  title?: string
  content?: string
  toolName?: string
  payload?: Record<string, unknown>
  receivedAt?: string
  createdAt?: string
}

const PLAN_TOOL = /(?:^|[:._-])(update_todo_list|todo_write|update_plan|write_plan|set_plan)$/i
const STEP_LIST_KEYS = ['todos', 'steps', 'items', 'tasks'] as const

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function normalizedStatus(value: unknown): ExecutionPlanStepStatus {
  const status = typeof value === 'string' ? value.trim().toLowerCase().replace(/[ -]+/g, '_') : ''
  if (['in_progress', 'running', 'started', 'active', 'current'].includes(status)) return 'running'
  if (['completed', 'complete', 'done', 'finished', 'success', 'succeeded'].includes(status)) return 'completed'
  if (['failed', 'error', 'blocked'].includes(status)) return 'failed'
  if (['skipped', 'cancelled', 'canceled'].includes(status)) return 'skipped'
  return 'pending'
}

function planToolName(activity: PlanActivity): string {
  const payload = activity.payload ?? {}
  return activity.toolName
    || textValue(payload, ['tool_name', 'toolName', 'name'])
    || ''
}

function candidateContainers(payload: Record<string, unknown>): Record<string, unknown>[] {
  const containers = [payload]
  for (const key of ['parameters', 'input', 'arguments', 'result', 'output']) {
    const nested = asRecord(payload[key])
    if (nested) containers.push(nested)
  }
  const plan = asRecord(payload.plan)
  if (plan) containers.push(plan)
  return containers
}

function extractStepItems(payload: Record<string, unknown>): { items: unknown[]; container: Record<string, unknown> } | undefined {
  for (const container of candidateContainers(payload)) {
    for (const key of STEP_LIST_KEYS) {
      const items = container[key]
      if (Array.isArray(items)) return { items, container }
    }
    if (Array.isArray(container.plan)) return { items: container.plan, container }
  }
  return undefined
}

function parseStep(value: unknown, index: number): ExecutionPlanStep | undefined {
  if (typeof value === 'string') {
    const title = value.trim()
    return title ? { id: `step-${index + 1}`, title, status: 'pending' } : undefined
  }
  const record = asRecord(value)
  if (!record) return undefined
  const title = textValue(record, ['content', 'title', 'name', 'text', 'label', 'task', 'description'])
  if (!title) return undefined
  const detail = textValue(record, ['detail', 'details', 'note'])
  const id = textValue(record, ['id', 'step_id', 'stepId']) || `step-${index + 1}-${title}`
  return { id, title, detail, status: normalizedStatus(record.status ?? record.state) }
}

/** Return the latest complete plan snapshot emitted by Bob Shell. */
export function executionPlanFromActivities(activities: PlanActivity[] | undefined): ExecutionPlan | null {
  let latest: ExecutionPlan | null = null
  for (const activity of activities ?? []) {
    const toolName = planToolName(activity)
    if (!PLAN_TOOL.test(toolName)) continue
    const payload = activity.payload ?? {}
    const extracted = extractStepItems(payload)
    if (!extracted) continue
    const steps = extracted.items.flatMap((item, index) => {
      const parsed = parseStep(item, index)
      return parsed ? [parsed] : []
    })
    // A one-line todo is ordinary activity, not a project execution plan.
    if (steps.length < 2) continue
    latest = {
      id: textValue(extracted.container, ['id', 'plan_id', 'planId']) || `${toolName}:${steps.map(step => step.id).join('|')}`,
      title: textValue(extracted.container, ['title', 'plan_title', 'planTitle', 'name']),
      steps,
      updatedAt: activity.receivedAt || activity.createdAt,
    }
  }
  return latest
}

export function executionPlanProgress(plan: ExecutionPlan): { completed: number; total: number; percent: number } {
  const completed = plan.steps.filter(step => step.status === 'completed' || step.status === 'skipped').length
  const total = plan.steps.length
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 }
}
