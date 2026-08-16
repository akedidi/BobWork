import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatView, {
  appendThinkingText,
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
    mocks.getTasks.mockResolvedValue([])
    await waitFor(() => expect(mocks.listeners.has('task-updated')).toBe(true))
    await act(async () => {
      await mocks.listeners.get('task-updated')?.({ payload: { id: 'task-1' } })
    })

    expect(await screen.findByText('Spotify est ouvert.')).toBeVisible()
    expect(screen.queryByText('Analyse de la demande…')).not.toBeInTheDocument()
  })
})

describe('WorkingIndicator thought swap', () => {
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
