# Terminal sandbox on macOS

`TerminalSandbox` launches Bob through `/usr/bin/sandbox-exec` with a default-deny
Seatbelt profile. Descendants inherit the profile, including shell scripts and
commands invoked without Bob's native file tools. Direct-disk sessions keep their
existing launcher. Missing isolation support or an invalid workspace fails closed;
there is no retry without isolation.

Writable locations are the canonical workspace and a private temporary HOME.
System tools and runtime libraries are readable, not writable. Personal files,
global Bob configuration, keychains and other workspaces are not readable.
Environment inheritance is cleared. Only Bob's inference credential is injected;
integration/database/plugin credentials are excluded. MCP, subagents and plugin
hooks are disabled. Resume IDs are not reused with the temporary HOME.

Approving a pending session cannot weaken its sandbox setting. The setting is
captured at launch; changing settings does not retroactively alter running processes.

## Boundaries

This is filesystem/process confinement, not a VM or a complete network sandbox.
Outbound TCP 443 remains available for inference and is consequently available to
descendants too. The model API key exists in the child environment. A separate
inference broker is necessary to isolate credentials and distinguish model traffic
from tool traffic. Resource quotas (CPU/memory/disk) are not implemented here.
Preexisting multiply-linked files in the workspace are rejected; only use a
dedicated workspace not concurrently modified by an untrusted host process.
The macOS sandbox API must be tested on supported OS
versions and fails closed if unavailable.

## Tests

The macOS tests use disposable canary files: workspace read/write must succeed;
outside reads/writes, removal, rename, hard-link creation, symlink traversal and
nested shells must fail. They also reject overly broad workspace roots.
An opt-in local Bob CLI smoke test checks startup without making a model call.
These tests do not replace an authenticated end-to-end conversation test.
