# IBM-aligned agentic profession plugins

Seven built-in Bob Work plugins live under `plugins/`. These files are the authoritative source and include hand-maintained additions.

Run `build_catalog.py` from this directory, or `pnpm build:embedded-plugins` from the macOS app, to rebuild `ibm-agentic-professions.zip`. Both commands package the current source tree without regenerating or deleting source files.

The methods are original operational guidance. IBM and third-party frameworks are referenced through official links and are not bundled or presented as endorsements.

## Language policy

- **Skill files** (`SKILL.md`, plugin `instructions`, reference docs) are authored in **English**.
- **Deliverables** produced by a skill must be written in the **same language as the user's prompt** (see `references/deliverable-contract.md` and each skill's `## Language` section).
- When editing a plugin root `SKILL.md`, run the manifest sync step or update `manifest.json` `instructions` and nested skill `description` fields to match.
