import type { Task } from '@bob-work/shared-types'

export const ACTIVE_TASK_STATES = [
  'draft',
  'queued',
  'starting',
  'running',
  'awaiting_info',
  'awaiting_approval',
  'paused',
] as const

export function isActiveTaskState(state: string): boolean {
  return (ACTIVE_TASK_STATES as readonly string[]).includes(state)
}

/** Latest active task per conversation (for sidebar loaders and chat resume). */
export function activeTasksByConversationId(tasks: Task[]): Map<string, Task> {
  const map = new Map<string, Task>()
  for (const task of tasks) {
    if (!task.conversationId || !isActiveTaskState(task.state)) continue
    const existing = map.get(task.conversationId)
    if (!existing || task.updatedAt > existing.updatedAt) {
      map.set(task.conversationId, task)
    }
  }
  return map
}

export function latestActiveTaskForConversation(tasks: Task[], conversationId: string): Task | undefined {
  return [...tasks]
    .filter(task => task.conversationId === conversationId && isActiveTaskState(task.state))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

export type ConversationActivity = 'running' | 'unread' | 'idle'

export function conversationActivity(
  conversationId: string,
  runningConversationIds: Iterable<string>,
  unreadConversationIds: Iterable<string>,
): ConversationActivity {
  const running = runningConversationIds instanceof Set
    ? runningConversationIds
    : new Set(runningConversationIds)
  if (running.has(conversationId)) return 'running'
  const unread = unreadConversationIds instanceof Set
    ? unreadConversationIds
    : new Set(unreadConversationIds)
  if (unread.has(conversationId)) return 'unread'
  return 'idle'
}
