//! Seatbelt confinement inherited by Bob's terminal commands and descendants.
//! Network remains available for model inference; this is filesystem/process isolation.
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

pub struct TerminalSandbox {
    _state: tempfile::TempDir,
    home: PathBuf,
    workspace: PathBuf,
    profile: String,
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
            return Err(AppError::Security("Le workspace contient un fichier à liens physiques multiples. Fournissez une copie indépendante dans un workspace dédié.".into()));
        }
        if metadata.is_dir() {
            reject_hard_links(&entry.path())?;
        }
    }
    Ok(())
}

impl TerminalSandbox {
    pub fn new(workspace: &Path, executable: &Path) -> AppResult<Self> {
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
        let mut profile = String::from(
            "(version 1)\n(deny default)\n(allow process-exec process-fork)\n(allow signal (target self))\n(allow sysctl-read)\n(allow file-read-metadata)\n(allow network-outbound (remote tcp \"*:443\"))\n(allow mach-lookup (global-name \"com.apple.system.logger\") (global-name \"com.apple.system.notification_center\") (global-name \"com.apple.trustd.agent\") (global-name \"com.apple.networkd\"))\n"
        );
        profile.push_str("(allow mach-lookup (global-name \"com.apple.SystemConfiguration.DNSConfiguration\") (global-name \"com.apple.mDNSResponder\"))\n");
        // OS tools and runtime libraries are read-only, never the user's home/configuration.
        for path in [
            "/System",
            "/usr/lib",
            "/usr/share",
            "/usr/bin",
            "/bin",
            "/sbin",
            "/usr/sbin",
            "/usr/local/bin",
            "/usr/local/lib",
            "/opt/homebrew/Cellar",
            "/opt/homebrew/opt",
            "/opt/homebrew/lib",
            "/opt/homebrew/bin",
            "/private/var/db/dyld",
        ] {
            profile.push_str(&format!(
                "(allow file-read* (subpath {}))\n",
                quoted(Path::new(path))?
            ));
        }
        for path in [
            "/",
            "/dev/null",
            "/dev/urandom",
            "/dev/random",
            "/private/etc/passwd",
            "/private/etc/localtime",
            "/private/etc/resolv.conf",
            "/private/etc/hosts",
            "/private/etc/services",
            "/private/etc/protocols",
            "/private/etc/ssl/cert.pem",
        ] {
            profile.push_str(&format!(
                "(allow file-read* (literal {}))\n",
                quoted(Path::new(path))?
            ));
        }
        profile.push_str("(allow file-write* (literal \"/dev/null\"))\n");
        // The distributed JS entry point needs its package assets, not ~/.local as a whole.
        let runtime = if executable.file_name().is_some_and(|n| n == "bob.js") {
            executable
                .parent()
                .and_then(Path::parent)
                .ok_or_else(|| AppError::Security("Runtime Bob invalide".into()))?
        } else {
            &executable
        };
        profile.push_str(&format!(
            "(allow file-read* (subpath {}))\n",
            quoted(runtime)?
        ));
        for path in [&workspace, &home] {
            profile.push_str(&format!(
                "(allow file-read* file-write* (subpath {}))\n",
                quoted(path)?
            ));
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
        cmd.env_clear()
            .env(
                "PATH",
                "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            )
            .env("HOME", &self.home)
            .env("TMPDIR", self.home.join("tmp"))
            .env("LANG", "en_US.UTF-8")
            .env(
                "NODE_OPTIONS",
                format!("--require={}", self.home.join("sandbox-node.cjs").display()),
            )
            .current_dir(&self.workspace);
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
    fn rejects_broad_workspace() {
        assert!(TerminalSandbox::new(Path::new("/"), Path::new("/bin/sh")).is_err());
        assert!(TerminalSandbox::new(&dirs::home_dir().unwrap(), Path::new("/bin/sh")).is_err());
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
    #[ignore = "requires a locally installed Bob CLI; no API key or model call"]
    async fn installed_bob_starts_inside_sandbox() {
        let bob =
            std::env::var("BOB_SANDBOX_TEST_EXECUTABLE").expect("explicit Bob executable required");
        let workspace = tempfile::tempdir().unwrap();
        let sandbox = TerminalSandbox::new(workspace.path(), Path::new(&bob)).unwrap();
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            sandbox
                .command(&bob)
                .env("BOB_API_KEY", "sandbox-test-not-a-real-key")
                .env("BOBSHELL_API_KEY", "sandbox-test-not-a-real-key")
                .args(["run", "--help"])
                .output(),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(
            output.status.success(),
            "status={:?} stdout={} stderr={}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("--workspace"));
    }
}
