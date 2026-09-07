import type { Approval, ArtifactPage, BobSlashCommand, BobTask, Bootstrap, Catalog, Connection, Conversation, ConversationItem, MessagePage, ModeOption, Project, ProjectMutationInput, PromptAttachment, RemoteArtifact, Schedule, ScheduleInput, ScheduleRun, StartSessionResult, SyncSnapshot, TaskDetail, UsageStatus } from './types'

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
  }
}

export const API_REQUEST_TIMEOUT_MS = 12_000
export const CONNECTION_TIMEOUT_MS = 10_000

export function canonicalMode(mode: string | null | undefined): string {
  return !mode || mode === 'general_work' ? 'agent' : mode
}

function canonicalProject(project: Project): Project {
  return { ...project, defaultMode: canonicalMode(project.defaultMode) }
}

function canonicalTask(task: BobTask): BobTask {
  return { ...task, mode: canonicalMode(task.mode) }
}

function canonicalConversationItem(item: ConversationItem): ConversationItem {
  return {
    ...item,
    conversation: { ...item.conversation, bobMode: item.conversation.bobMode ? canonicalMode(item.conversation.bobMode) : item.conversation.bobMode },
  }
}

function canonicalConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    bobMode: conversation.bobMode ? canonicalMode(conversation.bobMode) : conversation.bobMode,
  }
}

export function isConnectionFailure(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false
  if (error.message === 'request-timeout' || error.message === 'transport-unavailable') return true
  const status = error.status ?? 0
  return status === 401 || status === 403 || status === 410 || status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530)
}

export function parseConnectionLink(value: string): Connection {
  const candidate = value.trim()
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new ApiError('invalid-link')
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
  const accessToken = fragment.get('token') ?? fragment.get('key') ?? ''
  if (!accessToken) throw new ApiError('missing-token')
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return { serverUrl: url.toString().replace(/\/$/, ''), accessToken }
}

export class BobApi {
  constructor(
    private connection: Connection,
    private onConnectionFailure?: (error: ApiError) => void,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = API_REQUEST_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController()
    let didTimeout = false
    const timeout = setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, timeoutMs)
    try {
      const response = await fetch(`${this.connection.serverUrl}/api/v1${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.connection.accessToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string }
        throw new ApiError(payload.error ?? `HTTP ${response.status}`, response.status)
      }
      return await response.json() as T
    } catch (error) {
      const normalized = didTimeout
        ? new ApiError('request-timeout')
        : error instanceof ApiError
          ? error
          : new ApiError('transport-unavailable')
      if (isConnectionFailure(normalized)) this.onConnectionFailure?.(normalized)
      throw normalized
    } finally {
      clearTimeout(timeout)
    }
  }

  health = (timeoutMs = API_REQUEST_TIMEOUT_MS) => this.request<{ status: string; apiVersion: string; bobAvailable: boolean }>('/health', {}, timeoutMs)
  usage = (timeoutMs = API_REQUEST_TIMEOUT_MS) => this.request<UsageStatus>('/usage', {}, timeoutMs)
  updateCurrentLocation = (latitude: number, longitude: number) =>
    this.request<{ enabled: boolean; updatedAt: string }>('/location', { method: 'POST', body: JSON.stringify({ latitude, longitude }) })
  clearCurrentLocation = () => this.request<{ enabled: boolean }>('/location', { method: 'DELETE' })
  bootstrap = async (timeoutMs = API_REQUEST_TIMEOUT_MS) => {
    const bootstrap = await this.request<Bootstrap>('/bootstrap', {}, timeoutMs)
    return {
      ...bootstrap,
      settings: { ...bootstrap.settings, defaultMode: canonicalMode(bootstrap.settings.defaultMode) },
    }
  }
  sync = async (timeoutMs = API_REQUEST_TIMEOUT_MS): Promise<SyncSnapshot> => {
    try {
      const snapshot = await this.request<SyncSnapshot>('/sync', {}, timeoutMs)
      return {
        ...snapshot,
        projects: snapshot.projects.map(canonicalProject),
        conversations: snapshot.conversations.map(canonicalConversationItem),
        tasks: snapshot.tasks.map(canonicalTask),
      }
    } catch (error) {
      // Compatibility with a Bob Work instance that predates the snapshot
      // endpoint. The next desktop update will transparently switch to the
      // single-response path.
      if (!(error instanceof ApiError) || error.status !== 404) throw error
      const [projects, conversations, tasks] = await Promise.all([
        this.request<{ projects: Project[] }>('/projects', {}, timeoutMs).then(value => value.projects),
        this.request<{ conversations: ConversationItem[] }>('/conversations', {}, timeoutMs).then(value => value.conversations),
        this.request<{ tasks: BobTask[] }>('/tasks', {}, timeoutMs).then(value => value.tasks),
      ])
      return {
        syncedAt: new Date().toISOString(),
        projects: projects.map(canonicalProject),
        conversations: conversations.map(canonicalConversationItem),
        tasks: tasks.map(canonicalTask),
      }
    }
  }
  tasks = async (projectId?: string) => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
    return (await this.request<{ tasks: BobTask[] }>(`/tasks${query}`)).tasks.map(canonicalTask)
  }
  projects = async () => (await this.request<{ projects: Project[] }>('/projects')).projects.map(canonicalProject)
  createProject = async (input: ProjectMutationInput) =>
    canonicalProject((await this.request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(projectPayload(input)) })).project)
  updateProject = async (id: string, input: ProjectMutationInput) =>
    canonicalProject((await this.request<{ project: Project }>(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(projectPayload(input)) })).project)
  deleteProject = (id: string) => this.request<{ deleted: boolean; projectId: string }>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
  conversations = async (projectId?: string, archived = false) => {
    const params = new URLSearchParams()
    if (projectId) params.set('projectId', projectId)
    if (archived) params.set('archived', 'true')
    const query = params.size ? `?${params}` : ''
    return (await this.request<{ conversations: ConversationItem[] }>(`/conversations${query}`)).conversations.map(canonicalConversationItem)
  }
  searchConversations = async (query: string, projectId?: string) => {
    const params = new URLSearchParams({ q: query, limit: '60' })
    if (projectId) params.set('projectId', projectId)
    return (await this.request<{ conversations: ConversationItem[] }>(`/search?${params}`)).conversations.map(canonicalConversationItem)
  }
  createConversation = async (input: { title: string; projectId?: string; mode?: string }) =>
    canonicalConversation((await this.request<{ conversation: Conversation }>('/conversations', { method: 'POST', body: JSON.stringify({ ...input, mode: canonicalMode(input.mode) }) })).conversation)
  updateConversation = async (id: string, input: { title?: string; projectId?: string; pinned?: boolean; archived?: boolean }) =>
    (await this.request<{ conversation: Conversation }>(`/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })).conversation
  deleteConversation = (id: string) => this.request<{ deleted: boolean; conversationId: string }>(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
  messages = (id: string, cursor?: string, limit = 8) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return this.request<MessagePage>(`/conversations/${encodeURIComponent(id)}/messages?${params}`)
  }
  sendPrompt = (id: string, input: { prompt: string; mode: string; projectId?: string; pluginIds: string[]; skillSlugs: string[]; mcpNames: string[]; dbNames: string[]; attachments: PromptAttachment[]; resumeTaskId?: string }) =>
    this.request<{ session: StartSessionResult }>(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        mode: canonicalMode(input.mode),
        attachments: input.attachments.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 })),
      }),
    })
  resendPrompt = (id: string, messageId: string, input: { prompt: string; mode: string; projectId?: string; pluginIds: string[]; skillSlugs: string[]; mcpNames: string[]; dbNames: string[]; attachments: PromptAttachment[] }) =>
    this.request<{ session: StartSessionResult }>(`/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/resend`, {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        mode: canonicalMode(input.mode),
        attachments: input.attachments.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 })),
      }),
    })
  catalog = async () => {
    const catalog = await this.request<Catalog>('/catalog')
    return {
      ...catalog,
      mcpServers: catalog.mcpServers ?? [],
      dbConnections: catalog.dbConnections ?? [],
    }
  }
  updatePlugin = (id: string, input: { enabled?: boolean; favorite?: boolean }) =>
    this.request<{ plugin: unknown }>(`/plugins/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  installPluginUpdate = (id: string) =>
    this.request<{ plugin: unknown }>(`/plugins/${encodeURIComponent(id)}/update`, { method: 'POST' })
  updateSkill = (slug: string, input: { enabled?: boolean; favorite?: boolean; scope?: string }) =>
    this.request<{ skill: unknown }>(`/skills/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(input) })
  updateIntegration = (id: string, input: { favorite: boolean }) =>
    this.request<{ updated: boolean; integrationId: string }>(`/integrations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
  modes = async () => {
    const modes = (await this.request<{ modes: ModeOption[] }>('/modes')).modes
    const unique = new Map<string, ModeOption>()
    for (const mode of modes) {
      const id = canonicalMode(mode.id)
      if (!unique.has(id)) unique.set(id, { ...mode, id, name: mode.id === 'general_work' ? 'Agent' : mode.name })
    }
    return [...unique.values()]
  }
  slashCommands = async () => (await this.request<{ commands: BobSlashCommand[] }>('/slash-commands')).commands
  eventsUrl = () => `${this.connection.serverUrl}/api/v1/events`
  taskDetail = (id: string) => this.request<TaskDetail>(`/tasks/${encodeURIComponent(id)}`)
  setTaskPinned = async (id: string, pinned: boolean) => (await this.request<{ task: BobTask }>(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ pinned }) })).task
  cancelTask = (id: string) => this.request<{ taskId: string; state: string }>(`/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  retryTask = (id: string, prompt?: string) => this.request<{ session: StartSessionResult }>(`/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST', body: JSON.stringify({ prompt }) })
  replyToTask = (id: string, prompt: string) => this.request<{ session: StartSessionResult }>(`/tasks/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ prompt }) })
  approvals = async (conversationId?: string) => {
    const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''
    return (await this.request<{ approvals: Approval[] }>(`/approvals${query}`)).approvals
  }
  resolveApproval = (id: string, decision: 'approved' | 'denied', permissionDuration?: 'once' | 'task' | 'always') => this.request<{ approvalId: string; decision: string }>(`/approvals/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: JSON.stringify({ decision, permissionDuration }) })
  registerPushToken = (input: { token: string; platform?: string; deviceName?: string; language?: string }) => this.request<{ registered: boolean }>('/devices/push-token', { method: 'POST', body: JSON.stringify(input) })
  unregisterPushToken = (input: { token: string }) => this.request<{ registered: boolean }>('/devices/push-token', { method: 'DELETE', body: JSON.stringify(input) })
  schedules = async () => (await this.request<{ schedules: Schedule[] }>('/schedules')).schedules
  createSchedule = async (input: ScheduleInput) => (await this.request<{ schedule: Schedule }>('/schedules', { method: 'POST', body: JSON.stringify(input) })).schedule
  updateSchedule = async (id: string, input: ScheduleInput) => (await this.request<{ schedule: Schedule }>(`/schedules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })).schedule
  deleteSchedule = (id: string) => this.request<{ deleted: boolean }>(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  setScheduleState = async (id: string, state: 'active' | 'paused' | 'completed') => (await this.request<{ schedule: Schedule }>(`/schedules/${encodeURIComponent(id)}/state`, { method: 'PATCH', body: JSON.stringify({ state }) })).schedule
  runSchedule = (id: string) => this.request<{ taskId: string }>(`/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' })
  scheduleRuns = async (id: string) => (await this.request<{ runs: ScheduleRun[] }>(`/schedules/${encodeURIComponent(id)}/runs`)).runs
  artifacts = (input: { q?: string; category?: string; projectId?: string; conversationId?: string; cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams()
    if (input.q) params.set('q', input.q)
    if (input.category && input.category !== 'all') params.set('category', input.category)
    if (input.projectId) params.set('projectId', input.projectId)
    if (input.conversationId) params.set('conversationId', input.conversationId)
    if (input.cursor) params.set('cursor', input.cursor)
    params.set('limit', String(input.limit ?? 200))
    return this.request<ArtifactPage>(`/artifacts?${params}`)
  }
  artifact = (id: string) => this.request<RemoteArtifact>(`/artifacts/${encodeURIComponent(id)}`)
  deleteArtifact = (id: string) => this.request<{ deleted: boolean; artifactId: string }>(`/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  artifactContentUrl = (id: string, download = false) => `${this.connection.serverUrl}/api/v1/artifacts/${encodeURIComponent(id)}/content${download ? '?download=true' : ''}`
  authorizationHeaders = () => ({ Authorization: `Bearer ${this.connection.accessToken}` })
  artifactText = async (id: string) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(this.artifactContentUrl(id), {
        signal: controller.signal,
        headers: this.authorizationHeaders(),
      })
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status)
      return await response.text()
    } finally {
      clearTimeout(timeout)
    }
  }
}

function projectPayload(input: ProjectMutationInput) {
  return {
    ...input,
    pluginIds: input.allowedPlugins.filter(value => !value.startsWith('skill:')),
    skillSlugs: input.allowedPlugins.filter(value => value.startsWith('skill:')).map(value => value.slice(6)),
    integrationIds: input.allowedIntegrations,
    allowedPlugins: undefined,
    allowedIntegrations: undefined,
  }
}
