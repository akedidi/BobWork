# Bob Work - Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** 2026-08-05  
**Status:** Draft  
**Product Name (Working Title):** Bob Work

> **Décision produit 0.1.4 (9 août 2026)** — Aucun secret Bob Work n’est stocké dans le Trousseau. Les anciennes exigences Keychain de ce brouillon sont remplacées par une clé de session non persistante.

---

## Executive Summary

Bob Work is a native macOS application that makes IBM Bob's AI capabilities accessible to non-technical users through an intuitive graphical interface. It transforms conversations into projects, deliverables, automations, and private plugins, with IBM Bob Shell as the local agentic execution engine.

### Core Value Proposition

> Transform a conversation into a project, deliverable, automation, or private plugin, with IBM Bob as the local execution engine.

---

## Target Audience

### Primary Users (Non-Technical)
- Consultants
- Sales professionals
- Marketing managers
- Project managers
- Business analysts
- Financial managers
- Small business owners
- Administrative staff
- Enterprise business teams using IBM
- Users wanting to automate tasks without programming

### User Characteristics
- Limited or no terminal/CLI experience
- No knowledge of YAML/JSON configuration
- Unfamiliar with MCP, environment variables, Node.js
- Want results without technical complexity
- Value privacy and local-first operation

---

## Product Goals

### Must Have (MVP)
1. **Native macOS Experience**
   - Premium, professional interface
   - Full keyboard navigation and accessibility
   - Light/dark theme support
   - macOS-native controls and behaviors

2. **Transparent Bob Integration**
   - Automatic Bob detection and setup
   - Guided IBM authentication
   - No manual CLI configuration required
   - Clear capability detection and limitation handling

3. **Project Management**
   - Create and organize projects
   - Attach files and sources
   - Custom instructions per project
   - Project memory and context

4. **Conversation Types**
   - **Chat**: Quick questions, brainstorming, explanations
   - **Work**: Long-running tasks, deliverables, orchestration

5. **Conversational Plugin Builder** (Priority Feature)
   - Create plugins through natural conversation
   - Three categories: Recipes, Integrations, Executables
   - Visual permission management
   - Sandboxed testing before installation
   - Version control and rollback

6. **Business Modes**
   - Quick Chat (Ask mode)
   - Planning (Plan mode)
   - General Work (Code/Agent mode)
   - Presentation Builder
   - Document/Report Generator
   - Research Mode
   - Automation Builder
   - Orchestrator
   - Plugin Creator
   - Advanced Bob Modes (detected from installation)

7. **Security & Permissions**
   - Explicit approval for sensitive actions
   - No automatic `--yolo` mode
   - macOS Keychain for secrets
   - Sandboxing support
   - File access controls
   - Network restrictions

8. **Artifacts & Deliverables**
   - Generate PPTX, DOCX, XLSX, PDF
   - Visual preview and validation
   - Version tracking
   - Export and sharing

### Should Have (Post-MVP)
- Scheduled tasks and automation
- Integration catalog (Slack, Google, etc.)
- Built-in browser for web tasks
- Notification system
- Menu bar app
- Advanced orchestration with dependency graphs
- MCP server management UI

### Could Have (Future)
- Mobile companion app for monitoring
- Encrypted relay for remote execution
- Cloud runners
- Enterprise version
- Multi-device sync
- Team collaboration features

---

## Functional Requirements

### FR-1: Onboarding & Setup

**FR-1.1: Welcome Flow**
- Display clear value proposition
- Explain local-first, privacy-focused approach
- Set user expectations about IBM Bob requirement

**FR-1.2: Bob Detection**
- Search standard locations and PATH for `bob` binary
- Display version and compatibility status
- Handle states:
  - Bob available and compatible
  - Bob incompatible version
  - Bob not found
  - Bob not authenticated
  - Bob subscription/budget unavailable

**FR-1.3: IBM Authentication**
- Support IBMid/SSO browser flow for interactive sessions
- Optional: API key for non-interactive automation (stored in Keychain)
- Never store credentials in SQLite or logs
- Clear explanation of why API key may be needed

**FR-1.4: Workspace Selection**
- Choose existing folder or create new workspace
- Set file access permissions
- Configure allowed file patterns
- Option to work without folder (conversation-only mode)

**FR-1.5: Verification**
- Run non-destructive test (simple query or file read)
- Display clear diagnostic results
- Confirm Bob is working correctly

### FR-2: Project Management

**FR-2.1: Project Creation**
- Name and objective
- Optional template selection
- File/folder attachment
- Integration selection
- Default mode
- Privacy settings

**FR-2.2: Project Templates**
- Blank Project
- Presentation
- Data Analysis
- Research
- Marketing Campaign
- Meeting Preparation
- Financial Tracking
- Personal Automation

**FR-2.3: Project Views**
- Overview dashboard
- Conversations list
- Tasks and progress
- Sources and files
- Deliverables gallery
- Automations
- Plugins
- Custom instructions
- Settings

**FR-2.4: Project Operations**
- Rename, duplicate, export
- Archive, delete
- Change folder location
- Revoke access permissions
- Clear memory
- Create template from project

### FR-3: Conversations

**FR-3.1: Chat Mode**
- Quick questions and answers
- Brainstorming
- Explanations
- No long-running workflows
- Markdown rendering with code highlighting

**FR-3.2: Work Mode**
- Long-running tasks
- Deliverable creation
- Research and analysis
- File creation and modification
- Orchestration
- Automation building
- Plugin development

**FR-3.3: Message Composer**
- Multi-line text input
- Drag-and-drop file attachment
- Attach button for file picker
- Screenshot capture (if authorized)
- `@` mentions for integrations
- `/` commands for actions
- Mode selector
- Project selector
- Schedule option
- Permission policy selector
- Send/Stop/Pause controls

**FR-3.4: Message Display**
- Markdown with tables and code blocks
- Attached sources and files
- Embedded images
- Artifacts and deliverables
- Task steps and progress
- Tool usage indicators
- Errors and warnings
- Approval requests

**FR-3.5: Conversation Management**
- Pin/unpin conversations
- Rename
- Move to project
- Duplicate
- Export
- Archive
- Delete
- Search across conversations

### FR-4: Business Modes

**FR-4.1: Mode Registry**
- Visual card-based catalog
- Search and filter
- Status indicators (available/partial/unavailable)
- Description and capabilities
- Permission requirements
- Usage examples

**FR-4.2: Built-in Modes**

**Quick Chat**
- Maps to Bob Ask mode when available
- Fast responses
- No file modifications

**Planning**
- Uses Bob Plan mode
- Generates actionable plan
- User validation before execution

**General Work**
- Uses most appropriate Bob mode
- File creation and modification
- Full capabilities

**Presentation Builder**
- Workflow: audience → objective → sources → plan → validation → drafting → theming → generation → visual QA → corrections → delivery
- Output: PPTX with preview
- Detect text overflow and empty slides
- Export to PDF

**Document & Report**
- Generate Markdown, DOCX, PDF
- Structure, references, tables, images
- Coherence checking
- Preview

**Spreadsheet & Analysis**
- CSV/XLSX support
- Data inspection and cleaning
- Calculations and formulas
- Charts and visualizations
- Export with validation

**Research**
- Web search (when available)
- Source collection and citation
- Synthesis and comparison
- Timeline creation
- Confidence levels
- Final report

**Website/App Builder**
- Create web projects
- Local preview
- Logs and inspection
- Annotations
- Export

**Automation Builder**
- Transform request into triggerable workflow
- Schedule configuration
- Permission setup

**Orchestrator**
- Decompose complex goals into task graph
- Identify dependencies
- Choose modes/plugins per step
- Parallel execution (when safe)
- Validation gates
- Progress visualization
- Result summarization
- Blockage detection
- Task redirection

**Plugin Creator** (Priority)
- Conversational plugin building
- Interview-based requirements gathering
- Three categories: Recipe, Integration, Executable
- Manifest generation
- Permission analysis
- Sandboxed testing
- Installation with rollback

**Advanced Bob Modes**
- Dynamically detected from Bob installation
- Ask, Plan, Code/Agent, Orchestrator (if exposed)
- Custom modes
- IBM offering-specific modes

### FR-5: Conversational Plugin System (Priority)

**FR-5.1: Plugin Builder Conversation**
User describes desired plugin in natural language:
> "I want a plugin that fetches my sales files every Monday, detects anomalies, creates a presentation, and asks before sending."

Builder conducts interview:
- Objective
- Trigger (schedule, event, manual)
- Inputs and sources
- Outputs and format
- Recipients
- Actions
- Exception handling
- Permissions required
- Validation steps
- Frequency
- Expected example

**FR-5.2: Plugin Categories**

**Recipe Plugin**
- Instructions only
- Templates and examples
- Checklists
- Output formats
- No code execution

**Integration Plugin**
- Adds external tools/connectors
- API integrations
- Data sources
- Requires explicit permissions

**Executable Plugin**
- Contains code or MCP server
- Maximum security controls
- Sandboxed execution
- Extensive permission review

**FR-5.3: Plugin Manifest Schema**
```
id, name, version, description, author
scope (project/personal/team)
capabilities, inputs, outputs
skills, modes, workflows
tools, integrations
permissions (detailed)
triggers (schedule/event/manual)
ui (custom interface elements)
runtime (requirements)
compatibility (minimumBobVersion)
createdAt, updatedAt
```

**FR-5.4: Plugin Creation Pipeline**
1. Gather requirements through conversation
2. Clarify ambiguities
3. Generate plan
4. Determine category
5. Produce manifest
6. Display permissions clearly
7. Generate files (skills, modes, configs)
8. Validate schema
9. Analyze security risks
10. Execute sandboxed test
11. Display test results
12. Request installation approval
13. Install transactionally with backup
14. Enable rollback
15. Generate user documentation

**FR-5.5: Plugin Scope**
- **Project**: Available only in specific project
- **Personal**: Available globally for user
- **Team**: (Future) Shared with team

Maps to Bob's skills and custom modes, but Bob Work owns the plugin definition.

**FR-5.6: Plugin Library**
Views:
- Installed
- Local (not installed)
- Drafts
- Updates available
- Disabled

Each plugin card shows:
- Description and capabilities
- Permissions required
- Integrations used
- Compatibility
- Last execution
- Version
- Activity stats
- Test, Disable, Uninstall, Export buttons

**FR-5.7: Plugin Security**
Never auto-approve:
- `postinstall` scripts
- Unverified external binaries
- Global disk access
- Secret access
- Undeclared network access
- Admin commands

**FR-5.8: Plugin Export Format**
- `.bobwork-plugin` versioned format
- Includes manifest, files, documentation
- Portable and shareable

### FR-6: Tasks & Orchestration

**FR-6.1: Task States**
- Draft
- Queued
- Starting
- Running
- Awaiting Information
- Awaiting Approval
- Paused
- Completed
- Failed
- Cancelled
- Expired

**FR-6.2: Task Properties**
- Objective
- Project and conversation
- Mode or plugin
- Permission policy
- Budget limit
- Maximum time
- Bob process reference
- Start and end dates
- Summary
- Progress percentage
- Errors
- Resumable flag

**FR-6.3: Task Steps**
- Title and description
- Status
- Dependencies
- Responsible agent/mode
- Dates
- Tools used
- Inputs and outputs
- Retry count
- Error details
- Validation required

**FR-6.4: Task Center Views**
- Today
- In Progress
- Awaiting Action
- Scheduled
- Completed
- Failed

**FR-6.5: Task Progress Display**
- Current status
- Elapsed time
- Active step
- Sub-tasks
- Tool being used
- Stop button
- Pause button (if supported)
- Modify instruction button

### FR-7: Approval System

**FR-7.1: Approval Card**
Clear explanation of:
- What Bob wants to do
- Why it's needed
- Data to be accessed
- Files to be modified
- Commands to be executed
- External services to be contacted
- Risk level
- Ability to undo

**FR-7.2: Approval Actions**
- Deny
- Modify
- Allow Once
- Allow for This Task
- Always Allow (only if policy permits, with warning)

**FR-7.3: Approval Types**
- File read
- File write
- File delete
- Command execution
- Network request
- Browser action
- Clipboard access
- Application control
- Screenshot capture
- Microphone access

**FR-7.4: Risk Levels**
- Low: Read public files
- Medium: Write to project files
- High: Execute commands, network access
- Critical: Delete files, admin commands, secret access

### FR-8: Artifacts & Deliverables

**FR-8.1: Artifact Types**
- Text
- Markdown
- PDF
- DOCX
- PPTX
- XLSX
- CSV
- Image
- HTML
- Web site/app
- Archive

**FR-8.2: Artifact Operations**
- Generate
- Preview (visual rendering)
- Version tracking
- Download
- Open in native app
- Duplicate
- Compare versions
- Regenerate
- Export
- Associate with sources

**FR-8.3: Artifact Validation**
For PPTX, DOCX, XLSX, PDF:
- Use maintained libraries
- Verify licenses
- Render to images/PDF for QA
- Detect overflowing text
- Detect empty pages/slides
- Verify formulas
- Confirm file opens correctly
- Never claim success if file is invalid

**FR-8.4: Artifact Gallery**
- Grid or list view
- Filter by type, project, date
- Search
- Preview thumbnails
- Quick actions

### FR-9: Security & Permissions

**FR-9.1: Permission Policies**
- Always Ask
- Ask for Modifications
- Ask for Important Actions
- Never Ask (requires explicit warning)

**FR-9.2: Security Controls**
- Path traversal protection
- Symlink validation (no external links)
- File size limits
- Binary file detection
- Secret exclusion (.env, keys, tokens)
- Log redaction
- macOS Keychain for secrets
- macOS permission requests (Files, Accessibility, etc.)
- Sandbox support
- Network restrictions
- Tool allowlists
- Plugin validation
- Bob config backup before modification
- Audit trail
- Undo/rollback capability

**FR-9.3: Prompt Injection Protection**
Content from untrusted sources must not be treated as system instructions:
- Web pages
- Emails
- Documents
- Plugins
- Connectors

**FR-9.4: Terminal Access**
- Disabled in normal experience
- Available only in expert mode with clear warning
- Not for general users

### FR-10: Data Model

**FR-10.1: Core Entities**

**Project**
- id, name, description, objective
- image/color
- localPath
- customInstructions
- language
- memoryEnabled
- allowedFiles, allowedPlugins, allowedIntegrations
- defaultMode
- createdAt, updatedAt
- archived

**Conversation**
- id, projectId
- title, type (Chat/Work)
- businessMode, bobMode
- date, pinned
- localOnly
- summary
- bobContextState

**Message**
- id, conversationId
- author (user/assistant)
- content
- attachments, sources, citations
- toolsUsed
- sendState, errors
- associatedArtifacts, associatedApprovals

**Task**
- id, objective
- projectId, conversationId
- mode, permissionPolicy
- budget, maxTime
- bobProcess
- startDate, endDate
- summary, progress
- errors, resumable
- state (draft/queued/starting/running/awaiting/paused/completed/failed/cancelled/expired)

**TaskStep**
- id, taskId
- title, description, status
- dependencies
- responsibleAgent
- dates, tools
- inputs, outputs
- retryCount, error
- validationRequired

**Approval**
- id, taskId
- actionType, humanDescription
- commandOrChange
- dataAccessed, filesAffected
- networkDestination
- riskLevel
- decision, permissionDuration
- decidedBy, decidedAt

**Artifact**
- id, type, title
- filePath, version
- preview
- origin, sources
- validationStatus
- exported
- createdAt

**Plugin**
- id, name, version, author
- description, scope
- manifest
- skills, modes, workflows
- tools, integrations
- permissions, triggers
- inputs, outputs
- installState, validationState
- signature
- versionHistory

**Integration**
- id, provider, account
- authType, scopes
- availableTools
- approvalPermission
- healthState
- lastSync
- keychainSecretRef
- allowedProjects

**Schedule**
- id, name, instructions
- projectId, pluginOrMode
- cronOrEvent, timezone
- nextRun, lastRun
- offlineBehavior, overlapPolicy
- retryPolicy
- notifications
- state (active/paused/completed)

**Event** (Append-only log)
- id, type, timestamp
- entityType, entityId
- data (JSON)
- userId

**FR-10.2: Database**
- SQLite for local persistence
- Transactional writes
- Migration system
- Backup before schema changes
- Integrity checks

---

## Non-Functional Requirements

### NFR-1: Performance
- App launch < 2 seconds
- UI responsiveness < 100ms
- Conversation load < 500ms
- Search results < 1 second
- File indexing in background

### NFR-2: Reliability
- Graceful handling of Bob crashes
- Task resumption after app restart
- Data integrity with transactions
- Automatic backup before risky operations
- Clear error messages

### NFR-3: Security
- Secrets only in macOS Keychain
- No credentials in logs or SQLite
- Sandboxed plugin execution
- Explicit approval for sensitive actions
- Audit trail for all operations
- Regular security updates

### NFR-4: Usability
- No terminal knowledge required
- Clear, jargon-free language
- Contextual help
- Keyboard shortcuts
- Accessibility (VoiceOver, contrast, text size)
- Undo/redo where applicable

### NFR-5: Compatibility
- macOS 12.0+ (Monterey and later)
- Apple Silicon native
- Intel support (if feasible)
- Bob Shell 2.x compatibility
- Graceful degradation for missing Bob features

### NFR-6: Privacy
- Local-first architecture
- No telemetry by default
- Optional crash reports
- Clear data retention policies
- User control over all data
- Export and delete capabilities

### NFR-7: Maintainability
- Modular architecture
- Comprehensive logging
- Feature flags
- A/B testing capability (future)
- Automated testing
- CI/CD pipeline

---

## User Interface Requirements

### UIR-1: Visual Design
- Original, professional design language
- Not a pixel-perfect ChatGPT copy
- SF Pro or system font
- SF Symbols or original icons
- Light, dark, and system themes
- WCAG AA contrast
- 8-point grid system
- 8-14pt border radius
- Subtle shadows
- Clear surface hierarchy

### UIR-2: Color Palette (Original)
**Light Theme:**
- Background: Warm light gray
- Surface: White with subtle shadow
- Primary: Indigo or petrol blue
- Secondary: Soft turquoise
- Success: Green
- Warning: Amber
- Risk: Orange
- Error: Desaturated red

**Dark Theme:**
- Background: Graphite with blue tint
- Surface: Elevated dark gray
- (Same accent colors, adjusted for dark mode)

### UIR-3: Main Window
- Minimum: 980×680 px
- Three-column adaptive layout:
  1. Left sidebar (260-290px, resizable)
  2. Central workspace
  3. Right inspector (340-420px, optional)
- Full screen support
- Split View support
- Sidebar hide/show
- Inspector hide/show
- Window state restoration
- Multiple windows (if reasonable)
- Integrated title bar with drag area

### UIR-4: Sidebar
**Top:**
- Space/profile selector
- "New" button
- Global search

**Navigation:**
- Home
- New Chat
- Projects
- Tasks
- Scheduled
- Plugins
- Integrations

**Sections:**
- Recent conversations
- Pinned conversations
- Projects
- Shared items (future)

**Bottom:**
- Bob status
- Local/offline status
- Usage/budget
- Account
- Settings
- Help

**Context Menus:**
- Rename, Pin, Move to Project
- Duplicate, Export
- Archive, Delete

### UIR-5: Home View
- "What would you like to accomplish?" prompt
- Recent projects
- Active tasks
- Pending approvals
- Upcoming scheduled tasks
- Recent deliverables
- Mode suggestions

**Quick Start Cards:**
- Create Presentation
- Analyze Files
- Write Report
- Automate Task
- Organize Project
- Research Topic
- Create Plugin
- Orchestrate Process

### UIR-6: Chat/Work Views
- Segmented control for Chat/Work toggle
- Message thread with Markdown rendering
- Code syntax highlighting
- Tables, images, attachments
- Sources and citations
- Artifacts and deliverables
- Task steps and progress
- Tool usage indicators
- Approval cards
- Error messages

**Active Response:**
- Current status
- Elapsed time
- Active step
- Sub-tasks
- Tool in use
- Stop button
- Pause button (if available)
- Modify instruction button

### UIR-7: Composer
- Multi-line text field
- Drag-and-drop zone
- Attach button
- Screenshot button (if authorized)
- `@` button for integrations
- `/` button for commands
- Mode selector
- Project selector
- Schedule option
- Permission policy selector
- Voice input (if available)
- Send button
- Stop button

**Keyboard Shortcuts:**
- Enter: Send
- Shift+Enter: New line
- Cmd+K: Search
- Cmd+N: New chat
- Cmd+Shift+N: New project
- Cmd+,: Settings
- Configurable global hotkey for mini-composer

### UIR-8: Right Inspector
Context-dependent panels:
- Task plan
- Progress
- Sources
- Files
- Diff viewer
- Artifact preview
- Browser (future)
- Plugin details
- Permissions
- Execution history

Resizable, detachable, closable.

### UIR-9: Approval Cards
Clear, prominent display:
- Action description
- Reason
- Data accessed
- Files affected
- Command to execute
- Network destination
- Risk level badge
- Undo capability

**Actions:**
- Deny (red)
- Modify (blue)
- Allow Once (green)
- Allow for Task (green)
- Always Allow (yellow, with warning)

### UIR-10: Settings Window
Searchable, organized by category:
- General
- Appearance
- Bob & Models
- Projects
- Tasks
- Scheduling
- Permissions & Security
- Plugins
- Integrations
- Browser (future)
- Notifications
- Memory & Personalization
- Data & Privacy
- Account
- Advanced
- About

---

## Technical Constraints

### TC-1: Dependencies
- IBM Bob Shell 2.x must be installed
- macOS 12.0+ required
- Node.js 22.15.0+ (for Bob)
- Internet connection for IBM authentication
- Optional: Apple Developer certificates for signing/notarization

### TC-2: Bob Limitations
- Must detect actual capabilities, not assume
- Handle missing features gracefully
- Provide fallbacks where possible
- Never fake unavailable functionality
- Clear user communication about limitations

### TC-3: Distribution
- DMG format for macOS
- Unsigned builds for development
- Signed/notarized builds when certificates available
- No bundling of Bob binary without IBM permission
- Clear installation instructions

---

## Success Criteria

### SC-1: User Can Complete Core Workflows
1. Install from DMG
2. Authenticate with IBM
3. Create a project
4. Have a conversation
5. Generate a deliverable (e.g., presentation)
6. Create a plugin through conversation
7. Schedule a task (if Bob supports it)

### SC-2: Security & Reliability
- No secrets in logs or database
- All sensitive actions require approval
- App recovers from Bob crashes
- Data persists across restarts
- Rollback works for plugins

### SC-3: User Experience
- Non-technical users can accomplish tasks without help
- Clear error messages, no technical jargon
- Responsive UI (no freezing)
- Accessible (keyboard, VoiceOver)
- Professional appearance

### SC-4: Bob Integration
- Correctly detects Bob capabilities
- Handles missing features gracefully
- Never claims to do what Bob can't do
- Provides clear capability matrix
- Adapts to different Bob versions

---

## Out of Scope (MVP)

- Mobile app (future)
- Cloud runners (future)
- Team collaboration (future)
- Multi-device sync (future)
- Built-in browser (post-MVP)
- Scheduled tasks (post-MVP, depends on Bob capabilities)
- Integration catalog (post-MVP)
- Advanced orchestration UI (post-MVP)
- Custom MCP server builder (post-MVP)

---

## Open Questions

1. **Bob API Stability**: Does Bob provide stable JSON output for parsing, or do we need to parse text/ANSI?
2. **Bob Approval Flow**: Can Bob pause for approval in non-interactive mode, or must we plan-then-execute?
3. **Bob Session Persistence**: Can Bob sessions be resumed after app restart?
4. **Bob Orchestrator**: Is the Orchestrator mode exposed in Bob 2.x?
5. **Bob MCP Management**: How does Bob 2.x handle MCP server configuration?
6. **IBM Licensing**: Can we redistribute Bob installer or must users install separately?
7. **Apple Certificates**: When will signing certificates be available?

---

## Appendix: Terminology

- **Bob**: IBM Bob, the AI assistant platform
- **Bob Shell**: Command-line interface to Bob
- **Bob Work**: This application (working title)
- **Chat**: Quick conversation mode
- **Work**: Long-running task mode
- **Plugin**: User-created automation or capability
- **Recipe**: Instruction-only plugin
- **Integration**: Plugin with external API connections
- **Executable**: Plugin with code execution
- **Artifact**: Generated deliverable (document, presentation, etc.)
- **Approval**: User permission for sensitive action
- **Mode**: Specialized behavior (Plan, Code, Ask, etc.)
- **Orchestrator**: Multi-step task coordinator
- **MCP**: Model Context Protocol (for integrations)
- **Sandbox**: Isolated execution environment

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-08-05 | Bob (Plan Mode) | Initial PRD based on mission brief |
