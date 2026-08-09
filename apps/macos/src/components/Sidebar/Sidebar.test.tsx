import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../stores/appStore'
import Sidebar from './Sidebar'

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
  getProjects: mocks.getProjects,
  getConversations: mocks.getConversations,
  getTasks: mocks.getTasks,
  updateConversation: mocks.updateConversation,
  updateTaskPinned: mocks.updateTaskPinned,
  searchWorkspace: vi.fn().mockResolvedValue([]),
}))

describe('Sidebar', () => {
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
    useAppStore.setState({ projects, conversations, tasks: [], bobStatus: 'ready' })
  })

  it('places recent conversations below projects', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Conversation locale')).toBeVisible())
    const projectsHeading = screen.getByText('Projets')
    const conversationsHeading = screen.getByText('Conversations')

    expect(projectsHeading.compareDocumentPosition(conversationsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Documents')).not.toBeInTheDocument()
  })
})
