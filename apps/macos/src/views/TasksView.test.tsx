import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TasksView from './TasksView'

const mocks = vi.hoisted(() => ({
  getTasks: vi.fn(),
  getTaskDetail: vi.fn(),
  updateTaskPinned: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

vi.mock('../lib/ipc', () => ({
  getTasks: mocks.getTasks,
  getTaskDetail: mocks.getTaskDetail,
  updateTaskPinned: mocks.updateTaskPinned,
  cancelTask: vi.fn().mockResolvedValue(undefined),
}))

const task = {
  id: 'task-1',
  objective: 'Préparer le rapport client',
  permissionPolicy: 'always_ask' as const,
  progress: 100,
  errors: [],
  resumable: false,
  pinned: false,
  state: 'completed' as const,
  createdAt: '2026-08-09T00:00:00Z',
  updatedAt: '2026-08-09T00:00:00Z',
}

describe('TasksView pinning', () => {
  beforeEach(() => {
    mocks.getTasks.mockReset().mockResolvedValue([task])
    mocks.getTaskDetail.mockReset().mockResolvedValue(null)
    mocks.updateTaskPinned.mockReset().mockResolvedValue(undefined)
  })

  it('shows a pin action on every task and persists it', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)

    const pin = await screen.findByRole('button', { name: 'Épingler la tâche' })
    fireEvent.click(pin)

    await waitFor(() => expect(mocks.updateTaskPinned).toHaveBeenCalledWith('task-1', true))
  })

  it('provides a dedicated pinned filter', async () => {
    mocks.getTasks.mockResolvedValue([{ ...task, pinned: true }])
    render(<MemoryRouter><TasksView /></MemoryRouter>)

    await screen.findByText('Préparer le rapport client')
    fireEvent.click(screen.getByRole('button', { name: 'Épinglées' }))
    expect(screen.getByText('Préparer le rapport client')).toBeVisible()
  })
})
