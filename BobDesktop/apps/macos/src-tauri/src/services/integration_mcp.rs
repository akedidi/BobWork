use crate::error::{AppError, AppResult};
use crate::models::workspace::{SaveApiConnectionInput, SaveMcpServerInput};
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
const REST_API_SCRIPT: &str = include_str!("../../resources/integrations/rest_api_mcp.py");

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
            AppError::Io(format!(
                "Failed to create integration MCP directory: {}",
                error
            ))
        })?;
        Self::write_script(&bundle_dir, "integration_mcp_base.py", BASE_SCRIPT)?;
        Self::write_script(&bundle_dir, "github_server.py", GITHUB_SCRIPT)?;
        Self::write_script(&bundle_dir, "slack_server.py", SLACK_SCRIPT)?;
        Self::write_script(&bundle_dir, "monday_server.py", MONDAY_SCRIPT)?;
        Self::write_script(&bundle_dir, "microsoft_server.py", MICROSOFT_SCRIPT)?;
        Self::write_script(&bundle_dir, "rest_api_server.py", REST_API_SCRIPT)?;
        Ok(bundle_dir)
    }

    fn write_script(bundle_dir: &Path, filename: &str, contents: &str) -> AppResult<()> {
        let script_path = bundle_dir.join(filename);
        std::fs::write(&script_path, contents).map_err(|error| {
            AppError::Io(format!(
                "Failed to write integration MCP script {filename}: {error}"
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
        let env = match provider {
            "github" => json!({
                // Bob Shell resolves process environment entries through the
                // nested `env` variable namespace. `${GITHUB_TOKEN}` is left
                // literal and GitHub consequently rejects it as a bad token.
                "GITHUB_TOKEN": "${env:GITHUB_TOKEN}",
                "GH_TOKEN": "${env:GH_TOKEN}",
            }),
            "slack" => json!({
                "SLACK_BOT_TOKEN": "${env:SLACK_BOT_TOKEN}",
                "SLACK_ACCESS_TOKEN": "${env:SLACK_ACCESS_TOKEN}",
                "SLACK_USER_TOKEN": "${env:SLACK_USER_TOKEN}",
            }),
            "monday" => json!({ "MONDAY_API_TOKEN": "${env:MONDAY_API_TOKEN}" }),
            "microsoft" => json!({
                "MICROSOFT_GRAPH_ACCESS_TOKEN": "${env:MICROSOFT_GRAPH_ACCESS_TOKEN}",
            }),
            _ => Value::Null,
        };
        Ok(json!({
            "command": "python3",
            "args": [script],
            "cwd": bundle_dir.to_string_lossy(),
            "env": env,
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

    pub fn save_api_connection(
        &self,
        bob_path: &str,
        input: SaveApiConnectionInput,
    ) -> AppResult<()> {
        let mut parsed = url::Url::parse(input.url.trim())
            .map_err(|_| AppError::ValidationFailed("URL d’API HTTPS invalide".into()))?;
        if parsed.scheme() != "https" || parsed.host_str().is_none() {
            return Err(AppError::ValidationFailed(
                "Une API doit utiliser une URL HTTPS".into(),
            ));
        }
        let auth_mode = input.auth_mode.trim().to_ascii_lowercase();
        if !matches!(auth_mode.as_str(), "none" | "query" | "bearer" | "header") {
            return Err(AppError::ValidationFailed(
                "Mode d’authentification API invalide".into(),
            ));
        }
        if auth_mode == "query" {
            let auth_name = if input.auth_name.trim().is_empty() {
                "api_key"
            } else {
                input.auth_name.trim()
            };
            let retained = parsed
                .query_pairs()
                .filter(|(key, _)| key != auth_name)
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect::<Vec<_>>();
            parsed.query_pairs_mut().clear().extend_pairs(retained);
        }
        let base_url = parsed.to_string().trim_end_matches('/').to_string();

        let workspace = WorkspaceService::new();
        let previous = input
            .original_name
            .as_deref()
            .and_then(|name| workspace.read_mcp_server_config(name));
        let secret = if input.secret.trim().is_empty() {
            previous
                .as_ref()
                .and_then(|config| existing_api_secret(config, &auth_mode, &input.auth_name))
                .unwrap_or_default()
        } else {
            input.secret.trim().to_string()
        };
        if auth_mode != "none" && secret.is_empty() {
            return Err(AppError::ValidationFailed(
                "La clé ou le jeton API est obligatoire".into(),
            ));
        }

        let bundle_dir = Self::ensure_bundle()?;
        let previous_env_keys = previous
            .as_ref()
            .and_then(|config| config.get("env"))
            .and_then(Value::as_object)
            .map(|env| env.keys().cloned().collect())
            .unwrap_or_default();
        let mut env = std::collections::HashMap::from([
            ("BOB_WORK_API_KIND".into(), "rest".into()),
            ("BOB_WORK_API_ID".into(), input.name.clone()),
            ("BOB_WORK_API_BASE_URL".into(), base_url),
            ("BOB_WORK_API_AUTH_MODE".into(), auth_mode),
            (
                "BOB_WORK_API_AUTH_NAME".into(),
                input.auth_name.trim().to_string(),
            ),
        ]);
        if !secret.is_empty() {
            env.insert("BOB_WORK_API_SECRET".into(), secret);
        }
        let script_path = bundle_dir.join("rest_api_server.py");
        workspace.save_mcp_server(
            bob_path,
            SaveMcpServerInput {
                original_name: input.original_name,
                name: input.name,
                transport: "stdio".into(),
                command_or_url: "python3".into(),
                args: vec![script_path.to_string_lossy().into_owned()],
                enabled: input.enabled,
                env: Some(env),
                env_remove: previous_env_keys,
                headers: None,
            },
        )?;

        Ok(())
    }

    pub fn sync_provider(&self, bob_path: &str, provider: &str) -> AppResult<()> {
        let Some(name) = Self::mcp_name_for_provider(provider) else {
            return Ok(());
        };
        let bundle_dir = Self::ensure_bundle()?;
        let config = Self::mcp_config(&bundle_dir, provider)?;
        // `--scope global`: the connector belongs to the user (their OAuth
        // token), not to whatever workspace the app was launched from. The
        // trailing position keeps positional args stable for the E2E fake bob.
        run_bob(
            bob_path,
            &[
                "mcp",
                "add-json",
                name,
                &config.to_string(),
                "--scope",
                "global",
            ],
        )?;
        run_bob(bob_path, &["mcp", "enable", name, "--scope", "global"])?;
        Ok(())
    }

    /// Close the startup race where the first prompt can begin before the
    /// background MCP refresh has finished. The common path only reads the
    /// existing JSON; invoking Bob Shell is reserved for stale configurations.
    pub fn ensure_provider_current(&self, bob_path: &str, provider: &str) -> AppResult<()> {
        let Some(name) = Self::mcp_name_for_provider(provider) else {
            return Ok(());
        };
        let desired = Self::mcp_config(&Self::bundle_dir()?, provider)?;
        let current = WorkspaceService::new().read_mcp_server_config(name);
        let is_current = current
            .as_ref()
            .is_some_and(|config| mcp_config_contains(config, &desired))
            && current
                .as_ref()
                .and_then(|config| config.get("disabled"))
                .and_then(Value::as_bool)
                != Some(true);
        if is_current {
            return Ok(());
        }
        self.sync_provider(bob_path, provider)
    }

    pub fn disable_provider(&self, bob_path: &str, provider: &str) -> AppResult<()> {
        let Some(name) = Self::mcp_name_for_provider(provider) else {
            return Ok(());
        };
        if self.is_configured(name) {
            run_bob(bob_path, &["mcp", "disable", name, "--scope", "global"])?;
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
            self.maybe_disable_after_disconnect(
                bob_path,
                integration_id,
                oauth,
                legacy_secret_exists,
            )
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
                "github" => {
                    oauth.has_connection("github", legacy_secret_exists(bob_service, "github"))
                }
                "slack" => {
                    oauth.has_connection("slack", legacy_secret_exists(bob_service, "slack"))
                }
                "monday" => {
                    oauth.has_connection("monday", legacy_secret_exists(bob_service, "monday"))
                }
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

fn mcp_config_contains(current: &Value, desired: &Value) -> bool {
    let (Some(current), Some(desired)) = (current.as_object(), desired.as_object()) else {
        return false;
    };
    desired
        .iter()
        .all(|(key, expected)| current.get(key) == Some(expected))
}

fn existing_api_secret(config: &Value, auth_mode: &str, auth_name: &str) -> Option<String> {
    if let Some(secret) = config
        .get("env")
        .and_then(Value::as_object)
        .and_then(|env| env.get("BOB_WORK_API_SECRET"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        return Some(secret.to_string());
    }
    if auth_mode == "query" {
        let name = if auth_name.trim().is_empty() {
            "api_key"
        } else {
            auth_name.trim()
        };
        return config
            .get("url")
            .and_then(Value::as_str)
            .and_then(|value| url::Url::parse(value).ok())
            .and_then(|url| {
                url.query_pairs()
                    .find(|(key, _)| key == name)
                    .map(|(_, value)| value.into_owned())
            });
    }
    if auth_mode == "bearer" {
        return config
            .get("headers")
            .and_then(Value::as_object)
            .and_then(|headers| headers.get("Authorization"))
            .and_then(Value::as_str)
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::to_string);
    }
    if auth_mode == "header" {
        return config
            .get("headers")
            .and_then(Value::as_object)
            .and_then(|headers| headers.get(auth_name))
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    None
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
        assert!(MICROSOFT_SCRIPT.contains("graph_get_profile"));
        assert!(REST_API_SCRIPT.contains("Perform a read-only GET request"));
    }

    #[test]
    fn mcp_config_points_to_local_server_scripts() {
        let bundle_dir = PathBuf::from("/tmp/bob-work-integrations");
        let github = IntegrationMcpService::mcp_config(&bundle_dir, "github").unwrap();
        assert_eq!(github["command"], "python3");
        assert_eq!(github["args"], json!(["github_server.py"]));
        assert_eq!(github["cwd"], "/tmp/bob-work-integrations");
        assert_eq!(github["env"]["GH_TOKEN"], "${env:GH_TOKEN}");
        assert_eq!(github["env"]["GITHUB_TOKEN"], "${env:GITHUB_TOKEN}");

        let microsoft = IntegrationMcpService::mcp_config(&bundle_dir, "microsoft").unwrap();
        assert_eq!(
            microsoft["env"]["MICROSOFT_GRAPH_ACCESS_TOKEN"],
            "${env:MICROSOFT_GRAPH_ACCESS_TOKEN}"
        );
        let slack = IntegrationMcpService::mcp_config(&bundle_dir, "slack").unwrap();
        assert_eq!(slack["env"]["SLACK_BOT_TOKEN"], "${env:SLACK_BOT_TOKEN}");
        let monday = IntegrationMcpService::mcp_config(&bundle_dir, "monday").unwrap();
        assert_eq!(monday["env"]["MONDAY_API_TOKEN"], "${env:MONDAY_API_TOKEN}");
    }

    #[test]
    fn current_config_accepts_runtime_metadata_but_requires_env_placeholders() {
        let desired = json!({
            "command": "python3",
            "args": ["github_server.py"],
            "env": { "GH_TOKEN": "${env:GH_TOKEN}" }
        });
        let current = json!({
            "command": "python3",
            "args": ["github_server.py"],
            "env": { "GH_TOKEN": "${env:GH_TOKEN}" },
            "disabled": false
        });
        assert!(super::mcp_config_contains(&current, &desired));

        let missing_env = json!({
            "command": "python3",
            "args": ["github_server.py"],
            "disabled": false
        });
        assert!(!super::mcp_config_contains(&missing_env, &desired));
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
