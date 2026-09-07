import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatView, { conversationTitleForMode, isPlaceholderConversationTitle } from './ChatView'
import { useAppStore, useConversationStore } from '../stores/appStore'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: Record<string, unknown> }) => unknown>(),
  sendMessage: vi.fn(),
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  getConversation: vi.fn(),
  getMessages: vi.fn(),
  getTasks: vi.fn(),
  getCodeGraphSuggestion: vi.fn(),
  installExternalRuntime: vi.fn(),
}))

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="Route active">{location.pathname}</output>
}

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
  getDbConnections: vi.fn().mockResolvedValue([]),
  listBobSlashCommands: vi.fn().mockResolvedValue([]),
  allowComposerAttachments: vi.fn(async (paths: string[]) => paths),
  getCodeGraphSuggestion: mocks.getCodeGraphSuggestion,
  installExternalRuntime: mocks.installExternalRuntime,
}))

describe('Chat prompt queue', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  beforeEach(() => {
    useAppStore.setState({ builderSession: null })
    useConversationStore.setState({ messages: {}, loadingMessages: {} })
    mocks.listeners.clear()
    mocks.updateConversation.mockReset().mockResolvedValue(undefined)
    mocks.getConversation.mockReset().mockResolvedValue({ id: 'conv-1', title: 'Conversation de test', pinned: false })
    mocks.getMessages.mockReset().mockResolvedValue([])
    mocks.getTasks.mockReset().mockResolvedValue([])
    mocks.getCodeGraphSuggestion.mockReset().mockResolvedValue(null)
    mocks.installExternalRuntime.mockReset().mockResolvedValue({ runtimeId: 'external.codegraph', status: 'installed' })
    window.localStorage.clear()
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

  it('proposes CodeGraph with native buttons and installs it before dispatching', async () => {
    mocks.getCodeGraphSuggestion.mockResolvedValue({
      id: 'codegraph-runtime-project-1',
      kind: 'runtime_suggestion',
      title: 'CodeGraph peut aider pour cette tâche',
      question: 'Installer le runtime CodeGraph et indexer ce projet ?',
      detail: 'Le code et l’index restent sur ce Mac.',
      runtimeId: 'external.codegraph',
      projectId: 'project-1',
      choices: [
        { id: 'install', label: 'Installer et continuer', value: 'Installer', action: 'install_runtime' },
        { id: 'continue', label: 'Continuer sans CodeGraph', value: 'Continuer', action: 'continue' },
      ],
    })

    render(
      <MemoryRouter initialEntries={[{ pathname: '/chat/conv-1', state: { projectId: 'project-1' } }]}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: "Fais une analyse d'impact de saveUser" } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))

    expect(await screen.findByText("Fais une analyse d'impact de saveUser")).toBeVisible()
    expect(await screen.findByTestId('conversation-interaction')).toBeVisible()
    expect(mocks.sendMessage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Installer et continuer' }))
    await waitFor(() => expect(mocks.installExternalRuntime).toHaveBeenCalledWith('external.codegraph', true))
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "Fais une analyse d'impact de saveUser",
      projectId: 'project-1',
    })))
  })

  it('passes the choice to continue without CodeGraph to Bob without installing it', async () => {
    mocks.getCodeGraphSuggestion.mockResolvedValue({
      id: 'codegraph-runtime-project-1',
      kind: 'runtime_suggestion',
      title: 'CodeGraph peut aider pour cette tâche',
      question: 'Installer le runtime CodeGraph et indexer ce projet ?',
      runtimeId: 'external.codegraph',
      projectId: 'project-1',
      choices: [
        { id: 'install', label: 'Installer et continuer', value: 'Installer', action: 'install_runtime' },
        {
          id: 'continue',
          label: 'Continuer sans CodeGraph',
          value: 'Poursuis sans CodeGraph et utilise les outils de fichiers habituels.',
          action: 'continue',
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={[{ pathname: '/chat/conv-1', state: { projectId: 'project-1' } }]}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: "Fais une analyse d'impact de saveUser" } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer sans CodeGraph' }))

    expect(mocks.installExternalRuntime).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "Fais une analyse d'impact de saveUser\n\nPoursuis sans CodeGraph et utilise les outils de fichiers habituels.",
      projectId: 'project-1',
    })))
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

  it('rend le titre du haut directement éditable au clic', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Renommer la conversation' }))
    const input = await screen.findByRole('textbox', { name: 'Renommer la conversation' })
    expect(input).toHaveValue('Conversation de test')
    fireEvent.change(input, { target: { value: 'Brief Q3' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mocks.updateConversation).toHaveBeenCalledWith('conv-1', { title: 'Brief Q3' }))
    expect(screen.getByRole('button', { name: 'Renommer la conversation' })).toHaveTextContent('Brief Q3')
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

  it('shows the prompt immediately while a new conversation is still being created', async () => {
    let resolveConversation: (conversation: { id: string; title: string; pinned: boolean }) => void = () => {}
    mocks.createConversation.mockImplementationOnce(() => new Promise(resolve => { resolveConversation = resolve }))

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes><Route path="/chat/:id?" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Message visible sans attendre Bob' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('Message visible sans attendre Bob')).toBeVisible()
    expect(mocks.sendMessage).not.toHaveBeenCalled()

    await act(async () => resolveConversation({ id: 'conv-created-late', title: 'Nouvelle conversation', pinned: false }))
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-created-late', message: 'Message visible sans attendre Bob',
    })))
    expect(screen.getAllByText('Message visible sans attendre Bob')).toHaveLength(1)
  })

  it('does not erase the prompt when task hydration is stale during startup', async () => {
    let resolveSend: (result: { sessionId: string; taskId: string; userMessageId: string }) => void = () => {}
    mocks.createConversation.mockResolvedValue({ id: 'conv-starting', title: 'Nouvelle conversation', pinned: false })
    mocks.sendMessage.mockImplementationOnce(() => new Promise(resolve => { resolveSend = resolve }))
    mocks.getTasks.mockResolvedValue([])
    mocks.getMessages.mockResolvedValue([])

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes><Route path="/chat/:id?" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Prompt conservé pendant le démarrage' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Prompt conservé pendant le démarrage')).toBeVisible()
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled())
    await waitFor(() => expect(mocks.listeners.has('task-updated')).toBe(true))

    await act(async () => {
      await mocks.listeners.get('task-updated')?.({ payload: 'task-starting' as unknown as Record<string, unknown> })
    })
    expect(screen.getByText('Prompt conservé pendant le démarrage')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Arrêter l’exécution active' })).toBeVisible()

    await act(async () => resolveSend({ sessionId: 'session-starting', taskId: 'task-starting', userMessageId: 'user-persisted' }))
    expect(screen.getByText('Prompt conservé pendant le démarrage')).toBeVisible()
  })

  it('keeps the local prompt after send acceptance until persisted history can confirm it', async () => {
    mocks.createConversation.mockResolvedValue({ id: 'conv-accepted', title: 'Nouvelle conversation', pinned: false })
    mocks.sendMessage.mockResolvedValueOnce({
      sessionId: 'session-accepted', taskId: 'task-accepted', userMessageId: 'user-accepted',
    })
    mocks.getMessages.mockResolvedValue([])

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes><Route path="/chat/:id?" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Prompt gardé après acceptation' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled())

    // Reproduce a concurrent route/history hydration that cannot see the new
    // database row yet. The local outbox remains the display authority.
    act(() => useConversationStore.getState().setMessages('conv-accepted', []))

    expect(screen.getByText('Prompt gardé après acceptation')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Arrêter l’exécution active' })).toBeVisible()
  })

  it('keeps the launched conversation focused after a routed prompt starts its task', async () => {
    mocks.createConversation.mockResolvedValue({
      id: 'conv-focused', title: 'Nouvelle conversation', pinned: false,
    })

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/chat',
        state: { initialPrompt: 'Construis une architecture Azure', mode: 'agent' },
      }]}>
        <LocationProbe />
        <Routes>
          <Route path="/chat/:id?" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-focused',
        message: 'Construis une architecture Azure',
      }),
    ))

    expect(screen.getByLabelText('Route active')).toHaveTextContent('/chat/conv-focused')
    expect(screen.getByText('Construis une architecture Azure')).toBeVisible()

    const onToken = mocks.listeners.get('bob-token')
    await act(async () => {
      await onToken?.({ payload: {
        sessionId: 'session-1',
        conversationId: 'conv-focused',
        chunk: 'Analyse en cours',
        isFinal: false,
        eventType: 'text',
      } })
    })

    expect(screen.getByLabelText('Route active')).toHaveTextContent('/chat/conv-focused')
    expect(screen.getByText('Analyse en cours')).toBeVisible()
  })

  it('keeps the conversation open when task hydration fails during startup', async () => {
    mocks.getConversation.mockResolvedValue({
      id: 'conv-1', title: 'Analytics restauré', pinned: false,
    })
    mocks.getMessages.mockResolvedValue([{
      id: 'message-1',
      author: 'assistant',
      content: 'Dashboard chargé',
      createdAt: '2026-09-03T12:00:00Z',
      attachments: [],
      sources: [],
      fileChanges: [],
    }])
    mocks.getTasks.mockRejectedValue(new Error('task service warming up'))

    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <LocationProbe />
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Dashboard chargé')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Renommer la conversation' })).toHaveTextContent('Analytics restauré')
    expect(screen.getByLabelText('Route active')).toHaveTextContent('/chat/conv-1')
    expect(screen.queryByText('Impossible de charger la conversation.')).not.toBeInTheDocument()
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
