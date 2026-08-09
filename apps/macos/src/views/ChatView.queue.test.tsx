import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatView from './ChatView'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: Record<string, unknown> }) => unknown>(),
  sendMessage: vi.fn(),
  updateConversation: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: Record<string, unknown> }) => unknown) => {
    mocks.listeners.set(name, callback)
    return vi.fn()
  }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../lib/ipc', () => ({
  sendMessage: mocks.sendMessage,
  stopTask: vi.fn().mockResolvedValue(undefined),
  getConversation: vi.fn().mockResolvedValue({ id: 'conv-1', title: 'Conversation de test', pinned: false }),
  getMessages: vi.fn().mockResolvedValue([]),
  createConversation: vi.fn(),
  updateConversation: mocks.updateConversation,
  getTaskDetail: vi.fn().mockResolvedValue(null),
  cancelTask: vi.fn().mockResolvedValue(undefined),
  getTasks: vi.fn().mockResolvedValue([]),
  getBobModes: vi.fn().mockResolvedValue([
    { slug: 'agent', name: 'Agent', description: 'Exécuter une tâche', groups: [], builtin: true, source: 'test' },
  ]),
  getProjects: vi.fn().mockResolvedValue([]),
  getSkills: vi.fn().mockResolvedValue([]),
  getPlugins: vi.fn().mockResolvedValue([]),
  getPlugin: vi.fn().mockResolvedValue(null),
}))

describe('Chat prompt queue', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  beforeEach(() => {
    mocks.listeners.clear()
    mocks.updateConversation.mockReset().mockResolvedValue(undefined)
    mocks.sendMessage.mockReset()
      .mockResolvedValueOnce({ sessionId: 'session-1', taskId: 'task-1' })
      .mockResolvedValueOnce({ sessionId: 'session-2', taskId: 'task-2' })
  })

  it('waits for the active Shell session before dispatching the next prompt', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Travailler avec Bob…')
    fireEvent.change(input, { target: { value: 'Premier prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.listeners.has('bob-session-done')).toBe(true))

    fireEvent.change(input, { target: { value: 'Deuxième prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le prompt à la file' }))
    expect(screen.getByText('File d’attente')).toBeVisible()
    expect(screen.getByText('Deuxième prompt')).toBeVisible()
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)

    const onDone = mocks.listeners.get('bob-session-done')
    expect(onDone).toBeDefined()
    await act(async () => {
      await onDone?.({ payload: {
        sessionId: 'session-1', conversationId: 'conv-1', success: true,
        fullOutput: 'Première réponse', taskId: 'task-1',
      } })
    })

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(2))
    expect(mocks.sendMessage.mock.calls[1][0]).toMatchObject({
      conversationId: 'conv-1', message: 'Deuxième prompt', mode: 'agent',
    })
    await waitFor(() => expect(screen.queryByText('File d’attente')).not.toBeInTheDocument())
  })

  it('pins the open conversation from its always-visible header action', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const pin = await screen.findByRole('button', { name: 'Épingler la conversation' })
    fireEvent.click(pin)

    await waitFor(() => expect(mocks.updateConversation).toHaveBeenCalledWith('conv-1', { pinned: true }))
    expect(screen.getByRole('button', { name: 'Désépingler la conversation' })).toBeVisible()
  })
})
