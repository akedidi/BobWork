import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatView, {
  appendThinkingText,
  coalesceActivityEvents,
  isThinkingContinuation,
  latestThinkingLine,
  WorkingIndicator,
} from './ChatView'
import { useAppStore } from '../stores/appStore'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: Record<string, unknown> }) => unknown>(),
  sendMessage: vi.fn(),
  getMessages: vi.fn(),
  getTasks: vi.fn(),
}))

function ConversationSwitcher() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/chat/conv-2')}>Changer de conversation</button>
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
  getConversation: vi.fn().mockResolvedValue({ id: 'conv-1', title: 'Conversation de test', pinned: false }),
  getMessages: mocks.getMessages,
  createConversation: vi.fn(),
  updateConversation: vi.fn().mockResolvedValue(undefined),
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
  registerExternalArtifact: vi.fn().mockResolvedValue(null),
}))

describe('appendThinkingText', () => {
  it('appends distinct reasoning chunks on separate lines', () => {
    const merged = appendThinkingText('Première étape.', 'Consultation du dépôt GitHub.')
    expect(merged).toContain('Première étape.')
    expect(merged).toContain('Consultation du dépôt GitHub.')
  })
})

describe('latestThinkingLine', () => {
  it('returns the current reflection, not the full transcript', () => {
    expect(latestThinkingLine('Première étape.\nConsultation du dépôt GitHub.')).toBe(
      'Consultation du dépôt GitHub.',
    )
  })
})

describe('isThinkingContinuation', () => {
  it('treats token growth of the same thought as a continuation', () => {
    expect(isThinkingContinuation('Je vérifie', 'Je vérifie la structure')).toBe(true)
  })

  it('treats a new paragraph as a replacement', () => {
    expect(isThinkingContinuation('Première étape.', 'Consultation du dépôt GitHub.')).toBe(false)
  })
})

describe('coalesceActivityEvents', () => {
  it('merges a tool start and result into one inspectable action', () => {
    const events = coalesceActivityEvents([{
      sessionId: 'session-1', conversationId: 'conv-1', eventType: 'tool_started',
      title: 'Lecture de rapport.md', toolName: 'read_file',
      payload: { tool_id: 'tool-1', parameters: { path: 'rapport.md' } },
    }, {
      sessionId: 'session-1', conversationId: 'conv-1', eventType: 'tool_finished',
      title: 'Outil terminé', toolName: 'read_file',
      payload: { tool_id: 'tool-1', output: 'Contenu chargé' },
    }])

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Lecture de rapport.md',
      eventType: 'tool_finished',
      payload: { parameters: { path: 'rapport.md' }, result: 'Contenu chargé' },
    })
  })
})

describe('Chat live thinking', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  beforeEach(() => {
    useAppStore.setState({ builderSession: null })
    mocks.listeners.clear()
    mocks.sendMessage.mockReset().mockResolvedValue({ sessionId: 'session-1', taskId: 'task-1' })
    mocks.getMessages.mockReset().mockResolvedValue([])
    mocks.getTasks.mockReset().mockResolvedValue([])
  })

  it('shows reasoning below the dotted loader while Bob is working', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Explique ton raisonnement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))

    expect(await screen.findByText('Analyse de la demande…')).toBeVisible()
    expect(screen.getByRole('status', { name: 'Réflexion en cours' })).toBeVisible()
    await waitFor(() => expect(mocks.listeners.has('bob-activity')).toBe(true))

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
    expect(screen.getByRole('status', { name: 'Réflexion en cours' })).toBeVisible()
  })

  it('renders Bob follow-up options as separate buttons in the conversation', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Aide-moi à choisir' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.listeners.has('bob-activity')).toBe(true))

    await act(async () => {
      await mocks.listeners.get('bob-activity')?.({ payload: {
        sessionId: 'session-1',
        conversationId: 'conv-1',
        eventType: 'user_input_required',
        title: 'Choix utilisateur requis',
        toolName: 'ask_followup_question',
        payload: {
          type: 'tool_use',
          parameters: {
            questions: [{
              header: 'Approche',
              question: 'Quelle approche utiliser ?',
              options: [{ label: 'Rapide' }, { label: 'Complète' }],
            }],
          },
        },
      } })
    })

    expect(screen.getByText('Quelle approche utiliser ?')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Rapide' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Complète' })).toBeVisible()
  })

  it('stops auto-scrolling when the user moves away from the bottom', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Réponse longue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.listeners.has('bob-token')).toBe(true))

    const scrollArea = screen.getByLabelText('Messages de la conversation')
    Object.defineProperties(scrollArea, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 200, writable: true },
    })
    fireEvent.scroll(scrollArea)

    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView)
    scrollIntoView.mockClear()
    await act(async () => {
      await mocks.listeners.get('bob-token')?.({ payload: {
        sessionId: 'session-1',
        conversationId: 'conv-1',
        eventType: 'thought',
        chunk: 'Nouvelle réflexion pendant la lecture.',
      } })
    })

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(scrollArea.scrollTop).toBe(200)
  })

  it('ne mélange jamais les événements d’outil avec le texte de la réponse', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Teste un outil' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.listeners.has('bob-token')).toBe(true))

    await act(async () => {
      await mocks.listeners.get('bob-token')?.({ payload: {
        sessionId: 'session-1',
        conversationId: 'conv-1',
        eventType: 'tool_use',
        chunk: '> Exécution de l’outil web_fetch…',
        isFinal: false,
      } })
    })

    expect(screen.queryByText(/Exécution de l’outil web_fetch/)).not.toBeInTheDocument()
  })

  it('replaces infinite reflection with the persisted reply when the task finishes', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )
    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Ouvre Spotify' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    expect(await screen.findByText('Analyse de la demande…')).toBeVisible()

    mocks.getMessages.mockResolvedValue([{
      id: 'assistant-final',
      conversationId: 'conv-1',
      author: 'assistant',
      content: 'Spotify est ouvert.',
      attachments: [], sources: [], citations: [], toolsUsed: [], sendState: 'sent', errors: [],
      associatedArtifacts: [], associatedApprovals: [], createdAt: '2026-08-15T01:00:00Z',
    }])
    mocks.getTasks.mockResolvedValue([{
      id: 'task-1',
      objective: 'Ouvre Spotify',
      conversationId: 'conv-1',
      permissionPolicy: 'always_ask',
      progress: 100,
      resumable: false,
      pinned: false,
      state: 'completed',
      createdAt: '2026-08-15T01:00:00Z',
      updatedAt: '2026-08-15T01:00:01Z',
    }])
    await waitFor(() => expect(mocks.listeners.has('task-updated')).toBe(true))
    await act(async () => {
      await mocks.listeners.get('task-updated')?.({ payload: 'task-1' as unknown as Record<string, unknown> })
    })

    expect(await screen.findByText('Spotify est ouvert.')).toBeVisible()
    expect(screen.queryByText('Analyse de la demande…')).not.toBeInTheDocument()
  })

  it('removes the sub-agent frame as soon as the session completes', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Compare trois API météo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.listeners.has('bob-activity')).toBe(true))
    await waitFor(() => expect(mocks.listeners.has('bob-session-done')).toBe(true))

    await act(async () => {
      await mocks.listeners.get('bob-activity')?.({ payload: {
        sessionId: 'session-1',
        conversationId: 'conv-1',
        eventType: 'tool_started',
        toolName: 'spawn_subagent',
        title: 'Délégation à un sous-agent',
        payload: { tool_id: 'tool-open-meteo', parameters: { name: 'explore', description: 'Analyse **Open-Meteo**.' } },
      } })
    })
    expect(screen.getByRole('region', { name: 'Sous-agents de la tâche principale' })).toBeVisible()

    await act(async () => {
      await mocks.listeners.get('bob-session-done')?.({ payload: {
        sessionId: 'session-1',
        conversationId: 'conv-1',
        success: true,
        fullOutput: 'Comparaison terminée.',
        taskId: 'task-1',
      } })
    })

    expect(screen.queryByRole('region', { name: 'Sous-agents de la tâche principale' })).not.toBeInTheDocument()
  })

  it('keeps completed activity attached to the assistant response', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Lis rapport.md' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.listeners.has('bob-activity')).toBe(true))
    await waitFor(() => expect(mocks.listeners.has('bob-session-done')).toBe(true))

    await act(async () => {
      await mocks.listeners.get('bob-activity')?.({ payload: {
        sessionId: 'session-1', conversationId: 'conv-1', eventType: 'tool_started',
        title: 'Lecture de rapport.md', toolName: 'read_file',
        payload: { tool_id: 'tool-1', parameters: { path: 'rapport.md' } },
      } })
      await mocks.listeners.get('bob-activity')?.({ payload: {
        sessionId: 'session-1', conversationId: 'conv-1', eventType: 'tool_finished',
        title: 'Fichier lu : rapport.md', toolName: 'read_file',
        payload: { tool_id: 'tool-1', output: 'Contenu du rapport' },
      } })
    })
    expect(screen.getByText('Fichier lu : rapport.md')).toBeVisible()

    await act(async () => {
      await mocks.listeners.get('bob-session-done')?.({ payload: {
        sessionId: 'session-1', conversationId: 'conv-1', success: true,
        fullOutput: 'Le rapport a été lu.', taskId: 'task-1',
      } })
    })

    const completedAction = screen.getByText('Fichier lu : rapport.md')
    expect(completedAction.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(completedAction.closest('summary')!)
    expect(screen.getByText(/"path": "rapport.md"/)).toBeInTheDocument()
    expect(screen.getByText('Le rapport a été lu.')).toBeVisible()
  })

  it('restores persisted activity when reopening a conversation', async () => {
    mocks.getMessages.mockResolvedValue([{
      id: 'assistant-with-activity', conversationId: 'conv-1', author: 'assistant',
      content: 'Analyse terminée.', attachments: [], sources: [], citations: [],
      toolsUsed: [{
        name: 'web_fetch', timestamp: '2026-09-05T10:02:00Z',
        eventType: 'tool_finished', title: 'Source web consultée : example.com',
        toolName: 'web_fetch', content: 'La page a été chargée.',
        payload: { url: 'https://example.com', status: 200 },
        createdAt: '2026-09-05T10:02:00Z',
      }],
      sendState: 'sent', errors: [], associatedArtifacts: [], associatedApprovals: [],
      fileChanges: [], createdAt: '2026-09-05T10:03:00Z',
    }])

    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Analyse terminée.')).toBeVisible()
    const completedAction = screen.getByText('Source web consultée : example.com')
    expect(completedAction.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(completedAction.closest('summary')!)
    expect(screen.getByText('La page a été chargée.')).toBeVisible()
    expect(screen.getByText(/"status": 200/)).toBeInTheDocument()
  })

  it('pins the latest multi-step plan and updates its progress while Bob works', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    fireEvent.change(await screen.findByPlaceholderText('Sur quoi travailler ?'), { target: { value: 'Crée le projet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.listeners.has('bob-activity')).toBe(true))

    await act(async () => {
      await mocks.listeners.get('bob-activity')?.({ payload: {
        sessionId: 'session-1', conversationId: 'conv-1', eventType: 'tool_started',
        toolName: 'update_todo_list', payload: { tool_id: 'plan-1', parameters: { todos: [
          { content: 'Initialiser le projet', status: 'in_progress' },
          { content: 'Créer l’interface', status: 'pending' },
          { content: 'Tester le résultat', status: 'pending' },
        ] } },
      } })
    })

    const pinnedPlan = screen.getByRole('region', { name: 'Plan d’exécution' })
    expect(pinnedPlan.closest('.execution-plan-sticky')).toBeInTheDocument()
    expect(screen.getByText('0/3 terminées')).toBeVisible()

    await act(async () => {
      await mocks.listeners.get('bob-activity')?.({ payload: {
        sessionId: 'session-1', conversationId: 'conv-1', eventType: 'tool_started',
        toolName: 'update_todo_list', payload: { tool_id: 'plan-2', parameters: { todos: [
          { content: 'Initialiser le projet', status: 'completed' },
          { content: 'Créer l’interface', status: 'in_progress' },
          { content: 'Tester le résultat', status: 'pending' },
        ] } },
      } })
    })

    expect(screen.getByText('1/3 terminées')).toBeVisible()
    expect(within(pinnedPlan).getByText(/Créer l’interface/).closest('li')).toHaveClass('is-running')
  })

  it('restores the pinned plan from persisted assistant activity', async () => {
    mocks.getMessages.mockResolvedValue([{
      id: 'assistant-with-plan', conversationId: 'conv-1', author: 'assistant',
      content: 'Projet créé.', attachments: [], sources: [], citations: [],
      toolsUsed: [{
        name: 'update_todo_list', timestamp: '2026-09-05T10:02:00Z',
        eventType: 'tool_finished', title: 'Mise à jour du plan', toolName: 'update_todo_list',
        payload: { parameters: { title: 'Création du projet', todos: [
          { content: 'Initialiser le projet', status: 'completed' },
          { content: 'Créer l’interface', status: 'completed' },
        ] } },
        createdAt: '2026-09-05T10:02:00Z',
      }],
      sendState: 'sent', errors: [], associatedArtifacts: [], associatedApprovals: [],
      fileChanges: [], createdAt: '2026-09-05T10:03:00Z',
    }])

    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Création du projet')).toBeVisible()
    expect(screen.getByText('2/2 terminées')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Plan d’exécution' })).toHaveClass('is-complete')
  })

  it('does not carry a live sub-agent frame into another conversation', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/conv-1']}>
        <ConversationSwitcher />
        <Routes><Route path="/chat/:id" element={<ChatView />} /></Routes>
      </MemoryRouter>,
    )

    const input = await screen.findByPlaceholderText('Sur quoi travailler ?')
    fireEvent.change(input, { target: { value: 'Compare trois API météo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    await waitFor(() => expect(mocks.listeners.has('bob-activity')).toBe(true))

    await act(async () => {
      await mocks.listeners.get('bob-activity')?.({ payload: {
        sessionId: 'session-1',
        conversationId: 'conv-1',
        eventType: 'tool_started',
        toolName: 'spawn_subagent',
        title: 'Délégation à un sous-agent',
        payload: { tool_id: 'tool-open-meteo', parameters: { name: 'explore', description: 'Analyse **Open-Meteo**.' } },
      } })
    })
    expect(screen.getByText('Open-Meteo')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Changer de conversation' }))

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Sous-agents de la tâche principale' })).not.toBeInTheDocument()
    })
  })
})

describe('WorkingIndicator thought swap', () => {
  it('shows live actions and keeps their payload available in expandable rows', () => {
    render(<WorkingIndicator
      thinking="Consultation des sources."
      loading={false}
      activities={[{
        sessionId: 'session-1',
        conversationId: 'conv-1',
        eventType: 'tool_finished',
        title: 'Source web consultée : https://example.com/feed.xml',
        toolName: 'web_fetch',
        content: 'La source a été chargée.',
        payload: { ok: true, url: 'https://example.com/feed.xml' },
        receivedAt: '2026-09-05T10:02:00Z',
      }]}
    />)

    const activityRegion = screen.getByRole('region', { name: 'Bob travaille' })
    expect(activityRegion).toBeVisible()
    const summary = activityRegion
      .querySelector('.thinking-activity__summary')!
    const row = summary.closest('details')
    expect(row).not.toHaveAttribute('open')
    expect(summary.parentElement?.querySelector('[data-activity-icon="web"]')).toBeInTheDocument()
    fireEvent.click(summary.closest('summary')!)
    expect(row).toHaveAttribute('open')
    expect(screen.getByText('La source a été chargée.')).toBeInTheDocument()
    expect(screen.getByText(/"url": "https:\/\/example.com\/feed.xml"/)).toBeInTheDocument()
  })

  it('marks the previous reflection as outgoing when a new thought replaces it', () => {
    const { rerender } = render(<WorkingIndicator thinking="Première étape." loading />)
    rerender(
      <WorkingIndicator thinking={'Première étape.\nConsultation du dépôt GitHub.'} loading />,
    )

    expect(screen.getByText('Consultation du dépôt GitHub.')).toBeVisible()
    expect(screen.getByText('Première étape.')).toHaveClass('thinking-stream-line--out')
    expect(screen.getByText('Consultation du dépôt GitHub.')).toHaveClass('thinking-stream-line--in')
  })

  it('does not fire a swap animation when the same thought grows by tokens', () => {
    const { rerender } = render(<WorkingIndicator thinking="Je vérifie" loading />)
    rerender(<WorkingIndicator thinking="Je vérifie la structure" loading />)

    expect(screen.getByText('Je vérifie la structure')).toBeVisible()
    expect(document.querySelector('.thinking-stream-line--out')).toBeNull()
    expect(document.querySelector('.thinking-stream-line--in')).toBeNull()
  })
})
