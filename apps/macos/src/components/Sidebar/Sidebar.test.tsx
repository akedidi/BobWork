import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../stores/appStore'
import Sidebar, { clampContextMenuPosition } from './Sidebar'

const mocks = vi.hoisted(() => ({
  getProjects: vi.fn(),
  getConversations: vi.fn(),
  getTasks: vi.fn(),
  updateConversation: vi.fn(),
  updateTaskPinned: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

vi.mock('../../lib/ipc', () => ({
  detectBob: vi.fn().mockResolvedValue({ found: true, authenticated: true }),
  getBobAuthSnapshot: vi.fn().mockResolvedValue({ found: true, authenticated: true, authenticationMethod: 'api_key_session' }),
  getProjects: mocks.getProjects,
  getConversations: mocks.getConversations,
  getTasks: mocks.getTasks,
  updateConversation: mocks.updateConversation,
  updateTaskPinned: mocks.updateTaskPinned,
  searchWorkspace: vi.fn().mockResolvedValue([]),
  getUsageStatus: vi.fn().mockResolvedValue(null),
}))

describe('Sidebar', () => {
  it('expose Artefacts et remplace le corps de la barre par Priorité', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Artefacts')).toBeVisible()
    expect(screen.queryByText('Modes')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Notifications'))
    const priority = await screen.findByRole('region', { name: 'Priorité' })
    expect(priority).toBeVisible()
    expect(await screen.findByText('Aucune notification pour le moment.')).toBeVisible()
  })

  it('ouvre la recherche de chats depuis le bouton à côté du titre', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByTitle('Rechercher'))
    expect(
      await screen.findByPlaceholderText('Rechercher dans les chats'),
    ).toBeVisible()
  })

  it('ferme la recherche avec Échap et rend le focus au bouton', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    const trigger = screen.getByTitle('Rechercher')
    trigger.focus()
    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Rechercher' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rechercher' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('garde le panneau Priorité ouvert après le clic d’ouverture', async () => {
    useAppStore.setState({
      notifications: [{
        id: 'n1',
        title: 'Réponse de Bob',
        body: 'Synthèse prête.',
        kind: 'chat_completed',
        createdAt: '2026-08-11T00:00:00Z',
        read: false,
      }],
    })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    const bell = screen.getByTitle('Notifications')
    fireEvent.pointerDown(bell)
    fireEvent.click(bell)
    expect(await screen.findByText('Synthèse prête.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Priorité' })).toBeVisible()
    expect(screen.queryByText('Nouveau chat')).not.toBeInTheDocument()
  })

  it('ouvre le centre Priorité quand une notification interne arrive', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('region', { name: 'Priorité' })).not.toBeInTheDocument()
    act(() => {
      useAppStore.getState().pushNotification({
        id: 'n-live',
        title: 'Réponse de Bob',
        body: 'Le brief AXA est prêt.',
        kind: 'bob_completed',
        createdAt: '2026-08-13T00:00:00Z',
        conversationId: 'conversation-1',
      })
      useAppStore.getState().revealNotificationCenter()
    })
    expect(await screen.findByRole('region', { name: 'Priorité' })).toBeVisible()
    expect(screen.getByText('Le brief AXA est prêt.')).toBeVisible()
    expect(screen.queryByText('Nouveau chat')).not.toBeInTheDocument()
  })

  it('revient à la navigation normale au second clic sur la cloche', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    const bell = screen.getByTitle('Notifications')
    fireEvent.click(bell)
    expect(await screen.findByRole('region', { name: 'Priorité' })).toBeVisible()
    fireEvent.click(bell)
    expect(await screen.findByText('Nouveau chat')).toBeVisible()
    expect(screen.getByText('Projets')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Priorité' })).not.toBeInTheDocument()
  })

  beforeEach(() => {
    const projects = [{
      id: 'project-1',
      name: 'Projet Alpha',
      language: 'fr',
      memoryEnabled: true,
      allowedFiles: [],
      allowedPlugins: [],
      allowedIntegrations: [],
      createdAt: '2026-08-09T00:00:00Z',
      updatedAt: '2026-08-09T00:00:00Z',
      archived: false,
    }]
    const conversations = [{
      id: 'conversation-1',
      title: 'Conversation locale',
      type: 'chat' as const,
      date: '2024-01-01T12:00:00Z',
      pinned: false,
      localOnly: true,
      archived: false,
    }]

    mocks.getProjects.mockResolvedValue(projects)
    mocks.getConversations.mockResolvedValue(conversations)
    mocks.getTasks.mockResolvedValue([])
    mocks.updateConversation.mockResolvedValue(undefined)
    mocks.updateTaskPinned.mockResolvedValue(undefined)
    useAppStore.setState({ projects, conversations, tasks: [], bobStatus: 'ready', notifications: [], notificationsOpen: false, unreadConversationIds: [] })
  })

  it('shows a loader on conversations with active tasks', async () => {
    const runningTask = {
      id: 'task-1',
      objective: 'Synthèse en cours',
      conversationId: 'conversation-1',
      state: 'running' as const,
      bobProcessId: 'sess_1',
      permissionPolicy: 'ask_for_important' as const,
      progress: 40,
      resumable: false,
      pinned: false,
      createdAt: '2026-08-12T08:00:00Z',
      updatedAt: '2026-08-12T08:01:00Z',
    }
    mocks.getTasks.mockResolvedValue([runningTask])
    useAppStore.setState({ tasks: [runningTask] })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(await screen.findByLabelText('Tâche en cours')).toBeVisible()
    expect(screen.getByText('Conversation locale')).toBeVisible()
  })

  it('hides the loader after the conversation task is cancelled', async () => {
    const cancelledTask = {
      id: 'task-1',
      objective: 'Synthèse arrêtée',
      conversationId: 'conversation-1',
      state: 'cancelled' as const,
      permissionPolicy: 'ask_for_important' as const,
      progress: 40,
      resumable: false,
      pinned: false,
      createdAt: '2026-08-12T08:00:00Z',
      updatedAt: '2026-08-12T08:01:00Z',
    }
    mocks.getTasks.mockResolvedValue([cancelledTask])
    useAppStore.setState({ tasks: [cancelledTask], unreadConversationIds: [] })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Conversation locale')).toBeVisible()
    expect(screen.queryByLabelText('Tâche en cours')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Résultat non consulté')).not.toBeInTheDocument()
  })

  it('shows an unread dot when a finished conversation has not been opened', async () => {
    useAppStore.setState({ unreadConversationIds: ['conversation-1'] })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(await screen.findByLabelText('Résultat non consulté')).toBeVisible()
    expect(screen.queryByLabelText('Tâche en cours')).not.toBeInTheDocument()
  })

  it('places recent conversations below projects', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Conversation locale')).toBeVisible())
    const projectsHeading = screen.getByText('Projets')
    const conversationsHeading = screen.getByText('Conversations')

    expect(projectsHeading.compareDocumentPosition(conversationsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Documents')).not.toBeInTheDocument()
  })

  it('keeps Nouveau chat outside the scrollable conversation list', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Nouveau chat')).toBeVisible())

    const newChat = screen.getByText('Nouveau chat')
    const scrollArea = document.querySelector('.sidebar-content')

    expect(scrollArea).toBeTruthy()
    expect(newChat.closest('.sidebar-nav')).toBeTruthy()
    expect(scrollArea?.contains(newChat)).toBe(false)
  })

  it('keeps the conversation context menu outside the sidebar overflow', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    const conversation = await screen.findByText('Conversation locale')
    fireEvent.contextMenu(conversation)

    const menu = await screen.findByRole('menu', { name: 'Actions de la conversation' })
    expect(menu).toBeVisible()
    expect(menu.closest('.sidebar')).toBeNull()
    expect(document.body.contains(menu)).toBe(true)
    expect(screen.getByRole('menuitem', { name: /Épingler le chat/i })).toBeVisible()
  })

  it('opens the project picker as an accessible modal and closes it with Escape', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    fireEvent.contextMenu(await screen.findByText('Conversation locale'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Déplacer vers un projet' }))

    const picker = await screen.findByRole('dialog', { name: 'Déplacer vers un projet' })
    expect(picker).toBeVisible()
    expect(picker.closest('.sidebar')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aucun projet (Conversations)' })).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Déplacer vers un projet' })).not.toBeInTheDocument()
  })

  it('clamps the context menu inside the viewport', () => {
    expect(clampContextMenuPosition(10, 20, 1280, 800)).toEqual({ x: 10, y: 20 })
    expect(clampContextMenuPosition(1200, 780, 1280, 800)).toEqual({ x: 1052, y: 624 })
  })

  it('affiche une erreur visible si le chargement IPC échoue', async () => {
    mocks.getConversations.mockRejectedValue(new Error('IPC down'))
    mocks.getProjects.mockRejectedValue(new Error('IPC down'))
    mocks.getTasks.mockRejectedValue(new Error('IPC down'))
    useAppStore.setState({ projects: [], conversations: [], tasks: [] })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(await screen.findByText('IPC down')).toBeVisible()
  })
})
