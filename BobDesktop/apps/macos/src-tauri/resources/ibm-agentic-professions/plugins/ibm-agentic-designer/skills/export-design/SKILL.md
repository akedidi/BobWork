---
name: export-design
description: "Export a design from Design IR, including a real .sketch package when requested."
icon: designer
---

# Export design

Export from the same Design IR as the preview.

## Required outputs

Always keep the Design IR JSON (`.design.json`) as the source of truth.

When the user asks for **Sketch** / **`.sketch`**:

1. Ensure a valid Design IR `version: "1.0"` with `document.pages` exists (see `../../references/deliverable-contract.md`). Prefer PascalCase node types (`Page`, `Section`, `Text`, `Button`). Refresh or rewrite a loose draft into this shape — do not invent a handoff-only substitute.
2. Write it to the workspace (for example `name.design.json`).
3. Generate a **real Sketch package** — prefer in order:
   - `generate_artifact` with `artifact_type: "sketch"` and the Design IR JSON as content, or `create_designer_preview` when available;
   - otherwise the bundled exporter:

```bash
python3 ~/.bob/skills/ibm-agentic-designer/scripts/export_sketch.py path/to/design.design.json -o path/to/name.sketch
```

If the skill is still under the packaged tree before deploy, use the plugin bundle path that contains `scripts/export_sketch.py`.

4. Verify the file exists, starts with a ZIP signature (`PK`), and report the absolute path.
5. Inspect the generated package before delivery: each requested screen must be a distinct, non-overlapping artboard; visible text must be present; child frames must reflect the Design IR layout rather than all starting at `(0,0)`; and colors, typography, borders, and corner radii must be preserved when supplied.
6. Optionally also export HTML/CSS preview, tokens JSON, or SVG from the same IR.

## Forbidden substitutes

- Do **not** claim Sketch/sketchtool is unavailable in Bob Work.
- Do **not** replace `.sketch` with `.sketch-handoff.json`, `.design.json` alone, PNG screenshots, or HTML.
- Do **not** produce `.fig`.
- You may keep `.design.json` **in addition to** `.sketch`, never instead of it when Sketch was requested.

## Fidelity note

The `.sketch` file is Bob Work’s structured interchange package (ZIP + `document.json` / `pages/*.json`) derived from Design IR. The bundled exporter converts screens to separate artboards, resolves vertical/horizontal/grid/free layout, and maps supported visual styles to editable Sketch layers. Import fidelity can vary across Sketch-compatible apps — state that briefly after delivering the file.

## Language

- This skill file is authored in English.
- Deliverables must be written in the same language as the user's prompt unless the design system specifies fixed locale strings.
- Never mix languages in a single deliverable unless the user explicitly requests bilingual output.
