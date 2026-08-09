import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatView, { appendThinkingText } from './ChatView'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: Record<string, unknown> }) => unknown>(),
  sendMessage: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: Record<string, unknown> }) => unknown) => {
    mocks.listeners.set(name, callback)
    return vi.fn()
  }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: () => Promise.resolve(() => {}),
  }),
}))
vi.mock('../lib/ipc', () => ({
  sendMessage: mocks.sendMessage,
  stopTask: vi.fn().mockResolvedValue(undefined),
  getConversation: vi.fn().mockResolvedValue({ id: 'conv-1', title: 'Conversation de test', pinned: false }),
  getMessages: vi.fn().mockResolvedValue([]),
  createConversation: vi.fn(),
  updateConversation: vi.fn().mockResolvedValue(undefined),
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

describe('appendThinkingText', () => {
  it('appends distinct reasoning chunks on separate lines', () => {
    const merged = appendThinkingText('Première étape.', 'Consultation du dépôt GitHub.')
    expect(merged).toContain('Première étape.')
    expect(merged).toContain('Consultation du dépôt GitHub.')
  })
})

describe('Chat live thinking', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  beforeEach(() => {
    mocks.listeners.clear()
    mocks.sendMessage.mockReset().mockResolvedValue({ sessionId: 'session-1', taskId: 'task-1' })
  })

  it('shows reasoning below the dotted loader while Bob is working', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Travailler avec Bob…')
    fireEvent.change(input, { target: { value: 'Explique ton raisonnement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.listeners.has('bob-activity')).toBe(true))

    expect(screen.getByText('Analyse de la demande…')).toBeVisible()

    const onActivity = mocks.listeners.get('bob-activity')
    await act(async () => {
      await onActivity?.({ payload: {
        sessionId: 'session-1',
        conversationId: 'conv-1',
        eventType: 'analysis',
        title: 'Analyse en cours',
        content: 'Je vérifie la structure du projet et les fichiers pertinents.',
        payload: {},
      } })
    })

    expect(screen.getByText(/Je vérifie la structure du projet/)).toBeVisible()
    expect(screen.getByRole('status', { name: 'Bob réfléchit' })).toBeVisible()
  })
})
