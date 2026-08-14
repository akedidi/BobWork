import { describe, expect, it } from 'vitest'
import { activeTasksByConversationId, conversationActivity, isActiveTaskState, latestActiveTaskForConversation } from './activeTasks'
import type { Task } from '@bob-work/shared-types'

const task = (overrides: Partial<Task> & Pick<Task, 'id' | 'conversationId' | 'state'>): Task => ({
  objective: 'Test',
  permissionPolicy: 'ask_for_important',
  progress: 0,
  resumable: false,
  pinned: false,
  createdAt: '2026-08-12T08:00:00Z',
  updatedAt: '2026-08-12T08:00:00Z',
  ...overrides,
})

describe('activeTasks', () => {
  it('detects active task states', () => {
    expect(isActiveTaskState('running')).toBe(true)
    expect(isActiveTaskState('completed')).toBe(false)
  })

  it('maps the latest active task per conversation', () => {
    const map = activeTasksByConversationId([
      task({ id: 't1', conversationId: 'c1', state: 'running', updatedAt: '2026-08-12T08:01:00Z' }),
      task({ id: 't2', conversationId: 'c1', state: 'completed', updatedAt: '2026-08-12T08:02:00Z' }),
      task({ id: 't3', conversationId: 'c2', state: 'starting', updatedAt: '2026-08-12T08:00:30Z' }),
    ])
    expect(map.get('c1')?.id).toBe('t1')
    expect(map.get('c2')?.id).toBe('t3')
    expect(map.has('c3')).toBe(false)
  })

  it('returns the newest active task for a conversation', () => {
    const latest = latestActiveTaskForConversation([
      task({ id: 'old', conversationId: 'c1', state: 'running', updatedAt: '2026-08-12T08:00:00Z' }),
      task({ id: 'new', conversationId: 'c1', state: 'awaiting_approval', updatedAt: '2026-08-12T08:05:00Z' }),
      task({ id: 'done', conversationId: 'c1', state: 'completed', updatedAt: '2026-08-12T08:10:00Z' }),
    ], 'c1')
    expect(latest?.id).toBe('new')
  })

  it('prefers the running spinner over an unread badge', () => {
    expect(conversationActivity('c1', ['c1'], ['c1'])).toBe('running')
    expect(conversationActivity('c1', [], ['c1'])).toBe('unread')
    expect(conversationActivity('c2', [], ['c1'])).toBe('idle')
  })
})
