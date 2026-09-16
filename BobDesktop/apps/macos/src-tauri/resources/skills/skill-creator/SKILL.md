---
name: Skill Creator
description: "Create or edit a personal Bob Work skill (SKILL.md) in the right location, with correct frontmatter and personal scope — never an agentic plugin."
icon: plugin
user-invocable: true
---

# Skill Creator (Bob Work)

Help the user **create, edit, or import** a **personal Bob Work skill**. A skill is local markdown instructions — **not** an agentic plugin (no MCP/CLI/binary required in the bundle).

## When to use this skill

- Create: "create a skill", "new skill", "personal skill", `skill_builder` mode
- Edit: "edit the skill", "update SKILL.md", "improve the skill", "fix the skill"
- Import: "import a skill from GitHub", "pull a SKILL.md from a repo"

If the user needs **executable tools** (CLI, MCP, scripts, plugin manifest), route them to **plugin-creator** (`@skill:plugin-creator`) — not this skill.

## Terminology (mandatory in user-facing replies)

| Product | Files | UI |
|---------|-------|----|
| **Skill** | `SKILL.md` only under `~/.bob/skills/<slug>/` | **Skills** |
| **Plugin** | Same folder **plus** `.bob-work-plugin.json` | **Plugins** |

The shared path `~/.bob/skills/` is a storage location for bundles — it does not mean every folder there is a skill. If the user asks why you created a skill vs a plugin, answer in their language without rewriting files.

## Language policy (mandatory)

Bob Work skills follow a **single authoring language** and **localized output**:

| Layer | Language | Rule |
|-------|----------|------|
| **Skill file** (`SKILL.md`) | **English only** | Frontmatter, headings, instructions, examples, and comments in the skill body must be written in English. |
| **Skill output** (deliverables, replies, documents) | **User prompt language** | Write the entire output in the same language as the user's message that invoked the skill — title, headings, labels, tables, and body text. |
| **Ambiguous prompt** | Main request sentence | If the prompt mixes languages, use the language of the sentence that states the task — not the source document language alone. |
| **Mixed output** | Forbidden | Never mix languages in a single deliverable unless the user explicitly asks for bilingual output. |
| **Framework names** | Keep official names | Keep official framework names (ADKAR, MECE, C4, OKR, …) and add a brief translation in parentheses when helpful in the output language. |

Every skill you create or edit **must** include a `## Language` section with the output rules above (adapt examples to the skill's deliverable type).

When clarifying with the user, ask about **goal and format** — not which language to write the skill in (always English).

## Personal scope (required)

Skills you create or edit for the user are **personal**:

| Element | Rule |
|--------|--------|
| Location | `~/.bob/skills/<slug>/SKILL.md` (`global-bob` scope) |
| Slug | `a-z`, `0-9`, single hyphens, 3–64 chars, no `--` |
| Markers | **Never** write `.bob-work-builtin`, `.bob-work-plugin.json`, or `.bob-work-plugin-id` |
| Bob Work UI | Appears under **Bob · Personal**, deletable by the user |
| Project-only | `<workspace>/.bob/skills/<slug>/SKILL.md` (`workspace-bob` scope) — only if the user explicitly asks |

## SKILL.md format

```yaml
---
name: Human-readable name
description: "User benefit in 1–2 sentences (what the skill does, not the stack)."
icon: key-or-favicon
user-invocable: true
---
```

- **`description`**: business benefit, not implementation jargon.
- **`icon`**: HTTPS favicon (`https://www.google.com/s2/favicons?domain=<domain>&sz=128`) or Bob key (`meeting`, `designer`, `word`, `plugin`, …). Never leave empty when a domain is identifiable.
- **Body**: clear instructions, limits, usage examples, what the skill does **not** do, and a mandatory `## Language` section.

### Language section template (include in every skill)

```markdown
## Language

- Write the **skill file** in English.
- Write the **entire output** in the same language as the user's prompt (the message that invoked this skill), including titles, section headings, labels, and table headers.
- When the prompt language is ambiguous, use the language of the prompt's main request sentence.
- Never mix languages in a single deliverable unless the user explicitly requests bilingual output.
- Keep official framework and product names; add a brief translation in parentheses when helpful.
```

## Creation workflow

1. **Clarify** (briefly): goal, when to use, inputs/outputs, deliverable format — not skill authoring language.
2. **Propose** a slug and description; confirm with the user if ambiguous.
3. **Check** the slug does not already exist (read the target folder).
4. **Write** `SKILL.md` at the correct path — **English body** + `## Language` section.
5. **Confirm** the absolute path and ask the user to refresh **Extensions → Skills**.

## Edit workflow

1. **Read** the existing `SKILL.md` (path from conversation or `~/.bob/skills/<slug>/`).
2. **Do not** change the slug without explicit agreement (rename = move the folder).
3. **Preserve** what works; change only what the user asked for.
4. When rewriting substantial content, **convert instructions to English** if they are in another language; keep the `## Language` output rules.
5. **Never** add built-in or plugin markers on a personal skill.
6. Announce changes and remind the user to refresh Skills if needed.

## Import from GitHub / SKILL.md

1. Ask for the source (raw GitHub URL, repo, or local file).
2. With agreement, fetch the `SKILL.md`.
3. Adapt to Bob format (frontmatter, `user-invocable: true`, functional description).
4. **Translate the skill body to English** if the source is in another language; add or preserve the `## Language` output section.
5. Keep license / attribution at the bottom of the body when present in the source.
6. **Do not overwrite** an existing skill without confirmation.
7. Write under `~/.bob/skills/<slug>/` without plugin/built-in markers.

## Forbidden

- Creating a second folder or parallel `agentic-*` slug for a simple skill.
- Placing a personal skill in `~/.agents/skills/` (Bob Work reads that location but it is not the Bob personal creation channel).
- Confusing skill and plugin: no `.bob-work-plugin.json` here.
- Authoring skill instructions in French, Spanish, or any non-English language (output localization handles user-facing language).

## Success message

Success **only** if all of the following are true:

1. `~/.bob/skills/<slug>/SKILL.md` exists and is readable
2. The folder has **no** `.bob-work-plugin.json`, `.bob-work-plugin-id`, or `.bob-work-builtin`
3. You re-read the path after writing (do not claim success from intent alone)

Then state the exact path and: "Refresh **Extensions → Skills** to see it." If you accidentally wrote plugin markers, remove them or route the user to **plugin-creator** — a skill with those markers will not appear under Skills.
