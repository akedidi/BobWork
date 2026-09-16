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
    pub app_name: String,
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
        let mut env = serde_json::Map::new();
        #[cfg(target_os = "macos")]
        {
            env.insert(
                "BOB_WORK_APPLESCRIPT_SOCKET".into(),
                json!(crate::macos_applescript_bridge::socket_path_string()),
            );
            env.insert(
                "BOB_WORK_APP_NAME".into(),
                json!(crate::app_identity::app_display_name()),
            );
            env.insert(
                "BOB_WORK_BUNDLE_ID".into(),
                json!(crate::app_identity::bundle_identifier()),
            );
        }
        json!({
            "command": "python3",
            "args": ["server.py"],
            "cwd": bundle_dir.to_string_lossy(),
            "env": env,
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
                run_bob(
                    bob_path,
                    &["mcp", "disable", CHROME_MCP_NAME, "--scope", "global"],
                )?;
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
                "--scope",
                "global",
                CHROME_MCP_NAME,
                &config.to_string(),
            ],
        )?;
        run_bob(
            bob_path,
            &["mcp", "enable", CHROME_MCP_NAME, "--scope", "global"],
        )?;
        Ok(())
    }

    pub fn status(&self) -> MacosChromeControlStatus {
        self.status_for_app(&crate::app_identity::app_display_name())
    }

    pub fn mcp_status(&self, app_name: &str) -> MacosChromeControlStatus {
        MacosChromeControlStatus {
            chrome_installed: Self::chrome_installed(),
            mcp_configured: self.is_configured(),
            mcp_enabled: self.is_enabled(),
            automation: "unknown".into(),
            automation_message: String::new(),
            app_name: app_name.to_string(),
        }
    }

    pub fn status_for_app(&self, app_name: &str) -> MacosChromeControlStatus {
        let mut status = self.mcp_status(app_name);
        let (automation, automation_message) = Self::probe_chrome_automation_for_app(app_name);
        status.automation = automation;
        status.automation_message = automation_message;
        status
    }

    pub fn chrome_installed() -> bool {
        if std::env::consts::OS != "macos" {
            return false;
        }
        std::path::Path::new("/Applications/Google Chrome.app").exists()
    }

    pub fn probe_chrome_automation() -> (String, String) {
        Self::probe_chrome_automation_for_app(&crate::app_identity::app_display_name())
    }

    pub fn probe_chrome_automation_for_app(app_name: &str) -> (String, String) {
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
        // E2E / headless CI: never talk to Chrome via AppleScript — Automation
        // TCC prompts hang the Tokio runtime and freeze the whole app.
        #[cfg(feature = "e2e")]
        {
            return (
                "denied".into(),
                "E2E : sonde Automatisation Chrome désactivée (pas de dialogue système).".into(),
            );
        }
        #[cfg(all(target_os = "macos", not(feature = "e2e")))]
        {
            // In-process probe only so Automation lists the running app, never osascript.
            return crate::macos_permissions::probe_chrome_automation_in_process_for_app(app_name);
        }
        #[allow(unreachable_code)]
        ("unavailable".into(), "Non disponible.".into())
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
        assert!(CHROME_MCP_SCRIPT.contains("web_fetch"));
        assert!(CHROME_MCP_SCRIPT.contains("fetch_background_url"));
        assert!(CHROME_MCP_SCRIPT.contains("contentSource"));
        assert!(CHROME_MCP_SCRIPT.contains("chrome_javascript_from_applescript_disabled"));
        assert!(CHROME_MCP_SCRIPT.contains("BOB_WORK_ALLOW_VISIBLE_CHROME"));
        assert!(CHROME_MCP_SCRIPT.contains("open location"));
        assert!(
            !CHROME_MCP_SCRIPT.contains("open\", \"-a\", \"Google Chrome\""),
            "chrome_open_url must use the AppleScript bridge, not Launch Services open -a"
        );
        let compatibility_body = CHROME_MCP_SCRIPT
            .split("def browser_snapshot(arguments: dict) -> dict:")
            .nth(1)
            .and_then(|value| value.split("\ndef handle_call").next())
            .expect("browser_snapshot body");
        assert!(compatibility_body.contains("fetch_background_url"));
        assert!(!compatibility_body.contains("chrome_open_url"));
    }

    #[test]
    fn mcp_config_points_to_local_server_script() {
        let bundle_dir = PathBuf::from("/tmp/bob-work-chrome");
        let config = ChromeMcpService::mcp_config(&bundle_dir);
        assert_eq!(config["command"], "python3");
        assert_eq!(config["args"], json!(["server.py"]));
        assert_eq!(config["cwd"], "/tmp/bob-work-chrome");
        #[cfg(target_os = "macos")]
        {
            assert!(config["env"]["BOB_WORK_APPLESCRIPT_SOCKET"]
                .as_str()
                .unwrap_or("")
                .contains("applescript.sock"));
            assert!(!config["env"]["BOB_WORK_APP_NAME"].as_str().unwrap_or("").is_empty());
            assert!(!config["env"]["BOB_WORK_BUNDLE_ID"].as_str().unwrap_or("").is_empty());
        }
    }

    #[test]
    fn bundled_script_prefers_bob_work_applescript_bridge() {
        assert!(CHROME_MCP_SCRIPT.contains("BOB_WORK_APPLESCRIPT_SOCKET"));
        assert!(CHROME_MCP_SCRIPT.contains("applescript_socket_path"));
        assert!(CHROME_MCP_SCRIPT.contains("applescript-test.sock"));
        assert!(CHROME_MCP_SCRIPT.contains("_run_osascript_via_bob_work"));
        assert!(CHROME_MCP_SCRIPT.contains("BOB_WORK_APP_NAME"));
        assert!(CHROME_MCP_SCRIPT.contains("bridge_required_error"));
        assert!(
            !CHROME_MCP_SCRIPT.contains("[\"osascript\""),
            "Chrome MCP must not spawn /usr/bin/osascript (TCC would attach to python3)"
        );
        assert!(
            CHROME_MCP_SCRIPT.contains(r#""action": "screencapture""#),
            "Screen Recording must go through the native bridge, not python3 screencapture"
        );
        assert!(CHROME_MCP_SCRIPT.contains("BOB_WORK_BUNDLE_ID"));
    }
}
