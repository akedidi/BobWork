# Terminal sandbox on macOS (Seatbelt)

`TerminalSandbox` launches Bob through `/usr/bin/sandbox-exec` with a
default-deny Seatbelt profile. Descendants inherit the profile, including shell
scripts and commands invoked without Bob's native file tools. Direct-disk
sessions keep their existing launcher. Missing isolation support or an invalid
workspace fails closed; there is no retry without isolation.

## Folder mounts

Folder-mount isolation model (Seatbelt profile, not a Linux
VM):

- **Writable**: the conversation workspace connected via Bob Work and a private
  temporary `HOME`/`TMPDIR` destroyed when the run ends.
- **Readable**: OS runtimes and libraries (`file-read*` under `/`), the Bob
  package path when it lives under the user’s home, and the whole host
  `~/.bob` tree remounted read-only (skills/plugins, MCP scripts including
  Chrome, shared runtimes under `~/.bob/runtimes` such as diagram/D2, LaTeX,
  Pandoc).
- **Denied**: `/Users`, `/Volumes`, host temp trees (`/tmp`, `/var/folders`, …),
  and host account databases (`/etc/passwd`). The workspace and private HOME are
  re-allowed after those denies so Application Support workspaces still work.
- **Host Unix sockets**: the AppleScript bridge socket under `~/.bob/run` is
  remounted read/write so sandboxed Chrome MCP can call the host broker without
  opening localhost TCP to the Mac LAN.
- **Network**: outbound HTTPS for the model API. Localhost outbound is denied by
  Seatbelt. RFC1918, link-local, and cloud metadata are blocked in userspace
  (`sandbox-node.cjs` for Node, `$HOME/bin` wrappers for curl/wget/nc, Chrome MCP
  URL validation) because current macOS Seatbelt only accepts `localhost`/`*` as
  remote hosts — CIDR filters are rejected by `sandbox-exec`.
- **Session policy**: pass `--trust` so Bob Shell tools are not soft-blocked on
  the seatbelt-writable host remount `~/.bob/skills` (skill/plugin creation).
  Computer Use MCP and plugin hooks stay forced off. Chrome and subagents follow
  user settings. Remote MCP gateway stays forbidden.

Environment inheritance is cleared. Only Bob’s inference credential (plus proxy /
custom CA env when present) is injected. Resume IDs are not reused with the
temporary HOME.

## Resource quotas

Sandboxed children also get soft OS ceilings (`RLIMIT_CPU`, `RLIMIT_AS`,
`RLIMIT_FSIZE`) plus a 30-minute wall-clock kill and a 2 GiB private-HOME disk
check. Exceeding a quota terminates the session with an explicit
“limitations de la sandbox Bob Work” message (`SandboxLimitKind`).

Approving a pending session cannot weaken its sandbox setting.

## Capability matrix

| Capability | Sandbox |
|------------|---------|
| Connected workspace FS | Allowed |
| Host Desktop/Documents/… | Denied |
| Subagents | Allowed (settings) |
| Chrome MCP (host bridge) | Allowed (settings) |
| Computer Use | Forced off |
| Plugin hooks | Forced off |
| Remote MCP gateway | Forced off |
| Local MCP (non-CU) | Allowed when MCP on |
| Shared skills + runtimes | Allowed (`~/.bob` remount + `$HOME/.bob/{skills,runtimes}` symlinks + `BOB_WORK_D2` on PATH) |
| External runtimes / host CLI | If a plugin cannot run: explicit sandbox message + advise turning sandbox off in Settings → Permissions |
| Private / LAN / metadata net | Denied (userspace) |

## Boundaries

This is filesystem/process confinement, not a VM or a complete network sandbox.
Public HTTPS remains available for inference. The model API key exists in the
child environment. Preexisting multiply-linked files in the workspace are
rejected. The macOS sandbox API must be tested on supported OS versions and fails
closed if unavailable.
