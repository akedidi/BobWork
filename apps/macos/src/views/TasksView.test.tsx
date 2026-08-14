import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
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

  it('updates the open detail when navigation targets another task', async () => {
    const second = { ...task, id: 'task-2', objective: 'Préparer le second rapport' }
    mocks.getTasks.mockResolvedValue([task, second])
    mocks.getTaskDetail.mockImplementation(async (id: string) => ({
      task: id === second.id ? second : task,
      runs: [], inputs: [], outputs: [], events: [],
    }))

    function Harness() {
      const navigate = useNavigate()
      return <><button onClick={() => navigate('/tasks', { state: { taskId: second.id } })}>Ouvrir seconde</button><TasksView /></>
    }

    render(<MemoryRouter initialEntries={[{ pathname: '/tasks', state: { taskId: task.id } }]}><Routes><Route path="/tasks" element={<Harness />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(mocks.getTaskDetail).toHaveBeenCalledWith(task.id))
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir seconde' }))
    await waitFor(() => expect(mocks.getTaskDetail).toHaveBeenCalledWith(second.id))
  })
})
