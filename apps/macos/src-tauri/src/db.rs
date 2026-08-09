// ============================================================
// Bob Work - Database Layer
// ============================================================

use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;
use tracing::info;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path).map_err(|e| AppError::Database(e.to_string()))?;

        // Enable WAL mode for better performance
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Create an in-memory database (for tests only)
    #[cfg(test)]
    pub fn new_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory().map_err(|e| AppError::Database(e.to_string()))?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn run_migrations(&self) -> AppResult<()> {
        let conn = self.conn.lock().unwrap();

        // Create migrations table
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // Run migrations in order
        let migrations: &[(&str, &str)] = &[
            ("001", MIGRATION_001_INITIAL_SCHEMA),
            ("002", MIGRATION_002_EVENTS),
            ("003", MIGRATION_003_SETTINGS),
            ("004", MIGRATION_004_WORKSPACE_RUNTIME),
            ("005", MIGRATION_005_PINNED_TASKS),
            ("006", MIGRATION_006_PLUGIN_VERSIONS),
            ("007", MIGRATION_007_REMOVE_LEGACY_KEYCHAIN_COLUMN),
            ("008", MIGRATION_008_ARCHIVED_CONVERSATIONS),
        ];

        for (version, sql) in migrations {
            let version_num: i64 = version.parse().unwrap();
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
                    params![version_num],
                    |row| row.get::<_, i64>(0),
                )
                .map(|count| count > 0)
                .unwrap_or(false);

            if !exists {
                info!("Running migration {}", version);
                conn.execute_batch(sql).map_err(|e| {
                    AppError::Database(format!("Migration {} failed: {}", version, e))
                })?;
                conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    params![version_num],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
                info!("Migration {} complete", version);
            }
        }

        Ok(())
    }
}

const MIGRATION_001_INITIAL_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    objective TEXT,
    color TEXT DEFAULT '#6366f1',
    image_url TEXT,
    local_path TEXT,
    custom_instructions TEXT,
    language TEXT DEFAULT 'fr',
    memory_enabled INTEGER DEFAULT 1,
    allowed_files TEXT DEFAULT '[]',
    allowed_plugins TEXT DEFAULT '[]',
    allowed_integrations TEXT DEFAULT '[]',
    default_mode TEXT DEFAULT 'general_work',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('chat', 'work')) DEFAULT 'chat',
    business_mode TEXT DEFAULT 'quick_chat',
    bob_mode TEXT,
    date TEXT NOT NULL,
    pinned INTEGER DEFAULT 0,
    local_only INTEGER DEFAULT 1,
    summary TEXT,
    bob_context_state TEXT DEFAULT '{}',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_date ON conversations(date DESC);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    author TEXT CHECK(author IN ('user', 'assistant', 'system')) NOT NULL,
    content TEXT NOT NULL,
    attachments TEXT DEFAULT '[]',
    sources TEXT DEFAULT '[]',
    citations TEXT DEFAULT '[]',
    tools_used TEXT DEFAULT '[]',
    send_state TEXT DEFAULT 'sent',
    errors TEXT DEFAULT '[]',
    associated_artifacts TEXT DEFAULT '[]',
    associated_approvals TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    objective TEXT NOT NULL,
    project_id TEXT,
    conversation_id TEXT,
    mode TEXT,
    permission_policy TEXT DEFAULT 'always_ask',
    budget REAL,
    max_time INTEGER,
    bob_process_id TEXT,
    start_date TEXT,
    end_date TEXT,
    summary TEXT,
    progress REAL DEFAULT 0,
    errors TEXT DEFAULT '[]',
    resumable INTEGER DEFAULT 0,
    state TEXT CHECK(state IN (
        'draft','queued','starting','running',
        'awaiting_info','awaiting_approval','paused',
        'completed','failed','cancelled','expired'
    )) DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

CREATE TABLE IF NOT EXISTS task_steps (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    dependencies TEXT DEFAULT '[]',
    responsible_agent TEXT,
    start_date TEXT,
    end_date TEXT,
    tools TEXT DEFAULT '[]',
    inputs TEXT DEFAULT '{}',
    outputs TEXT DEFAULT '{}',
    retry_count INTEGER DEFAULT 0,
    error TEXT,
    validation_required INTEGER DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    human_description TEXT NOT NULL,
    command_or_change TEXT,
    data_accessed TEXT DEFAULT '[]',
    files_affected TEXT DEFAULT '[]',
    network_destination TEXT,
    risk_level TEXT CHECK(risk_level IN ('low','medium','high','critical')) DEFAULT 'medium',
    decision TEXT CHECK(decision IN ('pending','approved','denied','modified')) DEFAULT 'pending',
    permission_duration TEXT,
    decided_by TEXT,
    decided_at TEXT,
    undo_possible INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id);
CREATE INDEX IF NOT EXISTS idx_approvals_decision ON approvals(decision);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    preview_path TEXT,
    origin TEXT,
    sources TEXT DEFAULT '[]',
    validation_status TEXT DEFAULT 'pending',
    validation_notes TEXT,
    exported INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    size INTEGER
);

CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created_at DESC);

CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    author TEXT,
    description TEXT,
    scope TEXT CHECK(scope IN ('project','personal','team')) DEFAULT 'personal',
    category TEXT CHECK(category IN ('recipe','integration','executable')) DEFAULT 'recipe',
    manifest TEXT NOT NULL DEFAULT '{}',
    install_state TEXT DEFAULT 'installed',
    validation_state TEXT DEFAULT 'pending',
    signature TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_executed_at TEXT
);

CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    account TEXT,
    auth_type TEXT,
    scopes TEXT DEFAULT '[]',
    available_tools TEXT DEFAULT '[]',
    approval_permission TEXT DEFAULT 'always_ask',
    health_state TEXT DEFAULT 'healthy',
    last_sync TEXT,
    keychain_secret_ref TEXT,
    allowed_projects TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL,
    project_id TEXT,
    plugin_or_mode TEXT,
    cron_or_event TEXT NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    next_run TEXT,
    last_run TEXT,
    offline_behavior TEXT DEFAULT 'skip',
    overlap_policy TEXT DEFAULT 'queue',
    retry_policy TEXT DEFAULT '{}',
    notifications TEXT DEFAULT '[]',
    state TEXT CHECK(state IN ('active','paused','completed')) DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
"#;

const MIGRATION_002_EVENTS: &str = r#"
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    data TEXT DEFAULT '{}',
    user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
"#;

const MIGRATION_003_SETTINGS: &str = r#"
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
    ('theme', '"system"', datetime('now')),
    ('language', '"auto"', datetime('now')),
    ('default_mode', '"general_work"', datetime('now')),
    ('sidebar_width', '260', datetime('now')),
    ('inspector_width', '340', datetime('now')),
    ('sidebar_visible', 'true', datetime('now')),
    ('inspector_visible', 'true', datetime('now')),
    ('font_size', '15', datetime('now')),
    ('reduced_motion', 'false', datetime('now')),
    ('permission_policy', '"always_ask"', datetime('now')),
    ('launch_at_login', 'false', datetime('now')),
    ('menu_bar_enabled', 'true', datetime('now'));
"#;

const MIGRATION_004_WORKSPACE_RUNTIME: &str = r#"
ALTER TABLE tasks ADD COLUMN schedule_id TEXT;
ALTER TABLE tasks ADD COLUMN shell_task_id TEXT;
ALTER TABLE tasks ADD COLUMN last_event_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_schedule ON tasks(schedule_id);

CREATE TABLE IF NOT EXISTS task_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'queued',
    shell_session_id TEXT,
    shell_task_id TEXT,
    process_id INTEGER,
    started_at TEXT,
    ended_at TEXT,
    summary TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, attempt DESC);

CREATE TABLE IF NOT EXISTS task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    run_id TEXT,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT,
    content TEXT,
    tool_name TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_sequence ON task_events(task_id, sequence);

CREATE TABLE IF NOT EXISTS task_io (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    run_id TEXT,
    direction TEXT CHECK(direction IN ('input','output')) NOT NULL,
    io_type TEXT NOT NULL,
    name TEXT NOT NULL,
    path_or_url TEXT,
    mime_type TEXT,
    size INTEGER,
    sha256 TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_io_task ON task_io(task_id, direction);

CREATE TABLE IF NOT EXISTS schedule_runs (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    task_id TEXT,
    scheduled_for TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    started_at TEXT,
    ended_at TEXT,
    summary TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    project_id TEXT,
    task_id TEXT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT CHECK(kind IN ('file','directory')) NOT NULL,
    mime_type TEXT,
    size INTEGER,
    sha256 TEXT,
    access_mode TEXT NOT NULL DEFAULT 'reference',
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation ON attachments(conversation_id);

CREATE TABLE IF NOT EXISTS permission_grants (
    id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    resource TEXT NOT NULL,
    scope TEXT CHECK(scope IN ('once','task','conversation','project','always')) NOT NULL,
    scope_id TEXT,
    decision TEXT CHECK(decision IN ('allow','deny')) NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_permission_grants_lookup ON permission_grants(action_type, resource, revoked_at);

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    source_path TEXT,
    origin TEXT NOT NULL DEFAULT 'local',
    version TEXT NOT NULL DEFAULT '1.0.0',
    enabled INTEGER NOT NULL DEFAULT 1,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL,
    command_or_url TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '[]',
    env_secret_refs TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unknown',
    tools TEXT NOT NULL DEFAULT '[]',
    last_checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_snapshots (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    used_amount REAL,
    remaining_amount REAL,
    unit TEXT,
    raw TEXT NOT NULL DEFAULT '{}',
    captured_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    entity_type UNINDEXED,
    entity_id UNINDEXED,
    project_id UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS search_project_insert AFTER INSERT ON projects BEGIN
  INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
  VALUES ('project', new.id, new.id, new.name, coalesce(new.description,'') || ' ' || coalesce(new.objective,'') || ' ' || coalesce(new.custom_instructions,''));
END;
CREATE TRIGGER IF NOT EXISTS search_project_update AFTER UPDATE ON projects BEGIN
  DELETE FROM search_index WHERE entity_type='project' AND entity_id=old.id;
  INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
  VALUES ('project', new.id, new.id, new.name, coalesce(new.description,'') || ' ' || coalesce(new.objective,'') || ' ' || coalesce(new.custom_instructions,''));
END;
CREATE TRIGGER IF NOT EXISTS search_project_delete AFTER DELETE ON projects BEGIN
  DELETE FROM search_index WHERE entity_type='project' AND entity_id=old.id;
END;

CREATE TRIGGER IF NOT EXISTS search_conversation_insert AFTER INSERT ON conversations BEGIN
  INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
  VALUES ('conversation', new.id, new.project_id, new.title, coalesce(new.summary,''));
END;
CREATE TRIGGER IF NOT EXISTS search_conversation_update AFTER UPDATE ON conversations BEGIN
  DELETE FROM search_index WHERE entity_type='conversation' AND entity_id=old.id;
  INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
  VALUES ('conversation', new.id, new.project_id, new.title, coalesce(new.summary,''));
END;
CREATE TRIGGER IF NOT EXISTS search_conversation_delete AFTER DELETE ON conversations BEGIN
  DELETE FROM search_index WHERE entity_type='conversation' AND entity_id=old.id;
  DELETE FROM search_index WHERE entity_type='message' AND entity_id=old.id;
END;

CREATE TRIGGER IF NOT EXISTS search_message_insert AFTER INSERT ON messages BEGIN
  INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
  SELECT 'message', new.conversation_id, c.project_id, c.title, new.content
  FROM conversations c WHERE c.id = new.conversation_id;
END;
CREATE TRIGGER IF NOT EXISTS search_message_delete AFTER DELETE ON messages BEGIN
  DELETE FROM search_index WHERE rowid IN (
    SELECT rowid FROM search_index WHERE entity_type='message' AND entity_id=old.conversation_id AND body=old.content LIMIT 1
  );
END;

CREATE TRIGGER IF NOT EXISTS search_task_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
  VALUES ('task', new.id, new.project_id, new.objective, coalesce(new.summary,''));
END;
CREATE TRIGGER IF NOT EXISTS search_task_update AFTER UPDATE ON tasks BEGIN
  DELETE FROM search_index WHERE entity_type='task' AND entity_id=old.id;
  INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
  VALUES ('task', new.id, new.project_id, new.objective, coalesce(new.summary,''));
END;
CREATE TRIGGER IF NOT EXISTS search_task_delete AFTER DELETE ON tasks BEGIN
  DELETE FROM search_index WHERE entity_type='task' AND entity_id=old.id;
END;

INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
SELECT 'project', id, id, name, coalesce(description,'') || ' ' || coalesce(objective,'') || ' ' || coalesce(custom_instructions,'') FROM projects;
INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
SELECT 'conversation', id, project_id, title, coalesce(summary,'') FROM conversations;
INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
SELECT 'message', m.conversation_id, c.project_id, c.title, m.content FROM messages m JOIN conversations c ON c.id=m.conversation_id;
INSERT INTO search_index(entity_type, entity_id, project_id, title, body)
SELECT 'task', id, project_id, objective, coalesce(summary,'') FROM tasks;

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
    ('global_instructions', '""', datetime('now')),
    ('max_turns', '100', datetime('now')),
    ('max_cost', '0', datetime('now')),
    ('mcp_enabled', 'true', datetime('now')),
    ('subagents_enabled', 'true', datetime('now')),
    ('web_enabled', 'true', datetime('now')),
    ('notifications_enabled', 'true', datetime('now')),
    ('notify_task_complete', 'true', datetime('now')),
    ('voice_on_device', 'true', datetime('now')),
    ('task_retention_days', '30', datetime('now')),
    ('telemetry_enabled', 'false', datetime('now')),
    ('computer_use_enabled', 'false', datetime('now')),
    ('chrome_control_enabled', 'false', datetime('now'));
"#;

const MIGRATION_005_PINNED_TASKS: &str = r#"
ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_tasks_pinned ON tasks(pinned, updated_at DESC);
"#;

const MIGRATION_006_PLUGIN_VERSIONS: &str = r#"
ALTER TABLE plugins ADD COLUMN available_version TEXT;

CREATE TABLE IF NOT EXISTS plugin_versions (
    plugin_id TEXT NOT NULL,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    author TEXT,
    description TEXT,
    scope TEXT NOT NULL DEFAULT 'personal',
    category TEXT NOT NULL,
    manifest TEXT NOT NULL,
    validation_state TEXT NOT NULL DEFAULT 'pending',
    signature TEXT,
    release_notes TEXT,
    bundle_snapshot_path TEXT,
    created_at TEXT NOT NULL,
    installed_at TEXT,
    PRIMARY KEY (plugin_id, version),
    FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plugin_versions_plugin
ON plugin_versions(plugin_id, created_at DESC);

-- Existing installations become the first immutable version in their history.
INSERT OR IGNORE INTO plugin_versions (
    plugin_id, version, name, author, description, scope, category, manifest,
    validation_state, signature, created_at, installed_at
)
SELECT id, version, name, author, description, scope, category, manifest,
       validation_state, signature, created_at, updated_at
FROM plugins;
"#;

// The obsolete column never contained credentials in the current runtime.
// Drop it so upgraded databases no longer retain a Keychain-shaped schema.
const MIGRATION_007_REMOVE_LEGACY_KEYCHAIN_COLUMN: &str = r#"
ALTER TABLE integrations DROP COLUMN keychain_secret_ref;
"#;

const MIGRATION_008_ARCHIVED_CONVERSATIONS: &str = r#"
ALTER TABLE conversations ADD COLUMN archived INTEGER DEFAULT 0;
"#;
