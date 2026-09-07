# Bob Work - System Design Document

**Version:** 1.0  
**Date:** 2026-08-05  
**Status:** Draft

> **Décision d’implémentation 0.1.4+ (août 2026)** — Le Trousseau a été retiré de l’architecture. Toute mention Keychain plus bas décrit une ancienne option non implémentée. Les secrets manuels vivent dans le **coffre local chiffré** (persistants jusqu’à effacement) et sont injectés uniquement dans `bob run`.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [System Components](#system-components)
4. [Data Architecture](#data-architecture)
5. [Bob Integration Architecture](#bob-integration-architecture)
6. [Security Architecture](#security-architecture)
7. [Plugin System Architecture](#plugin-system-architecture)
8. [Event System](#event-system)
9. [Process Management](#process-management)
10. [File System Organization](#file-system-organization)
11. [Deployment Architecture](#deployment-architecture)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Bob Work (macOS App)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              React UI Layer (TypeScript)             │   │
│  │  - Components  - Views  - Hooks  - State Management │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ IPC                                │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │           Tauri Backend (Rust)                       │   │
│  │  - Commands  - Events  - State  - File System       │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │              Core Services Layer                     │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │   Bob    │ │ Project  │ │  Task    │            │   │
│  │  │ Adapter  │ │  Engine  │ │  Engine  │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │  Plugin  │ │Artifact  │ │Integration│           │   │
│  │  │  System  │ │  Engine  │ │   SDK    │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │            Data & Storage Layer                      │   │
│  │  - SQLite  - Keychain  - File System  - Events      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└───────────────────────┬───────────────────────────────────┘
                        │
        ┌───────────────▼────────────────┐
        │     IBM Bob Shell (CLI)        │
        │  - Interactive Mode             │
        │  - Non-Interactive Mode         │
        │  - Modes, Skills, MCP           │
        └────────────────────────────────┘
```

### Design Principles

1. **Separation of Concerns**: Clear boundaries between UI, business logic, and data
2. **Bob Abstraction**: UI never directly calls Bob CLI
3. **Event-Driven**: Asynchronous communication via typed events
4. **Local-First**: All data stored locally, no cloud dependency
5. **Security by Default**: Explicit permissions, sandboxing, secret management
6. **Graceful Degradation**: Handle missing Bob features elegantly
7. **Testability**: Mock Bob adapter for testing without real Bob
8. **Extensibility**: Plugin system for user customization

---

## Technology Stack

### Frontend
- **Framework**: React 18+
- **Language**: TypeScript 5+
- **State Management**: Zustand or Jotai (lightweight, performant)
- **Styling**: Tailwind CSS + CSS Modules
- **UI Components**: Radix UI (accessible primitives)
- **Markdown**: react-markdown + remark/rehype plugins
- **Code Highlighting**: Prism or Shiki
- **Icons**: Lucide React (open-source, SF Symbols-like)
- **Animations**: Framer Motion (optional, respecting reduced motion)

### Backend (Tauri)
- **Framework**: Tauri 2.x
- **Language**: Rust 1.70+
- **Database**: SQLite via rusqlite
- **Migrations**: refinery or custom migration system
- **Keychain**: security-framework (macOS Keychain)
- **Process Management**: tokio for async runtime
- **IPC**: Tauri's built-in IPC
- **File Watching**: notify crate
- **HTTP Client**: reqwest (for future integrations)

### Build & Development
- **Package Manager**: pnpm (fast, efficient)
- **Bundler**: Vite (via Tauri)
- **Linting**: ESLint, Prettier, Clippy
- **Testing**: 
  - Frontend: Vitest, React Testing Library
  - Backend: Rust built-in tests, cargo-nextest
- **CI/CD**: GitHub Actions (when repo is set up)

### Distribution
- **Format**: DMG for macOS
- **Signing**: Apple Developer certificates (when available)
- **Notarization**: Apple notarization service (when available)
- **Updates**: Tauri updater (signed updates)

---

## System Components

### 1. React UI Layer

**Purpose**: Render user interface, handle user interactions, display data

**Key Modules**:
- `src/ui/components/`: Reusable UI components
- `src/ui/views/`: Page-level views (Home, Chat, Project, Settings, etc.)
- `src/ui/hooks/`: Custom React hooks
- `src/ui/stores/`: State management (Zustand stores)
- `src/ui/utils/`: UI utilities, formatters, helpers

**Responsibilities**:
- Render conversations, projects, tasks
- Handle user input (composer, forms)
- Display approval cards
- Show progress and status
- Manage local UI state
- Call Tauri commands via IPC
- Listen to Tauri events

**Key Components**:
- `ConversationView`: Chat/Work interface
- `Composer`: Message input with attachments
- `MessageList`: Scrollable message thread
- `ApprovalCard`: Permission request UI
- `TaskProgress`: Live task status
- `ProjectDashboard`: Project overview
- `PluginBuilder`: Conversational plugin creator
- `SettingsWindow`: Preferences UI
- `Sidebar`: Navigation and project list
- `Inspector`: Context-sensitive right panel

### 2. Tauri Backend (Rust)

**Purpose**: Business logic, system integration, security enforcement

**Key Modules**:
- `src-tauri/src/commands/`: Tauri command handlers (IPC endpoints)
- `src-tauri/src/services/`: Core business logic services
- `src-tauri/src/models/`: Data models and types
- `src-tauri/src/db/`: Database access layer
- `src-tauri/src/events/`: Event definitions and emitters
- `src-tauri/src/security/`: Security utilities, validation
- `src-tauri/src/bob/`: Bob adapter and integration

**Responsibilities**:
- Execute business logic
- Manage Bob processes
- Enforce security policies
- Access file system safely
- Store/retrieve data from SQLite
- Manage secrets in Keychain
- Emit events to frontend
- Handle background tasks

**Key Services**:
- `BobService`: Bob detection, execution, monitoring
- `ProjectService`: Project CRUD operations
- `ConversationService`: Conversation management
- `TaskService`: Task lifecycle management
- `PluginService`: Plugin installation, execution
- `ApprovalService`: Permission management
- `ArtifactService`: Deliverable generation
- `SchedulerService`: Task scheduling
- `IntegrationService`: External API management

### 3. Bob Adapter

**Purpose**: Abstract Bob CLI, provide stable interface regardless of Bob version

**Location**: `packages/bob-adapter/` or `src-tauri/src/bob/`

**Key Components**:

**BobDetector**
- Search for `bob` binary in PATH and standard locations
- Verify version compatibility
- Check authentication status
- Detect available modes
- Detect capabilities (MCP, skills, orchestrator, etc.)

**BobExecutor**
- Launch Bob processes (interactive/non-interactive)
- Send prompts and commands
- Capture stdout/stderr
- Parse output (JSON if available, text otherwise)
- Handle process lifecycle (start, stop, pause, resume)
- Manage sessions

**BobEventParser**
- Parse Bob output into structured events
- Emit typed events: `task.started`, `tool.requested`, `approval.required`, etc.
- Handle both JSON and text output
- Detect errors and warnings

**CapabilityRegistry**
- Track available/unavailable Bob features
- Store capability status: Native, Adapted, Emulated, Partial, Unavailable
- Provide fallback strategies
- Generate user-facing messages

**BobAuthManager**
- Handle IBMid/SSO authentication
- Manage API keys in Keychain
- Refresh tokens
- Detect authentication errors

**Interface**:
```rust
pub trait BobAdapter {
    async fn detect() -> Result<BobInfo>;
    async fn authenticate(method: AuthMethod) -> Result<()>;
    async fn get_capabilities() -> CapabilityRegistry;
    async fn create_session(config: SessionConfig) -> Result<BobSession>;
    async fn send_prompt(session: &BobSession, prompt: &str) -> Result<()>;
    async fn stop_session(session: &BobSession) -> Result<()>;
    async fn pause_session(session: &BobSession) -> Result<()>;
    async fn resume_session(session: &BobSession) -> Result<()>;
}

pub struct BobSession {
    id: String,
    process: Child,
    mode: BobMode,
    event_stream: EventStream,
}
```

### 4. Project Engine

**Purpose**: Manage projects, files, sources, instructions

**Key Operations**:
- Create, read, update, delete projects
- Attach/detach files and folders
- Manage project-level permissions
- Store custom instructions
- Handle project memory
- Index project files
- Search within project

**Data Flow**:
```
UI → ProjectService → Database
                   ↓
              File System
```

### 5. Task Engine

**Purpose**: Orchestrate long-running tasks, manage lifecycle

**Key Operations**:
- Create task from conversation
- Queue task
- Execute task via Bob
- Monitor progress
- Handle approvals
- Pause/resume/cancel
- Store results
- Retry on failure

**State Machine**:
```
Draft → Queued → Starting → Running → Completed
                              ↓
                         Awaiting Info
                              ↓
                       Awaiting Approval
                              ↓
                           Paused
                              ↓
                      Failed / Cancelled
```

### 6. Plugin System

**Purpose**: Allow users to create custom capabilities through conversation

**Key Components**:

**PluginBuilder**
- Conversational interface for plugin creation
- Interview-based requirements gathering
- Manifest generation
- File generation (skills, modes, configs)
- Validation and testing

**PluginInstaller**
- Transactional installation
- Backup before install
- Rollback on failure
- Update Bob configuration files safely

**PluginExecutor**
- Execute plugin in sandbox
- Monitor execution
- Enforce permissions
- Capture results

**PluginRegistry**
- Track installed plugins
- Manage versions
- Handle updates
- Enable/disable plugins

**Plugin Manifest Schema**:
```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  scope: 'project' | 'personal' | 'team';
  category: 'recipe' | 'integration' | 'executable';
  capabilities: string[];
  inputs: InputSchema[];
  outputs: OutputSchema[];
  skills?: SkillDefinition[];
  modes?: ModeDefinition[];
  workflows?: WorkflowDefinition[];
  tools?: ToolDefinition[];
  integrations?: IntegrationRequirement[];
  permissions: Permission[];
  triggers?: Trigger[];
  ui?: UIExtension;
  runtime?: RuntimeRequirements;
  compatibility: {
    minimumBobVersion: string;
    minimumAppVersion: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

### 7. Artifact Engine

**Purpose**: Generate, validate, and manage deliverables

**Supported Formats**:
- **PPTX**: python-pptx or officegen (Node.js)
- **DOCX**: docx (Node.js) or docx-rs (Rust)
- **XLSX**: xlsx (Node.js) or calamine (Rust)
- **PDF**: Rendering via headless browser or PDF library
- **Markdown**: Native support
- **HTML/Web**: Static site generation

**Validation Pipeline**:
1. Generate file
2. Verify file structure
3. Render to image/PDF for visual QA
4. Detect issues (overflow, empty pages, broken formulas)
5. Report to user
6. Allow regeneration

**Versioning**:
- Store each version
- Allow comparison
- Enable rollback

### 8. Integration SDK

**Purpose**: Connect to external services (future)

**Planned Integrations**:
- Google Workspace (Drive, Docs, Sheets, Calendar)
- Microsoft 365 (OneDrive, Outlook, Teams)
- Slack
- GitHub
- Notion
- Airtable
- Custom APIs

**Architecture**:
- OAuth 2.0 flow
- Token storage in Keychain
- Scoped permissions
- Rate limiting
- Error handling
- Webhook support (future)

---

## Data Architecture

### Database Schema (SQLite)

**projects**
```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    objective TEXT,
    image_url TEXT,
    color TEXT,
    local_path TEXT,
    custom_instructions TEXT,
    language TEXT DEFAULT 'en',
    memory_enabled BOOLEAN DEFAULT 1,
    allowed_files TEXT, -- JSON array
    allowed_plugins TEXT, -- JSON array
    allowed_integrations TEXT, -- JSON array
    default_mode TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    archived BOOLEAN DEFAULT 0
);
```

**conversations**
```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('chat', 'work')) DEFAULT 'chat',
    business_mode TEXT,
    bob_mode TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    pinned BOOLEAN DEFAULT 0,
    local_only BOOLEAN DEFAULT 1,
    summary TEXT,
    bob_context_state TEXT, -- JSON
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

**messages**
```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    author TEXT CHECK(author IN ('user', 'assistant')) NOT NULL,
    content TEXT NOT NULL,
    attachments TEXT, -- JSON array
    sources TEXT, -- JSON array
    citations TEXT, -- JSON array
    tools_used TEXT, -- JSON array
    send_state TEXT DEFAULT 'sent',
    errors TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

**tasks**
```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    objective TEXT NOT NULL,
    project_id TEXT,
    conversation_id TEXT,
    mode TEXT,
    permission_policy TEXT DEFAULT 'always_ask',
    budget REAL,
    max_time INTEGER, -- seconds
    bob_process_id TEXT,
    start_date DATETIME,
    end_date DATETIME,
    summary TEXT,
    progress REAL DEFAULT 0,
    errors TEXT, -- JSON
    resumable BOOLEAN DEFAULT 0,
    state TEXT CHECK(state IN (
        'draft', 'queued', 'starting', 'running',
        'awaiting_info', 'awaiting_approval', 'paused',
        'completed', 'failed', 'cancelled', 'expired'
    )) DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
```

**task_steps**
```sql
CREATE TABLE task_steps (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    dependencies TEXT, -- JSON array of step IDs
    responsible_agent TEXT,
    start_date DATETIME,
    end_date DATETIME,
    tools TEXT, -- JSON array
    inputs TEXT, -- JSON
    outputs TEXT, -- JSON
    retry_count INTEGER DEFAULT 0,
    error TEXT,
    validation_required BOOLEAN DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

**approvals**
```sql
CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    human_description TEXT NOT NULL,
    command_or_change TEXT,
    data_accessed TEXT, -- JSON
    files_affected TEXT, -- JSON array
    network_destination TEXT,
    risk_level TEXT CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
    decision TEXT CHECK(decision IN ('pending', 'approved', 'denied', 'modified')),
    permission_duration TEXT, -- 'once', 'task', 'always'
    decided_by TEXT,
    decided_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

**artifacts**
```sql
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    preview_path TEXT,
    origin TEXT, -- conversation_id or task_id
    sources TEXT, -- JSON array
    validation_status TEXT DEFAULT 'pending',
    exported BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**plugins**
```sql
CREATE TABLE plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    author TEXT,
    description TEXT,
    scope TEXT CHECK(scope IN ('project', 'personal', 'team')),
    category TEXT CHECK(category IN ('recipe', 'integration', 'executable')),
    manifest TEXT NOT NULL, -- JSON
    install_state TEXT DEFAULT 'installed',
    validation_state TEXT DEFAULT 'pending',
    signature TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**integrations**
```sql
CREATE TABLE integrations (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    account TEXT,
    auth_type TEXT,
    scopes TEXT, -- JSON array
    available_tools TEXT, -- JSON array
    approval_permission TEXT DEFAULT 'always_ask',
    health_state TEXT DEFAULT 'healthy',
    last_sync DATETIME,
    keychain_secret_ref TEXT, -- Reference to Keychain item
    allowed_projects TEXT, -- JSON array of project IDs
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**schedules**
```sql
CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL,
    project_id TEXT,
    plugin_or_mode TEXT,
    cron_or_event TEXT NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    next_run DATETIME,
    last_run DATETIME,
    offline_behavior TEXT DEFAULT 'skip',
    overlap_policy TEXT DEFAULT 'queue',
    retry_policy TEXT, -- JSON
    notifications TEXT, -- JSON
    state TEXT CHECK(state IN ('active', 'paused', 'completed')) DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

**events** (Append-only log)
```sql
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    entity_type TEXT,
    entity_id TEXT,
    data TEXT, -- JSON
    user_id TEXT
);

CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_entity ON events(entity_type, entity_id);
```

### Migration System

**Strategy**: Sequential numbered migrations

**Location**: `src-tauri/migrations/`

**Format**:
```
001_initial_schema.sql
002_add_plugin_system.sql
003_add_schedules.sql
...
```

**Tracking**:
```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Process**:
1. Check current version
2. Apply pending migrations in order
3. Wrap each in transaction
4. Rollback on error
5. Update version tracking

### Keychain Storage

**Purpose**: Store sensitive credentials securely

**Items Stored**:
- IBM API keys
- OAuth tokens
- Integration credentials
- Plugin secrets

**Access Pattern**:
```rust
use security_framework::passwords::*;

// Store
set_generic_password(
    "com.bobwork.app",
    "ibm_api_key",
    api_key.as_bytes()
)?;

// Retrieve
let password = find_generic_password(
    "com.bobwork.app",
    "ibm_api_key"
)?;
```

**Security**:
- Items encrypted by macOS
- Require user authentication for access
- Never log or expose in UI after storage
- Delete on account disconnect

---

## Bob Integration Architecture

### Bob Detection Flow

```
App Launch
    ↓
Search for `bob` binary
    ├─ Check PATH
    ├─ Check /usr/local/bin
    ├─ Check /opt/homebrew/bin
    └─ Check ~/bin
    ↓
Found? → Verify version
    ↓
Compatible? → Check authentication
    ↓
Authenticated? → Detect capabilities
    ↓
Ready!
```

### Bob Execution Modes

**Interactive Mode** (for user-driven conversations)
```bash
bob --interactive --mode=code
```
- User can see and interact
- Approvals handled in real-time
- Session persists until closed

**Non-Interactive Mode** (for automation)
```bash
bob --non-interactive --mode=code --input="prompt.txt" --output="result.json"
```
- No user interaction
- Must pre-approve actions or use restricted policy
- One-shot execution

### Bob Event Stream

**Ideal (if Bob provides JSON output)**:
```json
{
  "type": "task.started",
  "timestamp": "2026-08-05T13:00:00Z",
  "data": {
    "task_id": "task_123",
    "mode": "code"
  }
}
```

**Reality (if Bob only provides text)**:
- Parse stdout/stderr
- Detect patterns (e.g., "Starting task...", "Error:", "Approval required:")
- Emit best-effort events
- Mark uncertain events clearly
- Use indeterminate progress when needed

### Capability Detection

**Process**:
1. Run `bob --version`
2. Run `bob --help`
3. Parse available modes
4. Test non-destructive commands
5. Check for MCP support
6. Check for skills directory
7. Check for custom modes
8. Build capability matrix

**Capability Matrix**:
```rust
pub struct CapabilityRegistry {
    pub version: String,
    pub capabilities: HashMap<String, Capability>,
}

pub struct Capability {
    pub name: String,
    pub status: CapabilityStatus,
    pub evidence: String,
    pub fallback: Option<String>,
    pub user_message: String,
}

pub enum CapabilityStatus {
    Native,      // Fully supported by Bob
    Adapted,     // Requires workaround
    Emulated,    // Simulated by app
    Partial,     // Limited functionality
    Unavailable, // Not possible
}
```

**Example**:
```rust
capabilities.insert("orchestrator", Capability {
    name: "Orchestrator Mode",
    status: CapabilityStatus::Unavailable,
    evidence: "Not found in `bob --help` output",
    fallback: Some("Use app's built-in task planner"),
    user_message: "Bob doesn't expose Orchestrator mode. Bob Work will use its own task planner with reduced capabilities."
});
```

---

## Security Architecture

### Threat Model

**Threats**:
1. Malicious plugin execution
2. Unauthorized file access
3. Secret leakage in logs
4. Prompt injection from untrusted sources
5. Path traversal attacks
6. Symlink attacks
7. Command injection
8. Network exfiltration

**Mitigations**:
1. Sandboxed plugin execution
2. Explicit file permissions
3. Secret redaction in logs
4. Content sanitization
5. Path validation
6. Symlink resolution and validation
7. Command allowlisting
8. Network policy enforcement

### Permission System

**Permission Types**:
- `file.read`
- `file.write`
- `file.delete`
- `command.execute`
- `network.request`
- `browser.action`
- `clipboard.access`
- `app.control`
- `screenshot.capture`
- `microphone.access`

**Permission Policies**:
- `always_ask`: Prompt for every action
- `ask_for_modifications`: Prompt only for writes/deletes
- `ask_for_important`: Prompt for high-risk actions
- `never_ask`: No prompts (requires explicit warning)

**Approval Flow**:
```
Action Requested
    ↓
Check Policy
    ↓
Requires Approval?
    ├─ Yes → Show Approval Card
    │         ↓
    │    User Decision
    │         ├─ Deny → Block Action
    │         ├─ Modify → Adjust & Retry
    │         ├─ Allow Once → Execute
    │         ├─ Allow for Task → Cache for task
    │         └─ Always Allow → Cache globally (if policy permits)
    └─ No → Execute
```

### Sandboxing

**Plugin Sandbox**:
- Separate process
- Limited file system access
- Network restrictions
- Resource limits (CPU, memory, time)
- No access to Keychain
- No access to other plugins

**Implementation**:
- Use macOS sandbox profile (if available)
- Or use process isolation with restricted permissions
- Monitor resource usage
- Kill on timeout or excessive resource use

### Secret Management

**Rules**:
1. Never store secrets in SQLite
2. Never log secrets
3. Never display secrets after initial entry
4. Never include secrets in URLs
5. Never send secrets to third parties without explicit consent

**Redaction**:
```rust
pub fn redact_secrets(text: &str) -> String {
    let patterns = [
        r"api[_-]?key[=:]\s*['\"]?([a-zA-Z0-9_-]+)",
        r"token[=:]\s*['\"]?([a-zA-Z0-9_-]+)",
        r"password[=:]\s*['\"]?([^\s'\"]+)",
        r"secret[=:]\s*['\"]?([a-zA-Z0-9_-]+)",
    ];
    
    let mut redacted = text.to_string();
    for pattern in patterns {
        let re = Regex::new(pattern).unwrap();
        redacted = re.replace_all(&redacted, "$1=***REDACTED***").to_string();
    }
    redacted
}
```

---

## Plugin System Architecture

### Plugin Lifecycle

```
Conversation → Requirements → Manifest → Files → Validation → Test → Install → Execute
```

**1. Conversation Phase**
- User describes desired plugin
- Builder asks clarifying questions
- Gather: objective, triggers, inputs, outputs, permissions

**2. Manifest Generation**
- Create plugin manifest JSON
- Define scope, category, capabilities
- List required permissions
- Specify triggers

**3. File Generation**
- Generate skill files (if applicable)
- Generate mode files (if applicable)
- Generate MCP config (if applicable)
- Generate documentation

**4. Validation**
- Validate manifest schema
- Check for security issues
- Verify compatibility
- Analyze permissions

**5. Testing**
- Execute in sandbox
- Verify outputs
- Check for errors
- Measure performance

**6. Installation**
- Backup Bob config
- Write plugin files transactionally
- Update Bob configuration
- Register in plugin database
- Commit or rollback

**7. Execution**
- Load plugin
- Apply permissions
- Execute in sandbox
- Monitor and log
- Return results

### Plugin Storage

**Location**: `~/Library/Application Support/BobWork/plugins/`

**Structure**:
```
plugins/
  ├─ installed/
  │   ├─ plugin-id-1/
  │   │   ├─ manifest.json
  │   │   ├─ skill.yaml (if applicable)
  │   │   ├─ mode.yaml (if applicable)
  │   │   ├─ mcp-config.json (if applicable)
  │   │   └─ README.md
  │   └─ plugin-id-2/
  │       └─ ...
  ├─ drafts/
  │   └─ draft-plugin-1/
  │       └─ ...
  └─ backups/
      └─ plugin-id-1-v1.0.0/
          └─ ...
```

### Bob Configuration Integration

**Bob Skill Location**: `~/.bob/skills/` (or detected location)

**Bob Mode Location**: `~/.bob/modes/` (or detected location)

**Process**:
1. Detect Bob config locations
2. Backup before modification
3. Generate Bob-compatible files
4. Write atomically
5. Validate Bob can load them
6. Rollback on error

**Example Skill File** (generated by plugin system):
```yaml
# ~/.bob/skills/sales-report-analyzer.yaml
name: Sales Report Analyzer
description: Analyzes sales files and creates presentations
version: 1.0.0
author: user@example.com
tools:
  - name: analyze_sales_data
    description: Analyze sales CSV files
    parameters:
      file_path:
        type: string
        description: Path to sales CSV file
  - name: create_presentation
    description: Create PowerPoint presentation
    parameters:
      data:
        type: object
        description: Analyzed sales data
      template:
        type: string
        description: Presentation template
```

---

## Event System

### Event Types

**Bob Events**:
- `bob.detected`
- `bob.authentication_required`
- `bob.ready`
- `bob.capability_unavailable`

**Task Events**:
- `task.created`
- `task.started`
- `task.progress`
- `task.step_created`
- `task.step_started`
- `task.step_completed`
- `task.completed`
- `task.failed`
- `task.cancelled`

**Tool Events**:
- `tool.requested`
- `tool.executed`
- `tool.failed`

**Approval Events**:
- `approval.required`
- `approval.resolved`

**File Events**:
- `file.changed`
- `file.created`
- `file.deleted`

**Artifact Events**:
- `artifact.created`
- `artifact.updated`
- `artifact.validated`

**User Events**:
- `user.input_required`
- `user.action_required`

### Event Flow

```
Backend (Rust)
    ↓
Emit Event via Tauri
    ↓
Frontend (React)
    ↓
Update UI State
    ↓
Re-render Components
```

**Example**:
```rust
// Backend
app.emit_all("task.progress", TaskProgressPayload {
    task_id: "task_123",
    progress: 0.45,
    current_step: "Analyzing files",
})?;
```

```typescript
// Frontend
import { listen } from '@tauri-apps/api/event';

listen<TaskProgressPayload>('task.progress', (event) => {
  updateTaskProgress(event.payload.task_id, event.payload.progress);
});
```

---

## Process Management

### Bob Process Lifecycle

**Starting**:
```rust
let mut cmd = Command::new("bob");
cmd.arg("--interactive")
   .arg("--mode=code")
   .stdin(Stdio::piped())
   .stdout(Stdio::piped())
   .stderr(Stdio::piped());

let child = cmd.spawn()?;
```

**Monitoring**:
- Read stdout/stderr asynchronously
- Parse output into events
- Detect errors and warnings
- Track process health

**Stopping**:
- Send SIGTERM
- Wait for graceful shutdown (timeout: 5s)
- Send SIGKILL if needed
- Clean up resources

**Crash Recovery**:
- Detect unexpected process exit
- Log crash details
- Mark task as failed
- Offer retry or resume
- Never claim task completed if process crashed

### Background Task Management

**Scheduler**:
- Persistent queue in SQLite
- Check for due tasks every minute
- Execute tasks in order
- Respect concurrency limits
- Handle Mac sleep/wake

**Concurrency**:
- Max 3 simultaneous tasks (configurable)
- Queue additional tasks
- Prioritize user-initiated tasks

**Persistence**:
- Store task state in database
- Restore on app restart
- Resume interrupted tasks (if possible)
- Mark orphaned tasks clearly

---

## File System Organization

### Application Data

**macOS Standard Locations**:
- **App Bundle**: `/Applications/BobWork.app`
- **User Data**: `~/Library/Application Support/BobWork/`
- **Logs**: `~/Library/Logs/BobWork/`
- **Caches**: `~/Library/Caches/BobWork/`
- **Preferences**: `~/Library/Preferences/com.bobwork.app.plist`

**User Data Structure**:
```
~/Library/Application Support/BobWork/
  ├─ database.sqlite
  ├─ plugins/
  │   ├─ installed/
  │   ├─ drafts/
  │   └─ backups/
  ├─ artifacts/
  │   ├─ presentations/
  │   ├─ documents/
  │   ├─ spreadsheets/
  │   └─ exports/
  ├─ projects/
  │   └─ (optional project-specific data)
  ├─ backups/
  │   └─ (database backups)
  └─ temp/
      └─ (temporary files)
```

### Project Workspaces

**User-Chosen Locations**:
- User selects folder during project creation
- App requests file access permission
- Store path in database
- Respect user's organization

**Access Control**:
- Only access files within approved paths
- Validate all file operations
- Detect and block path traversal
- Resolve and validate symlinks

---

## Deployment Architecture

### Build Process

**Development Build**:
```bash
pnpm install
pnpm tauri dev
```

**Production Build**:
```bash
pnpm install
pnpm tauri build
```

**Output**:
- `src-tauri/target/release/bundle/macos/BobWork.app`
- `src-tauri/target/release/bundle/dmg/BobWork_1.0.0_aarch64.dmg`

### Code Signing (when certificates available)

**Requirements**:
- Apple Developer account
- Developer ID Application certificate
- Developer ID Installer certificate (for PKG)

**Process**:
```bash
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name (TEAM_ID)" \
  --options runtime \
  --entitlements entitlements.plist \
  BobWork.app
```

**Entitlements** (`entitlements.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
</dict>
</plist>
```

### Notarization (when certificates available)

**Process**:
```bash
# Upload for notarization
xcrun notarytool submit BobWork.dmg \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password" \
  --wait

# Staple notarization ticket
xcrun stapler staple BobWork.dmg
```

### DMG Creation

**Structure**:
```
BobWork.dmg
  ├─ BobWork.app
  ├─ Applications (symlink)
  └─ .background/
      └─ background.png
```

**Script** (using `create-dmg`):
```bash
create-dmg \
  --volname "Bob Work" \
  --volicon "icon.icns" \
  --window-pos 200 120 \
  --window-size 800 400 \
  --icon-size 100 \
  --icon "BobWork.app" 200 190 \
  --hide-extension "BobWork.app" \
  --app-drop-link 600 185 \
  --background "background.png" \
  "BobWork.dmg" \
  "src-tauri/target/release/bundle/macos/"
```

### Update System

**Tauri Updater**:
- Signed update manifests
- Delta updates (future)
- Background download
- User notification
- Automatic or manual install

**Update Manifest** (`latest.json`):
```json
{
  "version": "1.0.1",
  "notes": "Bug fixes and improvements",
  "pub_date": "2026-08-10T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://releases.bobwork.app/BobWork_1.0.1_aarch64.dmg"
    },
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://releases.bobwork.app/BobWork_1.0.1_x86_64.dmg"
    }
  }
}
```

---

## Performance Considerations

### Optimization Strategies

**Database**:
- Index frequently queried columns
- Use prepared statements
- Batch inserts
- Vacuum periodically
- Limit query results

**UI**:
- Virtual scrolling for long lists
- Lazy loading of images
- Debounce search input
- Memoize expensive computations
- Code splitting

**File Operations**:
- Stream large files
- Background indexing
- Incremental search
- Cache file metadata

**Bob Integration**:
- Reuse sessions when possible
- Parse output incrementally
- Buffer events
- Throttle UI updates

---

## Monitoring & Diagnostics

### Logging

**Levels**:
- ERROR: Critical failures
- WARN: Recoverable issues
- INFO: Important events
- DEBUG: Detailed diagnostics
- TRACE: Very verbose (dev only)

**Destinations**:
- Console (dev mode)
- File (`~/Library/Logs/BobWork/app.log`)
- Rotating logs (max 10 files, 10MB each)

**Redaction**:
- Automatically redact secrets
- Redact file paths (optional)
- Redact user data (optional)

### Diagnostics Export

**Contents**:
- App version and build
- macOS version
- Bob version and capabilities
- Recent logs (redacted)
- Database schema version
- Installed plugins
- Active tasks
- Error reports

**Format**: ZIP file with JSON and log files

**Privacy**: User reviews before export

---

## Scalability & Future Considerations

### Multi-Device Sync (Future)

**Architecture**:
- End-to-end encrypted sync
- Conflict resolution
- Selective sync
- Offline-first

**Sync Entities**:
- Projects (metadata only)
- Conversations
- Plugins
- Settings

**Not Synced**:
- Local files
- Artifacts (too large)
- Secrets (device-specific)

### Team Collaboration (Future)

**Features**:
- Shared projects
- Shared plugins
- Role-based permissions
- Activity feed
- Comments

**Architecture**:
- Central server (optional)
- Peer-to-peer (alternative)
- Encrypted communication

### Cloud Runners (Future)

**Purpose**: Execute tasks when Mac is offline

**Architecture**:
- Secure relay to cloud
- Encrypted task payload
- Result delivery
- Usage tracking

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-08-05 | Bob (Plan Mode) | Initial system design |
