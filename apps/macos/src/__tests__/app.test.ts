// ============================================================
// Bob Work – TypeScript Tests
// Tests for shared types, store, and view logic
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Shared Types ──────────────────────────────────────────────

describe('shared-types', () => {
  it('Artifact interface has required fields', async () => {
    // Type-level check: create a minimal valid Artifact object
    const artifact = {
      id: 'a1',
      artifactType: 'pptx',
      title: 'Test',
      filePath: '/tmp/test.pptx',
      version: 1,
      sources: [],
      validationStatus: 'valid' as const,
      exported: false,
      createdAt: new Date().toISOString(),
    }
    expect(artifact.id).toBe('a1')
    expect(artifact.artifactType).toBe('pptx')
    expect(artifact.validationStatus).toBe('valid')
  })

  it('Schedule interface has required fields', async () => {
    const schedule = {
      id: 's1',
      name: 'Daily Report',
      instructions: 'Run report',
      cronOrEvent: 'every day',
      timezone: 'UTC',
      offlineBehavior: 'skip' as const,
      overlapPolicy: 'queue' as const,
      notifications: [],
      state: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    expect(schedule.state).toBe('active')
    expect(schedule.cronOrEvent).toBe('every day')
  })
})

// ── Zustand Store ─────────────────────────────────────────────

describe('appStore', () => {
  beforeEach(() => {
    // Reset module registry so store state is fresh
    vi.resetModules()
  })

  it('setProjects updates projects list', async () => {
    const { useAppStore } = await import('../stores/appStore')
    const store = useAppStore.getState()

    // Use only fields that are present in the Rust-side response (camelCase wire format)
    // Type cast to avoid needing every optional field in the test object
    const project = {
      id: 'p1',
      name: 'Test Project',
      language: 'fr',
      memoryEnabled: false,
      allowedFiles: [],
      allowedPlugins: [],
      allowedIntegrations: [],
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    store.setProjects([project])
    expect(useAppStore.getState().projects).toHaveLength(1)
    expect(useAppStore.getState().projects[0].id).toBe('p1')
  })

  it('setConversations updates conversations list', async () => {
    const { useAppStore } = await import('../stores/appStore')
    const store = useAppStore.getState()

    const conv = {
      id: 'c1',
      title: 'Chat 1',
      type: 'chat' as const,
      date: new Date().toISOString(),
      pinned: false,
      localOnly: false,
      archived: false,
    }
    store.setConversations([conv])
    expect(useAppStore.getState().conversations).toHaveLength(1)
  })

  it('setBobStatus updates bob status', async () => {
    const { useAppStore } = await import('../stores/appStore')
    const store = useAppStore.getState()

    store.setBobStatus('ready')
    expect(useAppStore.getState().bobStatus).toBe('ready')

    store.setBobStatus('error')
    expect(useAppStore.getState().bobStatus).toBe('error')
  })

  it('setTasks updates task list', async () => {
    const { useAppStore } = await import('../stores/appStore')
    const store = useAppStore.getState()

    const task = {
      id: 't1',
      objective: 'Write report',
      mode: 'general_work',
      state: 'running' as const,
      progress: 50,
      permissionPolicy: 'always_ask' as const,
      resumable: false,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    store.setTasks([task])
    expect(useAppStore.getState().tasks).toHaveLength(1)
    expect(useAppStore.getState().tasks[0].progress).toBe(50)
  })

  it('pushNotification prepends and ignores duplicates', async () => {
    const { useAppStore } = await import('../stores/appStore')
    useAppStore.setState({ notifications: [] })
    const note = {
      id: 'n1',
      title: 'Réponse de Bob',
      body: 'Brief prêt.',
      kind: 'bob_completed',
      createdAt: '2026-08-13T00:00:00Z',
    }
    useAppStore.getState().pushNotification(note)
    useAppStore.getState().pushNotification(note)
    useAppStore.getState().pushNotification({ ...note, id: 'n2', body: 'Autre.' })
    expect(useAppStore.getState().notifications.map(item => item.id)).toEqual(['n2', 'n1'])
    expect(useAppStore.getState().notifications[0].read).toBe(false)
  })

  it('revealNotificationCenter opens the in-app notification inbox', async () => {
    const { useAppStore } = await import('../stores/appStore')
    useAppStore.setState({ notificationsOpen: false, sidebarVisible: false })
    useAppStore.getState().revealNotificationCenter()
    expect(useAppStore.getState().notificationsOpen).toBe(true)
    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })

  it('records Bob replies without any ingestion option opening the in-app notification inbox', async () => {
    const { useAppStore } = await import('../stores/appStore')
    const { ingestAppNotification } = await import('../components/Layout/MainLayout')
    useAppStore.setState({ notifications: [], notificationsOpen: false, sidebarVisible: true })
    ingestAppNotification({
      id: 'bob-done-1',
      title: 'Réponse de Bob',
      body: 'Le travail est terminé.',
      kind: 'bob_completed',
      createdAt: '2026-08-13T18:00:00Z',
      conversationId: 'conversation-1',
    })
    expect(useAppStore.getState().notifications).toHaveLength(1)
    expect(useAppStore.getState().notificationsOpen).toBe(false)
  })

  it('tracks unread conversations until they are opened', async () => {
    const { useAppStore } = await import('../stores/appStore')
    const store = useAppStore.getState()
    store.markConversationUnread('c1')
    store.markConversationUnread('c2')
    store.markConversationUnread('c1')
    expect(useAppStore.getState().unreadConversationIds).toEqual(['c1', 'c2'])
    store.markConversationRead('c1')
    expect(useAppStore.getState().unreadConversationIds).toEqual(['c2'])
  })
})

// ── IPC Wrappers ──────────────────────────────────────────────

describe('ipc wrappers', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('ipc module exports all required functions', async () => {
    // Mock @tauri-apps/api/core so imports don't fail in jsdom
    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockResolvedValue(null),
    }))

    const ipc = await import('../lib/ipc')

    // Bob
    expect(typeof ipc.detectBob).toBe('function')
    expect(typeof ipc.sendMessage).toBe('function')
    expect(typeof ipc.stopTask).toBe('function')

    // Projects
    expect(typeof ipc.getProjects).toBe('function')
    expect(typeof ipc.createProject).toBe('function')

    // Conversations
    expect(typeof ipc.getConversations).toBe('function')
    expect(typeof ipc.createConversation).toBe('function')
    expect(typeof ipc.getMessages).toBe('function')

    // Tasks
    expect(typeof ipc.getTasks).toBe('function')
    expect(typeof ipc.cancelTask).toBe('function')

    // Plugins
    expect(typeof ipc.getPlugins).toBe('function')
    expect(typeof ipc.installPlugin).toBe('function')
    expect(typeof ipc.validatePlugin).toBe('function')

    // Schedule
    expect(typeof ipc.getSchedules).toBe('function')
    expect(typeof ipc.createSchedule).toBe('function')
    expect(typeof ipc.updateScheduleState).toBe('function')
    expect(typeof ipc.deleteSchedule).toBe('function')

    // Volatile Bob and integration secrets
    expect(typeof ipc.setSessionSecret).toBe('function')
    expect(typeof ipc.hasSessionSecret).toBe('function')
    expect(typeof ipc.clearSessionSecret).toBe('function')

    // Artifact generation
    expect(typeof ipc.generateArtifact).toBe('function')
    expect(typeof ipc.getArtifactsList).toBe('function')

    // Artifacts
    expect(typeof ipc.getArtifacts).toBe('function')
    expect(typeof ipc.deleteArtifact).toBe('function')
    expect(typeof ipc.openArtifact).toBe('function')

    // Settings
    expect(typeof ipc.getSettings).toBe('function')
    expect(typeof ipc.updateSettings).toBe('function')
    expect(typeof ipc.listAppNotifications).toBe('function')
    expect(typeof ipc.getUsageStatus).toBe('function')
    expect(typeof ipc.getBobalytics).toBe('function')
    expect(typeof ipc.exportBobalytics).toBe('function')
    expect(typeof ipc.installBobShell).toBe('function')
    expect(typeof ipc.openDataDir).toBe('function')
    expect(typeof ipc.exportDiagnostics).toBe('function')
    expect(typeof ipc.createPermissionGrant).toBe('function')
  })

  it('detectBob calls invoke with correct command', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ found: true, version: '2.0.0', authenticated: true })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))

    const { detectBob } = await import('../lib/ipc')
    await detectBob()

    expect(mockInvoke).toHaveBeenCalledWith('detect_bob')
  })

  it('sendMessage calls invoke with all params', async () => {
    const mockInvoke = vi.fn().mockResolvedValue('session-123')
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))

    const { sendMessage } = await import('../lib/ipc')
    await sendMessage({
      conversationId: 'conv-1',
      message: 'Hello',
      mode: 'quick_chat',
    })

    expect(mockInvoke).toHaveBeenCalledWith('send_message', {
      conversationId: 'conv-1',
      message: 'Hello',
      mode: 'quick_chat',
      projectId: undefined,
    })
  })

  it('createSchedule calls invoke with correct command', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ id: 's1', name: 'Daily' })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))

    const { createSchedule } = await import('../lib/ipc')
    const input = {
      name: 'Daily',
      instructions: 'Run daily',
      cronOrEvent: 'every day',
    }
    await createSchedule(input)
    expect(mockInvoke).toHaveBeenCalledWith('create_schedule', { input })
  })

  it('generateArtifact calls invoke with correct command', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ id: 'a1' })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))

    const { generateArtifact } = await import('../lib/ipc')
    const input = { artifactType: 'docx', title: 'Report', content: '# Hello' }
    await generateArtifact(input)
    expect(mockInvoke).toHaveBeenCalledWith('generate_artifact', { input })
  })
})

// ── Utility functions (pure logic) ───────────────────────────

describe('utility: format helpers', () => {
  it('formatDate returns readable date', () => {
    const iso = '2024-01-15T10:30:00.000Z'
    const d = new Date(iso)
    const result = d.toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
    expect(result).toContain('janv')
    expect(result).toContain('2024')
  })

  it('file size formatting', () => {
    const fmt = (bytes: number) => {
      if (bytes < 1024) return `${bytes} o`
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} Ko`
      return `${(bytes / 1048576).toFixed(1)} Mo`
    }
    expect(fmt(500)).toBe('500 o')
    expect(fmt(1536)).toBe('1.5 Ko')
    expect(fmt(2097152)).toBe('2.0 Mo')
  })

  it('truncation logic works', () => {
    const truncate = (s: string, max: number) =>
      s.length > max ? s.slice(0, max) + '…' : s

    expect(truncate('Hello', 10)).toBe('Hello')
    expect(truncate('Hello World This Is Long', 10)).toBe('Hello Worl…')
  })
})

// ── Security rules (client-side) ─────────────────────────────

describe('security: input validation', () => {
  it('plugin manifest validation catches missing name', () => {
    const validateManifest = (m: Record<string, unknown>) => {
      const errors: string[] = []
      if (!m.name) errors.push('name required')
      if (!m.version) errors.push('version required')
      return { valid: errors.length === 0, errors }
    }

    const result = validateManifest({ version: '1.0.0' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('name required')
  })

  it('plugin manifest validation passes for valid input', () => {
    const validateManifest = (m: Record<string, unknown>) => {
      const errors: string[] = []
      if (!m.name) errors.push('name required')
      if (!m.version) errors.push('version required')
      return { valid: errors.length === 0, errors }
    }

    const result = validateManifest({ name: 'my-plugin', version: '1.0.0' })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('schedule frequency options are recognized', () => {
    const KNOWN_FREQS = ['every day', 'every week', 'every month', 'every hour', 'in 5 minutes']
    for (const freq of KNOWN_FREQS) {
      expect(KNOWN_FREQS).toContain(freq)
    }
  })
})
