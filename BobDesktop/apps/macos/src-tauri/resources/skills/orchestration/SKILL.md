---
name: Orchestration
description: "Coordinate multi-agent work in Orca — threaded messages, task dispatch, DAGs, decision gates, and coordinator loops."
icon: plugin
user-invocable: true
---

# Orchestration

This file is a **discovery stub**, not the usage guide. The full, version-matched Orca
orchestration reference is served by the **`orca` binary itself** — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Orca orchestration whenever you need **structured multi-agent coordination**: threaded
messages, blocking ask/reply flows, task dispatch, `worker_done` / escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents.

Use `@skill:orca-cli` instead for **full ownership handoffs** ("hand off", "handoff", "handover",
"give this to another agent", "another worktree") when the user did **not** ask to supervise,
monitor, wait for results, or coordinate a DAG — and for ordinary terminal control, shell
commands, worktree management, and Orca's built-in browser.

Use `@skill:computer-use` for browser windows, webviews, or desktop UI **outside** Orca's
embedded browser.

Coordination requires real Orca runtime state; never substitute a non-Orca subagent tool.

## Orca must be installed

If Bob Work reports that Orca CLI is **not installed**, tell the user to install Orca and ensure
the `orca` command is on PATH, then retry.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If `ORCA_CLI_COMMAND` is set, use its value.
- Otherwise, in a dev checkout with `ORCA_DEV_REPO_ROOT`, use `orca-dev`.
- Otherwise, on Linux outside an Orca-managed terminal, use `orca-ide` (never bare `orca`).
- Otherwise, use `orca`.

Below, `ORCA` is a placeholder for the executable you resolved.

If the selected executable cannot run, report its exact error and stop. Do not fall through to
another executable.

## Load the full guide before running Orca commands

```text
ORCA skills get orchestration
```

That prints the complete, version-matched guide — task creation and dispatch, lifecycle preambles,
`worker_done` authority, decision gates, and coordinator loops. Read it first, then run the
specific command you need.

Confirm the app is up with `ORCA status --json` (start with `ORCA open --json` if needed), and
prefer `--json` for agent-driven calls.

## If an older Orca does not recognize `skills get`

```text
ORCA status --json
ORCA orchestration task-list --json
ORCA terminal list --json
```

Then tell the user that updating Orca restores the full guide via `ORCA skills get orchestration`.

## Language

- Write the **skill file** in English.
- Write user-facing explanations in the **same language as the user's prompt**.
- Keep CLI command names and JSON field names unchanged.
