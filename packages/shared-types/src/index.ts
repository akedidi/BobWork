// ============================================================
// Bob Work - Shared Types
// Shared TypeScript types for the entire monorepo
// ============================================================

// ── Bob Adapter ──────────────────────────────────────────────

export interface BobDetectionResult {
  found: boolean;
  path?: string;
  version?: string;
  /** True only when Bob Work can execute `bob run` (session-only key or environment). */
  authenticated: boolean;
  error?: string;
}

export type CapabilityInfo = Capability;

export type CreateProjectInput = {
  name: string;
  description?: string;
  objective?: string;
  color?: string;
  localPath?: string;
  customInstructions?: string;
  language?: string;
  defaultMode?: string;
  template?: string;
};

export type UpdateProjectInput = {
  name?: string;
  description?: string;
  objective?: string;
  color?: string;
  localPath?: string;
  customInstructions?: string;
  language?: string;
  memoryEnabled?: boolean;
  allowedFiles?: string[];
  allowedPlugins?: string[];
  allowedIntegrations?: string[];
  defaultMode?: string;
};

export type CreateConversationInput = {
  projectId?: string;
  title?: string;
  conversationType?: string;
  businessMode?: string;
  bobMode?: string;
};

export type AddMessageInput = {
  conversationId: string;
  author: string;
  content: string;
  attachments?: unknown;
  sources?: unknown;
};

export type CreateTaskInput = {
  objective: string;
  projectId?: string;
  conversationId?: string;
  mode?: string;
  permissionPolicy?: string;
  budget?: number;
  maxTime?: number;
  scheduleId?: string;
};

export type CreatePluginInput = {
  name: string;
  version: string;
  author?: string;
  description?: string;
  scope?: string;
  category: string;
  manifest: unknown;
};

export type ResolveApprovalInput = {
  decision: string;
  permissionDuration?: string;
  modifiedCommand?: string;
};

export type BobStatus =
  | "detecting"
  | "not_found"
  | "incompatible"
  | "unauthenticated"
  | "ready"
  | "busy"
  | "error";

export interface BobInfo {
  version: string;
  path: string;
  authenticated: boolean;
  modes: string[];
  capabilities: CapabilityRegistry;
}

export type CapabilityStatus =
  | "native"
  | "adapted"
  | "emulated"
  | "partial"
  | "unavailable"
  | "to_confirm";

export interface Capability {
  name: string;
  status: CapabilityStatus;
  evidence?: string;
  fallback?: string;
  userMessage: string;
  minimumVersion?: string;
  lastCheckedAt?: string;
}

export type CapabilityRegistry = Record<string, Capability>;

// ── Project ───────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  objective?: string;
  color?: string;
  imageUrl?: string;
  localPath?: string;
  customInstructions?: string;
  language: string;
  memoryEnabled: boolean;
  allowedFiles: string[];
  allowedPlugins: string[];
  allowedIntegrations: string[];
  defaultMode?: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export type ProjectTemplate =
  | "blank"
  | "presentation"
  | "data_analysis"
  | "research"
  | "marketing"
  | "meeting"
  | "financial"
  | "automation";

// ── Conversation ──────────────────────────────────────────────

export type ConversationType = "chat" | "work";

export interface Conversation {
  id: string;
  projectId?: string;
  title: string;
  type: ConversationType;
  businessMode?: string;
  bobMode?: string;
  date: string;
  pinned: boolean;
  localOnly: boolean;
  summary?: string;
  bobContextState?: Record<string, unknown>;
  archived: boolean;
}

export interface ConversationTransferSummary {
  conversations: number;
  messages: number;
  skipped: number;
  detectedFormat: string;
}

// ── Message ───────────────────────────────────────────────────

export type MessageAuthor = "user" | "assistant" | "system";
export type MessageSendState = "sending" | "sent" | "error" | "streaming";

export interface MessageAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  path?: string;
  url?: string;
}

export interface MessageSource {
  id: string;
  title: string;
  url?: string;
  excerpt?: string;
  path?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  content: string;
  attachments: MessageAttachment[];
  sources: MessageSource[];
  citations: string[];
  toolsUsed: ToolUse[];
  sendState: MessageSendState;
  errors?: MessageError[];
  associatedArtifacts: string[];
  associatedApprovals: string[];
  createdAt: string;
}

export interface ToolUse {
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  timestamp: string;
}

export interface MessageError {
  code: string;
  message: string;
  details?: string;
}

// ── Task ──────────────────────────────────────────────────────

export type TaskState =
  | "draft"
  | "queued"
  | "starting"
  | "running"
  | "awaiting_info"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type PermissionPolicy =
  | "always_ask"
  | "ask_for_modifications"
  | "ask_for_important"
  | "never_ask";

export interface Task {
  id: string;
  objective: string;
  projectId?: string;
  conversationId?: string;
  mode?: string;
  permissionPolicy: PermissionPolicy;
  budget?: number;
  maxTime?: number;
  bobProcessId?: string;
  startDate?: string;
  endDate?: string;
  summary?: string;
  progress: number;
  errors?: TaskError[];
  resumable: boolean;
  scheduleId?: string;
  shellTaskId?: string;
  lastEventAt?: string;
  pinned: boolean;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
}

export interface TaskError {
  code: string;
  message: string;
  timestamp: string;
  step?: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  title: string;
  description?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  dependencies: string[];
  responsibleAgent?: string;
  startDate?: string;
  endDate?: string;
  tools: string[];
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  retryCount: number;
  error?: string;
  validationRequired: boolean;
}

export interface TaskRun {
  id: string;
  taskId: string;
  attempt: number;
  state: string;
  shellSessionId?: string;
  shellTaskId?: string;
  processId?: number;
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  error?: string;
  createdAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  runId?: string;
  sequence: number;
  eventType: string;
  title?: string;
  content?: string;
  toolName?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TaskIO {
  id: string;
  taskId: string;
  runId?: string;
  direction: 'input' | 'output';
  ioType: string;
  name: string;
  pathOrUrl?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TaskDetail {
  task: Task;
  runs: TaskRun[];
  events: TaskEvent[];
  inputs: TaskIO[];
  outputs: TaskIO[];
}

// ── Approval ──────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ApprovalDecision =
  | "pending"
  | "approved"
  | "denied"
  | "modified";

export type PermissionDuration = "once" | "task" | "always";

export interface Approval {
  id: string;
  taskId: string;
  actionType: string;
  humanDescription: string;
  commandOrChange?: string;
  dataAccessed: string[];
  filesAffected: string[];
  networkDestination?: string;
  riskLevel: RiskLevel;
  decision: ApprovalDecision;
  permissionDuration?: PermissionDuration;
  decidedBy?: string;
  decidedAt?: string;
  undoPossible: boolean;
  createdAt: string;
}

// ── Artifact ──────────────────────────────────────────────────

export type ArtifactType =
  | "text"
  | "markdown"
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "csv"
  | "image"
  | "html"
  | "web"
  | "archive"
  | "code";

export type ArtifactValidationStatus =
  | "pending"
  | "valid"
  | "invalid"
  | "warning";

export interface Artifact {
  id: string;
  /** Wire name from Rust: artifact_type -> artifactType */
  artifactType: string;
  title: string;
  filePath: string;
  version: number;
  previewPath?: string;
  origin?: string;
  sources: unknown[];
  validationStatus: ArtifactValidationStatus;
  validationNotes?: string;
  exported: boolean;
  createdAt: string;
  size?: number;
}

// ── Plugin ────────────────────────────────────────────────────

export type PluginCategory = "recipe" | "integration" | "executable";
export type PluginScope = "project" | "personal" | "team";
export type PluginInstallState =
  | "installed"
  | "disabled"
  | "draft"
  | "update_available"
  | "error";

export interface PluginPermission {
  type: string;
  path?: string;
  domain?: string;
  description: string;
  required: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  scope: PluginScope;
  category: PluginCategory;
  capabilities: string[];
  inputs: PluginInputSchema[];
  outputs: PluginOutputSchema[];
  skills?: SkillDefinition[];
  modes?: ModeDefinition[];
  tools?: ToolDefinition[];
  integrations?: IntegrationRequirement[];
  mcpServers?: Record<string, PluginMcpServerDefinition>;
  browserExtensions?: PluginBrowserExtension[];
  hooks?: PluginHookDefinition[];
  scheduledTaskTemplates?: PluginScheduleTemplate[];
  permissions: PluginPermission[];
  triggers?: PluginTrigger[];
  runtime?: RuntimeRequirements;
  compatibility: {
    minimumBobVersion: string;
    minimumAppVersion: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PluginMcpServerDefinition {
  displayName?: string;
  description?: string;
  required?: boolean;
  tools?: Array<string | { name: string; description?: string }>;
  type?: "streamable-http" | "http" | "sse" | string;
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface PluginMcpStatus {
  id: string;
  name: string;
  description?: string;
  transport: string;
  tools: string[];
  configured: boolean;
  enabled: boolean;
  required: boolean;
}

export interface PluginIntegrationStatus {
  provider: string;
  name: string;
  authType: "oauth" | "token" | "mcp" | string;
  scopes: string[];
  state: "connected" | "configured" | "disabled" | "disconnected" | string;
  required: boolean;
  message: string;
}

export interface MacosChromeControlStatus {
  chromeInstalled: boolean;
  mcpConfigured: boolean;
  mcpEnabled: boolean;
  automation: 'granted' | 'denied' | 'chrome_missing' | 'unavailable' | 'unknown';
  automationMessage: string;
}

export interface PluginBrowserExtension {
  id: string;
  displayName: string;
  capability: "browser" | "computer_use" | "chrome";
  mcpServer?: string;
  required?: boolean;
}

export interface PluginBrowserStatus {
  id: string;
  name: string;
  capability: string;
  state: "ready" | "disabled" | "disconnected" | string;
  required: boolean;
  message: string;
}

export interface PluginHookDefinition {
  id: string;
  displayName: string;
  event: "before_task" | "after_task" | "task_error";
  entrypoint: string;
  args?: string[];
  enabled?: boolean;
  required?: boolean;
  timeoutSeconds?: number;
}

export interface PluginHookStatus {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  required: boolean;
}

export interface PluginScheduleTemplate {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  cronOrEvent: string;
  pluginOrMode?: string;
  offlineBehavior: OfflineBehavior;
  overlapPolicy: OverlapPolicy;
}

export interface PluginExtensionStatus {
  integrations: PluginIntegrationStatus[];
  browserExtensions: PluginBrowserStatus[];
  hooks: PluginHookStatus[];
  scheduledTaskTemplates: PluginScheduleTemplate[];
}

export interface PluginInputSchema {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
}

export interface PluginOutputSchema {
  name: string;
  type: string;
  description: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
}

export interface ModeDefinition {
  name: string;
  description: string;
  prompt: string;
  model?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface IntegrationRequirement {
  provider: string;
  displayName?: string;
  description?: string;
  authType?: "oauth" | "token" | "mcp";
  mcpServer?: string;
  scopes: string[];
  optional: boolean;
}

export interface PluginTrigger {
  type: "schedule" | "event" | "manual";
  cron?: string;
  event?: string;
  description: string;
}

export interface RuntimeRequirements {
  node?: string;
  python?: string;
  bob?: string;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  author?: string;
  description: string;
  scope: PluginScope;
  category: PluginCategory;
  manifest: PluginManifest;
  installState: PluginInstallState;
  validationState: "pending" | "valid" | "invalid" | "warning";
  signature?: string;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
  availableVersion?: string;
}

export interface PluginVersion {
  pluginId: string;
  version: string;
  releaseNotes?: string;
  createdAt: string;
  installedAt?: string;
  state: "current" | "available" | "previous";
}

export interface PluginVersionDiff {
  fromVersion: string;
  toVersion: string;
  changes: string[];
  warnings: string[];
  permissionsChanged: boolean;
}

// ── Integration ───────────────────────────────────────────────

export type IntegrationHealthState = "healthy" | "degraded" | "disconnected";

export interface Integration {
  id: string;
  provider: string;
  account?: string;
  authType: string;
  scopes: string[];
  availableTools: string[];
  approvalPermission: PermissionPolicy;
  healthState: IntegrationHealthState;
  lastSync?: string;
  allowedProjects: string[];
  createdAt: string;
  updatedAt: string;
}

// ── Schedule ──────────────────────────────────────────────────

export type ScheduleState = "active" | "paused" | "completed";
export type OfflineBehavior = "skip" | "run_on_wake" | "ask";
export type OverlapPolicy = "ignore" | "queue" | "cancel_old" | "ask";

export interface Schedule {
  id: string;
  name: string;
  instructions: string;
  projectId?: string;
  pluginOrMode?: string;
  cronOrEvent: string;
  timezone: string;
  nextRun?: string;
  lastRun?: string;
  offlineBehavior: OfflineBehavior;
  overlapPolicy: OverlapPolicy;
  retryPolicy?: RetryPolicy;
  notifications: ScheduleNotification[];
  state: ScheduleState;
  createdAt: string;
  updatedAt: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  delaySeconds: number;
  backoffMultiplier?: number;
}

export interface CreateScheduleInput {
  name: string;
  instructions: string;
  projectId?: string;
  pluginOrMode?: string;
  cronOrEvent: string;
  timezone?: string;
  offlineBehavior?: OfflineBehavior;
  overlapPolicy?: OverlapPolicy;
}

export interface ScheduleNotification {
  event: string;
  channel: "system" | "email";
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  taskId?: string;
  scheduledFor: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  error?: string;
  createdAt: string;
}

// ── Event ─────────────────────────────────────────────────────

export interface AppEvent {
  id: string;
  type: string;
  timestamp: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  userId?: string;
}

// ── UI State ──────────────────────────────────────────────────

export type Theme = "light" | "dark" | "system";
export type BusinessMode =
  | "quick_chat"
  | "planning"
  | "general_work"
  | "presentation"
  | "document"
  | "spreadsheet"
  | "research"
  | "website"
  | "automation"
  | "orchestrator"
  | "plugin_creator";

export interface AppSettings {
  theme: Theme;
  language: string;
  /** Maps to BusinessMode but stored as plain string for flexibility */
  defaultMode: string;
  sidebarWidth: number;
  inspectorWidth: number;
  sidebarVisible: boolean;
  inspectorVisible: boolean;
  fontSize: number;
  reducedMotion: boolean;
  /** Maps to PermissionPolicy but stored as plain string */
  permissionPolicy: string;
  launchAtLogin: boolean;
  menuBarEnabled: boolean;
  globalHotkey?: string;
  globalInstructions: string;
  maxTurns: number;
  maxCost: number;
  mcpEnabled: boolean;
  subagentsEnabled: boolean;
  webEnabled: boolean;
  notificationsEnabled: boolean;
  notifyTaskComplete: boolean;
  voiceOnDevice: boolean;
  taskRetentionDays: number;
  telemetryEnabled: boolean;
  computerUseEnabled: boolean;
  chromeControlEnabled: boolean;
}

export interface BobMode {
  slug: string;
  name: string;
  description?: string;
  groups: string[];
  builtin: boolean;
  source: string;
}

export interface ShellProfile {
  detection: BobDetectionResult;
  commit?: string;
  authenticationMethod: 'api_key' | 'sso_session_detected' | 'required' | string;
  supportsStreamJson: boolean;
  supportsResume: boolean;
  supportsTaskList: boolean;
  supportsMcp: boolean;
  supportsSubagents: boolean;
  supportsLimits: boolean;
  modes: BobMode[];
  checkedAt: string;
}

export interface SearchResult {
  entityType: 'project' | 'conversation' | 'message' | 'task' | string;
  entityId: string;
  projectId?: string;
  title: string;
  snippet: string;
  score: number;
}

export interface WorkspaceSkill {
  slug: string;
  name: string;
  description: string;
  content: string;
  sourcePath: string;
  scope: string;
  enabled: boolean;
}

export interface SaveSkillInput {
  slug: string;
  description: string;
  content: string;
  workspace?: string;
}

export interface McpServer {
  name: string;
  transport: string;
  commandOrUrl: string;
  args: string[];
  enabled: boolean;
  status: string;
  raw: Record<string, unknown>;
}

export interface SaveMcpServerInput {
  name: string;
  transport: string;
  commandOrUrl: string;
  args: string[];
  enabled: boolean;
}

export interface PermissionGrant {
  id: string;
  actionType: string;
  resource: string;
  scope: 'once' | 'task' | 'conversation' | 'project' | 'always';
  scopeId?: string;
  decision: 'allow' | 'deny';
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface UsageStatus {
  available: boolean;
  usedAmount?: number;
  remainingAmount?: number;
  totalAmount?: number;
  unit?: string;
  capturedAt?: string;
  instanceLabel?: string;
  message: string;
}

export interface PreviewEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

export interface FilePreview {
  path: string;
  name: string;
  kind: 'directory' | 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'html' | 'text' | 'office' | 'unsupported' | string;
  mimeType: string;
  size: number;
  modifiedAt?: string;
  previewPath?: string;
  content?: string;
  entries: PreviewEntry[];
  quickLook: boolean;
}

// ── IPC Events ────────────────────────────────────────────────

export interface BobEvent {
  type:
    | "bob.detected"
    | "bob.authentication_required"
    | "bob.ready"
    | "bob.capability_unavailable"
    | "task.created"
    | "task.started"
    | "task.progress"
    | "task.step_created"
    | "task.step_started"
    | "task.step_completed"
    | "task.completed"
    | "task.failed"
    | "task.cancelled"
    | "tool.requested"
    | "tool.executed"
    | "tool.failed"
    | "approval.required"
    | "approval.resolved"
    | "file.changed"
    | "artifact.created"
    | "artifact.updated"
    | "user.input_required";
  payload: Record<string, unknown>;
  timestamp: string;
}
