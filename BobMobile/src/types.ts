export interface Connection {
  serverUrl: string
  accessToken: string
}

export interface Project {
  id: string
  name: string
  description?: string | null
  objective?: string | null
  color?: string | null
  localPath?: string | null
  customInstructions?: string | null
  language: string
  memoryEnabled: boolean
  defaultMode?: string | null
  updatedAt: string
  allowedPlugins: string[]
  allowedIntegrations: string[]
  conversationCount?: number
  activeTaskCount?: number
}

export interface ProjectMutationInput {
  name: string
  description?: string
  objective?: string
  customInstructions?: string
  language?: string
  defaultMode?: string
  memoryEnabled?: boolean
  allowedPlugins: string[]
  allowedIntegrations: string[]
}

export interface Conversation {
  id: string
  projectId?: string | null
  title: string
  type: string
  bobMode?: string | null
  date: string
  summary?: string | null
  pinned?: boolean
  archived?: boolean
}

export interface ConversationItem {
  conversation: Conversation
  taskState?: string | null
  scheduled?: boolean
  matchSnippet?: string | null
}

export interface Message {
  id: string
  conversationId: string
  author: 'user' | 'assistant' | string
  content: string
  attachments: unknown[]
  artifacts?: RemoteArtifact[]
  fileChanges?: FileChange[]
  toolsUsed?: unknown[]
  createdAt: string
}

export interface FileChange {
  path: string
  changeType: 'created' | 'modified' | 'deleted'
}

export interface RemoteArtifact {
  id: string
  type: string
  title: string
  fileName: string
  mimeType: string
  size?: number | null
  inlinePreview: boolean
  category?: 'pdf' | 'images' | 'word' | 'excel' | 'powerpoint' | 'text' | 'other' | string
  version?: number
  validationStatus?: 'valid' | 'warning' | 'invalid' | 'pending' | string
  validationNotes?: string | null
  exported?: boolean
  createdAt?: string
  conversation?: { id: string; title?: string | null } | null
  project?: { id: string; name?: string | null } | null
  versions?: ArtifactVersion[]
}

export interface ArtifactVersion {
  id: string
  version: number
  createdAt: string
  validationStatus?: string
}

export interface ArtifactPage {
  artifacts: RemoteArtifact[]
  nextCursor?: string | null
  hasMore: boolean
  total: number
}

export interface MessagePage {
  messages: Message[]
  nextCursor?: string | null
  hasMore: boolean
  taskState?: string | null
}

export interface StartSessionResult {
  sessionId: string
  taskId: string
  userMessageId: string
  awaitingApproval?: boolean
}

export interface LiveEnvelope {
  type: 'connected' | 'bob-token' | 'bob-activity' | 'bob-session-done' | 'task-updated' | 'approval-required' | 'approval-resolved' | 'conversation-updated' | 'project-updated' | 'artifacts-updated' | string
  payload: unknown
  sentAt: string
}

export interface BobTokenPayload {
  sessionId: string
  conversationId: string
  taskId?: string | null
  chunk: string
  isFinal: boolean
  eventType: string
}

export interface BobActivityPayload {
  sessionId: string
  conversationId: string
  taskId?: string | null
  type?: string
  eventType: string
  title?: string | null
  content?: string | null
  toolName?: string | null
  payload?: Record<string, unknown>
}

export interface Approval {
  id: string
  taskId: string
  actionType: string
  humanDescription: string
  commandOrChange?: string | null
  filesAffected: unknown[]
  networkDestination?: string | null
  riskLevel: string
  undoPossible: boolean
  createdAt: string
}

export interface TaskEvent {
  id: string
  taskId: string
  runId?: string | null
  sequence: number
  type: string
  title?: string | null
  content?: string | null
  toolName?: string | null
  createdAt: string
}

export interface TaskOutput {
  id: string
  taskId: string
  type: string
  name: string
  mimeType?: string | null
  size?: number | null
  artifact?: RemoteArtifact | null
  createdAt: string
}

export interface TaskDetail {
  task: BobTask
  runs: TaskRun[]
  events: TaskEvent[]
  outputs: TaskOutput[]
  inputs: TaskOutput[]
}

export interface TaskRun { id: string; taskId: string; state: string; startedAt?: string | null; endedAt?: string | null; summary?: string | null; error?: string | null; createdAt: string }

export interface Schedule {
  id: string; name: string; instructions: string; projectId?: string | null; pluginOrMode?: string | null
  cronOrEvent: string; runAt?: string | null; timezone: string; nextRun?: string | null; lastRun?: string | null
  offlineBehavior: string; overlapPolicy: string; state: 'active' | 'paused' | 'completed' | string
  createdAt: string; updatedAt: string
}
export interface ScheduleRun { id: string; scheduleId: string; taskId?: string | null; scheduledFor: string; state: string; startedAt?: string | null; endedAt?: string | null; summary?: string | null; error?: string | null; createdAt: string }
export interface ScheduleInput { name: string; instructions: string; projectId?: string; pluginOrMode?: string; cronOrEvent: string; runAt?: string; timezone?: string; offlineBehavior?: string; overlapPolicy?: string }

export interface CatalogPlugin {
  id: string
  name: string
  icon?: string | null
  description?: string | null
  category?: string
  scope?: string
  builtin?: boolean
  enabled: boolean
  favorite: boolean
  version: string
  availableVersion?: string | null
  lastUsedAt?: string | null
  validationState?: string
  permissions: string[]
  capabilities: string[]
  tools: string[]
  configuration: string[]
  requiresMacConfiguration: boolean
  canUpdate: boolean
}

export interface CatalogSkill {
  slug: string
  name: string
  description?: string | null
  scope?: string
  enabled: boolean
  builtin: boolean
  favorite: boolean
  updatedAt?: string
  icon?: string
}

export interface Catalog {
  plugins: CatalogPlugin[]
  skills: CatalogSkill[]
  integrations: CatalogIntegration[]
  mcpServers: CatalogMcpServer[]
  dbConnections: CatalogDbConnection[]
}

export interface CatalogMcpServer {
  name: string
  transport: string
  enabled: boolean
  builtin?: boolean
  status: string
}

export interface CatalogDbConnection {
  id: string
  name: string
  engine: string
  enabled: boolean
}

export interface CatalogIntegration {
  id: string
  name: string
  connected: boolean
  favorite: boolean
  authMethod?: string | null
  accountLabel?: string | null
  expiresAt?: string | null
  oauthClientConfigured: boolean
  deviceFlowAvailable: boolean
  scopeSatisfied: boolean
  permissions: string[]
  requiresMacConfiguration: boolean
}

export interface ModeOption {
  id: string
  name: string
  description?: string | null
}

export interface BobSlashCommand {
  name: string
  description: string
  source: 'bob' | 'fallback' | string
  altNames?: string[]
}

export interface PromptAttachment {
  id: string
  name: string
  mimeType?: string
  dataBase64: string
}

export interface QueuedPrompt {
  id: string
  prompt: string
  mode: string
  projectId?: string
  pluginIds: string[]
  skillSlugs: string[]
  mcpNames: string[]
  dbNames: string[]
  attachments: PromptAttachment[]
  editMessageId?: string
}

export interface Bootstrap {
  apiVersion: string
  bobAvailable: boolean
  settings: {
    theme: string
    language: string
    defaultMode: string
    permissionPolicy: string
    permissionPolicySource?: 'bob_work' | string
    sandboxMode: boolean
    mcpEnabled: boolean
    subagentsEnabled: boolean
    webEnabled: boolean
    locationEnabled?: boolean
    currentLatitude?: number | null
    currentLongitude?: number | null
    currentLocationUpdatedAt?: string | null
  }
}

export interface UsageStatus {
  available: boolean
  usedAmount?: number | null
  remainingAmount?: number | null
  totalAmount?: number | null
  unit?: string | null
  capturedAt?: string | null
  instanceLabel?: string | null
  accountEmail?: string | null
  instanceName?: string | null
  message: string
}

export interface BobTask {
  id: string
  objective: string
  projectId?: string | null
  conversationId?: string | null
  mode?: string | null
  permissionPolicy: string
  summary?: string | null
  progress: number
  pinned: boolean
  startDate?: string | null
  endDate?: string | null
  errors?: unknown
  scheduleId?: string | null
  state: string
  resumable: boolean
  shellTaskId?: string | null
  bobProcessId?: string | null
  lastEventAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface SyncSnapshot {
  syncedAt: string
  projects: Project[]
  conversations: ConversationItem[]
  tasks: BobTask[]
}
