# Bob Work Desktop

**Version:** 0.1.4

**Status:** functional local desktop application for macOS

**Last updated:** 2026-09-07

Bob Work is a native desktop application that makes **IBM Bob** capabilities available without requiring users to operate the CLI directly. It uses **Bob Shell 2** as its local agent engine for conversations, projects, tasks, schedules, plugins, skills, MCP integrations, and artifacts.

> Turn a conversation into a project, deliverable, automation, or private plugin, with Bob Shell as the local execution engine.

## Contents

1. [Platform support](#platform-support)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Quick start](#quick-start)
5. [Architecture](#architecture)
6. [Plugins, tools, and runtimes](#plugins-tools-and-runtimes)
7. [Features](#features)
8. [Technology stack](#technology-stack)
9. [Repository layout](#repository-layout)
10. [Configuration and runtime data](#configuration-and-runtime-data)
11. [Testing](#testing)
12. [CI and releases](#ci-and-releases)
13. [Security](#security)
14. [Documentation](#documentation)
15. [Known limitations](#known-limitations)

## Platform support

| Platform | Bob Work application | Bob Shell engine | Notes |
|---|---|---|---|
| **macOS 12+**, Apple Silicon | Shipped | Required | Primary target; tray, notifications, Quick Look, TCC, Accessibility |
| **macOS Intel** | Buildable, not shipped by default | Required | Requires an `x86_64` or universal build |
| **Linux** | Not shipped | Installable through IBM-supported channels | No Linux Tauri package in this repository |
| **Windows** | Not shipped | Installable where offered by IBM | No Windows Tauri package in this repository |

The workspace currently ships only the macOS application. Linux and Windows can run Bob Shell where supported, but the macOS-specific notification, AppleScript, LaunchAgent, and Quick Look layers must be replaced before packaging Bob Work for those platforms.

## Requirements

### Development

| Tool | Recommended version |
|---|---|
| Node.js | 22.15 or newer |
| pnpm | 10.11 or newer |
| Rust | stable, with Cargo |
| Git | 2.x |
| IBM Bob Shell | 2.x, with `bob` on `PATH` |

### macOS

- macOS 12 Monterey or newer.
- Xcode Command Line Tools: `xcode-select --install`.
- A real `.app` bundle for development notification registration; plain `tauri dev` is not sufficient for every TCC flow.
- System permissions as needed: Notifications, Accessibility, Automation, Microphone, and Speech Recognition.

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd BobWork/BobDesktop
```

### 2. Install Bob Shell 2

Check whether Bob Shell is already available:

```bash
which bob
bob --version
bob run --help
```

If necessary, use the installer provided for your IBM offering:

```bash
./bobshell-install.sh --help
./bobshell-install.sh --package-manager pnpm
```

Bob Work primarily authenticates headless `bob run` sessions through a protected API key supplied as `BOB_API_KEY` or `BOBSHELL_API_KEY`. Interactive `bob chat` login is not the application's primary execution path.

### 3. Install workspace dependencies

```bash
pnpm install
```

### 4. Optional local configuration

```bash
cp apps/macos/.env.example apps/macos/.env
```

Populate only the OAuth client identifiers and optional development keys you need. Local `.env` files are ignored by Git.

## Quick start

### Development

From `BobDesktop/`:

```bash
pnpm dev
```

For macOS notification and TCC testing with a real application bundle:

```bash
pnpm --filter macos run ensure:dev-app

# Optional installation under /Applications
pnpm --filter macos run install:dev-app
open -n "apps/macos/src-tauri/target/debug/bundle/macos/Bob Work.app"
```

### Clean production application and DMG

```bash
pnpm mac:release
pnpm mac:dmg
```

Both commands go through `apps/macos/scripts/release-build.sh`. The pipeline:

1. Rejects development and E2E environment flags.
2. Invalidates Cargo artifacts when the compiler, lockfile, build script, or native bridges change.
3. Removes previous Release and frontend output.
4. Builds the application from clean inputs.
5. Checks npm, Cargo, Tauri, bundle identifier, and application versions.
6. Rejects source maps, debug libraries, E2E symbols, and stale development assets.
7. Generates `src-tauri/target/release/bob-work-release-manifest.json` with SHA-256 hashes.

Local builds use ad-hoc signing. GitHub releases use Developer ID signing, Apple notarization, and signed updater artifacts when repository secrets are configured. See [docs/release-macos.md](docs/release-macos.md).

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                    Bob Work desktop UI                       │
│ React 19 · TypeScript · Vite · Zustand · CSS · i18n         │
├──────────────────────────────────────────────────────────────┤
│                         Tauri 2 IPC                          │
├──────────────────────────────────────────────────────────────┤
│ Rust backend                                                 │
│ commands → services → SQLite · vault · filesystem · process │
└────────────────────────────┬─────────────────────────────────┘
                             │ bob run --stream-json
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                      IBM Bob Shell 2                         │
│ modes · skills · MCP · tools · task continuation            │
└────────────────────────────┬─────────────────────────────────┘
               ┌─────────────┴──────────────┐
               ▼                            ▼
       ~/.bob/skills and plugins       MCP servers / APIs
```

### Main conversation flow

```text
user prompt
    │ mode · project · attachments · selected capabilities
    ▼
React composer
    │ typed Tauri IPC
    ▼
Rust command boundary
    │ validation · permission policy · context construction
    ▼
Bob service ──▶ bob run
    │ structured events: text · tools · activity · errors · result
    ▼
conversation UI + SQLite + artifacts + notifications
```

1. The user submits a message with an optional mode, project, plugins, and attachments.
2. The frontend invokes a typed Tauri command.
3. The backend validates paths and permissions, resolves MCP and runtime requirements, and starts Bob Shell.
4. Structured events stream into the conversation while persistent activity remains available after completion.
5. The final state, artifacts, task status, and notifications are committed locally.

### Layers

| Layer | Responsibility |
|---|---|
| React views and components | Chat, Projects, Plugins, Skills, Integrations, Tasks, Schedules, Artifacts, Settings, Onboarding |
| IPC client | Typed calls and event subscriptions in `src/lib/ipc.ts` |
| Tauri commands | Native trust boundary under `src-tauri/src/commands/` |
| Rust services | Bob, plugins, MCP, OAuth, SSH, remote control, scheduler, notifications, vault, audit, workspace |
| Persistence | SQLite in the Tauri application data directory, encrypted local vault, and Bob Shell configuration under `~/.bob/` |

The application identifier is `com.bobwork.desktop`.

### Execution boundaries

```text
React UI
   │ typed IPC
   ▼
Tauri command ─▶ permission policy ─▶ product service
                                            │
                 ┌──────────────────────────┼──────────────────────┐
                 ▼                          ▼                      ▼
          local Bob Shell             local MCP server      remote API / SSH
                 │                          │                      │
                 └──── structured output and failures ────────────┘
                                            │
                                            ▼
                              conversation · SQLite · audit
```

Sandbox mode restricts terminal and filesystem operations to the authorized workspace. Sensitive operations remain subject to approval. Network isolation is deliberately outside the current sandbox scope.

## Plugins, tools, and runtimes

A **plugin** packages a user-facing capability, allowed tools, and operational instructions. A **skill** defines a reusable working method. An **MCP server** exposes callable operations. A **runtime** provides the executables and libraries required to execute those operations.

```text
┌──────────────┐   capability selection   ┌────────────────────┐
│ Conversation │ ───────────────────────▶ │ Plugin / work mode │
└──────────────┘                          │ rules · skills     │
                                          └─────────┬──────────┘
                                                    │ allowed tools
                                                    ▼
                                          ┌────────────────────┐
                                          │ MCP / command      │
                                          │ typed input/output │
                                          └─────────┬──────────┘
                                                    │ required capability
                                                    ▼
┌────────────────────────── RuntimeManager ──────────────────────────────┐
│ resolution · version · platform · integrity · consumers · storage     │
├─────────────────────┬────────────────────────┬─────────────────────────┤
│ Shared              │ ExternalManaged        │ PluginPrivate           │
│ reused by Bob Work  │ optional, installed    │ explicitly bundled by  │
│ capabilities        │ only when requested    │ a personal plugin       │
└──────────┬──────────┴────────────┬───────────┴────────────┬────────────┘
           └───────────────────────┼────────────────────────┘
                                   ▼
                         controlled local process
                 minimal environment · timeout · cancel · logs
```

| Runtime class | Owner | Installation | Removal |
|---|---|---|---|
| `shared` | Bob Work | Bundled, detected, or initialized once for several consumers | Not removable while required by the core; caches can be trimmed |
| `external_managed` | Bob Work after explicit installation | Automatic only when the catalog declares a reliable strategy; otherwise manual instructions | Allowed only when Bob Work owns the installation and can remove it safely |
| `plugin_private` | Personal plugin author/user | Deployed with the plugin bundle that declares it | Follows that plugin's lifecycle without changing shared runtimes |

Persisted states are `not_installed`, `installing`, `installed`, `updating`, `broken`, and `removing`.

```text
runtime manifest
      │
      ├── compatible platform and architecture? ── no ─▶ manual setup
      ├── reliable managed strategy available? ─── no ─▶ user instructions
      ▼ yes
installation plan → consent → download/cache → isolated installation
      → version/integrity check → SQLite registry → execution handle
```

Shared visualization runtimes include ECharts, Three.js, Plotly, Mermaid, and diagram engines used by conversation previews. Large specialized runtimes such as Qiskit and CodeGraph remain optional and are suggested only when a task needs them.

Personal MCP connectors expose structured optional environment-variable fields for local `stdio` servers. Remote MCP authentication uses OAuth or dedicated HTTP headers. MCP connectors managed by Bob Work or built-in plugins are tagged as built-in and cannot be edited or removed from the personal connector form.

## Features

| Area | Description |
|---|---|
| Chat | Streaming responses, prompt queue, persistent activity details, modes, attachments, citations, and action buttons |
| Projects | Workspaces, project instructions, authorized integrations, local and remote resources |
| Tasks | Execution history, continuation, status, input, and output |
| Scheduling | Recurrence, catch-up and overlap policies, background tray operation |
| Plugins | Agent bundles with manifests, scripts, MCP servers, hooks, SemVer, and rollback |
| Skills | Personal and built-in `SKILL.md` workflows; manual creation, Bob-assisted creation, and import |
| Integrations | OAuth catalog, public and keyed APIs, personal and built-in MCP servers, database connections, connection tests |
| Remote work | Multi-server SSH, remote filesystem browsing, mirrored workspaces, MCP gateway and outbound tunnel |
| Computer Use | Autonomous accessibility and vision loop with approvals and a separate visible Bob pointer |
| Live Canvas | Sandboxed live HTML/SVG/Mermaid rendering, hot reload, DOM inspection, visual comparison, and export |
| CodeGraph | Persistent symbol index, callers/callees, impact analysis, hybrid search, and contextual runtime suggestion |
| Maps | Structured geocoding, POI results, routing, pins, and conversation-native map cards |
| Memory | Native opt-in persistent project and user memory with semantic recall controls |
| Approvals | Native approval gates and persistent permission governance |
| Artifacts | Gallery, resizable preview panel, scrolling HTML content, Quick Look, and native opening |
| Internationalization | French, English, and Spanish UI; automatic system-locale selection |

## Technology stack

### Frontend: `apps/macos/src`

| Technology | Use |
|---|---|
| React 19 and TypeScript | Desktop user interface and type safety |
| Vite 7 | Development server and bundling |
| Zustand | Global application state |
| React Router | Navigation |
| CSS and Tailwind | Styling and layout |
| Framer Motion | Animation |
| Lucide React | Icons |
| react-markdown and GFM | Conversation Markdown rendering |
| xterm.js | Local and remote terminals |
| ECharts, Three.js, Plotly, Mermaid, Leaflet | Visualizations, 3D, diagrams, and maps |
| Tauri JavaScript APIs | Dialogs, filesystem, notifications, shell, opener, OS, and process access |
| Vitest and Testing Library | Unit and component tests |

### Backend: `apps/macos/src-tauri`

| Technology | Use |
|---|---|
| Tauri 2 | Native shell, IPC, windows, and tray |
| Rust 2021 | Product and security services |
| Tokio | Async execution and Bob processes |
| rusqlite | Local persistence |
| serde and serde_json | Typed serialization |
| AES-GCM | Local encrypted vault |
| reqwest | OAuth, remote APIs, and probes |
| cron | Scheduler |
| objc2 and UserNotifications | Native macOS capabilities |

### Shared packages

| Package | Responsibility |
|---|---|
| `@bob-work/shared-types` | Shared TypeScript contracts for settings, plugins, MCP, runtimes, SSH, and artifacts |
| `@bob-work/bob-adapter` | Bob detection and adapter helpers |
| `@bob-work/ui` | Shared UI primitives |

## Repository layout

```text
BobDesktop/
├── apps/
│   └── macos/
│       ├── src/
│       │   ├── components/          reusable React UI
│       │   ├── views/               application screens and settings tabs
│       │   ├── hooks/               integration and application behaviors
│       │   ├── lib/                 IPC, catalogs, maps, and utilities
│       │   ├── runtime/             shared rendering bridges
│       │   ├── stores/              Zustand state
│       │   └── i18n/                English, French, and Spanish catalogs
│       ├── src-tauri/
│       │   ├── src/
│       │   │   ├── commands/        Tauri command boundary
│       │   │   ├── services/        Bob, plugins, MCP, SSH, runtimes, security
│       │   │   ├── models/          serialized backend models
│       │   │   └── security/        validation and sandbox policy
│       │   └── resources/           built-in plugins, MCP servers, runtimes
│       ├── e2e/                     WebdriverIO specs and fixtures
│       └── scripts/                 build, release, and smoke-test utilities
├── packages/
│   ├── bob-adapter/
│   ├── shared-types/
│   └── ui/
├── docs/                             technical documentation
├── bobshell-install.sh
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

Repository-wide GitHub workflows live in `../.github/workflows/`, beside `BobDesktop/` and `BobMobile/`.

## Configuration and runtime data

### Environment file

Copy `apps/macos/.env.example` to `apps/macos/.env`. Common optional variables include:

| Variable | Purpose |
|---|---|
| `BOBWORK_OAUTH_GITHUB_CLIENT_ID` and `_SECRET` | GitHub OAuth |
| `BOBWORK_OAUTH_SLACK_CLIENT_ID` | Slack PKCE |
| `BOBWORK_OAUTH_MONDAY_CLIENT_ID` | Monday OAuth |
| `BOBWORK_OAUTH_MICROSOFT_CLIENT_ID` | Microsoft 365 PKCE |
| `FINNHUB_API_KEY` | Optional financial-data enrichment |
| `TMDB_API_KEY` | Optional API end-to-end tests |

The local OAuth redirect is `http://127.0.0.1:47823/oauth/callback`. Provider registration manifests live under `apps/macos/src-tauri/resources/oauth/`.

### Runtime data

| Location | Contents |
|---|---|
| Tauri application data for `com.bobwork.desktop` | SQLite database, encrypted vault, caches, previews, and managed state |
| `~/.bob/skills/` | Deployed skills and plugin bundles |
| `~/.bob/settings/` | Bob Shell MCP and settings files |
| `~/.bob/runtimes/` | Versioned external runtimes owned by Bob Work |

## Testing

### Workspace commands

| Command | Description |
|---|---|
| `pnpm mac:test:ts` | Frontend Vitest suite |
| `pnpm mac:test:rust` | Rust unit tests |
| `pnpm mac:test` | TypeScript and Rust tests |
| `pnpm mac:verify` | Typecheck, frontend tests, and Vite build |
| `pnpm mac:test:e2e` | Build the E2E application and run WebdriverIO |
| `pnpm mac:test:live-bob-oauth` | Live OAuth scenario |
| `pnpm mac:smoke:bob` | Smoke test against a real Bob Shell |
| `pnpm mac:ci` | Verification, Rust tests, and certified Release build |

### Frontend tests

```bash
pnpm mac:test:ts
# or
pnpm --filter macos test
```

Tests live beside source files as `*.test.ts` and `*.test.tsx` and cover views, components, connector forms, chat behavior, internationalization, catalogs, maps, and runtime behavior.

### Rust tests

```bash
pnpm mac:test:rust
# or
cargo test --manifest-path apps/macos/src-tauri/Cargo.toml
```

Rust tests cover Bob services, plugin and runtime management, MCP, SSH, sandbox policy, secrets, notifications, scheduling, remote control, and workspace operations. E2E-only features must never be enabled in production Release binaries.

### End-to-end tests

```bash
pnpm mac:test:e2e
```

The macOS E2E suite uses WebdriverIO, a dedicated Cargo `e2e` feature, and `VITE_BOB_WORK_E2E=1`. Fixtures include a deterministic fake Bob executable and local MCP/SSH test servers. GitHub retains packaged-application evidence for CI investigations.

### Real Bob Shell smoke test

```bash
export BOB_API_KEY=…
pnpm mac:smoke:bob
```

## CI and releases

| Workflow | Trigger | Responsibility |
|---|---|---|
| [verify.yml](../.github/workflows/verify.yml) | Push and pull request | TypeScript verification, Rust tests, clean certified Release application, E2E-symbol checks |
| [release.yml](../.github/workflows/release.yml) | Release workflow | Clean build, signing, notarization, bundle certification, updater artifacts |
| [smoke-bob-shell.yml](../.github/workflows/smoke-bob-shell.yml) | Tag or manual run | Install Bob Shell and execute a real authenticated smoke test |

The primary runner is `macos-latest`.

## Security

- Secrets are stored in a local AES-256-GCM vault and injected only into the child process that needs them.
- Logs and event streams redact known secret values.
- MCP manifests reject embedded literal secrets where environment placeholders or dedicated authentication are required.
- Personal MCP environment variables use structured key/value fields with backend name validation.
- Built-in MCP connectors are immutable from user settings.
- Plugin hooks receive a minimal environment without Bob or integration tokens.
- Filesystem paths are validated against authorized roots.
- Sandbox mode restricts disk and terminal access without claiming network isolation.
- Sensitive actions use native approval gates and persistent permission policies.
- OAuth connections report real provider state; the UI does not simulate a connected status.

See [docs/security-model.md](docs/security-model.md), [docs/keychain-security.md](docs/keychain-security.md), and [docs/security-exceptions.md](docs/security-exceptions.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/executive-summary.md](docs/executive-summary.md) | Product summary |
| [docs/product-requirements.md](docs/product-requirements.md) | Requirements and user stories |
| [docs/system-design.md](docs/system-design.md) | System design |
| [docs/bob-capability-matrix.md](docs/bob-capability-matrix.md) | Bob capability matrix |
| [docs/security-model.md](docs/security-model.md) | Threat model and controls |
| [docs/ui-specification.md](docs/ui-specification.md) | UI specification |
| [docs/runtime-architecture-v2.md](docs/architecture/runtime-architecture-v2.md) | Runtime ownership and lifecycle |
| [docs/terminal-sandbox.md](docs/architecture/terminal-sandbox.md) | Terminal isolation model |
| [docs/computer-use-autonomous.md](docs/architecture/computer-use-autonomous.md) | Autonomous Computer Use loop |
| [docs/persistent-memory-feature.md](docs/architecture/persistent-memory-feature.md) | Persistent memory design |
| [docs/release-macos.md](docs/release-macos.md) | Signing, notarization, and updates |
| [docs/test-report.md](docs/test-report.md) | Test report |
| [docs/limitations.md](docs/limitations.md) | Current guarantees and limitations |

## Known limitations

- The packaged desktop application currently targets macOS, with Apple Silicon DMG as the primary distribution.
- Local builds use ad-hoc signing; GitHub releases require configured Apple signing and notarization secrets.
- Web, Computer Use, Chrome, and remote capabilities depend on Bob Shell, connector availability, and macOS permissions.
- Closing the main window does not quit the application; the tray keeps the scheduler running.
- Sandbox mode restricts local filesystem/process scope but does not isolate the network.
- Some large optional runtimes require explicit installation or manual setup when no safe managed strategy exists.

## License

To be defined. This prototype and IBM Bob integration must be used according to your organization's policies and the applicable IBM Bob Shell terms.

## Acknowledgements

- IBM Bob and Bob Shell teams.
- The [Tauri](https://tauri.app/) project.
- The React, Rust, Vitest, WebdriverIO, and broader open-source communities.

## Document history

| Version | Date | Change |
|---|---|---|
| 0.1.0 | 2026-08-05 | Initial README |
| 0.1.4 | 2026-08-11 | Platform, installation, architecture, stack, tests, and CI refresh |
| Unified repository | 2026-09-06 | Moved under `BobDesktop/` and documented runtime and execution boundaries |
| English documentation | 2026-09-07 | Standardized every GitHub README in English |
