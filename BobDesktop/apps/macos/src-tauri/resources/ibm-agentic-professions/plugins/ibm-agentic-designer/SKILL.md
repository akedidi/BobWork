---
name: ibm-agentic-designer
description: "Design structured UX/UI experiences with responsive preview and open exports including Sketch."
icon: designer
---

# Designer

Designer turns a brief into professional, editable UX/UI:

`brief → architecture/flows → wireframe → design system → UI → Design IR → preview → review → patch → export`

## Design IR contract

Versioned Design IR JSON is the source of truth. Each node has a stable ID, semantics, layout, and when needed responsive/interaction rules. Previews and exports are derived from this document; no image, HTML, or proprietary export replaces it.

- use `FREE`, `HORIZONTAL`, `VERTICAL`, and `GRID`; prefer Flex/Grid over absolute positioning;
- create and reuse tokens and components;
- for a targeted change, patch only the affected node;
- produce a local, self-contained, sandboxed HTML preview so it renders in conversation on desktop and mobile;
- for charts, diagrams, or 3D, delegate to the shared Visualize runtime;
- never include arbitrary JavaScript or load a CDN in a preview.

## Responsive and accessibility

Define desktop, tablet, and mobile explicitly. On mobile, adapt navigation, order, density, and touch interactions; do not simply shrink the layout. Plan contrast, accessible labels, focus, touch targets, and reduced motion.

## Exports

Export from the same Design IR:

- `.design.json` — canonical source;
- HTML/CSS preview, JSON tokens, SVG when useful;
- **`.sketch`** — when the user asks for Sketch / `.sketch`, run `scripts/export_sketch.py` on the Design IR and deliver a real ZIP package ending in `.sketch`.

Never generate `.fig`. Never substitute `.sketch-handoff.json` or claim Sketch is unavailable.

## Language

- **Skill files** in this plugin are authored in English.
- **Deliverables** (briefs, reviews, handoff notes, user-facing copy in exports) must be written in the same language as the user's prompt unless the design system specifies fixed locale strings.
- When the prompt language is ambiguous, use the language of the prompt's main request sentence.
- Never mix languages in a single deliverable unless the user explicitly requests bilingual output.

See also `references/deliverable-contract.md`.

## Skills

For a new journey: `design-brief` → `information-architecture`/`user-journey` → `wireframe` → `ui-design`/`design-system` → `responsive-design`/`interaction-design` → `design-review` → `export-design`.

For a fix: use `design-refactor`, preserve out-of-scope elements, and refresh the preview.
