use crate::error::{AppError, AppResult};
use crate::services::bob::BobService;
use crate::services::integration_oauth::IntegrationOAuthService;
use crate::services::workspace::WorkspaceService;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const GITHUB_MCP_NAME: &str = "bob-work-github";
pub const SLACK_MCP_NAME: &str = "bob-work-slack";
pub const MONDAY_MCP_NAME: &str = "bob-work-monday";
pub const MICROSOFT_MCP_NAME: &str = "bob-work-microsoft";

const BASE_SCRIPT: &str = include_str!("../../resources/integrations/integration_mcp_base.py");
const GITHUB_SCRIPT: &str = include_str!("../../resources/integrations/github_mcp.py");
const SLACK_SCRIPT: &str = include_str!("../../resources/integrations/slack_mcp.py");
const MONDAY_SCRIPT: &str = include_str!("../../resources/integrations/monday_mcp.py");
const MICROSOFT_SCRIPT: &str = include_str!("../../resources/integrations/microsoft_mcp.py");

pub struct IntegrationMcpService;

impl IntegrationMcpService {
    pub fn new() -> Self {
        Self
    }

    pub fn bundle_dir() -> AppResult<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        Ok(home.join(".bob").join("resources").join("integrations"))
    }

    pub fn ensure_bundle() -> AppResult<PathBuf> {
        let bundle_dir = Self::bundle_dir()?;
        std::fs::create_dir_all(&bundle_dir).map_err(|error| {
            AppError::Io(format!("Failed to create integration MCP directory: {}", error))
        })?;
        Self::write_script(&bundle_dir, "integration_mcp_base.py", BASE_SCRIPT)?;
        Self::write_script(&bundle_dir, "github_server.py", GITHUB_SCRIPT)?;
        Self::write_script(&bundle_dir, "slack_server.py", SLACK_SCRIPT)?;
        Self::write_script(&bundle_dir, "monday_server.py", MONDAY_SCRIPT)?;
        Self::write_script(&bundle_dir, "microsoft_server.py", MICROSOFT_SCRIPT)?;
        Ok(bundle_dir)
    }

    fn write_script(bundle_dir: &Path, filename: &str, contents: &str) -> AppResult<()> {
        let script_path = bundle_dir.join(filename);
        std::fs::write(&script_path, contents).map_err(|error| {
            AppError::Io(format!("Failed to write integration MCP script {filename}: {error}"))
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
        Ok(())
    }

    pub fn mcp_name_for_provider(provider: &str) -> Option<&'static str> {
        match provider {
            "github" => Some(GITHUB_MCP_NAME),
            "slack" => Some(SLACK_MCP_NAME),
            "monday" => Some(MONDAY_MCP_NAME),
            "microsoft" => Some(MICROSOFT_MCP_NAME),
            _ => None,
        }
    }

    pub fn script_for_provider(provider: &str) -> Option<&'static str> {
        match provider {
            "github" => Some("github_server.py"),
            "slack" => Some("slack_server.py"),
            "monday" => Some("monday_server.py"),
            "microsoft" => Some("microsoft_server.py"),
            _ => None,
        }
    }

    pub fn mcp_config(bundle_dir: &Path, provider: &str) -> AppResult<Value> {
        let script = Self::script_for_provider(provider).ok_or_else(|| {
            AppError::ValidationFailed(format!("Aucun serveur MCP pour le provider {provider}"))
        })?;
        Ok(json!({
            "command": "python3",
            "args": [script],
            "cwd": bundle_dir.to_string_lossy(),
        }))
    }

    pub fn is_configured(&self, name: &str) -> bool {
        WorkspaceService::new()
            .list_mcp_servers()
            .into_iter()
            .any(|server| server.name == name)
    }

    pub fn is_enabled(&self, name: &str) -> bool {
        WorkspaceService::new()
            .list_mcp_servers()
            .into_iter()
            .any(|server| server.name == name && server.enabled)
    }

    pub fn sync_provider(&self, bob_path: &str, provider: &str) -> AppResult<()> {
        let Some(name) = Self::mcp_name_for_provider(provider) else {
            return Ok(());
        };
        let bundle_dir = Self::ensure_bundle()?;
        let config = Self::mcp_config(&bundle_dir, provider)?;
        run_bob(
            bob_path,
            &["mcp", "add-json", name, &config.to_string()],
        )?;
        run_bob(bob_path, &["mcp", "enable", name])?;
        Ok(())
    }

    pub fn disable_provider(&self, bob_path: &str, provider: &str) -> AppResult<()> {
        let Some(name) = Self::mcp_name_for_provider(provider) else {
            return Ok(());
        };
        if self.is_configured(name) {
            run_bob(bob_path, &["mcp", "disable", name])?;
        }
        Ok(())
    }

    pub fn sync_for_integration(
        &self,
        bob_path: &str,
        integration_id: &str,
        oauth: &IntegrationOAuthService,
        legacy_secret_exists: bool,
    ) -> AppResult<()> {
        let Some(provider) = IntegrationOAuthService::provider_for(integration_id) else {
            return Ok(());
        };
        if oauth.has_connection(integration_id, legacy_secret_exists) {
            self.sync_provider(bob_path, provider)
        } else {
            self.maybe_disable_after_disconnect(bob_path, integration_id, oauth, legacy_secret_exists)
        }
    }

    pub fn maybe_disable_after_disconnect(
        &self,
        bob_path: &str,
        integration_id: &str,
        oauth: &IntegrationOAuthService,
        legacy_secret_exists: bool,
    ) -> AppResult<()> {
        let Some(provider) = IntegrationOAuthService::provider_for(integration_id) else {
            return Ok(());
        };
        if provider == "microsoft" {
            let still_connected = IntegrationOAuthService::microsoft_integrations()
                .iter()
                .any(|id| oauth.has_connection(id, false));
            if still_connected {
                return Ok(());
            }
        }
        if legacy_secret_exists {
            return Ok(());
        }
        self.disable_provider(bob_path, provider)
    }

    pub fn sync_all_connected(&self, bob_path: &str, bob_service: &BobService) -> AppResult<()> {
        let oauth = IntegrationOAuthService::new();
        for provider in ["github", "slack", "monday", "microsoft"] {
            let connected = match provider {
                "github" => oauth.has_connection("github", legacy_secret_exists(bob_service, "github")),
                "slack" => oauth.has_connection("slack", legacy_secret_exists(bob_service, "slack")),
                "monday" => oauth.has_connection("monday", legacy_secret_exists(bob_service, "monday")),
                "microsoft" => IntegrationOAuthService::microsoft_integrations()
                    .iter()
                    .any(|id| oauth.has_connection(id, false)),
                _ => false,
            };
            if connected {
                let _ = self.sync_provider(bob_path, provider);
            }
        }
        Ok(())
    }
}

fn legacy_secret_exists(bob_service: &BobService, integration_id: &str) -> bool {
    let secret_id = match integration_id {
        "github" => Some(crate::services::bob::SECRET_GITHUB),
        "slack" => Some(crate::services::bob::SECRET_SLACK),
        "monday" => Some(crate::services::bob::SECRET_MONDAY),
        _ => None,
    };
    secret_id
        .and_then(|secret| bob_service.has_session_secret(secret).ok())
        .unwrap_or(false)
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
    fn bundled_scripts_expose_connector_tools() {
        assert!(GITHUB_SCRIPT.contains("github_list_repos"));
        assert!(SLACK_SCRIPT.contains("slack_search_messages"));
        assert!(MONDAY_SCRIPT.contains("monday_list_boards"));
        assert!(MICROSOFT_SCRIPT.contains("graph_search_mail"));
    }

    #[test]
    fn mcp_config_points_to_local_server_scripts() {
        let bundle_dir = PathBuf::from("/tmp/bob-work-integrations");
        let github = IntegrationMcpService::mcp_config(&bundle_dir, "github").unwrap();
        assert_eq!(github["command"], "python3");
        assert_eq!(github["args"], json!(["github_server.py"]));
        assert_eq!(github["cwd"], "/tmp/bob-work-integrations");
    }

    #[test]
    fn provider_names_map_to_mcp_servers() {
        assert_eq!(
            IntegrationMcpService::mcp_name_for_provider("github"),
            Some(GITHUB_MCP_NAME)
        );
        assert_eq!(
            IntegrationMcpService::mcp_name_for_provider("microsoft"),
            Some(MICROSOFT_MCP_NAME)
        );
    }
}
