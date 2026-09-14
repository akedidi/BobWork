//! Seatbelt confinement inherited by Bob's terminal commands and descendants.
//! Network remains available for model inference; private/LAN/metadata egress is denied.
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Wall-clock cap for one sandboxed `bob run` (parent kills the process group).
pub const SANDBOX_WALL_CLOCK: Duration = Duration::from_secs(30 * 60);
/// CPU seconds (`RLIMIT_CPU`) for the sandboxed process tree.
pub const SANDBOX_CPU_SECONDS: u64 = 30 * 60;
/// Address-space ceiling (`RLIMIT_AS`).
pub const SANDBOX_AS_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// Per-file write ceiling (`RLIMIT_FSIZE`).
pub const SANDBOX_FSIZE_BYTES: u64 = 512 * 1024 * 1024;
/// Soft ceiling for private sandbox HOME disk usage.
pub const SANDBOX_HOME_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxLimitKind {
    WallClock,
    Cpu,
    Memory,
    FileSize,
    HomeStorage,
    PrivateNetwork,
    FileAccess,
    ComputerUse,
    /// Plugin depends on an external/host runtime that sandbox cannot run or install.
    ExternalRuntime,
}

impl SandboxLimitKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WallClock => "wall_clock",
            Self::Cpu => "cpu",
            Self::Memory => "memory",
            Self::FileSize => "file_size",
            Self::HomeStorage => "home_storage",
            Self::PrivateNetwork => "private_network",
            Self::FileAccess => "file_access",
            Self::ComputerUse => "computer_use",
            Self::ExternalRuntime => "external_runtime",
        }
    }
}

/// User-facing message when a sandboxed run hits a hard limit.
pub fn sandbox_limit_message(kind: SandboxLimitKind) -> String {
    match kind {
        SandboxLimitKind::WallClock => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : durée d’exécution maximale atteinte (30 min)."
                .into()
        }
        SandboxLimitKind::Cpu => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : quota CPU atteint."
                .into()
        }
        SandboxLimitKind::Memory => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : mémoire maximale atteinte."
                .into()
        }
        SandboxLimitKind::FileSize => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : taille de fichier maximale atteinte."
                .into()
        }
        SandboxLimitKind::HomeStorage => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : stockage temporaire de session (HOME) dépassé."
                .into()
        }
        SandboxLimitKind::PrivateNetwork => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : pas d’accès au réseau local, aux adresses privées ni aux métadonnées cloud."
                .into()
        }
        SandboxLimitKind::FileAccess => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : accès limité aux dossiers explicitement connectés via Bob Work."
                .into()
        }
        SandboxLimitKind::ComputerUse => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : Computer Use (contrôle bureau) est indisponible en sandbox."
                .into()
        }
        SandboxLimitKind::ExternalRuntime => {
            "Cette action est bloquée par les limitations de la sandbox Bob Work : ce plugin dépend d’un runtime externe incompatible avec la sandbox. Désactivez le mode sandbox dans Réglages → Permissions, puis relancez."
                .into()
        }
    }
}

pub struct TerminalSandbox {
    _state: tempfile::TempDir,
    home: PathBuf,
    workspace: PathBuf,
    profile: String,
}

impl TerminalSandbox {
    pub fn home(&self) -> &Path {
        &self.home
    }

    pub fn workspace(&self) -> &Path {
        &self.workspace
    }

    /// Approximate recursive size of the private sandbox HOME (for quota checks).
    pub fn home_usage_bytes(&self) -> u64 {
        directory_size_bytes(&self.home)
    }

    pub fn home_quota_exceeded(&self) -> bool {
        self.home_usage_bytes() > SANDBOX_HOME_BYTES
    }
}

fn directory_size_bytes(root: &Path) -> u64 {
    fn walk(path: &Path, total: &mut u64) {
        let Ok(entries) = std::fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                walk(&path, total);
            } else {
                *total = total.saturating_add(meta.len());
            }
        }
    }
    let mut total = 0u64;
    walk(root, &mut total);
    total
}

fn quoted(path: &Path) -> AppResult<String> {
    let value = path
        .to_str()
        .ok_or_else(|| AppError::Security("Chemin sandbox non UTF-8".into()))?;
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

#[cfg(unix)]
fn reject_hard_links(directory: &Path) -> AppResult<()> {
    use std::os::unix::fs::MetadataExt;
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let metadata = entry.path().symlink_metadata()?;
        if metadata.is_file() && metadata.nlink() > 1 {
            return Err(AppError::Security(
                "Le workspace contient un fichier à liens physiques multiples. Fournissez une copie indépendante dans un workspace dédié."
                    .into(),
            ));
        }
        if metadata.is_dir() {
            reject_hard_links(&entry.path())?;
        }
    }
    Ok(())
}

/// GUI apps launched from Finder/Dock often start at soft `maxfiles` 256.
/// Bob + chokidar + native policy watchers exceed that immediately under
/// Seatbelt. Prefer a high soft ceiling (Cowork-like headroom for tools).
const NOFILE_DESIRED: u64 = 262_144;

/// Raise this process's file-descriptor ceiling. GUI apps launched from
/// Finder often start at 256, which is enough for Node's `fs.watch` to die
/// with `EMFILE: too many open files, watch`.
pub fn raise_process_nofile_limit() {
    #[cfg(unix)]
    unsafe {
        let mut lim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut lim) != 0 {
            return;
        }
        let desired = NOFILE_DESIRED as libc::rlim_t;
        if lim.rlim_max != libc::RLIM_INFINITY && lim.rlim_max < desired {
            let mut raised = lim;
            raised.rlim_max = desired;
            if libc::setrlimit(libc::RLIMIT_NOFILE, &raised) == 0 {
                lim.rlim_max = desired;
            }
        }
        let max = if lim.rlim_max == libc::RLIM_INFINITY {
            desired
        } else {
            lim.rlim_max
        };
        let next = desired.min(max);
        if lim.rlim_cur < next {
            lim.rlim_cur = next;
            let _ = libc::setrlimit(libc::RLIMIT_NOFILE, &lim);
        }
    }
}

#[cfg(unix)]
fn apply_sandbox_resource_limits() {
    unsafe {
        raise_process_nofile_limit();
        let caps = [
            (libc::RLIMIT_CPU, SANDBOX_CPU_SECONDS as libc::rlim_t),
            (libc::RLIMIT_AS, SANDBOX_AS_BYTES as libc::rlim_t),
            (libc::RLIMIT_FSIZE, SANDBOX_FSIZE_BYTES as libc::rlim_t),
        ];
        for (resource, soft) in caps {
            let mut lim = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            if libc::getrlimit(resource, &mut lim) != 0 {
                continue;
            }
            let hard = if lim.rlim_max == libc::RLIM_INFINITY {
                soft
            } else {
                soft.min(lim.rlim_max)
            };
            lim.rlim_cur = hard;
            lim.rlim_max = hard;
            let _ = libc::setrlimit(resource, &lim);
        }
    }
}

#[cfg(unix)]
fn raise_nofile_limit_for_child(cmd: &mut tokio::process::Command) {
    unsafe {
        cmd.pre_exec(|| {
            apply_sandbox_resource_limits();
            Ok(())
        });
    }
}

#[cfg(not(unix))]
fn raise_nofile_limit_for_child(_cmd: &mut tokio::process::Command) {}

/// Seatbelt may read the Bob package (`…/bobshell` or `…/bobshell/dist`),
/// never the parent `node_modules` tree. Watching that tree is what triggers
/// `EMFILE: too many open files, watch`. Bundled `bob.js` does not need hoisted
/// packages outside its own folder.
fn bob_runtime_root(executable: &Path) -> &Path {
    let Some(parent) = executable.parent() else {
        return executable;
    };
    if !executable.file_name().is_some_and(|name| name == "bob.js") {
        return executable;
    }
    if parent.file_name().is_some_and(|name| {
        matches!(
            name.to_str(),
            Some("dist" | "bin" | "lib" | "build" | "src")
        )
    }) {
        parent.parent().unwrap_or(parent)
    } else {
        parent
    }
}

fn allow_lookup_chain(profile: &mut String, path: &Path) -> AppResult<()> {
    let mut current = path.to_path_buf();
    loop {
        profile.push_str(&format!(
            "(allow file-read-metadata (literal {}))\n",
            quoted(&current)?
        ));
        match current.parent() {
            Some(parent) if parent != current => current = parent.to_path_buf(),
            _ => break,
        }
    }
    Ok(())
}

/// Deny loopback egress. On current macOS, Seatbelt only accepts `localhost` or
/// `*` as remote hosts — CIDR / literal private-IP filters are rejected by
/// `sandbox-exec`. RFC1918 / link-local / metadata are enforced in userspace
/// (`sandbox-node.cjs`, Chrome MCP URL validation, shell wrappers).
fn append_private_network_denies(profile: &mut String) {
    profile.push_str("(deny network-outbound (remote ip \"localhost:*\"))\n");
}

fn allow_unix_socket(profile: &mut String, socket: &Path) -> AppResult<()> {
    // AF_UNIX client connect needs read+write on the socket inode. Remount both
    // the requested path and its canonical form (e.g. /var/folders → /private/…).
    let mut candidates = vec![socket.to_path_buf()];
    if let Some(parent) = socket.parent() {
        if let (Ok(canon_parent), Some(name)) = (parent.canonicalize(), socket.file_name()) {
            candidates.push(canon_parent.join(name));
        }
    }
    if let Ok(canon) = socket.canonicalize() {
        candidates.push(canon);
    }
    candidates.sort();
    candidates.dedup();
    for path in candidates {
        profile.push_str(&format!(
            "(allow file-read* file-write* (literal {}))\n",
            quoted(&path)?
        ));
        if let Some(parent) = path.parent() {
            profile.push_str(&format!(
                "(allow file-read* file-write* (subpath {}))\n",
                quoted(parent)?
            ));
            allow_lookup_chain(profile, parent)?;
        }
    }
    Ok(())
}

/// Shell wrappers that refuse private/LAN/metadata targets. Seatbelt cannot
/// express those CIDRs on current macOS; PATH puts `$HOME/bin` first.
fn install_private_network_wrappers(home: &Path) -> AppResult<()> {
    let bin = home.join("bin");
    std::fs::create_dir_all(&bin)?;
    let script = r#"#!/bin/sh
# Bob Work sandbox: block private / LAN / cloud-metadata egress.
MSG="Cette action est bloquée par les limitations de la sandbox Bob Work : pas d’accès au réseau local, aux adresses privées ni aux métadonnées cloud."
is_blocked() {
  host="$1"
  [ -z "$host" ] && return 1
  host=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]' | sed 's/\.$//')
  case "$host" in
    localhost|*.local|metadata.google.internal|::1|0:0:0:0:0:0:0:1) return 0 ;;
  esac
  case "$host" in
    10.*|127.*|0.*|169.254.*|192.168.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[0-1][0-9].*|100.12[0-7].*) return 0 ;;
    fe80:*|fc*|fd*) return 0 ;;
  esac
  return 1
}
scan_args() {
  for arg in "$@"; do
    case "$arg" in
      -*) continue ;;
    esac
    # Strip URL scheme / path / brackets for host checks.
    host=$(printf '%s' "$arg" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#/.*##; s#^\[##; s#\]$##; s#:.*##')
    if is_blocked "$host" || is_blocked "$arg"; then
      printf '%s\n' "$MSG" >&2
      exit 1
    fi
  done
}
cmd=$(basename "$0")
real=""
for candidate in "/usr/bin/$cmd" "/bin/$cmd" "/usr/sbin/$cmd" "/sbin/$cmd"; do
  if [ -x "$candidate" ] && [ "$candidate" != "$0" ]; then
    real="$candidate"
    break
  fi
done
if [ -z "$real" ]; then
  printf 'bob-sandbox: %s introuvable hors wrappers\n' "$cmd" >&2
  exit 127
fi
scan_args "$@"
exec "$real" "$@"
"#;
    for name in ["curl", "wget", "nc", "ncat", "telnet"] {
        let path = bin.join(name);
        std::fs::write(&path, script)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&path)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms)?;
        }
    }
    Ok(())
}

impl TerminalSandbox {
    pub fn new(workspace: &Path, executable: &Path) -> AppResult<Self> {
        Self::with_extra_reads(workspace, executable, &[])
    }

    /// Same as [`Self::new`], plus read-only mounts under the host `~/.bob`
    /// tree so MCP server scripts/skills remain usable while Desktop/Documents
    /// stay denied.
    pub fn with_extra_reads(
        workspace: &Path,
        executable: &Path,
        extra_reads: &[PathBuf],
    ) -> AppResult<Self> {
        Self::with_mounts(workspace, executable, extra_reads, &[])
    }

    /// Like [`Self::with_extra_reads`], plus host Unix sockets (Chrome AppleScript
    /// bridge) remounted read/write so sandboxed MCP can call the host broker.
    pub fn with_mounts(
        workspace: &Path,
        executable: &Path,
        extra_reads: &[PathBuf],
        extra_unix_sockets: &[PathBuf],
    ) -> AppResult<Self> {
        if !cfg!(target_os = "macos") || !Path::new("/usr/bin/sandbox-exec").is_file() {
            return Err(AppError::Security("Isolation système indisponible : session arrêtée sans accès direct. Utilisez une machine compatible avec la sandbox.".into()));
        }
        let workspace = workspace.canonicalize()?;
        let real_home = dirs::home_dir().and_then(|p| p.canonicalize().ok());
        let system_root = [
            "/private",
            "/private/tmp",
            "/private/var",
            "/usr",
            "/usr/local",
            "/opt",
            "/opt/homebrew",
            "/System",
            "/Library",
            "/Applications",
            "/Volumes",
            "/Users",
        ]
        .iter()
        .any(|root| workspace == Path::new(root));
        if system_root
            || !workspace.is_dir()
            || workspace.parent().is_none()
            || real_home
                .as_ref()
                .is_some_and(|home| home.starts_with(&workspace))
        {
            return Err(AppError::Security("La sandbox exige un dossier de travail dédié, pas le dossier personnel ou un de ses parents.".into()));
        }
        let requested = executable.to_path_buf();
        let executable = executable.canonicalize()?;
        #[cfg(unix)]
        reject_hard_links(&workspace)?;
        let state = tempfile::Builder::new().prefix("bob-isolated-").tempdir()?;
        let home = state.path().canonicalize()?;
        std::fs::create_dir(home.join("tmp"))?;
        std::fs::write(
            home.join("sandbox-node.cjs"),
            include_str!("sandbox-node.cjs"),
        )?;
        install_private_network_wrappers(&home)?;
        // Cowork-like Seatbelt (behavioral parity with a VM mount, not identical):
        // - HTTPS outbound for the model (DNS needs mach*/system-socket + broad
        //   file-read; port-only 443/53 is insufficient on modern macOS).
        // - Block localhost via Seatbelt; RFC1918 / link-local / metadata via
        //   userspace (sandbox-node.cjs + PATH wrappers) — current macOS Seatbelt
        //   rejects CIDR / literal private-IP filters.
        // - System tree is read-only; /Users, /Volumes and host temp trees are
        //   denied, then only the conversation workspace + private HOME (+ bob
        //   runtime) are re-allowed — Cowork-style folder mounts.
        // sandbox-node.cjs stubs fs.watch* so broad file-read does not EMFILE.
        let mut profile = String::from(
            "(version 1)\n\
             (deny default)\n\
             (allow process-exec process-fork)\n\
             (allow signal (target self))\n\
             (allow sysctl*)\n\
             (allow mach*)\n\
             (allow ipc*)\n\
             (allow system-socket)\n\
             (allow network-outbound)\n",
        );
        append_private_network_denies(&mut profile);
        profile.push_str(
            "(allow file-read* (subpath \"/\"))\n\
             (allow file-write* (literal \"/dev/null\"))\n\
             (deny file-read* (literal \"/etc/passwd\") (literal \"/private/etc/passwd\") \
              (literal \"/etc/master.passwd\") (literal \"/private/etc/master.passwd\") \
              (literal \"/etc/shadow\") (literal \"/private/etc/shadow\"))\n\
             (deny file-read* file-write* \
              (subpath \"/Users\") \
              (subpath \"/Volumes\") \
              (subpath \"/private/var/folders\") \
              (subpath \"/var/folders\") \
              (subpath \"/private/tmp\") \
              (subpath \"/tmp\") \
              (subpath \"/private/var/root\"))\n",
        );
        let runtime = bob_runtime_root(&executable);
        // Workspace + private HOME stay fully usable even under denied parents.
        for path in [&workspace, &home] {
            profile.push_str(&format!(
                "(allow file-read* file-write* (subpath {}))\n",
                quoted(path)?
            ));
        }
        // Bob package may live under ~/.local (inside denied /Users).
        profile.push_str(&format!(
            "(allow file-read* (subpath {}))\n",
            quoted(runtime)?
        ));
        if requested != executable {
            profile.push_str(&format!(
                "(allow file-read* (literal {}))\n",
                quoted(&requested)?
            ));
        }
        // Host ~/.bob stays readable: skills, shared runtimes (diagram/D2,
        // LaTeX, Pandoc, Office helpers), MCP scripts. Desktop/Documents remain
        // denied under /Users. Always remount the whole tree — piecemeal
        // mounts of ~/.bob/runtimes alone left plugins unusable in sandbox.
        let bob_root = real_home.as_ref().map(|h| h.join(".bob"));
        if let Some(bob_root) = bob_root.as_ref() {
            if bob_root.is_dir() {
                if let Ok(canonical) = bob_root.canonicalize() {
                    profile.push_str(&format!(
                        "(allow file-read* (subpath {}))\n",
                        quoted(&canonical)?
                    ));
                    allow_lookup_chain(&mut profile, &canonical)?;
                }
            }
        }
        for path in extra_reads {
            let Ok(canonical) = path.canonicalize() else {
                continue;
            };
            let Some(bob_root) = bob_root.as_ref() else {
                continue;
            };
            if !canonical.starts_with(bob_root) {
                continue;
            }
            // Already covered by the whole-tree remount above; keep explicit
            // mounts for nested paths so callers/tests stay intentional.
            let mount = if canonical.is_dir() {
                canonical.clone()
            } else {
                canonical
                    .parent()
                    .unwrap_or(canonical.as_path())
                    .to_path_buf()
            };
            profile.push_str(&format!(
                "(allow file-read* (subpath {}))\n",
                quoted(&mount)?
            ));
            allow_lookup_chain(&mut profile, &mount)?;
        }
        // Host AppleScript / Chrome broker sockets (may not exist yet at profile build).
        for socket in extra_unix_sockets {
            allow_unix_socket(&mut profile, socket)?;
        }
        // Corporate CA bundles / proxy helper paths referenced by env.
        for key in [
            "SSL_CERT_FILE",
            "NODE_EXTRA_CA_CERTS",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "AWS_CA_BUNDLE",
        ] {
            if let Ok(value) = std::env::var(key) {
                let cert = PathBuf::from(value.trim());
                if cert.is_file() {
                    if let Ok(canonical) = cert.canonicalize() {
                        profile.push_str(&format!(
                            "(allow file-read* (literal {}))\n",
                            quoted(&canonical)?
                        ));
                        allow_lookup_chain(&mut profile, &canonical)?;
                    }
                }
            }
        }
        if let Ok(dir) = std::env::var("SSL_CERT_DIR") {
            let cert_dir = PathBuf::from(dir.trim());
            if cert_dir.is_dir() {
                if let Ok(canonical) = cert_dir.canonicalize() {
                    profile.push_str(&format!(
                        "(allow file-read* (subpath {}))\n",
                        quoted(&canonical)?
                    ));
                    allow_lookup_chain(&mut profile, &canonical)?;
                }
            }
        }
        for path in [
            workspace.as_path(),
            home.as_path(),
            runtime,
            requested.as_path(),
            executable.as_path(),
            Path::new("/bin/sh"),
            Path::new("/usr/bin/env"),
            Path::new("/usr/bin/node"),
            Path::new("/opt/homebrew/bin/node"),
            Path::new("/usr/local/bin/node"),
            Path::new("/private/var/select/sh"),
        ] {
            allow_lookup_chain(&mut profile, path)?;
        }
        Ok(Self {
            _state: state,
            home,
            workspace,
            profile,
        })
    }

    pub fn command(&self, executable: &str) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new("/usr/bin/sandbox-exec");
        cmd.args(["-p", &self.profile, executable]);
        // Never inherit shell startup hooks, loader overrides or unrelated credentials.
        let path = format!(
            "{}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            self.home.join("bin").display()
        );
        cmd.env_clear()
            .env("PATH", path)
            .env("HOME", &self.home)
            .env("TMPDIR", self.home.join("tmp"))
            .env("LANG", "en_US.UTF-8")
            .env("USER", "bob-sandbox")
            .env("LOGNAME", "bob-sandbox")
            .env(
                "NODE_OPTIONS",
                format!("--require={}", self.home.join("sandbox-node.cjs").display()),
            )
            .current_dir(&self.workspace);
        // Corporate networks (e.g. IBM) need proxy / custom CA env. Clearing the
        // whole environment otherwise yields opaque "Request Failed" from bob run
        // while direct-disk sessions still work.
        for key in [
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "https_proxy",
            "http_proxy",
            "all_proxy",
            "no_proxy",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "AWS_CA_BUNDLE",
        ] {
            if let Ok(value) = std::env::var(key) {
                if !value.is_empty() {
                    cmd.env(key, value);
                }
            }
        }
        raise_nofile_limit_for_child(&mut cmd);
        cmd
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[tokio::test]
    async fn confines_terminal_and_descendants() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let outside = fixture.path().join("outside");
        std::fs::write(&outside, "private canary").unwrap();
        std::os::unix::fs::symlink(&outside, workspace.join("escape")).unwrap();
        let sandbox = TerminalSandbox::new(&workspace, Path::new("/bin/sh")).unwrap();
        let result = sandbox
            .command("/bin/sh")
            .args(["-c", "echo ok > inside; cat inside"])
            .output()
            .await
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert_eq!(result.stdout, b"ok\n");
        for script in [
            format!("cat '{}'", outside.display()),
            format!("echo hacked > '{}'", outside.display()),
            "cat escape".into(),
            "echo hacked > escape".into(),
            format!("/bin/sh -c \"cat '{}'\"", outside.display()),
            format!("/bin/sh -c \"echo hacked > '{}'\"", outside.display()),
            format!("/bin/ln '{}' stolen", outside.display()),
            format!("/bin/rm '{}'", outside.display()),
            format!("/bin/mv '{}' stolen", outside.display()),
            "launchctl list".into(),
        ] {
            let result = sandbox
                .command("/bin/sh")
                .args(["-c", &script])
                .output()
                .await
                .unwrap();
            assert!(!result.status.success(), "Escape succeeded: {script}");
            assert!(!String::from_utf8_lossy(&result.stdout).contains("private canary"));
        }
        assert_eq!(std::fs::read_to_string(outside).unwrap(), "private canary");
    }

    #[test]
    fn runtime_root_stays_in_a_standalone_package() {
        assert_eq!(
            bob_runtime_root(Path::new("/tmp/bob-pkg/bob.js")),
            Path::new("/tmp/bob-pkg")
        );
        assert_eq!(
            bob_runtime_root(Path::new("/opt/bob/dist/bob.js")),
            Path::new("/opt/bob")
        );
        assert_eq!(
            bob_runtime_root(Path::new("/usr/lib/node_modules/bob/bob.js")),
            Path::new("/usr/lib/node_modules/bob")
        );
        assert_eq!(
            bob_runtime_root(Path::new("/usr/lib/node_modules/@ibm/bob/bob.js")),
            Path::new("/usr/lib/node_modules/@ibm/bob")
        );
        assert_eq!(
            bob_runtime_root(Path::new(
                "/Users/me/.local/lib/node_modules/bobshell/dist/bob.js"
            )),
            Path::new("/Users/me/.local/lib/node_modules/bobshell")
        );
    }

    #[test]
    fn rejects_broad_workspace() {
        assert!(TerminalSandbox::new(Path::new("/"), Path::new("/bin/sh")).is_err());
        assert!(TerminalSandbox::new(&dirs::home_dir().unwrap(), Path::new("/bin/sh")).is_err());
    }

    #[tokio::test]
    async fn bob_js_runtime_does_not_open_parent_of_package() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let pkg = fixture.path().join("bob-pkg");
        std::fs::create_dir(&pkg).unwrap();
        std::fs::write(pkg.join("bob.js"), "console.log(1)\n").unwrap();
        std::fs::write(pkg.join("ok.txt"), "package ok").unwrap();
        let secret = fixture.path().join("secret.txt");
        std::fs::write(&secret, "private canary").unwrap();
        let sandbox = TerminalSandbox::new(&workspace, &pkg.join("bob.js")).unwrap();
        let blocked = sandbox
            .command("/bin/sh")
            .args(["-c", &format!("cat '{}'", secret.display())])
            .output()
            .await
            .unwrap();
        assert!(!blocked.status.success());
        assert!(!String::from_utf8_lossy(&blocked.stdout).contains("private canary"));
        let allowed = sandbox
            .command("/bin/sh")
            .args(["-c", &format!("cat '{}'", pkg.join("ok.txt").display())])
            .output()
            .await
            .unwrap();
        assert!(
            allowed.status.success(),
            "{}",
            String::from_utf8_lossy(&allowed.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&allowed.stdout).trim(),
            "package ok"
        );
    }

    #[test]
    fn rejects_preexisting_hard_link_escape() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(fixture.path().join("outside"), "canary").unwrap();
        std::fs::hard_link(fixture.path().join("outside"), workspace.join("alias")).unwrap();
        assert!(TerminalSandbox::new(&workspace, Path::new("/bin/sh")).is_err());
    }

    #[tokio::test]
    async fn denies_local_service_connections() {
        let fixture = tempfile::tempdir().unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let sandbox = TerminalSandbox::new(fixture.path(), Path::new("/usr/bin/nc")).unwrap();
        let result = sandbox
            .command("/usr/bin/nc")
            .args(["-z", "-w", "1", "127.0.0.1", &port])
            .output()
            .await
            .unwrap();
        assert!(!result.status.success());
        listener.set_nonblocking(true).unwrap();
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[tokio::test]
    async fn denies_private_lan_via_path_wrappers() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let sandbox = TerminalSandbox::new(&workspace, Path::new("/bin/sh")).unwrap();
        // Current macOS Seatbelt cannot filter RFC1918 by CIDR; PATH wrappers do.
        for (host, port) in [
            ("10.255.255.1", "80"),
            ("192.168.255.1", "80"),
            ("172.31.255.1", "80"),
            ("169.254.169.254", "80"),
        ] {
            let result = sandbox
                .command("/bin/sh")
                .args(["-c", &format!("nc -z -w 1 {host} {port}")])
                .output()
                .await
                .unwrap();
            assert!(
                !result.status.success(),
                "private egress to {host}:{port} must be denied by wrappers"
            );
            let stderr = String::from_utf8_lossy(&result.stderr);
            assert!(
                stderr.contains("limitations de la sandbox Bob Work"),
                "stderr must name sandbox limitation: {stderr}"
            );
        }
    }

    #[tokio::test]
    async fn node_preload_blocks_private_dns_lookup() {
        let node = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file());
        let Some(node) = node else {
            return;
        };
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let sandbox = TerminalSandbox::new(&workspace, &node).unwrap();
        let result = sandbox
            .command(&node.to_string_lossy())
            .args([
                "-e",
                "require('dns').lookup('10.1.2.3', (e)=>{ if(e){ console.error(e.message); process.exit(1)} process.exit(0)})",
            ])
            .output()
            .await
            .unwrap();
        assert!(!result.status.success());
        assert!(
            String::from_utf8_lossy(&result.stderr).contains("limitations de la sandbox Bob Work")
        );
    }

    #[tokio::test]
    async fn remounts_unix_bridge_socket_path() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        // Put the socket under the real host home `~/.bob/...` tree — the same
        // denied-/Users-then-remount pattern production Chrome bridge uses.
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let sock_dir = home
            .join(".bob")
            .join("run")
            .join(format!("sandbox-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&sock_dir);
        std::fs::create_dir_all(&sock_dir).unwrap();
        let socket = sock_dir.join("applescript.sock");
        std::fs::write(&socket, "bridge").unwrap();
        let sandbox =
            TerminalSandbox::with_mounts(&workspace, Path::new("/bin/sh"), &[], &[socket.clone()]);
        let sandbox = match sandbox {
            Ok(s) => s,
            Err(_) => {
                let _ = std::fs::remove_dir_all(&sock_dir);
                return;
            }
        };
        let allowed = sandbox
            .command("/bin/sh")
            .args(["-c", &format!("cat '{}'", socket.display())])
            .output()
            .await
            .unwrap();
        let _ = std::fs::remove_dir_all(&sock_dir);
        assert!(
            allowed.status.success(),
            "bridge socket path must be remounted: {}",
            String::from_utf8_lossy(&allowed.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&allowed.stdout).trim(), "bridge");
    }

    #[tokio::test]
    async fn installed_bob_run_does_not_emfile_under_seatbelt() {
        let bob = std::env::var("BOB_SANDBOX_TEST_EXECUTABLE")
            .ok()
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|home| home.join(".local/bin/bob")))
            .filter(|path| path.is_file());
        let Some(bob) = bob else {
            return;
        };
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let sandbox = TerminalSandbox::new(&workspace, &bob).unwrap();
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(45),
            sandbox
                .command(&bob.to_string_lossy())
                .env("BOB_API_KEY", "sandbox-test-not-a-real-key")
                .env("BOBSHELL_API_KEY", "sandbox-test-not-a-real-key")
                .args([
                    "run",
                    "--format",
                    "stream-json",
                    "--accept-license",
                    "--workspace",
                    &workspace.to_string_lossy(),
                    "--max-turns",
                    "1",
                    "Reply with exactly OK and do nothing else.",
                ])
                .output(),
        )
        .await
        .expect("bob run timed out")
        .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            !stdout.contains("EMFILE")
                && !stderr.contains("EMFILE")
                && !stdout.contains("too many open files")
                && !stderr.contains("too many open files"),
            "status={:?} stdout={stdout} stderr={stderr}",
            output.status
        );
        // Auth may fail with the fake key, but Seatbelt+preload must let Node start.
        assert!(
            !stderr.contains("uv_cwd"),
            "cwd denied under Seatbelt: stderr={stderr}"
        );
    }

    #[tokio::test]
    async fn denies_host_passwd_read() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let sandbox = TerminalSandbox::new(&workspace, Path::new("/bin/sh")).unwrap();
        let result = sandbox
            .command("/bin/sh")
            .args(["-c", "cat /etc/passwd 2>/dev/null || cat /private/etc/passwd"])
            .output()
            .await
            .unwrap();
        assert!(!result.status.success());
        assert!(!String::from_utf8_lossy(&result.stdout).contains("root:"));
    }

    #[tokio::test]
    async fn allows_https_for_model_while_blocking_desktop() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let sandbox = TerminalSandbox::new(&workspace, Path::new("/usr/bin/curl")).unwrap();
        let https = sandbox
            .command("/usr/bin/curl")
            .args([
                "-sS",
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                "--connect-timeout",
                "8",
                "https://example.com",
            ])
            .output()
            .await
            .unwrap();
        assert!(
            https.status.success(),
            "HTTPS under Seatbelt must work for model API calls: stdout={} stderr={}",
            String::from_utf8_lossy(&https.stdout),
            String::from_utf8_lossy(&https.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&https.stdout).trim(), "200");

        if let Some(desktop) = dirs::home_dir()
            .map(|h| h.join("Desktop"))
            .filter(|p| p.is_dir())
        {
            let blocked = sandbox
                .command("/bin/sh")
                .args(["-c", &format!("ls '{}'", desktop.display())])
                .output()
                .await
                .unwrap();
            assert!(
                !blocked.status.success(),
                "Desktop must stay blocked under Cowork-like sandbox"
            );
        }
    }

    #[tokio::test]
    async fn denies_absolute_writes_outside_workspace() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let sandbox = TerminalSandbox::new(&workspace, Path::new("/bin/sh")).unwrap();
        let Some(home) = dirs::home_dir() else {
            return;
        };
        for folder in ["Desktop", "Documents", "Downloads"] {
            let dir = home.join(folder);
            if !dir.is_dir() {
                continue;
            }
            let canary = dir.join(format!(
                ".bob-sandbox-write-probe-{}",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&canary);
            let result = sandbox
                .command("/bin/sh")
                .args(["-c", &format!("echo leaked > '{}'", canary.display())])
                .output()
                .await
                .unwrap();
            assert!(
                !result.status.success(),
                "write to {} must be denied",
                dir.display()
            );
            assert!(
                !canary.exists(),
                "sandbox must not create {}",
                canary.display()
            );
        }
        // ~/Desktop under private HOME is allowed — that is not the host Desktop.
        let private = sandbox
            .command("/bin/sh")
            .args(["-c", "mkdir -p \"$HOME/Desktop\" && echo ok > \"$HOME/Desktop/private.txt\" && cat \"$HOME/Desktop/private.txt\""])
            .output()
            .await
            .unwrap();
        assert!(
            private.status.success(),
            "private sandbox HOME must remain writable: {}",
            String::from_utf8_lossy(&private.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&private.stdout).trim(), "ok");
    }

    #[tokio::test]
    async fn shared_runtime_tree_under_bob_is_readable() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let runtimes = home.join(".bob").join("runtimes");
        if !runtimes.is_dir() {
            return;
        }
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let sandbox = TerminalSandbox::with_extra_reads(
            &workspace,
            Path::new("/bin/sh"),
            &[runtimes.clone()],
        )
        .unwrap();
        let result = sandbox
            .command("/bin/sh")
            .args(["-c", &format!("ls '{}'", runtimes.display())])
            .output()
            .await
            .unwrap();
        assert!(
            result.status.success(),
            "shared ~/.bob/runtimes must be remounted: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[tokio::test]
    async fn host_bob_skills_readable_without_explicit_extra_reads() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let skills = home.join(".bob").join("skills");
        if !skills.is_dir() {
            return;
        }
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        // Even TerminalSandbox::new (no extra_reads) must remount ~/.bob so
        // cloud-architect / diagram plugins work with sandbox_mode=true.
        let sandbox = TerminalSandbox::new(&workspace, Path::new("/bin/sh")).unwrap();
        let result = sandbox
            .command("/bin/sh")
            .args(["-c", &format!("test -d '{}' && ls '{}'", skills.display(), skills.display())])
            .output()
            .await
            .unwrap();
        assert!(
            result.status.success(),
            "host ~/.bob/skills must be remounted for internal runtimes: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let plugin = home
            .join(".bob")
            .join("skills")
            .join("cloud-architect")
            .join("scripts")
            .join("render_professional_svg.py");
        if plugin.is_file() {
            let render = sandbox
                .command("/bin/sh")
                .args(["-c", &format!("test -r '{}'", plugin.display())])
                .output()
                .await
                .unwrap();
            assert!(
                render.status.success(),
                "cloud-architect renderer must be readable in sandbox: {}",
                String::from_utf8_lossy(&render.stderr)
            );
        }
    }

    #[tokio::test]
    async fn workspace_write_and_private_net_and_host_file_matrix() {
        let fixture = tempfile::tempdir().unwrap();
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let sandbox = TerminalSandbox::new(&workspace, Path::new("/bin/sh")).unwrap();

        // Allowed: write in connected workspace.
        let ok = sandbox
            .command("/bin/sh")
            .args(["-c", "echo hello > note.txt && cat note.txt"])
            .output()
            .await
            .unwrap();
        assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
        assert_eq!(String::from_utf8_lossy(&ok.stdout).trim(), "hello");
        assert_eq!(std::fs::read_to_string(workspace.join("note.txt")).unwrap().trim(), "hello");

        // Blocked: host Desktop (if present) — sandbox limitation.
        if let Some(desktop) = dirs::home_dir().map(|h| h.join("Desktop")).filter(|p| p.is_dir()) {
            let blocked = sandbox
                .command("/bin/sh")
                .args(["-c", &format!("ls '{}'", desktop.display())])
                .output()
                .await
                .unwrap();
            assert!(!blocked.status.success());
        }

        // Blocked: private network via PATH wrapper — explicit sandbox message.
        let lan = sandbox
            .command("/bin/sh")
            .args(["-c", "curl -sS --connect-timeout 2 http://192.168.1.1/ || true"])
            .output()
            .await
            .unwrap();
        let stderr = String::from_utf8_lossy(&lan.stderr);
        assert!(
            stderr.contains("limitations de la sandbox Bob Work"),
            "private net must name sandbox limitation: {stderr}"
        );
    }

    #[test]
    fn sandbox_limit_messages_name_sandbox() {
        for kind in [
            SandboxLimitKind::WallClock,
            SandboxLimitKind::PrivateNetwork,
            SandboxLimitKind::ComputerUse,
            SandboxLimitKind::FileAccess,
            SandboxLimitKind::ExternalRuntime,
        ] {
            let message = sandbox_limit_message(kind);
            assert!(
                message.contains("limitations de la sandbox Bob Work"),
                "{message}"
            );
        }
        let external = sandbox_limit_message(SandboxLimitKind::ExternalRuntime);
        assert!(
            external.contains("runtime externe") && external.contains("Réglages → Permissions"),
            "{external}"
        );
    }
}
