# ADR-017: Runtime Architecture V2

**Status:** Accepted
**Date:** 2026-09-01
**Scope:** Bob Work desktop runtime platform and all Built-in/Personal plugins

## Context

Bob Work already supports executable plugin entrypoints, packaged binaries, MCP sidecars,
artifacts, permissions and local deployment. Those capabilities grew independently. Runtime
resolution is split between `plugin_local_runtime`, `plugin_bundle_layout`, plugin MCP startup,
hook execution and plugin-owned installers. Cloud Architect currently owns generic diagram
engines; Docling owns a Python environment installer; most Python entrypoints resolve the host
`python3`; bundled plugin bins are prepended to a per-process PATH.

V2 consolidates these mechanisms. It does not introduce a second plugin format or a second
permission system.

## Inventory before migration

| Capability | Current owner | Current implementation | Target owner |
|---|---|---|---|
| Python | Host OS / individual plugin | `python3` from PATH; Docling venv installer | Shared Python Runtime; isolated fallback per external/private runtime |
| Visualization | No platform owner | No ECharts/Plotly/Three.js dependency in the desktop package | Shared Visualization Runtime |
| Diagram rendering | Cloud Architect | D2 0.7.1 (35 MB), Mermaid 11.17.1 (3.4 MB), PlantUML 1.2026.4 (28 MB), Graphviz host fallback | Shared Diagram Runtime |
| Artifact lifecycle | `ArtifactService` + task IO | SQLite `artifacts`, files, preview, task/conversation references | Shared Artifact Runtime façade over existing services |
| Qiskit | IBM Qiskit Built-in + host prerequisite | External `qiskit-bob` expected on PATH; Qiskit not installed | External Managed Runtime `qiskit` |
| Plugin-specific CLI | Plugin manifest + PATH probing | `resources`, `entrypoints`, `plugin_runtime_path` | Plugin Private Runtime resolved by Runtime Manager |
| Plugin-specific binary | Plugin bundle | `bin/` or `vendor/<tool>/<version>/bin`; per-process PATH injection | Plugin Private Runtime, explicit executable handle |
| CLI/process execution | Bob service, plugin MCP, hooks | several `Command`/`TokioCommand` call sites | Controlled Process Executor owned by Runtime Manager |
| Permissions | permission governance + plugin manifest | `command.execute`, `network.request`, filesystem permissions | Reused and enforced before runtime operations |
| Secrets | Keychain service | secret references; no secrets in plugin manifest | Reused unchanged |
| Plugin install/update/remove | Plugin service/deploy/archive | SQLite, version snapshots, rollback, `~/.bob/skills` | Reused; private-runtime lifecycle added |
| Platform detection | ad-hoc `cfg`, `uname`, PATH | mostly macOS-arm64 assumptions in bundles | Runtime Manager platform resolver |
| Storage | app data + `~/.bob/skills` + `~/.bob/runtimes` | no unified accounting | Runtime registry and diagnostics |

### Measured baseline on 2026-09-01

- Debug Bob Work application bundle: **131 MB**.
- Packaged Cloud Architect resource: **42 MB**.
- Active Cloud Architect deployed bundle: **79 MB**.
- Retained Cloud Architect version copies: **140 MB**.
- All deployed Bob skills: **221 MB**.
- Bob Work application data (database, backups, artifacts/cache): **147 MB**.
- `~/.bob/runtimes`: empty payload (Docling runtime directory exists but no installed runtime).
- Host Python: **3.9.6**. Host Node: **22.16.0**.
- Host Python packages observed: NumPy 1.26.4, pandas 2.2.3, SciPy 1.13.1,
  PyArrow 20.0.0, openpyxl 3.1.2. Polars, DuckDB, Plotly and Qiskit are absent.

These are diagnostic measurements, not promised installation sizes.

## Decision

Runtime Manager is the single authority for runtime classification, resolution, installation,
execution, lifecycle, integrity and storage diagnostics. Plugins continue using the existing JSON
manifest, extended with:

```json
{
  "sharedCapabilities": ["python", "visualization", "diagram", "artifact"],
  "externalRuntimes": [{ "id": "qiskit", "version": "1.x", "pythonMode": "shared" }],
  "privateDependencies": [
    { "id": "terraform", "kind": "binary", "entrypoint": "bin/terraform", "sha256": "…" }
  ]
}
```

Legacy `runtime`, `entrypoints` and `resources` remain accepted and are normalized into the V2
dependency model. Plugins never receive physical runtime roots. They receive capability or
executable handles.

### Runtime classes

1. **Shared** — trusted, reusable platform capability, installed once, immutable to plugins.
2. **External Managed** — optional and independently removable/updateable; lazy-installed only
   after explicit user approval.
3. **Plugin Private** — plugin-owned dependency layer with strict ownership and no global PATH
   mutation.

### External runtime lifecycle policy

Every External Managed runtime follows the same policy; the delivery technology (PyPI, a signed
vendor archive, or another supported official channel) is an installer strategy, not a different
runtime class.

1. The catalog fixes the runtime version, official source and validation metadata. The model and
   plugins cannot provide or override an installation URL.
2. Bob Work installs automatically only when Runtime Manager implements the declared strategy.
   The payload is staged, validated and atomically activated below
   `~/.bob/runtimes/external/<runtime>/<version>` without requiring a global installation.
3. A host executable may be detected for compatibility, but it remains user/vendor-owned. Bob Work
   may explain how to install or remove it and must never delete it.
4. Automatic removal is allowed only for an External Managed runtime whose exact installation path
   and `runtime.json` ownership marker both identify Bob Work. Shared runtimes and plugin-private
   dependencies are embedded lifecycles and never enter this removal flow.
5. A runtime whose official installation cannot be automated safely is shown as manual. Adding a
   supported installer strategy automatically gives it the same consent, transaction, update,
   rollback and removal behavior as every other external runtime; no product exception is allowed.

### Resolution rules

1. Validate manifest declarations and permissions.
2. Resolve platform and architecture.
3. Resolve a shared capability when declared.
4. Resolve/install an external runtime only from its registered trusted manifest.
5. Resolve a private dependency only inside its owning plugin root.
6. PATH discovery is a legacy fallback only when explicitly declared by the manifest.

### Python policy

The shared interpreter is selected centrally and is immutable from a plugin's perspective.
External/private packages may use a dependency layer compatible with that interpreter. A separate
interpreter is allowed only when the external runtime manifest records an incompatibility and
selects `pythonMode: isolated`.

### Rendering policy

Visualization and Diagram accept validated semantic specs. Trusted adapters select local engines
deterministically. Renderer-specific arbitrary JavaScript is not a canonical artifact and is not
executed from LLM output.

### Security policy

- No runtime URL is supplied by the LLM.
- External sources must exist in Bob Work's runtime catalog and declare the integrity metadata
  required by their installer strategy.
- Private paths are canonicalized below their owning plugin root.
- Runtime processes use explicit executable paths and scoped environments.
- Existing `command.execute`, `network.request` and filesystem permissions remain authoritative.
- Shared runtime mutation (`pip install`, uninstall or upgrade) is rejected.

## Consequences

- Generic diagram engines move out of Cloud Architect ownership.
- Qiskit can remain absent from the base app and become the first generic external-runtime case.
- Existing manifests and deployed plugins remain compatible during migration.
- Runtime installation UX and renderer adapters require incremental follow-up; registry and
  execution boundaries land first so migration does not create another parallel system.

## Rejected alternatives

- One Python environment per plugin: excessive duplication and update surface.
- Global plugin PATH mutation: breaks ownership and allows cross-plugin execution.
- Qiskit-specific installer service: cannot support future external runtimes.
- CDN-loaded rendering engines: violates offline and integrity requirements.
- LLM-generated renderer JavaScript: violates deterministic execution and security boundaries.
