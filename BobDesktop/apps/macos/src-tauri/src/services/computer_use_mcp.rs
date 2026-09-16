use crate::error::{AppError, AppResult};
use crate::services::workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;

pub const COMPUTER_USE_MCP_NAME: &str = "bob-work-computer-use";
const COMPUTER_USE_MCP_SCRIPT: &str = include_str!("../../resources/computer/computer_use_mcp.py");
const COMPUTER_USE_GUIDE: &str = include_str!("../../resources/computer/GUIDE.md");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacosComputerUseStatus {
    pub mcp_configured: bool,
    pub mcp_enabled: bool,
    pub accessibility: String,
    pub accessibility_message: String,
}

pub struct ComputerUseMcpService;

impl ComputerUseMcpService {
    pub fn new() -> Self {
        Self
    }

    pub fn bundle_dir() -> AppResult<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        Ok(home.join(".bob").join("resources").join("computer"))
    }

    pub fn ensure_bundle() -> AppResult<PathBuf> {
        let bundle_dir = Self::bundle_dir()?;
        std::fs::create_dir_all(&bundle_dir).map_err(|error| {
            AppError::Io(format!(
                "Failed to create Computer Use MCP directory: {}",
                error
            ))
        })?;
        let script_path = bundle_dir.join("server.py");
        std::fs::write(&script_path, COMPUTER_USE_MCP_SCRIPT).map_err(|error| {
            AppError::Io(format!(
                "Failed to write Computer Use MCP script: {}",
                error
            ))
        })?;
        std::fs::write(bundle_dir.join("GUIDE.md"), COMPUTER_USE_GUIDE).map_err(|error| {
            AppError::Io(format!(
                "Failed to write Computer Use guide: {}",
                error
            ))
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
        env.insert("BOB_COMPUTER_USE".into(), json!("1"));
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
            .any(|server| server.name == COMPUTER_USE_MCP_NAME)
    }

    pub fn is_enabled(&self) -> bool {
        WorkspaceService::new()
            .list_mcp_servers()
            .into_iter()
            .any(|server| server.name == COMPUTER_USE_MCP_NAME && server.enabled)
    }

    pub fn sync(&self, bob_path: &str, enabled: bool) -> AppResult<()> {
        if !enabled {
            if self.is_configured() {
                run_bob(bob_path, &["mcp", "disable", COMPUTER_USE_MCP_NAME])?;
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
                COMPUTER_USE_MCP_NAME,
                &config.to_string(),
            ],
        )?;
        run_bob(bob_path, &["mcp", "enable", COMPUTER_USE_MCP_NAME])?;
        Ok(())
    }

    pub fn status(&self) -> MacosComputerUseStatus {
        self.status_with_runtime(Self::probe_in_process_accessibility())
    }

    pub fn status_with_runtime(&self, runtime: String) -> MacosComputerUseStatus {
        let mcp_configured = self.is_configured();
        let mcp_enabled = self.is_enabled();
        let (accessibility, accessibility_message) = Self::probe_accessibility_with_runtime(runtime);
        MacosComputerUseStatus {
            mcp_configured,
            mcp_enabled,
            accessibility,
            accessibility_message,
        }
    }

    pub fn probe_accessibility() -> (String, String) {
        Self::probe_accessibility_with_runtime(Self::probe_in_process_accessibility())
    }

    pub fn probe_accessibility_with_runtime(runtime: String) -> (String, String) {
        if std::env::consts::OS != "macos" {
            return (
                "unavailable".into(),
                "Le contrôle de l’ordinateur n’est disponible que sur macOS.".into(),
            );
        }
        // E2E / headless CI: never run NSAppleScript — TCC dialogs hang the async
        // runtime and freeze every subsequent IPC call (settings, MCP list, chat).
        #[cfg(feature = "e2e")]
        {
            let _ = runtime;
            return (
                "denied".into(),
                "E2E : sonde Accessibilité désactivée (pas de dialogue système).".into(),
            );
        }
        #[cfg(all(target_os = "macos", not(feature = "e2e")))]
        {
            let app_name = crate::app_identity::app_display_name();
            let (app_state, app_message) = crate::macos_permissions::accessibility_status_for_app();
            return Self::combine_accessibility_status(
                &app_name,
                &app_state,
                &runtime,
                app_message,
            );
        }
        #[allow(unreachable_code)]
        ("unavailable".into(), "Non disponible.".into())
    }

    pub fn combine_accessibility_status(
        app_name: &str,
        app_state: &str,
        runtime: &str,
        app_message: String,
    ) -> (String, String) {
        match (app_state, runtime) {
            ("granted", "granted") => (
                "granted".into(),
                format!(
                    "Accessibilité OK pour {app_name} (les actions UI passent par {app_name}, pas python3)."
                ),
            ),
            ("granted", _) => (
                "granted".into(),
                format!(
                    "{app_message} Activez aussi System Events pour {app_name} si les clics restent bloqués."
                ),
            ),
            _ => ("denied".into(), app_message),
        }
    }

    fn probe_in_process_accessibility() -> String {
        #[cfg(target_os = "macos")]
        {
            let script = r#"tell application "System Events" to get name of first process whose frontmost is true"#;
            match crate::macos_permissions::run_applescript(script) {
                Ok(_) => "granted".into(),
                Err(message) => {
                    let lower = message.to_ascii_lowercase();
                    if lower.contains("not allowed")
                        || lower.contains("not authorized")
                        || lower.contains("autorisation")
                        || lower.contains("(-1719)")
                        || lower.contains("1002")
                    {
                        "denied".into()
                    } else {
                        "unknown".into()
                    }
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            "unavailable".into()
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
    fn bundled_script_exposes_desktop_tools() {
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("get_computer_use_guide"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("open_app"));
        assert!(COMPUTER_USE_GUIDE.contains("bob-work-computer-use"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("list_apps"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("desktop_click"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("desktop_scroll"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("capture_screen"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("ui_click"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("ui_set_value"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("app_command"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("bring_to_front"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("MAX_VISUAL_CAPTURES = 10"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("MAX_ACTIONS = 20"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("_authorize_action"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("formatOptions"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("frontmost_app"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("Telegram"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("open\", \"-g\""));
    }

    #[test]
    fn mcp_config_points_to_local_server_script() {
        let bundle_dir = PathBuf::from("/tmp/bob-work-computer");
        let config = ComputerUseMcpService::mcp_config(&bundle_dir);
        assert_eq!(config["command"], "python3");
        assert_eq!(config["args"], json!(["server.py"]));
        assert_eq!(config["cwd"], "/tmp/bob-work-computer");
        assert_eq!(config["env"]["BOB_COMPUTER_USE"], "1");
        #[cfg(target_os = "macos")]
        {
            assert!(config["env"]["BOB_WORK_APPLESCRIPT_SOCKET"]
                .as_str()
                .unwrap_or("")
                .contains("applescript.sock"));
        }
    }

    #[test]
    fn bundled_script_prefers_bob_work_applescript_bridge() {
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("BOB_WORK_APPLESCRIPT_SOCKET"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("applescript_socket_path"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("applescript-test.sock"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("_run_osascript_via_bob_work"));
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("def bridge_required_error"));
        assert!(
            !COMPUTER_USE_MCP_SCRIPT.contains("[\"osascript\""),
            "Computer Use must not spawn /usr/bin/osascript (TCC would attach to python3)"
        );
        assert!(
            COMPUTER_USE_MCP_SCRIPT.contains(r#""action": "screencapture""#),
            "Screen Recording must go through the native bridge, not python3 screencapture"
        );
        assert!(COMPUTER_USE_MCP_SCRIPT.contains("BOB_WORK_APP_NAME"));
    }

    #[test]
    fn accessibility_status_names_the_running_app() {
        let (state, message) = ComputerUseMcpService::combine_accessibility_status(
            "Bob Work-test",
            "granted",
            "granted",
            "ignored".into(),
        );
        assert_eq!(state, "granted");
        assert!(message.contains("Bob Work-test"));
        assert!(!message.contains("OK pour Bob Work ("));
    }
}
