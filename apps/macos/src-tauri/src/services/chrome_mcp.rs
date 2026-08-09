use crate::error::{AppError, AppResult};
use crate::services::workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;

pub const CHROME_MCP_NAME: &str = "bob-work-chrome-control";
const CHROME_MCP_SCRIPT: &str = include_str!("../../resources/chrome/chrome_mcp.py");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacosChromeControlStatus {
    pub chrome_installed: bool,
    pub mcp_configured: bool,
    pub mcp_enabled: bool,
    pub automation: String,
    pub automation_message: String,
}

pub struct ChromeMcpService;

impl ChromeMcpService {
    pub fn new() -> Self {
        Self
    }

    pub fn bundle_dir() -> AppResult<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        Ok(home.join(".bob").join("resources").join("chrome"))
    }

    pub fn ensure_bundle() -> AppResult<PathBuf> {
        let bundle_dir = Self::bundle_dir()?;
        std::fs::create_dir_all(&bundle_dir).map_err(|error| {
            AppError::Io(format!("Failed to create Chrome MCP directory: {}", error))
        })?;
        let script_path = bundle_dir.join("server.py");
        std::fs::write(&script_path, CHROME_MCP_SCRIPT).map_err(|error| {
            AppError::Io(format!("Failed to write Chrome MCP script: {}", error))
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&script_path) {
                let mut permissions = metadata.permissions();
                permissions.set_mode(0o755);
                let _ = std::fs::set_permissions(&script_path, permissions);
            }
        }
        Ok(bundle_dir)
    }

    pub fn mcp_config(bundle_dir: &PathBuf) -> Value {
        json!({
            "command": "python3",
            "args": ["server.py"],
            "cwd": bundle_dir.to_string_lossy(),
        })
    }

    pub fn is_configured(&self) -> bool {
        WorkspaceService::new()
            .list_mcp_servers()
            .into_iter()
            .any(|server| server.name == CHROME_MCP_NAME)
    }

    pub fn is_enabled(&self) -> bool {
        WorkspaceService::new()
            .list_mcp_servers()
            .into_iter()
            .any(|server| server.name == CHROME_MCP_NAME && server.enabled)
    }

    pub fn sync(&self, bob_path: &str, enabled: bool) -> AppResult<()> {
        if !enabled {
            if self.is_configured() {
                run_bob(bob_path, &["mcp", "disable", CHROME_MCP_NAME])?;
            }
            return Ok(());
        }

        let bundle_dir = Self::ensure_bundle()?;
        let config = Self::mcp_config(&bundle_dir);
        run_bob(
            bob_path,
            &[
                "mcp",
                "add-json",
                CHROME_MCP_NAME,
                &config.to_string(),
            ],
        )?;
        run_bob(bob_path, &["mcp", "enable", CHROME_MCP_NAME])?;
        Ok(())
    }

    pub fn status(&self) -> MacosChromeControlStatus {
        let chrome_installed = Self::chrome_installed();
        let mcp_configured = self.is_configured();
        let mcp_enabled = self.is_enabled();
        let (automation, automation_message) = Self::probe_chrome_automation();
        MacosChromeControlStatus {
            chrome_installed,
            mcp_configured,
            mcp_enabled,
            automation,
            automation_message,
        }
    }

    pub fn chrome_installed() -> bool {
        if std::env::consts::OS != "macos" {
            return false;
        }
        std::path::Path::new("/Applications/Google Chrome.app").exists()
    }

    pub fn probe_chrome_automation() -> (String, String) {
        if std::env::consts::OS != "macos" {
            return (
                "unavailable".into(),
                "Le contrôle Chrome n’est disponible que sur macOS.".into(),
            );
        }
        if !Self::chrome_installed() {
            return (
                "chrome_missing".into(),
                "Installez Google Chrome pour utiliser le contrôle navigateur.".into(),
            );
        }
        let script = r#"tell application "Google Chrome"
  if (count of windows) = 0 then return "NO_WINDOW"
  return title of active tab of front window
end tell"#;
        let output = Command::new("osascript").args(["-e", script]).output();
        match output {
            Ok(result) if result.status.success() => {
                if String::from_utf8_lossy(&result.stdout).trim() == "NO_WINDOW" {
                    (
                        "granted".into(),
                        "Automatisation accordée. Ouvrez Chrome pour lire les onglets actifs.".into(),
                    )
                } else {
                    (
                        "granted".into(),
                        "Automatisation accordée à Google Chrome.".into(),
                    )
                }
            }
            Ok(result) => {
                let stderr = String::from_utf8_lossy(&result.stderr).to_ascii_lowercase();
                if stderr.contains("not authorized")
                    || stderr.contains("autorisation")
                    || stderr.contains("(-1743)")
                {
                    (
                        "denied".into(),
                        "Autorisez python3 (ou le terminal Bob) à contrôler Google Chrome dans Réglages Système → Automatisation.".into(),
                    )
                } else {
                    (
                        "unknown".into(),
                        format!(
                            "Impossible de vérifier Automatisation : {}",
                            String::from_utf8_lossy(&result.stderr).trim()
                        ),
                    )
                }
            }
            Err(error) => (
                "unknown".into(),
                format!("Impossible d’exécuter la sonde Automatisation : {}", error),
            ),
        }
    }
}

fn run_bob(bob_path: &str, args: &[&str]) -> AppResult<()> {
    let output = Command::new(bob_path)
        .args(args)
        .output()
        .map_err(|error| AppError::BobExecutionFailed(error.to_string()))?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::BobExecutionFailed(if message.is_empty() {
        format!("Bob MCP command failed with status {}", output.status)
    } else {
        message
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_script_exposes_chrome_tools() {
        assert!(CHROME_MCP_SCRIPT.contains("chrome_list_tabs"));
        assert!(CHROME_MCP_SCRIPT.contains("chrome_execute_js"));
    }

    #[test]
    fn mcp_config_points_to_local_server_script() {
        let bundle_dir = PathBuf::from("/tmp/bob-work-chrome");
        let config = ChromeMcpService::mcp_config(&bundle_dir);
        assert_eq!(config["command"], "python3");
        assert_eq!(config["args"], json!(["server.py"]));
        assert_eq!(config["cwd"], "/tmp/bob-work-chrome");
    }
}
