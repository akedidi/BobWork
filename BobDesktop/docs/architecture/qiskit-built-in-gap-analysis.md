# Qiskit Built-in — Inventory and migration plan

**Status:** In progress  
**Date:** 2026-09-02

## Current architecture

| Area | Current implementation | Gap |
| --- | --- | --- |
| Built-in identity | `builtin-ibm-qiskit`, Qiskit icon asset, external runtime declaration | Rename/display refresh and structured tool contract |
| Runtime | `external.qiskit`, Qiskit 2.5.2, Aer 0.17.2, IBM Runtime 0.49.0 | Correct foundation; no silent installation |
| Python | Shared Python by default, isolated fallback in Runtime Manager | Correct foundation |
| Lifecycle | Explicit acceptance, transactional update/recovery, removal preserving artifacts | Correct foundation |
| Qiskit execution | Controlled Python runtime handle can execute only approved operations | Semantic quantum service absent |
| Secrets | Encrypted local vault exists | IBM Quantum credential adapter absent |
| Artifacts | Generic Artifact Runtime metadata exists | Circuit/job/result/experiment types absent |
| Visualization | Visualize/Shared Rendering runtime and semantic specs exist | Quantum-to-visual adapter absent |
| Desktop/mobile | Shared artifacts synchronize through remote control | No quantum-specific adaptive renderer shell yet |

## Dependency inventory and storage

The base BobWork package contains no Qiskit, Aer or IBM Runtime dependency. The optional managed runtime currently declares:

- `qiskit` 2.5.2
- `qiskit-aer` 0.17.2
- `qiskit-ibm-runtime` 0.49.0
- Python >= 3.10, shared by default; isolated only as a compatibility fallback
- estimated installed footprint: 800 MiB (catalog estimate; the Runtime Manager reports actual disk use after installation)

The existing 256×256 `qiskit.png` is used only through the plugin-icon component. Its source/provenance must be retained as an official Qiskit asset; no derived/recoloured logo is introduced.

## Migration

1. Keep the existing external runtime and its controlled process boundary.
2. Replace the manifest-only integration with typed circuit, result, job and experiment records.
3. Add static, platform-owned Qiskit operations; callers submit structured requests rather than Python source.
4. Persist only references and computed results; never credentials or raw token values.
5. Use Visualize specs for counts, state/topology and optional scene requests; Qiskit does not package renderers.
6. Gate remote IBM actions behind secret-configuration and an explicit consequential-action confirmation.

## Acceptance boundary for this phase

Local circuit creation, analysis, validation, transpilation and simulation become P0 when the user has explicitly installed `external.qiskit`. Remote IBM backend/job flows remain unavailable until a secure credential adapter and a confirmed submission workflow are present. No QPU state, calibration, queue or result is ever fabricated.
