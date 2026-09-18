---
name: Plugin Creator
description: "Create or edit a personal Bob Work plugin (bundle ~/.bob/skills/<slug>/, V2 manifest, personal tagging) with the correct architecture and paths."
icon: plugin
user-invocable: true
---

# Plugin Creator (Bob Work)

Help the user **create or edit a personal Bob Work plugin** — an executable product (CLI, MCP, scripts, specialized mode), **not** a standalone SKILL.md only.

## When to use this skill

- Create: "create a plugin", "new plugin", `plugin_builder` mode
- Edit: "edit the plugin", "update the manifest", "add an MCP to the plugin", "integrate ffmpeg / mermaid / …"
- The UI wizard is **optional**: you can create the bundle directly from chat.

If the user wants **markdown instructions only** with no executable, route them to **skill-creator** (`@skill:skill-creator`).

## Language policy (mandatory)

Applies to **every** markdown file in the plugin bundle — root `SKILL.md`, nested `skills/*/SKILL.md`, and reference docs:

| Layer | Language | Rule |
|-------|----------|------|
| **Skill / plugin instructions** | **English only** | Author all SKILL.md bodies, headings, and reference docs in English. |
| **Plugin output** (deliverables, user-facing replies) | **User prompt language** | Write the entire output in the same language as the user's message that invoked the plugin or nested skill. |
| **Ambiguous prompt** | Main request sentence | Use the language of the sentence that states the task. |
| **Framework names** | Keep official names | Keep ADKAR, MECE, C4, OKR, etc.; add a brief translation in parentheses when helpful. |

Every nested skill under `skills/` must include a `## Language` section (same rules as skill-creator). When creating or editing nested skills, follow `@skill:skill-creator` language policy.

Manifest `description` and `resources[].notes` are user-benefit strings — write them in English; Bob Work localizes system status messages in the UI.

## Terminology (mandatory in user-facing replies)

Bob Work stores **both** personal skills and personal plugins under `~/.bob/skills/<slug>/`. That path alone does **not** mean "this is a skill".

| Product | Required files | Where it appears in the UI |
|---------|----------------|----------------------------|
| **Skill** (instructions only) | `SKILL.md` only | **Skills** |
| **Plugin** (executable product) | `SKILL.md` + `.bob-work-plugin.json` (+ entrypoints/scripts as needed) | **Plugins** |

When the user asks "why a plugin / why a skill":
1. Answer in their language in a short paragraph.
2. Point to the discriminating file (`.bob-work-plugin.json` present ⇒ plugin).
3. Do **not** recreate or rewrite the bundle just to answer.

Never say "I created a skill" if `.bob-work-plugin.json` exists. Never say "I created a plugin" if only `SKILL.md` exists.

## Personal scope (required)

| Element | Rule |
|--------|--------|
| Bundle root | `~/.bob/skills/<slug>/` only |
| Slug | `a-z`, `0-9`, single hyphens; same rules as Bob Work |
| Plugin id (UI) | `@plugin:<slug>` — Bob Work imports with id `agentic-<slug>` in **personal** registry |
| Markers | **Never** write `.bob-work-builtin` on a user plugin |
| `.bob-work-plugin-id` | Let Bob Work write it on import; if you must set it in dev, use `agentic-<slug>` — **never** `builtin-*` |
| Manifest category | `recipe`, `integration`, or `executable` — **`personal` is not a category** (personal scope is handled by Bob Work) |
| Existing built-ins | Do not recreate Word/Excel/PowerPoint/Documents/Computer Use/Chrome/GitHub/… already shipped by Bob Work |

## Quality bar (Work-level plugin)

A skill alone is **not** a plugin. Minimum:

1. `specializedMode` (label, tools, workflow)
2. At least one real surface: `entrypoints` CLI, bundle binary/shell, local MCP `mcp/`, or remote HTTPS MCP
3. Honest `permissions` (objects `{ "type": "…" }`)
4. Zero secrets in plain text (`${PLACEHOLDER}` or catalog OAuth)
5. When the user describes **business workflows** (multi-step procedures, triggers, approvals), declare them in top-level `workflows` as **Open Workflow Specification (Serverless Workflow) 1.0** documents — do **not** put those into `skills` or only into `specializedMode.workflow` prose

## User workflows (`workflows` — Open Workflow Specification)

Workflows are **user-facing procedures** the plugin offers. They are **not** skills (instruction docs) and **not** `scheduledTaskTemplates` (Bob Work schedule presets).

**Standard:** [Open Workflow Specification](https://open-workflow-specification.org/) (formerly CNCF Serverless Workflow), DSL **1.0.x**, JSON or YAML shape stored as JSON in the manifest.

### When to add `workflows`

| Situation | Action |
|-----------|--------|
| User describes one or more multi-step flows (fetch → analyze → draft → ask before send…) | Declare each as an Open Workflow document in `workflows[]` |
| User only wants a tool/CLI with no procedure | Omit `workflows` (empty or absent is fine) |
| Editing a plugin that has **no** workflows yet, and the user adds procedures | **Add** `workflows` in the bump — allowed and expected |
| Editing to change steps / triggers | Update existing documents; keep stable `document.name` when possible |

### Schema (Open Workflow DSL 1.0)

Write in `.bob-work-plugin.json`:

```json
"workflows": [
  {
    "document": {
      "dsl": "1.0.0",
      "namespace": "bob.work.plugins",
      "name": "weekly-sales-review",
      "version": "1.0.0",
      "title": "Weekly sales review",
      "summary": "Detect anomalies in sales files and prepare a shareable deck."
    },
    "schedule": { "cron": "0 9 * * 1" },
    "do": [
      {
        "collect": {
          "run": { "shell": { "command": "python3", "arguments": ["scripts/collect.py"] } },
          "metadata": { "description": "Collect sales files" }
        }
      },
      {
        "analyze": {
          "set": { "phase": "analyze" },
          "metadata": { "description": "Detect anomalies" }
        }
      },
      {
        "draft": {
          "call": "http",
          "with": { "method": "post", "endpoint": { "uri": "https://example.com/draft" } },
          "metadata": { "description": "Draft presentation" }
        }
      },
      {
        "confirm": {
          "set": { "awaitApproval": true },
          "metadata": { "description": "Ask before sending" }
        }
      }
    ]
  }
]
```

| Field | Required | Notes |
|-------|----------|-------|
| `document.dsl` | yes | Must be `1.x` (prefer `1.0.0`) |
| `document.namespace` | yes | e.g. `bob.work.plugins` or plugin slug namespace |
| `document.name` | yes | Stable workflow id |
| `document.version` | yes | SemVer of this workflow document |
| `document.title` / `summary` | recommended | Shown in Plugins detail |
| `do` | yes | ≥1 task; each item is `{ "<taskName>": { … } }` |
| Task body | yes | OWS task: `call`, `run`, `set`, `switch`, `fork`, … |
| `metadata.description` | recommended | Human step blurb in the UI |
| `schedule.cron` / `every` / `on` | optional | OWS schedule; cron when the user asked for a recurring flow |

Limits enforced by Bob Work: ≤32 workflows, ≤32 tasks each. Full schema: https://github.com/open-workflow-specification/specification

Bob Work shows workflows in the plugin **Description** panel when present. Keep the top-level `description` string as 1–2 benefit sentences (no step dump there).

Do **not** invent workflows the user did not ask for. Do **not** replace skills with workflows — a plugin can have both. Do **not** use the removed proprietary `bob-work.workflow/v1` shape.

## File layout (do not invent other folders)

```
~/.bob/skills/<slug>/
  SKILL.md
  .bob-work-plugin.json
  scripts/          # python3, bash, sh, zsh, node wrappers
  bin/
  vendor/<tool>/<version>/bin/
  mcp/
  skills/           # optional nested skills (SKILL.md each, English + ## Language)
```

## Runtime Architecture V2

- Local Office: `docx` → shared **python-docx** runtime; `pptx` → **python-pptx**; `xlsx` → **openpyxl** — declare in `sharedCapabilities`, **do not** pip-install these libs in the bundle
- Generic capability (python, visualization, diagram, artifact) → `sharedCapabilities` — **do not copy** D2/Mermaid/ECharts into the bundle
- Optional heavy framework → `externalRuntimes`
- Plugin-specific dependency → `privateDependencies` with **V2 shape only**:
  `{ "id", "kind": "binary|cli|native|python|node|wasm", "entrypoint": "vendor/… or scripts/…", "version", "source": { "kind", "location" }, "sha256"? }`
- **Forbidden** (silently blocks Plugins import): `{ "name": "Pillow", "source": "pypi", "version": ">=…" }` — that is not a valid privateDependency
- Prefer `sharedCapabilities: ["python", "artifact", …]` when Bob Work already provides the capability; do not invent a PyPI shorthand
- The model **does not download** via curl/pip/global npm/brew; Bob Work Runtime Manager resolves installs

## `.bob-work-plugin.json` contract

- `bobWorkImportConsent`: **`true`** (required) — Bob Work only auto-imports new personal plugins when this flag is set. Also write an empty `.bob-work-import-ok` file next to the manifest.
- `category`: `recipe` | `integration` | `executable`
- `permissions`: `[{ "type": "command.execute" }, …]` — never a bare string array
- `entrypoints`: `[{ "name": "…", "runtime": "python3|bash|sh|zsh|node|binary", "path": "scripts/…" }]`
- Forbidden in entrypoints: keys `type`, `command`, `args`
- `description`: user benefit — **not** the connector list (those go in `resources` + `connectorStrategy`)
- `workflows` (optional): Open Workflow Specification 1.0 documents — see **User workflows** above. Omit when the user did not describe any.
- `icon`: HTTPS favicon or Bob key (`plugin`, `word`, `github`, …) — never leave empty when a domain is identifiable
- `skills`: prefer objects `[{ "name", "displayName", "description", "path": "skills/<id>/SKILL.md" }]`. String paths (`"skills/<id>/SKILL.md"`) or bare names are accepted and normalized on import. Always create nested files under `skills/<id>/SKILL.md`.
- `resources`: array `{ "kind", "label", "optional", "notes", … }` — see **Resource kinds** below

## Resource kinds (`resources[].kind`)

Each entry describes **what the plugin consumes**, not a generic alias. Bob Work shows the type in Plugins → Sources; system status strings are canonical English and localized by the UI.

| `kind` | When to use | Useful fields |
|--------|-------------|---------------|
| `bundled-python` | Python script **in the bundle** (`scripts/…`, `skills/…/scripts/…`) | `script` (relative path), `notes` |
| `bundled-bin` | **Embedded** binary in `bin/` or `vendor/` | `command`, `package`, `installHint` |
| `shell` | bash/sh/zsh wrapper in the bundle | `script` or shell entrypoint |
| `node-cli` | Node CLI in the bundle | `script`, entrypoint `runtime: node` |
| `stdio-cli` | **External** CLI on the Mac (brew, global pip, PATH binary) — **not** a bundle Python script | `command`, `package`, `installHint` |
| `host-cli` | Optional system command (`dot`, `ffmpeg`, …) | `command`, `optional: true` |
| `shared-runtime` | Bob Work capability (`shared.python`, `shared.diagram`, `shared.docx`, …) | `runtimeId`, `notes` |
| `bundled-assets` | Indexed static data (icons, catalogs, file sets) | `notes` |
| `external-runtime` | Heavy runtime managed by Runtime Manager | `runtimeId`, `installHint` |
| `mcp` | Local bundle MCP or remote server | `mcpServer`, `provider`, `env` |
| `oauth` / `api-key` / `api-public` | Catalog connectors or APIs | `provider`, `env` |
| `web-search` / `bob-llm` / `computer-use` / `chrome` | Global Bob Work capabilities | `notes` |
| `web-reference` | Documentation link (no connection) | `url`, `label` |
| `database` | `@db:` Bob Work connection | `provider`, notes |

**Rules:**
- A Python script **in the plugin** → `bundled-python`, **never** `stdio-cli`.
- `stdio-cli` = tool **installed on the machine** (e.g. `docling`, `mermaid-cli`), not bundle code.
- Shared runtimes (D2, Mermaid, python-docx, …) → `shared-runtime` + `sharedCapabilities` — do not copy them into the bundle.
- `notes` describe user benefit; generic status messages (missing Python, CLI detected, …) are handled and localized by Bob Work.

## Connector exploration (before writing)

Document what you explore, then keep only what is relevant:

1. Bob shared capabilities (Python, Visualization, Diagram, Artifact)
2. Catalog OAuth (GitHub, Slack, Monday, Microsoft…)
3. Bundle local MCPs and Bob Work global MCPs
4. Public APIs / API keys
5. Remote HTTPS MCP
6. Bob web search (if enabled)
7. Bob LLM (always available in chat)
8. Computer Use / Chrome (if enabled in Settings)
9. `@db:` databases — Bob Work stores the connection in the vault; **never** put passwords in the bundle

## Databases

If the user provides a DB URL or credentials: Bob Work registers them in Integrations → DB and links to the plugin. Declare `resources` kind `database`. Optional temporary `.bob-work-db.json` in the bundle — Bob Work imports then **deletes** the file.

## Edit workflow

1. Read `SKILL.md`, `.bob-work-plugin.json`, and existing entrypoints.
2. Bump `version` (SemVer) on material changes.
3. **Bob Work auto-applies** the new version on the next Plugins sync (startup or after the chat task). No « Mettre à jour » click — `~/.bob/skills/<slug>/` stays the editable source of truth. Old versions are not kept for rollback.
4. Do not break slugs/@plugin mentions without agreement.
5. Validate each entrypoint (file exists, safe relative path).
6. Run local entrypoints to verify before announcing success.
7. When editing nested skills, ensure English authoring + `## Language` output section.
8. Keep the authored `SKILL.md` as-is (no deploy policy jargon in the description/body).
9. **Workflows**: if the user adds or changes procedures, create/update `workflows` as Open Workflow Specification 1.0 documents (`document` + `do`). A plugin without workflows may gain them in a later edit — that is a normal, supported modification.

## Success message

Success **only** if:

- Files written and manifest conforms to Bob Work import contract
- First import: `bobWorkImportConsent: true` **or** empty `.bob-work-import-ok` (either is enough)
- No `.bob-work-import-error` file (if present, read it, fix, and re-sync — do not claim Plugins import succeeded)
- `privateDependencies` is either empty or uses the V2 `id`/`kind`/`entrypoint` shape (never `source: "pypi"`)
- Local entrypoints tested
- Bob Work **auto-imports / auto-updates** the bundle into **Plugins** — no manual activation or Update click

Announce clearly in the user's language, for example:

> I created the **plugin** `@plugin:<slug>` (not a skill-only file). Bundles live under `~/.bob/skills/<slug>/`; `.bob-work-plugin.json` is what makes it a plugin. Open **Plugins** to manage it.

End with a **Design choices** section: resources kept vs dropped, permissions, limits.

## Forbidden

- Folders outside the schema (arbitrary unmapped `src/`, `lib/`)
- Impersonating a built-in plugin (`builtin-*`, `.bob-work-builtin`)
- Secrets in plain text in SKILL.md or manifest
- Two plugins for the same slug as a Bob Work built-in
- Nested or root SKILL.md authored in a language other than English
- Shipping a personal plugin without `bobWorkImportConsent: true` or `.bob-work-import-ok`
- Claiming success if Plugins still shows an older version or an Update button for this bump
- Claiming success if `.bob-work-import-error` appears next to the bundle (Bob Work wrote the import failure there — fix the manifest and retry)
- Using `{ "name", "source": "pypi" }` in `privateDependencies` (invalid; blocks import)
