# Bob Work Computer Use — runtime guide

Version: 1.0.8 · MCP server: `bob-work-computer-use` · Platform: macOS

This guide is served by the MCP tool `get_computer_use_guide`. It always matches the
bundled runtime under `~/.bob/resources/computer/`.

## Prerequisites

1. **Settings → Extensions → Computer Control** enabled (not available in sandbox mode).
2. MCP `bob-work-computer-use` registered and enabled (Bob Work syncs this automatically).
3. **Accessibility** granted for Bob Work (System Settings → Privacy & Security → Accessibility).
4. **Screen Recording** granted when you need `capture_screen`.

Call `accessibility_status` first. If access is denied, ask the user to grant Accessibility
to Bob Work and retry — do not spawn `osascript`, `python3`, or Terminal workarounds.

## Bob Work vs target apps

- Stay in Bob Work. Do **not** steal focus unless the user explicitly asks or a tool requires it.
- Bob shows an independent blue **Bob cursor** during actions. It moves to each target and hides
  after ~12 s of inactivity.
- Do **not** click inside Bob Work / chat UI. Do **not** use Chrome preview tools for native Mac apps.
- AppleScript runs through Bob Work's bridge (`BOB_WORK_APPLESCRIPT_SOCKET`), not `/usr/bin/osascript`.
- **Never** create or edit a plugin/skill under `~/.bob/skills/` while handling a Computer Use
  request. Execute the user ask with the target app tools only. Authoring a plugin or skill is
  allowed only when the user explicitly asked for that (e.g. « crée un plugin ») — not because
  they said « crée » a note, list, or file inside another app.

## Background-first workflow

1. `accessibility_status` — confirm permissions.
2. `list_apps` — find the target app if needed.
3. `open_app` with **`activate: false`** (default) — launch without focus steal.
4. `get_app_state` — read window title, frontmost flag, accessibility tree.
5. Act with **`ui_click`**, **`ui_set_value`**, or **`app_command`** while the app stays in background.
6. **`focus_app`** or `bring_to_front: true` only as last resort (global keyboard, hidden window).
7. Re-observe with `get_app_state` after each action. Stop when the goal is met, the user refuses,
   three observations show no progress, or the tool reports a limit.

## Tool reference

### Read-only / setup

| Tool | Purpose |
|------|---------|
| `get_computer_use_guide` | Return this guide (call before first action). |
| `accessibility_status` | Check Accessibility permission state. |
| `list_apps` | Installed apps and/or running UI processes. |
| `get_app_state` | AX tree snapshot for an app (no focus change). |
| `capture_screen` | Visual screenshot (max **10** per task). |

### App control

| Tool | Purpose |
|------|---------|
| `open_app` | Open app via `open -g`. Set `activate: true` only when user requests focus. |
| `focus_app` | Bring app to front — last resort. |
| `app_command` | Run AppleScript inside `tell application "<app>"`. |

### UI actions (prefer these)

| Tool | Purpose |
|------|---------|
| `ui_click` | Click AX element by label/role without focus steal. |
| `ui_set_value` | Set text field value via Accessibility. |

### Coordinate / keyboard fallback

| Tool | Purpose |
|------|---------|
| `desktop_click` | Click at screen coordinates. Use `bring_to_front: true` only if required. |
| `desktop_type` | Type text globally. Pass `app` + `bring_to_front: true` when keyboard must reach a specific app. |
| `desktop_scroll` | Scroll at coordinates. |
| `press_key` | Send key with optional modifiers. |

## Limits and approvals

- Max **20** guarded actions per task (`ui_click`, `ui_set_value`, `app_command`, desktop tools, `press_key`).
- Max **10** `capture_screen` calls per task.
- Guarded actions may require user approval in Bob Work chat.
- If the AX tree is sparse, one `capture_screen` without focus may help — then return to AX tools.

## Parameter tips

- **`app`**: display name (`Telegram`, `Slack`) or `.app` path.
- **`label` / `role`**: match AX title, description, or role (`AXButton`, `AXTextField`, …).
- **`bring_to_front`**: default false. Set true only when indispensable.
- **`activate`** on `open_app`: default false.

## When to use Chrome Control instead

Use plugin `@plugin:bob-work-chrome-control` for Google Chrome tabs, navigation, and in-page
JavaScript — not Computer Use.

## When to use Orca CLI instead

Use `@skill:orca-cli` for Orca-managed worktrees, terminals, handoffs, and Orca's embedded browser.
Use `@skill:computer-use` (this MCP) for native desktop apps, external browser windows, and webviews
outside Orca's embedded browser.
