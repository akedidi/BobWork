# Visualize Built-in — Gap analysis

**Status:** In progress  
**Date:** 2026-09-02

## Existing foundation

| Capability | Existing owner | Status |
| --- | --- | --- |
| Visualize Built-in declaration | Plugin catalogue | Present (`builtin-visualize`) |
| Semantic chart IR | Shared Rendering API | Present (`VisualizationSpec` v1) |
| Semantic diagram IR | Diagram Runtime | Present (`DiagramSpec` v1) |
| Deterministic renderer routing | Shared Rendering API | Present (ECharts, Plotly, Three; D2, Mermaid, Graphviz) |
| Local, lazy renderer loading | Shared Visualization Runtime | Present |
| Renderer cleanup | Shared Visualization Runtime | Present for ECharts, Plotly and Three.js |
| Shared artifact metadata | Artifact Runtime | Present |
| Desktop artifact gallery | Desktop UI | Present |

## Gaps addressed by this implementation phase

1. Make scene, responsive and export intent first-class semantic fields rather than renderer options.
2. Expose a renderer capability registry to the agent/platform for deterministic validation.
3. Persist a visualization artifact as validated JSON with provenance and interaction state, independently of a loaded renderer.
4. Provide an explicit responsive presentation contract shared by desktop and mobile.

## Explicitly deferred

- A complete native mobile renderer shell is not present in this desktop repository. Mobile receives the same artifact/spec through remote synchronization; its client must consume the responsive contract.
- Full interactive D2/Mermaid/Graphviz inline canvases and every listed chart type require renderer-specific adapters and are not claimed complete here.
- Map runtime and geographic data are intentionally not introduced.
- No arbitrary JavaScript execution, CDN loading, or LLM-selected executable path is introduced.
