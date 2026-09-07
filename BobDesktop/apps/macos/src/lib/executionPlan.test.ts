import { describe, expect, it } from 'vitest'
import { executionPlanFromActivities, executionPlanProgress } from './executionPlan'

describe('execution plan activity parsing', () => {
  it('uses the latest update_todo_list snapshot and normalizes statuses', () => {
    const plan = executionPlanFromActivities([
      {
        toolName: 'update_todo_list',
        payload: { parameters: { todos: [
          { content: 'Create the structure', status: 'in_progress' },
          { content: 'Write the files', status: 'pending' },
        ] } },
      },
      {
        toolName: 'mcp__plans__update_todo_list',
        receivedAt: '2026-09-07T20:00:00Z',
        payload: { parameters: { title: 'Project delivery', todos: [
          { id: 'one', content: 'Create the structure', status: 'completed' },
          { id: 'two', content: 'Write the files', status: 'in-progress' },
          { id: 'three', content: 'Run tests', status: 'pending' },
        ] } },
      },
    ])

    expect(plan?.title).toBe('Project delivery')
    expect(plan?.steps.map(step => step.status)).toEqual(['completed', 'running', 'pending'])
    expect(plan?.updatedAt).toBe('2026-09-07T20:00:00Z')
    expect(executionPlanProgress(plan!)).toEqual({ completed: 1, total: 3, percent: 33 })
  })

  it('supports string steps but ignores a single ordinary todo', () => {
    expect(executionPlanFromActivities([{ toolName: 'update_plan', payload: { steps: ['One', 'Two'] } }])?.steps).toHaveLength(2)
    expect(executionPlanFromActivities([{ toolName: 'update_plan', payload: { steps: ['Only one'] } }])).toBeNull()
  })

  it('ignores unrelated tool activity', () => {
    expect(executionPlanFromActivities([{ toolName: 'write_file', payload: { steps: ['One', 'Two'] } }])).toBeNull()
  })

  it('keeps plans longer than eight steps without truncation', () => {
    const steps = Array.from({ length: 12 }, (_, index) => ({ content: `Step ${index + 1}`, status: index === 0 ? 'in_progress' : 'pending' }))
    const plan = executionPlanFromActivities([{ toolName: 'update_todo_list', payload: { todos: steps } }])

    expect(plan?.steps).toHaveLength(12)
    expect(plan?.steps[11]?.title).toBe('Step 12')
  })
})
