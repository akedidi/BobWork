---
name: Orca CLI
description: "Operate Orca-managed worktrees, terminals, repos, automations, and Orca's embedded browser via the public orca CLI."
icon: plugin
user-invocable: true
---

# Orca CLI

This file is a **discovery stub**, not the usage guide. The full, version-matched Orca CLI
reference is served by the **`orca` binary itself** — kept out of this file on purpose so it
can never drift from the binary that will actually run your commands.

Engage Orca whenever its running editor/runtime is the source of truth: Orca-managed worktrees,
folder contexts, terminals, repos, automations, worktree comments, and the browser embedded
inside the Orca app. Triggers include "$orca-cli", "use orca cli", "Orca worktree", "child worktree",
"spawn an agent in a worktree", "read/wait/send Orca terminal", "full handoff", "handover",
"give this to another agent", "another worktree", and "control the browser inside Orca".

Use plain shell tools when Orca state does not matter. Use `@skill:computer-use` for native desktop
apps and browser windows **outside** Orca's embedded browser.

## Orca must be installed

If Bob Work reports that Orca CLI is **not installed**, tell the user to install Orca and ensure
the `orca` command is on PATH, then retry. Do not substitute Bob Work MCP or git worktree commands
when the user asked for Orca-managed state.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If `ORCA_CLI_COMMAND` is set, use its value (Orca exports this for managed WSL sessions).
- Otherwise, in a dev checkout whose session exposes `ORCA_DEV_REPO_ROOT`, use `orca-dev`.
- Otherwise, on Linux outside an Orca-managed terminal, use `orca-ide`. **Never** run bare `orca`
  there — outside Orca's terminals it normally resolves to the GNOME Orca screen reader
  (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `orca`.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before running
anything; do not create a shell variable or run `ORCA` literally.

If the selected executable cannot run, report its exact error and stop. Do not fall through to
another executable, which could silently target a different Orca build.

## Load the full guide before running Orca commands

```text
ORCA skills get orca-cli
```

That prints the complete, version-matched guide for the exact binary that will handle your next
commands — worktrees, handoffs, terminals, automations, and the built-in browser. Read it first,
then run the specific command you need.

Do not guess subcommands or flags from memory or from a cached copy of this stub. Confirm the app
is up with `ORCA status --json` (start it with `ORCA open --json` if needed), and prefer `--json`
for agent-driven calls.

## If an older Orca does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an unknown
command:

```text
ORCA status --json
ORCA worktree ps --json
ORCA terminal list --json
```

Then tell the user that updating Orca restores the full guide via `ORCA skills get orca-cli`.
Beyond these commands, ask the user rather than guessing.

## Language

- Write the **skill file** in English.
- Write user-facing explanations in the **same language as the user's prompt**.
- Keep CLI command names, flags, and JSON field names unchanged.
