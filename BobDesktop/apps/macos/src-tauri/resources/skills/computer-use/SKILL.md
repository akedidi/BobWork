---
name: Computer Use
description: "Inspect and operate local desktop app windows through Bob Work's computer-use MCP — accessibility trees, screenshots, and safe UI actions."
icon: computer
user-invocable: true
---

# Computer Use

This file is a **discovery stub**, not the usage guide. The full, version-matched reference is
served by the **Bob Work MCP runtime** `bob-work-computer-use` — kept out of this file on purpose
so it can never drift from the server that will actually run your commands.

Engage Computer Use whenever you must inspect or operate a **local desktop app window** — reading
its accessibility tree, taking screenshots, or performing safe UI actions (click controls, type,
press keys, scroll, drag, set values). It also covers browser windows, webviews, and native app UI
**outside** Orca's embedded browser. Triggers include "computer use", "read Spotify", "read Slack",
"control/click/read in a desktop app", and "get app state".

Use `@skill:orca-cli` instead when the task touches Orca-managed worktrees, terminals, handoffs, or
Orca's built-in browser. Use `@plugin:bob-work-chrome-control` for Google Chrome tabs and in-page JS.

## Prerequisites (Bob Work)

1. **Settings → Extensions → Computer Control** must be enabled.
2. MCP `bob-work-computer-use` must be active (Bob Work registers it when Computer Control is on).
3. **Accessibility** must be granted for Bob Work.

If any prerequisite is missing, tell the user what to enable — do not guess MCP tools or spawn
`osascript` / Terminal workarounds.

## Load the full guide before running MCP tools

Call the MCP tool **`get_computer_use_guide`** on server **`bob-work-computer-use`** (via
`use_mcp_tool` / Bob Shell MCP integration).

That returns the complete, version-matched guide for the exact runtime bundled with this Bob Work
installation — listing apps/windows, reading UI, and driving clicks, typing, and other actions.
**Read it first**, then run the specific tool you need.

Do not guess tool parameters or workflows from memory or from a cached copy of this stub. Confirm
access with `accessibility_status`, then follow the guide's observe → act → verify loop.

## If the guide tool is unavailable

Use this fallback **only** when `get_computer_use_guide` explicitly fails because the MCP server
is missing or Computer Control is disabled:

1. Ask the user to enable **Computer Control** in Bob Work Settings → Extensions.
2. Run these bounded, read-only bootstrap tools if MCP is otherwise reachable:

```text
accessibility_status
list_apps
get_app_state
```

Then retry `get_computer_use_guide`. Beyond these commands, ask the user rather than inventing a
command surface the runtime may not support.

## Language

- Write the **skill file** in English.
- Write review summaries and user-facing explanations in the **same language as the user's prompt**.
- Keep tool names, MCP server names, file paths, and JSON field names unchanged.
