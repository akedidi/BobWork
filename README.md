# Bob Work

Bob Work brings the macOS desktop application and its mobile client together in one repository. The directory containing the clone is not an additional repository level: `BobDesktop/`, `BobMobile/`, and this README are versioned directly at the Git root.

## Repository layout

```text
Git root
├── BobDesktop/              macOS application, local backend, and runtimes
│   ├── apps/macos/          React frontend and Tauri/Rust shell
│   ├── packages/            shared desktop types and components
│   ├── docs/                architecture, security, and operations
│   └── README.md            complete desktop guide
├── BobMobile/               Expo client for iOS and Android
│   ├── src/                 screens, remote API, and application state
│   ├── assets/              visual resources
│   └── README.md            complete mobile guide
├── .github/workflows/       verification, release, and smoke tests
└── README.md                product overview
```

The two projects keep separate dependency managers: **pnpm** for BobDesktop and **npm** for BobMobile. They are not a single Node workspace.

## Product architecture

```text
┌──────────────────── BobMobile ────────────────────┐
│ React Native / Expo                               │
│ conversations · projects · files · settings       │
│ opt-in location · notifications · SSE             │
└───────────────────────┬───────────────────────────┘
                        │ authenticated HTTPS
                        │ REST + Server-Sent Events
                        ▼
┌──────────────────── BobDesktop ───────────────────┐
│ React / TypeScript / Vite                         │
│ chat · previews · plugins · integrations          │
├───────────────────────┬───────────────────────────┤
│ Tauri IPC             │ mobile API / MCP gateway │
├───────────────────────▼───────────────────────────┤
│ Rust backend                                      │
│ services · permissions · scheduler · SQLite       │
│ local vault · artifacts · runtime management      │
└───────────┬───────────────────────┬───────────────┘
            │ bob run              │ stdio / HTTP
            ▼                      ▼
┌────────────────────┐   ┌─────────────────────────┐
│ IBM Bob Shell      │   │ MCP · APIs · SSH        │
│ agent · modes      │   │ specialized tools       │
│ skills · sessions  │   │ remote systems          │
└────────────────────┘   └─────────────────────────┘
```

BobDesktop is the source of truth. It runs Bob Shell, stores SQLite history, enforces permissions, and manages local resources. BobMobile is a remote client: it does not duplicate the conversation database and uses the authenticated API exposed by the Mac.

## Runtime architecture

A plugin describes a product capability; a runtime supplies the executables and libraries required to run that capability. These concepts remain separate.

```text
                          user request
                               │
                               ▼
                     selected plugin / tool
                               │
                       capability resolution
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
       shared runtime    managed external   private runtime
       bundled/reused    optional runtime   explicitly bundled
       by Bob Work       managed by Bob     by a personal plugin
              │                │                │
              └────────────────┴────────────────┘
                               │
                    controlled local process
                  timeout · environment · logs
```

| Class | Example | Lifecycle |
|---|---|---|
| Shared | visualization, diagrams, artifacts, compatible Python | Shared by multiple capabilities; not removable when it belongs to the application core |
| Managed external | isolated Qiskit or CodeGraph | Suggested only when a task needs it; installed, integrity-checked, and removable when the strategy is supported |
| Plugin private | dependency explicitly bundled by the author of a personal plugin | Deployed with that plugin and isolated from the shared platform |

External dependencies that cannot be managed safely remain detectable and documented. Bob Work then asks for manual installation instead of silently taking ownership of a system runtime.

## Quick start

### BobDesktop

```bash
cd BobDesktop
pnpm install
pnpm dev
```

Main requirements: macOS 12+, Node.js 22, pnpm 10, stable Rust, and IBM Bob Shell available on `PATH`.

### BobMobile

```bash
cd BobMobile
npm install
npm start
```

Then open Bob Work on the Mac, enable **Settings → Remote Control**, and use the secure link in BobMobile.

## Verification commands

```bash
# Desktop
cd BobDesktop
pnpm mac:verify
pnpm mac:test:rust

# Mobile
cd ../BobMobile
npm run typecheck
npm run test:i18n
npm run test:visualization
npm run test:maps
```

## Detailed documentation

- [BobDesktop architecture and development](BobDesktop/README.md)
- [BobMobile architecture and development](BobMobile/README.md)
- [Desktop technical documents](BobDesktop/docs/)

## Security overview

- Secrets remain on the Mac in the local encrypted vault.
- The mobile API uses a revocable bearer token controlled by Remote Control.
- Sensitive actions follow Bob Work permission and approval policies.
- Local sandbox mode can restrict disk access.
- Current location is disabled by default and used only after explicit consent.
- Secrets and `.env` files must never be committed.

## Contributing

Work inside the relevant project directory, run that project's tests, and update its README whenever architecture, commands, or runtime lifecycles change. Root GitHub workflows currently verify and publish BobDesktop.
