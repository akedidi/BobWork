# BobMobile

BobMobile is the iOS and Android client for Bob Work. It lets users monitor and control from a phone the Bob Shell engine that continues to run on their Mac.

The desktop remains the source of truth. BobMobile does not maintain a second conversation database or independent copies of projects, plugins, and permissions.

## Features

- Conversations, projects, and history synchronized from BobDesktop.
- Bob response and activity streaming through Server-Sent Events.
- Start, stop, resume, and approve tasks.
- Select authorized modes, plugins, skills, MCP servers, APIs, and databases.
- Attachments, voice messages, generated files, and HTML previews.
- Interactive maps, multiple points of interest, and routes.
- Opt-in current location that can be used as a route origin.
- Push notifications and unread-conversation indicators.
- Archived chat management.
- French, English, and Spanish user interface.

![BobMobile conversation list](docs/images/conversations.png)

## Architecture

```text
┌────────────────────────── Expo application ───────────────────────┐
│ App.tsx                                                           │
│ navigation across conversations, projects, activity, files,      │
│ and settings                                                      │
├───────────────────────────────────────────────────────────────────┤
│ Screens                           Components                       │
│ ChatScreen                       prompt / modals / maps            │
│ ConversationsScreen              WebView previews / Markdown      │
│ ProjectsScreen                   status bars / selectors          │
│ FilesScreen · SettingsScreen                                     │
├───────────────────────────┬───────────────────────────────────────┤
│ AppContext                │ BobApi                                │
│ session · memory cache    │ REST JSON · uploads · SSE             │
│ locale · network state    │ bearer token                          │
├───────────────────────────▼───────────────────────────────────────┤
│ SecureStore: link and token          Expo modules:                │
│ no local business database           location · audio · files     │
└───────────────────────────┬───────────────────────────────────────┘
                            │ HTTPS
                            ▼
                    BobDesktop remote API
                            │
                    SQLite · Bob Shell · MCP
```

### Conversation flow

```text
mobile prompt
    │ POST /conversations/:id/messages
    ▼
BobDesktop starts Bob Shell
    │ SSE events: text, activity, task, approval
    ▼
BobMobile updates the screen
    │ GET /messages and /sync
    ▼
final state reloaded from the Mac SQLite database
```

REST refreshes always reconcile the interface with the persistent state on the Mac. SSE events make updates immediate, but they are not a second source of truth.

## Maps and location

`kind: "bob-map"` results produced by desktop mapping tools are detected in persisted activities and displayed in a WebView map:

- Numbered red pins for places and points of interest.
- A/B markers for routes.
- A blue dot reserved exclusively for the current device location.
- Automatic route rendering and framing of every visible point.

Location is disabled by default. Enabling **Settings → Current Location** requests foreground system permission and sends the coordinate to the connected BobDesktop. Disabling it clears the desktop-side coordinate. The application never requests background location access.

## Connecting to BobDesktop

1. Open Bob Work on the Mac.
2. Go to **Settings → Remote Control**.
3. Enable Remote Control and wait until it is ready.
4. Copy the secure link and paste it into BobMobile.

The token is stored in the URL fragment, persisted through SecureStore, and sent as a bearer token. Disabling or recreating Remote Control revokes the previous link.

## Requirements

- Node.js 22 recommended.
- npm.
- Xcode and an iOS Simulator for iOS development on macOS.
- Android Studio for an Android emulator.
- A reachable BobDesktop instance for real end-to-end scenarios.

## Installation and development

From the Git root:

```bash
cd BobMobile
npm install
npm start
```

Additional commands:

```bash
npm run ios       # generate/build native files and launch iOS
npm run android   # generate/build native files and launch Android
npm run web       # development web client
npm run mock      # local simulated server
```

Development-only automatic connection can use the documented Expo variables in a local `.env` file. Never commit a connection link or token.

## Project layout

```text
BobMobile/
├── App.tsx                    main navigation
├── src/
│   ├── api.ts                 authenticated REST client
│   ├── context/AppContext.tsx connection, synchronization, and SSE
│   ├── screens/               product screens
│   ├── components/            reusable UI and map components
│   ├── types.ts               remote contracts
│   ├── i18n.ts                fr/en/es catalogs
│   └── visualizationHtml.ts   HTML preview hardening
├── assets/                    images and icons
├── locales/                   localized native metadata
├── scripts/                   mock server and release utilities
├── app.json                   Expo configuration and permissions
└── package.json
```

`ios/`, `.expo/`, `dist/`, `build/`, `.release/`, and `node_modules/` are reproducible local outputs and are not versioned.

## Clean iOS releases

```bash
npm run ios:release:simulator  # unsigned Release binary for local validation
npm run ios:release:archive    # signed device archive for distribution
```

The release routine removes project-local Expo and Xcode outputs, completely regenerates `ios/` with `expo prebuild --clean`, and builds into isolated DerivedData under `.release/`. Final certification validates the version and bundle identifier, rejects Dev Client, Metro, development-screen markers, source maps, and preview libraries, and confirms that required native modules such as `ExpoLocation` are linked into the binary. This prevents an outdated iOS project or CocoaPod from surviving after JavaScript dependencies change.

## Tests

```bash
npm run typecheck
npm run test:i18n
npm run test:markdown
npm run test:visualization
npm run test:maps
npm run doctor
```

Before shipping, validate at minimum a real Mac connection, prompt submission, an approval, opening an artifact, and enabling/disabling location on a simulator or physical device.

## Security and privacy

- The connection token is stored in SecureStore.
- Integration secrets remain on BobDesktop.
- HTML previews block unauthorized navigation.
- Photo, microphone, notification, and location permissions are requested only when needed.
- Location is never enabled in the background.
- Signing out removes the local mobile session; disabling Remote Control revokes access on the Mac.

## Troubleshooting

- **Expired link:** recreate the link in BobDesktop and reconnect BobMobile.
- **History unavailable:** confirm that BobDesktop is running and that its tunnel is ready.
- **Location denied:** re-enable BobMobile permission in iOS or Android settings, then tap *Refresh*.
- **Native modules added:** rerun `npm run ios` or `npm run android`; an Expo refresh alone may be insufficient.
- **Blank preview:** check network access to authorized resources and inspect Metro/WebView logs.
