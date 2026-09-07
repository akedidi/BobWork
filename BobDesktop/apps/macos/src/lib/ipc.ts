// ============================================================
// Bob Work - IPC Layer
// Typed wrappers for Tauri commands
// ============================================================

import { invoke } from '@tauri-apps/api/core';
import type { ConversationInteraction, RuntimeInstallationPlan, RuntimeRecord, RuntimeStorageReport } from '@bob-work/shared-types';
import type {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  Conversation,
  CreateConversationInput,
  ConversationTransferSummary,
  Message,
  AddMessageInput,
  Task,
  CreateTaskInput,
  Plugin,
  CreatePluginInput,
  PluginExtensionStatus,
  PluginMcpStatus,
  PluginMcpTestResult,
  PluginResourceStatus,
  PluginVersion,
  PluginVersionDiff,
  Approval,
  ResolveApprovalInput,
  Artifact,
  AppSettings,
  MacosChromeControlStatus,
  MacosComputerUseStatus,
  BobDetectionResult,
  CapabilityInfo,
  BobAuthSnapshot,
  Schedule,
  ScheduleRun,
  CreateScheduleInput,
  ShellProfile,
  BobMode,
  ModeCatalogEntry,
  TaskDetail,
  SearchResult,
  WorkspaceSkill,
  SaveSkillInput,
  McpServer,
  SaveMcpServerInput,
  PermissionGrant,
  UsageStatus,
  BobalyticsReport,
  BobalyticsScope,
  FilePreview,
  DbConnection,
  SaveDbConnectionInput,
  DbConnectionTestResult,
  PluginFileResource,
  PluginLinkedDatabase,
  BobSlashCommand,
  PersistentMemory,
  CreateMemoryInput,
} from '@bob-work/shared-types';

// ── Bob Commands ─────────────────────────────────────────────

export const detectBob = () =>
  invoke<BobDetectionResult>('detect_bob');

export const getBobAuthSnapshot = () =>
  invoke<BobAuthSnapshot>('get_bob_auth_snapshot');


export const getBobCapabilities = () =>
  invoke<Record<string, CapabilityInfo>>('get_bob_capabilities');

export const getBobProfile = (workspace?: string) =>
  invoke<ShellProfile>('get_bob_profile', { workspace });

export const getBobModes = (workspace?: string) =>
  invoke<BobMode[]>('get_bob_modes', { workspace });

export const listBobSlashCommands = () =>
  invoke<BobSlashCommand[]>('list_bob_slash_commands');

export const listModeMarketplace = (workspace?: string) =>
  invoke<ModeCatalogEntry[]>('list_mode_marketplace', { workspace });

export const installBobMode = (slug: string) =>
  invoke<BobMode>('install_bob_mode', { slug });

export const uninstallBobMode = (slug: string) =>
  invoke<void>('uninstall_bob_mode', { slug });

export const importBobModeYaml = (yaml: string) =>
  invoke<BobMode>('import_bob_mode_yaml', { yaml });

export const sendMessage = (params: {
  conversationId: string;
  message: string;
  mode: string;
  projectId?: string;
  attachmentPaths?: string[];
  resumeTaskId?: string;
  approvedPluginIds?: string[];
}) => invoke<{ sessionId: string; taskId: string; userMessageId: string; awaitingApproval?: boolean; contextCondensed?: boolean }>('send_message', {
  conversationId: params.conversationId,
  message: params.message,
  mode: params.mode,
  projectId: params.projectId,
  attachmentPaths: params.attachmentPaths,
  resumeTaskId: params.resumeTaskId,
  approvedPluginIds: params.approvedPluginIds,
});

export const stopTask = (sessionId: string) =>
  invoke<void>('stop_task', { sessionId });

// ── Project Commands ─────────────────────────────────────────

export const getProjects = () => invoke<Project[]>('get_projects');

export const getProject = (id: string) => invoke<Project | null>('get_project', { id });

export const createProject = (input: CreateProjectInput) =>
  invoke<Project>('create_project', { input });

export const updateProject = (id: string, input: UpdateProjectInput) =>
  invoke<Project>('update_project', { id, input });

export const deleteProject = (id: string) => invoke<void>('delete_project', { id });

export const archiveProject = (id: string, archived: boolean) =>
  invoke<void>('archive_project', { id, archived });

// ── Conversation Commands ─────────────────────────────────────

export const getConversations = (projectId?: string) =>
  invoke<Conversation[]>('get_conversations', { projectId });

export const getConversation = (id: string) =>
  invoke<Conversation | null>('get_conversation', { id });

export const createConversation = (input: CreateConversationInput) =>
  invoke<Conversation>('create_conversation', { input });

export const updateConversation = (id: string, params: { title?: string; pinned?: boolean; archived?: boolean; projectId?: string }) =>
  invoke<void>('update_conversation', { id, ...params });

export const deleteConversation = (id: string) =>
  invoke<void>('delete_conversation', { id });

export const getMessages = (conversationId: string) =>
  invoke<Message[]>('get_messages', { conversationId });

export const addMessage = (input: AddMessageInput) =>
  invoke<Message>('add_message', { input });

export const truncateMessagesFrom = (conversationId: string, messageId: string) =>
  invoke<number>('truncate_messages_from', { conversationId, messageId });

export interface RewindConversationResult {
  deletedMessages: number;
  cancelledTasks: number;
  titleReset: boolean;
}

export const rewindConversationFromMessage = (conversationId: string, messageId: string) =>
  invoke<RewindConversationResult>('rewind_conversation_from_message', { conversationId, messageId });



export const importConversations = (path: string) =>
  invoke<ConversationTransferSummary>('import_conversations', { path });

export type ConversationExportFormat = 'bob-work-export-v1' | 'chatgpt' | 'claude-cowork';

export const exportConversations = (path: string, format: ConversationExportFormat = 'bob-work-export-v1') =>
  invoke<ConversationTransferSummary>('export_conversations', { path, format });

export const openMacosPrivacyPane = (
  pane: 'accessibility' | 'automation' | 'notifications' | 'microphone' | 'speech' | 'screen-recording',
) => invoke<void>('open_macos_privacy_pane', { pane });

export type MicrophoneAuthorizationState = 'not_determined' | 'denied' | 'restricted' | 'authorized';

export const getMicrophoneAuthorizationState = () =>
  invoke<MicrophoneAuthorizationState>('microphone_authorization_state');

export const requestMicrophonePermission = () =>
  invoke<MicrophoneAuthorizationState>('request_microphone_permission');

export interface VoiceDictationPermission {
  microphone: MicrophoneAuthorizationState;
  speechRecognition: MicrophoneAuthorizationState;
}

export const requestVoiceDictationPermission = () =>
  invoke<VoiceDictationPermission>('request_voice_dictation_permission');

export interface VoiceDictationAvailability {
  available: boolean;
  reason?: 'unsupported_platform' | 'requires_app_bundle' | 'missing_usage_description' | 'executable_unavailable' | null;
}

export const getVoiceDictationAvailability = () =>
  invoke<VoiceDictationAvailability>('get_voice_dictation_availability');

export type NotificationAuthState =
  | 'not_determined'
  | 'denied'
  | 'authorized'
  | 'provisional'
  | 'ephemeral'
  | 'unavailable';

export const isNotificationAuthGranted = (state: NotificationAuthState): boolean =>
  state === 'authorized' || state === 'provisional' || state === 'ephemeral';

export const getNotificationAuthState = () =>
  invoke<NotificationAuthState>('notification_authorization_state');

export const requestNotificationAuthorization = () =>
  invoke<NotificationAuthState>('request_notification_authorization');

export interface NotificationOpenTarget {
  conversationId?: string | null
  taskId?: string | null
}

export interface AppNotificationPayload {
  id: string
  title: string
  body: string
  kind: string
  createdAt: string
  taskId?: string | null
  conversationId?: string | null
}

export const listAppNotifications = () =>
  invoke<AppNotificationPayload[]>('list_app_notifications');

export const takePendingNotificationOpen = () =>
  invoke<NotificationOpenTarget | null>('take_pending_notification_open');

export const requestAccessibilityPermission = () =>
  invoke<boolean>('request_accessibility_permission');

export const requestChromeAutomationPermission = () =>
  invoke<string>('request_chrome_automation_permission');

export const getChromeControlStatus = () =>
  invoke<MacosChromeControlStatus>('get_chrome_control_status');

export const getComputerUseStatus = () =>
  invoke<MacosComputerUseStatus>('get_computer_use_status');

// ── Task Commands ─────────────────────────────────────────────

export const getTasks = (projectId?: string) =>
  invoke<Task[]>('get_tasks', { projectId });

export const getTask = (id: string) => invoke<Task | null>('get_task', { id });

export const getTaskDetail = (id: string) => invoke<TaskDetail | null>('get_task_detail', { id });

export const createTask = (input: CreateTaskInput) =>
  invoke<Task>('create_task', { input });

export const updateTaskState = (id: string, state: string) =>
  invoke<void>('update_task_state', { id, state });

export const updateTaskPinned = (id: string, pinned: boolean) =>
  invoke<void>('update_task_pinned', { id, pinned });

export const cancelTask = (id: string) => invoke<void>('cancel_task', { id });

// ── Plugin Commands ───────────────────────────────────────────

export const getPlugins = () => invoke<Plugin[]>('get_plugins');

export const getPlugin = (id: string) => invoke<Plugin | null>('get_plugin', { id });

export const getPluginVersions = (pluginId: string) =>
  invoke<PluginVersion[]>('get_plugin_versions', { pluginId });

export const comparePluginVersion = (pluginId: string, version: string) =>
  invoke<PluginVersionDiff>('compare_plugin_version', { pluginId, version });

export const installPluginUpdate = (pluginId: string, version: string) =>
  invoke<Plugin>('install_plugin_update', { pluginId, version });

export const rollbackPluginVersion = (pluginId: string, version: string) =>
  invoke<Plugin>('rollback_plugin_version', { pluginId, version });

export const createPlugin = (input: CreatePluginInput) =>
  invoke<Plugin>('create_plugin', { input });

export const updatePlugin = (pluginId: string, input: CreatePluginInput) =>
  invoke<Plugin>('update_plugin', { pluginId, input });

export const deletePlugin = (pluginId: string) =>
  invoke<void>('delete_plugin', { pluginId });

export const installPlugin = (pluginId: string) =>
  invoke<void>('install_plugin', { pluginId });

export const uninstallPlugin = (pluginId: string) =>
  invoke<void>('uninstall_plugin', { pluginId });

export const togglePlugin = (pluginId: string, enabled: boolean) =>
  invoke<void>('toggle_plugin', { pluginId, enabled });

export const getPluginMcpStatus = (pluginId: string) =>
  invoke<PluginMcpStatus[]>('get_plugin_mcp_status', { pluginId });

export const testPluginMcp = (pluginId: string) =>
  invoke<PluginMcpTestResult[]>('test_plugin_mcp', { pluginId });

export const getPluginExtensionStatus = (pluginId: string) =>
  invoke<PluginExtensionStatus>('get_plugin_extension_status', { pluginId });

export const getPluginResourceStatus = (pluginId: string) =>
  invoke<PluginResourceStatus[]>('get_plugin_resource_status', { pluginId });

export const validatePlugin = (manifest: unknown) =>
  invoke<{ valid: boolean; warnings: string[]; errors: string[]; riskLevel: string }>('validate_plugin', { manifest });

export const exportPluginZip = (pluginId: string, destination: string) =>
  invoke<void>('export_plugin_zip', { pluginId, destination });

export const importPluginZip = (source: string) =>
  invoke<Plugin>('import_plugin_zip', { source });

// ── Approval Commands ─────────────────────────────────────────

export const getPendingApprovals = () =>
  invoke<Approval[]>('get_pending_approvals');

export const resolveApproval = (approvalId: string, input: ResolveApprovalInput) =>
  invoke<void>('resolve_approval', { approvalId, input });

// ── Artifact Commands ─────────────────────────────────────────

export const getArtifacts = () => invoke<Artifact[]>('get_artifacts');

export const getArtifact = (id: string) => invoke<Artifact | null>('get_artifact', { id });

export const deleteArtifact = (id: string) => invoke<void>('delete_artifact', { id });

export const registerExternalArtifact = (path: string, conversationId?: string) =>
  invoke<Artifact | null>('register_external_artifact', {
    path,
    conversationId: conversationId ?? null,
  });

export const openArtifact = (id: string) => invoke<void>('open_artifact', { id });

// ── Settings Commands ─────────────────────────────────────────

/** Matches Rust `AppSettings::default` — used for instant Settings paint before IPC. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'auto',
  defaultMode: 'agent',
  sidebarWidth: 260,
  inspectorWidth: 340,
  sidebarVisible: true,
  inspectorVisible: true,
  fontSize: 15,
  reducedMotion: false,
  permissionPolicy: 'ask_for_important',
  launchAtLogin: false,
  menuBarEnabled: true,
  globalInstructions: '',
  maxCost: 0,
  mcpEnabled: true,
  subagentsEnabled: true,
  webEnabled: true,
  notificationsEnabled: true,
  notifyTaskComplete: true,
  voiceOnDevice: true,
  retainAudioRecordings: true,
  taskRetentionDays: 30,
  telemetryEnabled: false,
  computerUseEnabled: false,
  chromeControlEnabled: false,
  sandboxMode: false,
  crossConversationContext: false,
  persistentMemoryEnabled: false,
  persistentMemoryEngine: 'local',
  remoteControlEnabled: false,
  mcpGatewayEnabled: false,
  mcpGatewayTools: [],
  autoCondenseEnabled: true,
  autoCondenseThreshold: 0.85,
  locationEnabled: false,
}

/** In-memory settings so Settings UI can paint without waiting on IPC. */
let cachedSettings: AppSettings | null = null
let settingsInflight: Promise<AppSettings> | null = null

export const peekCachedSettings = (): AppSettings | null => cachedSettings

/** Cached settings if known, otherwise safe defaults for first paint. */
export const resolveSettingsSnapshot = (): AppSettings =>
  cachedSettings ?? DEFAULT_APP_SETTINGS

export const getSettings = (options?: { force?: boolean }) => {
  const force = options?.force === true
  if (!force && cachedSettings) return Promise.resolve(cachedSettings)
  if (!force && settingsInflight) return settingsInflight

  const request = invoke<AppSettings>('get_settings').then(settings => {
    cachedSettings = settings
    return settings
  })
  if (!force) {
    settingsInflight = request.finally(() => {
      settingsInflight = null
    })
    return settingsInflight
  }
  return request
}

/** Kick off settings IPC as early as possible (call from app bootstrap). */
export const warmSettingsCache = () => {
  void getSettings().catch(() => undefined)
}

export const updateSettings = async (settings: AppSettings) => {
  await invoke<void>('update_settings', { settings })
  cachedSettings = settings
}

export const getMemories = () => invoke<PersistentMemory[]>('get_memories')
export const createMemory = (input: CreateMemoryInput) => invoke<PersistentMemory>('create_memory', { input })
export const forgetMemory = (id: string) => invoke<void>('forget_memory', { id })

export interface RemoteControlStatus {
  enabled: boolean
  state: 'disabled' | 'starting' | 'verifying' | 'ready' | 'error' | string
  publicUrl?: string | null
  connectionUrl?: string | null
  error?: string | null
}

export const getRemoteControlStatus = () =>
  invoke<RemoteControlStatus>('get_remote_control_status')

export const restartRemoteControl = () =>
  invoke<RemoteControlStatus>('restart_remote_control')

// ── System Commands ───────────────────────────────────────────

export const getAppInfo = () =>
  invoke<{ appVersion: string; tauriVersion: string; os: string; arch: string; dataDir: string; logDir: string }>('get_app_info');

export const openDataDir = () => invoke<void>('open_data_dir');

export type DatabaseBackup = {
  name: string
  path: string
  createdAt: string
  sizeBytes: number
}

export const createDatabaseBackup = () =>
  invoke<DatabaseBackup>('create_database_backup')

export const listDatabaseBackups = () =>
  invoke<DatabaseBackup[]>('list_database_backups')

export const restoreDatabaseBackup = (name: string) =>
  invoke<void>('restore_database_backup', { name })

export type CachePurgeResult = {
  freedBytes: number
  clearedPaths: string[]
}

export const purgeAppCache = () => invoke<CachePurgeResult>('purge_app_cache');

export const getRuntimes = () => invoke<RuntimeRecord[]>('get_runtimes');
export const getRuntimeStorage = () => invoke<RuntimeStorageReport>('get_runtime_storage');
export const getRuntimeInstallationPlan = (runtimeId: string) =>
  invoke<RuntimeInstallationPlan>('get_runtime_installation_plan', { runtimeId });
export const installExternalRuntime = (runtimeId: string, accepted: boolean) =>
  invoke<RuntimeRecord>('install_external_runtime', { runtimeId, accepted });
export const removeExternalRuntime = (runtimeId: string, confirmed: boolean) =>
  invoke<void>('remove_external_runtime', { runtimeId, confirmed });
export const cancelRuntimeProcess = (processId: string) =>
  invoke<boolean>('cancel_runtime_process', { processId });

export const getCodeGraphSuggestion = (message: string, projectId?: string) =>
  invoke<ConversationInteraction | null>('get_codegraph_suggestion', { message, projectId });

export const exportDiagnostics = () => invoke<string>('export_diagnostics');

export interface UpdateCheckResult {
  currentVersion: string
  available: boolean
  version?: string | null
  notes?: string | null
  publishedAt?: string | null
}

export const checkForUpdates = () => invoke<UpdateCheckResult>('check_for_updates')

export const installAvailableUpdate = () => invoke<void>('install_available_update')

export const installBobShell = () => invoke<boolean>('install_bob_shell');

export interface CreatePermissionGrantInput {
  actionType: string;
  resource: string;
  scope: string;
  scopeId?: string;
  decision: string;
  expiresAt?: string;
}

export const createPermissionGrant = (input: CreatePermissionGrantInput) =>
  invoke<PermissionGrant>('create_permission_grant', { input });

// ── Schedule Commands ─────────────────────────────────────────

export const getSchedules = () => invoke<Schedule[]>('get_schedules');

export const createSchedule = (input: CreateScheduleInput) =>
  invoke<Schedule>('create_schedule', { input });

export const updateSchedule = (id: string, input: CreateScheduleInput) =>
  invoke<Schedule>('update_schedule', { id, input });

export const updateScheduleState = (id: string, state: string) =>
  invoke<void>('update_schedule_state', { id, state });

export const deleteSchedule = (id: string) =>
  invoke<void>('delete_schedule', { id });

export const getScheduleLogs = (id: string) =>
  invoke<string>('get_schedule_logs', { id });

export const getScheduleRuns = (id: string) =>
  invoke<ScheduleRun[]>('get_schedule_runs', { id });

export const runScheduleNow = (id: string) =>
  invoke<string>('run_schedule_now', { id });

// ── Local encrypted vault secrets ─────────────────────────────

export const setSessionSecret = (account: string, secret: string) =>
  invoke<void>('set_session_secret', { account, secret });

export const hasSessionSecret = (account: string) =>
  invoke<boolean>('has_session_secret', { account });

export const clearSessionSecret = (account: string) =>
  invoke<void>('clear_session_secret', { account });

// ── Artifact Generation Commands ──────────────────────────────

export const generateArtifact = (input: {
  artifactType: string;
  title: string;
  content: string;
  conversationId?: string;
}) => invoke<Artifact>('generate_artifact', { input });

export const getArtifactsList = () => invoke<Artifact[]>('get_artifacts_list');

export const createDesignerPreview = (input: {
  title: string;
  document: import('@bob-work/shared-types').DesignDocument;
  conversationId?: string;
}) => invoke<[Artifact, Artifact, Artifact]>('create_designer_preview', { input });

// ── Search / Skills / MCP / Permissions / Usage ──────────────

export const searchWorkspace = (query: string, limit = 30) =>
  invoke<SearchResult[]>('search_workspace', { query, limit });

export const getSkills = (workspace?: string) =>
  invoke<WorkspaceSkill[]>('get_skills', { workspace });

export const saveSkill = (input: SaveSkillInput) =>
  invoke<WorkspaceSkill>('save_skill', { input });

export const setSkillEnabled = (slug: string, scope: string, enabled: boolean, workspace?: string) =>
  invoke<void>('set_skill_enabled', { slug, scope, enabled, workspace });

export const deleteSkill = (slug: string, workspace?: string) =>
  invoke<void>('delete_skill', { slug, workspace });

export const installBuiltinIntegration = (integrationId: string) =>
  invoke<WorkspaceSkill>('install_builtin_integration', { integrationId });

export interface IntegrationConnectionStatus {
  integrationId: string;
  connected: boolean;
  authMethod?: 'oauth' | 'token' | null;
  accountLabel?: string | null;
  expiresAt?: string | null;
  oauthClientConfigured: boolean;
  deviceFlowAvailable: boolean;
  /** False when the provider token exists but lacks this integration's scopes. */
  scopeSatisfied: boolean;
  /** Persisted MCP probe for the connector behind this integration. */
  lastTest?: {
    ok: boolean;
    message: string;
    testedAt: string;
    tools?: string[];
  } | null;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret?: string | null;
}

export interface OAuthStartResult {
  integrationId: string;
  authUrl: string;
  state: string;
  /** web = authorize page, device = device-flow code, setup = one-time Slack app create */
  mode: 'web' | 'device' | 'setup';
  userCode?: string | null;
  verificationUri?: string | null;
}

export const getIntegrationStatuses = () =>
  invoke<IntegrationConnectionStatus[]>('get_integration_statuses');

export const getOAuthClientConfig = (integrationId: string) =>
  invoke<OAuthClientConfig | null>('get_oauth_client_config', { integrationId });

export const setOAuthClientConfig = (integrationId: string, clientId: string, clientSecret?: string) =>
  invoke<void>('set_oauth_client_config', { integrationId, clientId, clientSecret });

export const startIntegrationOAuth = (integrationId: string) =>
  invoke<OAuthStartResult>('start_integration_oauth', { integrationId });

export const connectIntegrationToken = (
  integrationId: string,
  accessToken: string,
  accountLabel?: string,
) =>
  invoke<IntegrationConnectionStatus>('connect_integration_token', {
    integrationId,
    accessToken,
    accountLabel,
  });

export const e2eConnectIntegration = (
  integrationId: string,
  accessToken: string,
  accountLabel?: string,
) => invoke<IntegrationConnectionStatus>('e2e_connect_integration', {
  integrationId,
  accessToken,
  accountLabel,
});



export const disconnectIntegration = (integrationId: string) =>
  invoke<void>('disconnect_integration', { integrationId });

export const getMcpServers = () => invoke<McpServer[]>('get_mcp_servers');

export const testMcpServer = (name: string) =>
  invoke<PluginMcpTestResult>('test_mcp_server', { name });

export const saveMcpServer = (input: SaveMcpServerInput) =>
  invoke<void>('save_mcp_server', { input });

export const setMcpServerEnabled = (name: string, enabled: boolean) =>
  invoke<void>('set_mcp_server_enabled', { name, enabled });

export const deleteMcpServer = (name: string) =>
  invoke<void>('delete_mcp_server', { name });

// ── Remote SSH workspaces ────────────────────────────────────
export const getSshServers = () => invoke<import('@bob-work/shared-types').SshServer[]>('get_ssh_servers');
export const saveSshServer = (input: import('@bob-work/shared-types').SaveSshServerInput) =>
  invoke<import('@bob-work/shared-types').SshServer>('save_ssh_server', { input });
export const deleteSshServer = (id: string) => invoke<void>('delete_ssh_server', { id });
export const testSshServer = (id: string) => invoke<import('@bob-work/shared-types').SshExecResult>('test_ssh_server', { id });
export const sshExec = (id: string, command: string) => invoke<import('@bob-work/shared-types').SshExecResult>('ssh_exec', { id, command });
export const sshRead = (id: string, path: string, maxBytes = 512_000) => invoke<string>('ssh_read', { id, path, maxBytes });
export const sshWrite = (id: string, path: string, content: string) => invoke<void>('ssh_write', { id, path, content });
export const browseSshDirectory = (id: string, path = '') => invoke<import('@bob-work/shared-types').SshRemoteEntry[]>('browse_ssh_directory', { id, path });
export const syncSshWorkspace = (id: string, direction: 'pull' | 'push') => invoke<import('@bob-work/shared-types').SshSyncResult>('sync_ssh_workspace', { id, direction });
export const startSshTerminal = (id: string, sessionId: string) => invoke<string>('start_ssh_terminal', { id, sessionId });
export const writeSshTerminal = (sessionId: string, data: string) => invoke<void>('write_ssh_terminal', { sessionId, data });
export const stopSshTerminal = (sessionId: string) => invoke<void>('stop_ssh_terminal', { sessionId });

export const getDbConnections = () => invoke<DbConnection[]>('get_db_connections');

export const saveDbConnection = (input: SaveDbConnectionInput) =>
  invoke<DbConnection>('save_db_connection', { input });

export const setDbConnectionEnabled = (id: string, enabled: boolean) =>
  invoke<void>('set_db_connection_enabled', { id, enabled });

export const deleteDbConnection = (id: string) =>
  invoke<void>('delete_db_connection', { id });

export const testDbConnection = (id: string) =>
  invoke<DbConnectionTestResult>('test_db_connection', { id });

export const listPluginFileResources = (pluginId: string) =>
  invoke<PluginFileResource[]>('list_plugin_file_resources', { pluginId });

export const uploadPluginFileResource = (pluginId: string, sourcePath: string) =>
  invoke<PluginFileResource>('upload_plugin_file_resource', { pluginId, sourcePath });

export const deletePluginFileResource = (pluginId: string, fileId: string) =>
  invoke<void>('delete_plugin_file_resource', { pluginId, fileId });

export const listPluginLinkedDatabases = (pluginId: string) =>
  invoke<PluginLinkedDatabase[]>('list_plugin_linked_databases', { pluginId });

export const linkPluginDatabase = (pluginId: string, connectionId: string, name: string) =>
  invoke<PluginLinkedDatabase[]>('link_plugin_database', { pluginId, connectionId, name });

export const unlinkPluginDatabase = (pluginId: string, connectionId: string) =>
  invoke<PluginLinkedDatabase[]>('unlink_plugin_database', { pluginId, connectionId });

export const getPermissionGrants = () => invoke<PermissionGrant[]>('get_permission_grants');

export const revokePermissionGrant = (id: string) => invoke<void>('revoke_permission_grant', { id });

export const getUsageStatus = (force = false) =>
  invoke<UsageStatus>('get_usage_status', { force });

export const getBobalytics = (scope: BobalyticsScope = 'workspace', rangeDays: 7 | 30 | 90 = 30) =>
  invoke<BobalyticsReport>('get_bobalytics', { scope, rangeDays });

export const exportBobalytics = (path: string, scope: BobalyticsScope = 'workspace', rangeDays: 7 | 30 | 90 = 30) =>
  invoke<void>('export_bobalytics', { path, scope, rangeDays });

// ── Right-side file and browser preview ─────────────────────

export const prepareFilePreview = (path: string) =>
  invoke<FilePreview>('prepare_file_preview', { path });

/** Read a bounded, user-selected HTML preview for sandboxed inline rendering. */
export const readHtmlPreview = (path: string) =>
  invoke<string>('read_html_preview', { path });

export const prepareFittedHtmlPreview = (sourcePath: string, html: string) =>
  invoke<string>('prepare_fitted_html_preview', { sourcePath, html });
export const getLivePreviewRevision = (path: string) => invoke<string>('get_live_preview_revision', { path });
export const exportLiveCanvasZip = (sourcePath: string, destination: string) => invoke<void>('export_live_canvas_zip', { sourcePath, destination });

export const allowComposerAttachments = (paths: string[]) =>
  invoke<string[]>('allow_composer_attachments', { paths });

export const startNativeAudioRecording = () =>
  invoke<void>('start_native_audio_recording');

export interface MeetingRecording {
  id: string;
  createdAt: string;
  format: 'm4a/aac' | string;
  recordingPath: string;
  microphonePath?: string | null;
  systemAudioPath?: string | null;
  manifestPath: string;
  transcriptPath?: string | null;
}

export const stopNativeAudioRecording = () =>
  invoke<MeetingRecording>('stop_native_audio_recording');

export const getNativeAudioRecordingLevel = () =>
  invoke<number>('native_audio_recording_level');


export const openPreviewResource = (target: string) =>
  invoke<void>('open_preview_resource', { target });

export const revealInFileManager = (path: string) =>
  invoke<void>('reveal_in_file_manager', { path });
