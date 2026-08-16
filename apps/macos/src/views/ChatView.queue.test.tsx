import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatView, { conversationTitleForMode, isPlaceholderConversationTitle } from './ChatView'
import { useAppStore } from '../stores/appStore'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: Record<string, unknown> }) => unknown>(),
  sendMessage: vi.fn(),
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  getConversation: vi.fn(),
  getMessages: vi.fn(),
  getTasks: vi.fn(),
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
  getConversation: mocks.getConversation,
  getMessages: mocks.getMessages,
  createConversation: mocks.createConversation,
  updateConversation: mocks.updateConversation,
  getTaskDetail: vi.fn().mockResolvedValue(null),
  cancelTask: vi.fn().mockResolvedValue(undefined),
  getTasks: mocks.getTasks,
  getBobModes: vi.fn().mockResolvedValue([
    { slug: 'agent', name: 'Agent', description: 'Exécuter une tâche', groups: [], builtin: true, source: 'test' },
  ]),
  getSettings: vi.fn().mockResolvedValue({ defaultMode: 'agent' }),
  getProjects: vi.fn().mockResolvedValue([]),
  getSkills: vi.fn().mockResolvedValue([]),
  getPlugins: vi.fn().mockResolvedValue([]),
  getPlugin: vi.fn().mockResolvedValue(null),
  getIntegrationStatuses: vi.fn().mockResolvedValue([]),
  getMcpServers: vi.fn().mockResolvedValue([]),
  allowComposerAttachments: vi.fn(async (paths: string[]) => paths),
}))

describe('Chat prompt queue', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  beforeEach(() => {
    useAppStore.setState({ builderSession: null })
    mocks.listeners.clear()
    mocks.updateConversation.mockReset().mockResolvedValue(undefined)
    mocks.getConversation.mockReset().mockResolvedValue({ id: 'conv-1', title: 'Conversation de test', pinned: false })
    mocks.getMessages.mockReset().mockResolvedValue([])
    mocks.getTasks.mockReset().mockResolvedValue([])
    mocks.createConversation.mockReset().mockResolvedValue({
      id: 'conv-builder', title: 'Création de skill', pinned: false,
    })
    mocks.sendMessage.mockReset()
      .mockResolvedValueOnce({ sessionId: 'session-1', taskId: 'task-1' })
      .mockResolvedValueOnce({ sessionId: 'session-2', taskId: 'task-2' })
  })

  it('waits for the active Shell session before dispatching the next prompt', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
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
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const pin = await screen.findByRole('button', { name: 'Épingler la conversation' })
    fireEvent.click(pin)

    await waitFor(() => expect(mocks.updateConversation).toHaveBeenCalledWith('conv-1', { pinned: true }))
    expect(screen.getByRole('button', { name: 'Désépingler la conversation' })).toBeVisible()
  })

  it('persists the skill builder title on the first prompt', async () => {
    useAppStore.setState({
      builderSession: { kind: 'skill_builder', brief: '', guided: false },
    })
    render(
      <MemoryRouter
        initialEntries={[{ pathname: '/chat', state: { mode: 'skill_builder' } }]}

      >
        <Routes><Route path="/chat" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Décrivez le skill à créer…')
    fireEvent.change(input, { target: { value: 'Créer un skill juridique' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))

    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Création de skill' }),
    ))
  })

  it('keeps the first prompt visible when the new conversation history resolves late', async () => {
    let resolveHistory: (messages: never[]) => void = () => {}
    mocks.getMessages.mockReset().mockImplementation(() => new Promise(resolve => { resolveHistory = resolve }))
    mocks.createConversation.mockResolvedValue({
      id: 'conv-new', title: 'Nouvelle conversation', pinned: false,
    })

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/chat/:id?" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Mon tout premier prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    expect(await screen.findByText('Mon tout premier prompt')).toBeVisible()

    await waitFor(() => expect(mocks.getMessages).toHaveBeenCalledWith('conv-new'))
    await act(async () => { resolveHistory([]) })

    expect(screen.getByText('Mon tout premier prompt')).toBeVisible()
  })
})

describe('conversationTitleForMode', () => {
  it('uses the builder context as the persisted conversation title', () => {
    expect(conversationTitleForMode('skill_builder')).toBe('Création de skill')
    expect(conversationTitleForMode('plugin_builder')).toBe('Création de plugin')
    expect(conversationTitleForMode('agent')).toBe('')
    expect(isPlaceholderConversationTitle('Nouvelle conversation')).toBe(true)
    expect(isPlaceholderConversationTitle('Mon titre personnalisé')).toBe(false)
  })
})
