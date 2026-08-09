# Bob Work - macOS Application

**Status**: Functional local macOS build  
**Version**: 0.1.4  
**Last Updated**: 2026-08-09

---

## Overview

Bob Work is a native macOS application that makes IBM Bob's AI capabilities accessible to non-technical users through an intuitive graphical interface. It transforms conversations into projects, deliverables, automations, and private plugins, with IBM Bob Shell as the local agentic execution engine.

### Core Value Proposition

> Transform a conversation into a project, deliverable, automation, or private plugin, with IBM Bob as the local execution engine.

---

## Project Status

Bob Work 0.1.4 is implemented as a local-first Tauri application and packaged as an Apple Silicon DMG. It uses the installed Bob Shell 2 runtime for real execution, modes, skills, MCP and task resume.

Implemented areas include conversations, projects, persistent tasks and run history, scheduling and catch-up policies, permissions and approvals, plugins/skills/MCP, local integrations, files and folders, search, import/export, notifications, voice dictation, themes, language and structured activity/sources.

The first-party plugin catalog also includes Documents, Microsoft Word, Microsoft PowerPoint, Microsoft Excel and Microsoft OneNote. A tabbed right panel previews local files through native macOS Quick Look where needed and can keep multiple Web sources open beside the conversation.

Agentic plugins can bundle instructions, local scripts, MCP servers, authenticated integration requirements, controlled lifecycle hooks, browser capabilities and scheduled-task templates in one installable unit. Bob Work validates paths and permissions, registers MCP servers through Bob Shell, checks required connections before execution, keeps enabled states synchronized and exposes every capability from one non-technical plugin details panel. OAuth is never simulated: an OAuth integration must reference a real MCP connector that owns its authorization flow.

Plugin versions use immutable semantic versions. Bob Work detects a newer local bundle without replacing the active one, displays its release notes and permission changes, archives the complete bundle (skill, scripts, hooks and MCP), then installs it only after an explicit action. The details panel keeps the version history and can restore a previous bundle while preserving connections and the enabled/disabled choice. A manual edit automatically creates the next corrective version.

See [the audited implementation plan](docs/implementation-plan-shell-2.md) and [the exact runtime limits](docs/limitations.md) before distribution.

---

## Documentation

### Design Documents

All design documents are located in the `docs/` directory:

1. **[Product Requirements](docs/product-requirements.md)** - Complete feature specifications, user stories, and acceptance criteria
2. **[System Design](docs/system-design.md)** - Technical architecture, component design, and data models
3. **[Bob Capability Matrix](docs/bob-capability-matrix.md)** - Mapping of features to IBM Bob capabilities with status and fallbacks
4. **[Security Model](docs/security-model.md)** - Threat model, security controls, and best practices
5. **[UI Specification](docs/ui-specification.md)** - Design system, component specs, and interaction patterns
6. **[Delivery Plan](docs/delivery-plan.md)** - Development phases, timeline, and success criteria

### Key Features (MVP)

**Priority 1 - Core Functionality**:
- Native macOS application with premium UI
- IBM Bob detection and integration
- Project and conversation management
- Chat and Work modes
- Approval and permission system

**Priority 2 - Conversational Plugin Builder** (Highest Priority Feature):
- Create plugins through natural conversation
- Simple enable/disable catalogue with one unified plugin detail view
- Visual permission management
- Sandboxed testing
- Version control and rollback

**Priority 3 - Business Modes**:
- Planning Mode
- Presentation Builder
- Document/Report Generator
- Spreadsheet/Analysis
- Research Mode
- Automation Builder
- Orchestrator

**Priority 4 - Deliverables**:
- PPTX generation and validation
- DOCX generation
- XLSX generation
- PDF generation
- Artifact gallery

---

## Technology Stack

### Frontend
- **Framework**: React 18+
- **Language**: TypeScript 5+
- **State**: Zustand or Jotai
- **Styling**: Tailwind CSS + CSS Modules
- **UI Components**: Radix UI
- **Icons**: Lucide React

### Backend
- **Framework**: Tauri 2.x
- **Language**: Rust 1.70+
- **Database**: SQLite (rusqlite)
- **Secrets**: encrypted local vault for the Bob API key; volatile memory for manual integration tokens
- **Async**: tokio

### Build & Development
- **Package Manager**: pnpm
- **Bundler**: Vite
- **Linting**: ESLint, Prettier, Clippy
- **Testing**: Vitest, React Testing Library, cargo-nextest

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Bob Work (macOS App)                     │
├─────────────────────────────────────────────────────────────┤
│  React UI Layer (TypeScript)                                 │
│  ↕ IPC                                                        │
│  Tauri Backend (Rust)                                        │
│  ↕                                                            │
│  Core Services (Bob, Project, Task, Plugin, Artifact)       │
│  ↕                                                            │
│  Data & Storage (SQLite, Session Memory, File System)       │
└───────────────────────┬───────────────────────────────────┘
                        │
        ┌───────────────▼────────────────┐
        │     IBM Bob Shell (CLI)        │
        └────────────────────────────────┘
```

---

## Security Principles

1. **Security by Default**: All sensitive actions require explicit approval
2. **Defense in Depth**: Multiple layers of protection
3. **Transparency**: Clear permission requests and audit trail
4. **Privacy First**: Local-first, minimal data collection
5. **Secure Development**: Input validation, output encoding, secure defaults

### Key Security Features

- Bob API key encrypted at rest with a user passphrase; manual integration tokens remain session-only
- Validated plugin paths, explicit permissions and isolated hook environments
- Path traversal protection
- Prompt injection protection
- Audit logging
- Secret redaction in logs

---

## Verification status

- TypeScript production build: passing
- Frontend test suite: 44/44 passing
- Rust test suite: 63/63 passing
- macOS end-to-end suite: 18/18 passing
- macOS `.app` and `.dmg`: generated and ad-hoc signed
- Smoke launch: passing on Apple Silicon

---

## Prerequisites

### Required
- macOS 12.0+ (Monterey or later)
- IBM Bob Shell 2.x installed
- Node.js 22.15.0+
- Rust 1.70+
- pnpm 8+

### Optional
- Apple Developer account (for signing/notarization)
- Developer ID certificates

---

## Getting Started

### 1. Validate IBM Bob Installation

```bash
# Check if Bob is installed
which bob

# Check Bob version
bob --version

# Check Bob help
bob --help

# Test Bob (non-destructive)
bob chat --accept-license
```

### 2. Clone Repository

```bash
git clone <repository-url>
cd bob-work
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Run Development Build

```bash
pnpm --filter macos dev:tauri
```

### 5. Build for Production

```bash
pnpm --filter macos build:tauri
```

---

## Project Structure

```
bob-work/
├── apps/
│   └── macos/              # macOS application
│       ├── src/            # React frontend
│       ├── src-tauri/      # Rust backend
│       └── package.json
├── packages/
│   ├── core/               # Shared core logic
│   ├── ui/                 # UI components
│   ├── bob-adapter/        # Bob integration
│   ├── project-engine/     # Project management
│   ├── task-engine/        # Task orchestration
│   ├── plugin-sdk/         # Plugin system
│   ├── artifact-engine/    # Deliverable generation
│   ├── integration-sdk/    # External integrations
│   └── shared-types/       # TypeScript types
├── docs/                   # Documentation
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

## Contributing

This project is currently in the planning phase. Contribution guidelines will be added once development begins.

---

## License

To be determined. This is a working prototype for IBM Bob integration.

---

## Contact

For questions or feedback, please refer to the project documentation or contact the development team.

---

## Acknowledgments

- IBM Bob team for the AI platform
- Tauri team for the application framework
- Open source community for the tools and libraries

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-08-05 | Bob (Plan Mode) | Initial README with project overview |
