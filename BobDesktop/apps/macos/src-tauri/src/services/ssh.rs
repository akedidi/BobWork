use crate::error::{AppError, AppResult};
use crate::models::ssh::{
    SaveSshServerInput, SshExecResult, SshRemoteEntry, SshServer, SshSyncResult,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub const SSH_MCP_NAME: &str = "bob-work-ssh";
const SSH_MCP_SCRIPT: &str = include_str!("../../resources/ssh/ssh_mcp.py");

pub struct SshService {
    data_dir: PathBuf,
}

struct TerminalProcess {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
}
#[derive(Clone, Default)]
pub struct SshTerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalProcess>>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
    stream: String,
}

impl SshService {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self {
            data_dir: data_dir.as_ref().to_path_buf(),
        }
    }
    fn dir(&self) -> PathBuf {
        self.data_dir.join("ssh")
    }
    fn profiles_path(&self) -> PathBuf {
        self.dir().join("servers.json")
    }
    fn mirrors_dir(&self) -> PathBuf {
        self.dir().join("mirrors")
    }

    pub fn list(&self) -> Vec<SshServer> {
        std::fs::read(self.profiles_path())
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default()
    }

    fn persist(&self, servers: &[SshServer]) -> AppResult<()> {
        std::fs::create_dir_all(self.dir()).map_err(|e| AppError::Io(e.to_string()))?;
        let raw = serde_json::to_vec_pretty(servers).map_err(|e| AppError::Io(e.to_string()))?;
        let tmp = self.profiles_path().with_extension("json.tmp");
        std::fs::write(&tmp, &raw).map_err(|e| AppError::Io(e.to_string()))?;
        std::fs::rename(tmp, self.profiles_path()).map_err(|e| AppError::Io(e.to_string()))?;
        self.refresh_mcp_bundle(servers)
    }

    pub fn save(&self, input: SaveSshServerInput) -> AppResult<SshServer> {
        validate_host(&input.host)?;
        validate_user(&input.user)?;
        if input.name.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "Le nom du serveur est requis.".into(),
            ));
        }
        let remote_root = normalize_remote_root(&input.remote_root)?;
        let mut servers = self.list();
        let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let local = self.mirrors_dir().join(&id).to_string_lossy().to_string();
        let server = SshServer {
            id: id.clone(),
            name: input.name.trim().into(),
            host: input.host.trim().into(),
            port: input.port.unwrap_or(22),
            user: input.user.trim().into(),
            identity_file: input.identity_file.filter(|v| !v.trim().is_empty()),
            remote_root,
            local_mirror_path: local,
            enabled: input.enabled.unwrap_or(true),
        };
        if let Some(existing) = servers.iter_mut().find(|item| item.id == id) {
            *existing = server.clone();
        } else {
            servers.push(server.clone());
        }
        self.persist(&servers)?;
        Ok(server)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let mut servers = self.list();
        let before = servers.len();
        servers.retain(|server| server.id != id);
        if servers.len() == before {
            return Err(AppError::NotFound("Serveur SSH introuvable.".into()));
        }
        self.persist(&servers)
    }

    fn get(&self, id: &str) -> AppResult<SshServer> {
        self.list()
            .into_iter()
            .find(|server| server.id == id && server.enabled)
            .ok_or_else(|| AppError::NotFound("Serveur SSH introuvable ou désactivé.".into()))
    }

    fn ssh_command(&self, server: &SshServer) -> Command {
        let mut command = Command::new("ssh");
        command
            .args([
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=12",
                "-o",
                "StrictHostKeyChecking=accept-new",
            ])
            .args(["-p", &server.port.to_string()]);
        if let Some(identity) = &server.identity_file {
            command.args(["-i", &expand_home(identity)]);
        }
        command.arg(format!("{}@{}", server.user, server.host));
        command
    }

    pub fn terminal_command(&self, id: &str) -> AppResult<Command> {
        let server = self.get(id)?;
        let mut command = Command::new("ssh");
        command
            .args([
                "-tt",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=12",
                "-o",
                "StrictHostKeyChecking=accept-new",
            ])
            .args(["-p", &server.port.to_string()]);
        if let Some(identity) = &server.identity_file {
            command.args(["-i", &expand_home(identity)]);
        }
        command.arg(format!("{}@{}", server.user, server.host));
        Ok(command)
    }

    pub fn test(&self, id: &str) -> AppResult<SshExecResult> {
        self.exec(id, "printf 'BOB_SSH_OK'")
    }

    pub fn exec(&self, id: &str, command_text: &str) -> AppResult<SshExecResult> {
        if command_text.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "La commande SSH est vide.".into(),
            ));
        }
        if command_text.len() > 32_768 {
            return Err(AppError::ValidationFailed(
                "La commande SSH est trop longue.".into(),
            ));
        }
        let server = self.get(id)?;
        let output = self
            .ssh_command(&server)
            .arg(command_text)
            .output()
            .map_err(|e| AppError::Io(format!("Impossible de lancer OpenSSH : {e}")))?;
        Ok(SshExecResult {
            stdout: String::from_utf8_lossy(&output.stdout).into(),
            stderr: String::from_utf8_lossy(&output.stderr).into(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }

    pub fn read(&self, id: &str, path: &str, max_bytes: usize) -> AppResult<String> {
        let server = self.get(id)?;
        let path = resolve_remote_path(&server.remote_root, path)?;
        let command = format!(
            "head -c {} -- {}",
            max_bytes.clamp(1, 2_000_000),
            shell_quote(&path)
        );
        let result = self.exec(id, &command)?;
        if result.exit_code != 0 {
            return Err(AppError::Io(result.stderr));
        }
        Ok(result.stdout)
    }

    pub fn write(&self, id: &str, path: &str, content: &str) -> AppResult<()> {
        if content.len() > 2_000_000 {
            return Err(AppError::ValidationFailed(
                "Le fichier distant dépasse 2 Mo.".into(),
            ));
        }
        let server = self.get(id)?;
        let path = resolve_remote_path(&server.remote_root, path)?;
        let parent = Path::new(&path)
            .parent()
            .and_then(Path::to_str)
            .unwrap_or(&server.remote_root);
        let remote = format!(
            "mkdir -p -- {} && cat > {}",
            shell_quote(parent),
            shell_quote(&path)
        );
        let mut child = self
            .ssh_command(&server)
            .arg(remote)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::Io(e.to_string()))?;
        child
            .stdin
            .take()
            .ok_or_else(|| AppError::Io("stdin SSH indisponible".into()))?
            .write_all(content.as_bytes())
            .map_err(|e| AppError::Io(e.to_string()))?;
        let output = child
            .wait_with_output()
            .map_err(|e| AppError::Io(e.to_string()))?;
        if !output.status.success() {
            return Err(AppError::Io(String::from_utf8_lossy(&output.stderr).into()));
        }
        Ok(())
    }

    pub fn browse(&self, id: &str, path: &str) -> AppResult<Vec<SshRemoteEntry>> {
        let server = self.get(id)?;
        let absolute = resolve_remote_path(&server.remote_root, path)?;
        let q = shell_quote(&absolute);
        // Run the glob loop in a POSIX shell instead of the account's login shell.
        // zsh aborts on unmatched globs (for example when the directory is empty),
        // whereas this loop intentionally ignores unmatched patterns.
        let browse_script = format!("cd -- {q} && for f in ./* ./.[!.]* ./..?*; do [ -e \"$f\" ] || continue; if [ -d \"$f\" ]; then t=d; else t=f; fi; s=$(wc -c < \"$f\" 2>/dev/null || printf 0); printf '%s\\t%s\\t%s\\n' \"$t\" \"$s\" \"${{f#./}}\"; done");
        let command = format!("sh -c {}", shell_quote(&browse_script));
        let result = self.exec(id, &command)?;
        if result.exit_code != 0 {
            return Err(AppError::Io(result.stderr));
        }
        let mut entries = Vec::new();
        for line in result.stdout.lines() {
            let mut parts = line.splitn(3, '\t');
            let kind = if parts.next() == Some("d") {
                "directory"
            } else {
                "file"
            };
            let size = parts
                .next()
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0);
            let Some(name) = parts.next() else { continue };
            entries.push(SshRemoteEntry {
                name: name.into(),
                path: format!("{}/{}", path.trim_end_matches('/'), name)
                    .trim_start_matches('/')
                    .into(),
                kind: kind.into(),
                size,
            });
        }
        entries.sort_by(|a, b| {
            (a.kind != "directory", a.name.to_lowercase())
                .cmp(&(b.kind != "directory", b.name.to_lowercase()))
        });
        Ok(entries)
    }

    pub fn sync(&self, id: &str, direction: &str) -> AppResult<SshSyncResult> {
        let server = self.get(id)?;
        std::fs::create_dir_all(&server.local_mirror_path)
            .map_err(|e| AppError::Io(e.to_string()))?;
        let mut command = Command::new("rsync");
        command
            .args(["-az", "--exclude", ".git/"])
            .args(["-e", &ssh_transport(&server)]);
        let remote_path = format!("{}/", server.remote_root.trim_end_matches('/'));
        let remote = format!(
            "{}@{}:{}",
            server.user,
            server.host,
            shell_quote(&remote_path)
        );
        match direction {
            "pull" => {
                command
                    .arg(remote)
                    .arg(format!("{}/", server.local_mirror_path));
            }
            "push" => {
                command
                    .arg(format!("{}/", server.local_mirror_path))
                    .arg(remote);
            }
            _ => {
                return Err(AppError::ValidationFailed(
                    "Direction de synchronisation invalide.".into(),
                ))
            }
        }
        let output = command
            .output()
            .map_err(|e| AppError::Io(format!("rsync indisponible : {e}")))?;
        if !output.status.success() {
            return Err(AppError::Io(String::from_utf8_lossy(&output.stderr).into()));
        }
        Ok(SshSyncResult {
            local_path: server.local_mirror_path,
            output: String::from_utf8_lossy(&output.stdout).into(),
        })
    }

    fn refresh_mcp_bundle(&self, servers: &[SshServer]) -> AppResult<()> {
        let dir = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Dossier utilisateur introuvable".into()))?
            .join(".bob/resources/ssh");
        std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
        std::fs::write(dir.join("server.py"), SSH_MCP_SCRIPT)
            .map_err(|e| AppError::Io(e.to_string()))?;
        std::fs::write(
            dir.join("servers.json"),
            serde_json::to_vec_pretty(servers).map_err(|e| AppError::Io(e.to_string()))?,
        )
        .map_err(|e| AppError::Io(e.to_string()))?;
        Ok(())
    }

    pub fn sync_mcp(&self, bob_path: &str) -> AppResult<()> {
        let servers = self.list();
        self.refresh_mcp_bundle(&servers)?;
        let dir = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Dossier utilisateur introuvable".into()))?
            .join(".bob/resources/ssh");
        let config: Value =
            json!({"command":"python3","args":["server.py"],"cwd":dir.to_string_lossy()});
        run_bob(
            bob_path,
            &["mcp", "add-json", SSH_MCP_NAME, &config.to_string()],
        )?;
        run_bob(bob_path, &["mcp", "enable", SSH_MCP_NAME])
    }
}

impl SshTerminalManager {
    pub fn start(&self, app: AppHandle, mut command: Command, id: String) -> AppResult<String> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| AppError::Io(format!("Impossible d’ouvrir le terminal SSH : {e}")))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Io("Entrée terminal indisponible".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Io("Sortie terminal indisponible".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Io("Erreur terminal indisponible".into()))?;
        self.sessions
            .lock()
            .map_err(|_| AppError::Unknown("Verrou terminal indisponible".into()))?
            .insert(id.clone(), TerminalProcess { child, stdin });
        stream_terminal(app.clone(), id.clone(), "stdout", stdout);
        stream_terminal(app, id.clone(), "stderr", stderr);
        Ok(id)
    }

    pub fn write(&self, id: &str, data: &str) -> AppResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Unknown("Verrou terminal indisponible".into()))?;
        let process = sessions
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound("Session terminal terminée.".into()))?;
        process
            .stdin
            .write_all(data.as_bytes())
            .and_then(|_| process.stdin.flush())
            .map_err(|e| AppError::Io(e.to_string()))
    }

    pub fn stop(&self, id: &str) -> AppResult<()> {
        if let Some(mut process) = self
            .sessions
            .lock()
            .map_err(|_| AppError::Unknown("Verrou terminal indisponible".into()))?
            .remove(id)
        {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
        Ok(())
    }
}

fn stream_terminal<R: Read + Send + 'static>(
    app: AppHandle,
    session_id: String,
    stream: &'static str,
    mut reader: R,
) {
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let _ = app.emit(
                        "ssh-terminal-output",
                        TerminalOutput {
                            session_id: session_id.clone(),
                            data: String::from_utf8_lossy(&buffer[..size]).into(),
                            stream: stream.into(),
                        },
                    );
                }
            }
        }
    });
}

fn validate_host(value: &str) -> AppResult<()> {
    if value.trim().is_empty() || value.starts_with('-') || value.chars().any(char::is_whitespace) {
        Err(AppError::ValidationFailed("Hôte SSH invalide.".into()))
    } else {
        Ok(())
    }
}
fn validate_user(value: &str) -> AppResult<()> {
    if value.is_empty()
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    {
        Err(AppError::ValidationFailed(
            "Utilisateur SSH invalide.".into(),
        ))
    } else {
        Ok(())
    }
}
fn normalize_remote_root(value: &str) -> AppResult<String> {
    let v = value.trim();
    if !v.starts_with('/') || v.contains('\0') {
        return Err(AppError::ValidationFailed(
            "La racine distante doit être un chemin absolu.".into(),
        ));
    }
    let normalized = v.trim_end_matches('/').to_string().replace("//", "/");
    Ok(if normalized.is_empty() {
        "/".into()
    } else {
        normalized
    })
}
fn resolve_remote_path(root: &str, relative: &str) -> AppResult<String> {
    let rel = relative.trim().trim_start_matches('/');
    if rel.split('/').any(|p| p == "..") || rel.contains('\0') {
        return Err(AppError::ValidationFailed(
            "Chemin distant non autorisé.".into(),
        ));
    }
    Ok(if rel.is_empty() {
        root.into()
    } else {
        format!("{}/{}", root.trim_end_matches('/'), rel)
    })
}
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn expand_home(value: &str) -> String {
    value
        .strip_prefix("~/")
        .and_then(|rest| dirs::home_dir().map(|home| home.join(rest).to_string_lossy().to_string()))
        .unwrap_or_else(|| value.to_string())
}
fn ssh_transport(server: &SshServer) -> String {
    let mut v = format!(
        "ssh -p {} -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
        server.port
    );
    if let Some(key) = &server.identity_file {
        v.push_str(" -i ");
        v.push_str(&shell_quote(&expand_home(key)));
    }
    v
}
fn run_bob(path: &str, args: &[&str]) -> AppResult<()> {
    let out = Command::new(path)
        .args(args)
        .output()
        .map_err(|e| AppError::BobExecutionFailed(e.to_string()))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(AppError::BobExecutionFailed(
            String::from_utf8_lossy(&out.stderr).into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_cannot_escape_root() {
        assert!(resolve_remote_path("/srv/app", "../etc/passwd").is_err());
        assert_eq!(
            resolve_remote_path("/srv/app", "src/main.rs").unwrap(),
            "/srv/app/src/main.rs"
        );
    }
    #[test]
    fn root_path_is_preserved() {
        assert_eq!(normalize_remote_root("/").unwrap(), "/");
    }
    #[test]
    fn shell_values_are_quoted() {
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }
    #[test]
    fn bundled_mcp_exposes_required_operations() {
        for name in [
            "ssh_exec",
            "ssh_read",
            "ssh_write",
            "ssh_browse",
            "ssh_sync",
        ] {
            assert!(SSH_MCP_SCRIPT.contains(name));
        }
    }

    #[test]
    #[ignore = "requires BOB_WORK_LIVE_SSH_HOST, BOB_WORK_LIVE_SSH_USER and BOB_WORK_LIVE_SSH_ROOT"]
    fn live_ssh_exec_read_write_and_browse_roundtrip() {
        let host = std::env::var("BOB_WORK_LIVE_SSH_HOST").expect("live SSH host");
        let user = std::env::var("BOB_WORK_LIVE_SSH_USER").expect("live SSH user");
        let remote_root = std::env::var("BOB_WORK_LIVE_SSH_ROOT").expect("live SSH root");
        let port = std::env::var("BOB_WORK_LIVE_SSH_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(22);
        let identity_file = std::env::var("BOB_WORK_LIVE_SSH_IDENTITY").ok();
        let data = tempfile::tempdir().expect("temporary SSH registry");
        let service = SshService::new(data.path());
        let id = "live-ssh";
        let server = SshServer {
            id: id.into(),
            name: "Live SSH test".into(),
            host,
            port,
            user,
            identity_file,
            remote_root,
            local_mirror_path: data.path().join("mirror").to_string_lossy().into(),
            enabled: true,
        };
        std::fs::create_dir_all(data.path().join("ssh")).unwrap();
        std::fs::write(
            data.path().join("ssh/servers.json"),
            serde_json::to_vec(&vec![server]).unwrap(),
        )
        .unwrap();

        assert_eq!(service.test(id).unwrap().stdout, "BOB_SSH_OK");
        let filename = format!(".bob-work-ssh-test-{}.txt", Uuid::new_v4());
        service
            .write(id, &filename, "roundtrip SSH Bob Work")
            .unwrap();
        assert_eq!(
            service.read(id, &filename, 1024).unwrap(),
            "roundtrip SSH Bob Work"
        );
        assert!(service
            .browse(id, "")
            .unwrap()
            .iter()
            .any(|entry| entry.name == filename));
        let server = service.get(id).unwrap();
        let remote_file = resolve_remote_path(&server.remote_root, &filename).unwrap();
        let cleanup = service.exec(id, &format!("rm -f -- {}", shell_quote(&remote_file)));
        assert!(cleanup.is_ok_and(|result| result.exit_code == 0));
    }
}
