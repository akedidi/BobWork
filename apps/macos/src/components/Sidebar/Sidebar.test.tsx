import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../stores/appStore'
import Sidebar, { synchronizedSpinnerDelay } from './Sidebar'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>
}

const mocks = vi.hoisted(() => ({
  getProjects: vi.fn(),
  getConversations: vi.fn(),
  getTasks: vi.fn(),
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  updateTaskPinned: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, listener: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(eventName, listener)
    return Promise.resolve(() => mocks.listeners.delete(eventName))
  }),
}))

vi.mock('../../lib/ipc', () => ({
  detectBob: vi.fn().mockResolvedValue({ found: true, authenticated: true }),
  getBobAuthSnapshot: vi.fn().mockResolvedValue({ found: true, authenticated: true, authenticationMethod: 'api_key_session' }),
  getProjects: mocks.getProjects,
  getConversations: mocks.getConversations,
  getTasks: mocks.getTasks,
  createConversation: mocks.createConversation,
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
    mocks.listeners.clear()
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
    mocks.createConversation.mockResolvedValue({
      id: 'conversation-new',
      title: 'Nouvelle conversation',
      type: 'chat',
      businessMode: 'agent',
      bobMode: 'agent',
      date: '2026-08-15T12:00:00Z',
      pinned: false,
      localOnly: true,
      archived: false,
    })
    mocks.updateConversation.mockResolvedValue(undefined)
    mocks.updateTaskPinned.mockResolvedValue(undefined)
    useAppStore.setState({ activeProjectId: null, projects, conversations, tasks: [], bobStatus: 'ready', notifications: [], notificationsOpen: false, unreadConversationIds: [] })
  })

  it('actualise les projets quand un projet est créé depuis le mobile', async () => {
    const mobileProject = {
      ...useAppStore.getState().projects[0],
      id: 'project-mobile',
      name: 'Projet mobile',
    }
    mocks.getProjects.mockResolvedValueOnce(useAppStore.getState().projects)
    mocks.getProjects.mockResolvedValueOnce([...useAppStore.getState().projects, mobileProject])

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.listeners.has('project-updated')).toBe(true))
    act(() => {
      mocks.listeners.get('project-updated')?.({ payload: mobileProject.id })
    })

    await waitFor(() => expect(screen.getByText('Projet mobile')).toBeVisible())
    expect(useAppStore.getState().projects.map(project => project.id)).toContain('project-mobile')
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

  it('cale les loaders sur une phase d’animation commune', () => {
    const period = 750
    const observedAt = 1_600
    const firstMountedAt = 1_000
    const secondMountedAt = 1_250
    const firstPhase = (observedAt - firstMountedAt - synchronizedSpinnerDelay(firstMountedAt)) % period
    const secondPhase = (observedAt - secondMountedAt - synchronizedSpinnerDelay(secondMountedAt)) % period

    expect(firstPhase).toBe(secondPhase)
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

    fireEvent.click(screen.getByText('Conversation locale'))

    expect(screen.queryByLabelText('Résultat non consulté')).not.toBeInTheDocument()
    expect(useAppStore.getState().unreadConversationIds).not.toContain('conversation-1')
  })

  it('uses a calendar icon to align scheduled conversations', async () => {
    const scheduledConversation = {
      ...useAppStore.getState().conversations[0],
      id: 'scheduled-conversation',
      title: '[Planifié] Rapport hebdomadaire',
    }
    mocks.getConversations.mockResolvedValue([scheduledConversation])
    useAppStore.setState({ conversations: [scheduledConversation] })

    render(<MemoryRouter><Sidebar /></MemoryRouter>)

    expect(await screen.findByLabelText('Conversation planifiée')).toBeVisible()
    expect(screen.getByText('[Planifié] Rapport hebdomadaire')).toBeVisible()
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

  it('ouvre un nouveau prompt avec le projet déjà sélectionné', async () => {
    render(
      <MemoryRouter initialEntries={['/project/project-1']}>
        <Sidebar />
        <LocationProbe />
      </MemoryRouter>,
    )

    const projectsHeader = screen.getByText('Projets').parentElement!
    const newProjectButton = within(projectsHeader).getByRole('button', { name: 'Nouveau projet' })
    const newConversationButton = await within(projectsHeader).findByRole('button', { name: 'Nouvelle conversation dans Projet Alpha' })

    expect(newProjectButton.compareDocumentPosition(newConversationButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(screen.getByText('Projet Alpha').closest('.sidebar-item')!).queryByRole('button')).not.toBeInTheDocument()

    fireEvent.click(newConversationButton)

    expect(screen.getByTestId('location')).toHaveTextContent(JSON.stringify({
      pathname: '/chat',
      state: { projectId: 'project-1', mode: 'agent', focusComposer: true },
    }))
    expect(mocks.createConversation).not.toHaveBeenCalled()
  })

  it('orders Conversations by last activity, including pinned chats', async () => {
    const olderPinned = {
      ...useAppStore.getState().conversations[0],
      id: 'older-pinned',
      title: 'Ancienne épinglée',
      pinned: true,
      date: '2026-08-14T10:00:00Z',
    }
    const newest = {
      ...olderPinned,
      id: 'newest-chat',
      title: 'Nouvelle active',
      pinned: false,
      date: '2026-08-15T10:00:00Z',
    }
    mocks.getConversations.mockResolvedValue([olderPinned, newest])
    useAppStore.setState({ conversations: [olderPinned, newest] })

    render(<MemoryRouter><Sidebar /></MemoryRouter>)

    await screen.findByText('Nouvelle active')
    const recent = document.querySelector('[aria-label="Conversations récentes"]')!
    const items = Array.from(recent.querySelectorAll('[data-conversation-location="recent"]'))
    expect(items.map(item => item.getAttribute('data-conversation-id'))).toEqual(['newest-chat', 'older-pinned'])
    expect(document.querySelector('[data-conversation-location="pinned"][data-conversation-id="older-pinned"]')).toBeTruthy()
  })

  it('does not display a distinct draft when Nouveau chat is clicked until a prompt is sent', async () => {
    render(
      <MemoryRouter>
        <Sidebar />
        <LocationProbe />
      </MemoryRouter>,
    )

    await screen.findByText('Conversation locale')
    fireEvent.click(screen.getByText('Nouveau chat'))

    expect(screen.getByTestId('location')).toHaveTextContent(JSON.stringify({
      pathname: '/',
      state: { focusComposer: true },
    }))
    expect(mocks.createConversation).not.toHaveBeenCalled()
    expect(useAppStore.getState().conversations.map(item => item.id)).not.toContain('conversation-new')
  })

  it('keeps a pinned conversation selected in both Épinglés and Conversations', async () => {
    const pinnedConversation = {
      ...useAppStore.getState().conversations[0],
      pinned: true,
    }
    mocks.getConversations.mockResolvedValue([pinnedConversation])
    useAppStore.setState({ conversations: [pinnedConversation] })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(() => expect(document.querySelector('[data-conversation-location="pinned"]')).toBeTruthy())
    fireEvent.click(document.querySelector('[data-conversation-location="pinned"]')!)
    await waitFor(() => {
      expect(document.querySelector('[data-conversation-location="pinned"]')).toHaveClass('active')
      expect(document.querySelector('[data-conversation-location="recent"]')).toHaveClass('active')
    })
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
