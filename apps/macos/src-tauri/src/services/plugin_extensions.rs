use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::plugin::{
    PluginBrowserStatus, PluginExtensionStatus, PluginHookStatus, PluginIntegrationStatus,
    PluginScheduleTemplate,
};
use crate::services::bob::BobService;
use crate::services::plugin_mcp::PluginMcpService;
use crate::services::settings::SettingsService;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

pub struct PluginExtensionService;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedPluginHook {
    pub id: String,
    pub name: String,
    pub event: String,
    pub runtime: String,
    pub path: PathBuf,
    pub bundle_dir: PathBuf,
    pub args: Vec<String>,
    pub required: bool,
    pub timeout_seconds: u64,
}

impl PluginExtensionService {
    pub fn new() -> Self {
        Self
    }

    pub fn validate_schema(manifest: &Value) -> Vec<String> {
        let permissions = manifest
            .get("permissions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let has_permission = |permission: &str| {
            permissions
                .iter()
                .any(|value| value.get("type").and_then(Value::as_str) == Some(permission))
        };
        let mcp_servers = manifest.get("mcpServers").and_then(Value::as_object);
        let mut errors = vec![];

        if let Some(value) = manifest.get("integrations") {
            let Some(integrations) = value.as_array() else {
                return vec!["integrations must be a JSON array".into()];
            };
            if integrations.len() > 16 {
                errors.push("A plugin cannot declare more than 16 integrations".into());
            }
            for integration in integrations {
                let provider = integration
                    .get("provider")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !valid_slug(provider) {
                    errors.push(format!("Invalid integration provider: {}", provider));
                }
                let auth_type = integration
                    .get("authType")
                    .and_then(Value::as_str)
                    .unwrap_or("mcp");
                if !matches!(auth_type, "mcp" | "oauth" | "token") {
                    errors.push(format!("Invalid authentication type for {}", provider));
                }
                if integration
                    .get("scopes")
                    .is_some_and(|value| !value.is_array())
                {
                    errors.push(format!("Integration {} scopes must be an array", provider));
                }
                let mcp_server = integration.get("mcpServer").and_then(Value::as_str);
                if matches!(auth_type, "oauth" | "mcp") {
                    let Some(server_id) = mcp_server else {
                        errors.push(format!(
                            "Integration {} must reference an MCP server; Bob Work never simulates OAuth",
                            provider
                        ));
                        continue;
                    };
                    if !valid_slug(server_id)
                        || mcp_servers.is_none_or(|servers| !servers.contains_key(server_id))
                    {
                        errors.push(format!(
                            "Integration {} references an unknown MCP server: {}",
                            provider, server_id
                        ));
                    }
                }
            }
        }

        if let Some(value) = manifest.get("browserExtensions") {
            let Some(extensions) = value.as_array() else {
                errors.push("browserExtensions must be a JSON array".into());
                return errors;
            };
            if extensions.len() > 8 {
                errors.push("A plugin cannot declare more than 8 browser capabilities".into());
            }
            for extension in extensions {
                let id = extension
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let capability = extension
                    .get("capability")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !valid_slug(id) {
                    errors.push(format!("Invalid browser capability id: {}", id));
                }
                if !matches!(capability, "browser" | "computer_use" | "chrome") {
                    errors.push(format!("Invalid browser capability: {}", capability));
                }
                if !has_permission("browser.control") {
                    errors.push(format!(
                        "Browser capability {} requires browser.control permission",
                        id
                    ));
                }
                if matches!(capability, "computer_use" | "chrome") {
                    let server_id = extension.get("mcpServer").and_then(Value::as_str);
                    if server_id.is_none()
                        || server_id.is_some_and(|server_id| {
                            mcp_servers.is_none_or(|servers| !servers.contains_key(server_id))
                        })
                    {
                        errors.push(format!(
                            "Browser capability {} needs a compatible MCP server; control is never simulated",
                            id
                        ));
                    }
                }
            }
        }

        if let Some(value) = manifest.get("hooks") {
            let Some(hooks) = value.as_array() else {
                errors.push("hooks must be a JSON array".into());
                return errors;
            };
            if !hooks.is_empty()
                && (!has_permission("hook.execute") || !has_permission("command.execute"))
            {
                errors.push(
                    "Plugin hooks require hook.execute and command.execute permissions".into(),
                );
            }
            if !hooks.is_empty() && manifest.get("bundlePath").and_then(Value::as_str).is_none() {
                errors.push(
                    "Plugin hooks are allowed only in a validated local agentic bundle".into(),
                );
            }
            if hooks.len() > 16 {
                errors.push("A plugin cannot declare more than 16 hooks".into());
            }
            let entrypoints = manifest
                .get("entrypoints")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for hook in hooks {
                let id = hook.get("id").and_then(Value::as_str).unwrap_or_default();
                let event = hook
                    .get("event")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let entrypoint = hook
                    .get("entrypoint")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !valid_slug(id) {
                    errors.push(format!("Invalid hook id: {}", id));
                }
                if !matches!(event, "before_task" | "after_task" | "task_error") {
                    errors.push(format!("Invalid hook event for {}: {}", id, event));
                }
                if !entrypoints.iter().any(|candidate| {
                    candidate.get("name").and_then(Value::as_str) == Some(entrypoint)
                }) {
                    errors.push(format!("Hook {} references an unknown entrypoint", id));
                }
                if hook
                    .get("args")
                    .is_some_and(|value| !safe_string_array(value, 32, 2048))
                {
                    errors.push(format!("Hook {} has invalid arguments", id));
                }
            }
        }

        if let Some(value) = manifest.get("scheduledTaskTemplates") {
            let Some(templates) = value.as_array() else {
                errors.push("scheduledTaskTemplates must be a JSON array".into());
                return errors;
            };
            if templates.len() > 16 {
                errors.push("A plugin cannot declare more than 16 scheduled task templates".into());
            }
            for template in templates {
                let id = template
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !valid_slug(id) {
                    errors.push(format!("Invalid scheduled task template id: {}", id));
                }
                for field in ["name", "instructions", "cronOrEvent"] {
                    if template
                        .get(field)
                        .and_then(Value::as_str)
                        .is_none_or(|value| value.trim().is_empty())
                    {
                        errors.push(format!("Scheduled task template {} needs {}", id, field));
                    }
                }
            }
        }

        errors.sort();
        errors.dedup();
        errors
    }

    pub fn status(
        &self,
        plugin_id: &str,
        manifest: &Value,
        db: &Database,
        bob: &BobService,
    ) -> AppResult<PluginExtensionStatus> {
        let mcp = self.mcp_status_by_id(plugin_id, manifest)?;
        let settings = SettingsService::new().get(db)?;
        let integrations = manifest
            .get("integrations")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|integration| {
                let provider = integration
                    .get("provider")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                let name = integration
                    .get("displayName")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| friendly_name(&provider));
                let auth_type = integration
                    .get("authType")
                    .and_then(Value::as_str)
                    .unwrap_or("mcp")
                    .to_string();
                let required = !integration
                    .get("optional")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let scopes = string_array(integration.get("scopes"));
                let (state, message) = if let Some(server_id) =
                    integration.get("mcpServer").and_then(Value::as_str)
                {
                    match mcp.get(server_id) {
                        Some(status) if status.enabled && auth_type == "oauth" => (
                            "configured".into(),
                            "Connecteur actif. L’autorisation du compte est vérifiée par le service lors du premier appel.".into(),
                        ),
                        Some(status) if status.enabled => (
                            "connected".into(),
                            "Outils MCP actifs et disponibles pour Bob.".into(),
                        ),
                        Some(status) if status.configured => (
                            "disabled".into(),
                            "Le connecteur est installé mais désactivé.".into(),
                        ),
                        _ => (
                            "disconnected".into(),
                            "Le connecteur MCP autorisé doit être configuré.".into(),
                        ),
                    }
                } else if bob.has_integration_credential(&provider) {
                    (
                        "connected".into(),
                        "Autorisation disponible pour cette session locale.".into(),
                    )
                } else {
                    (
                        "disconnected".into(),
                        "Cette intégration doit être autorisée avant utilisation.".into(),
                    )
                };
                PluginIntegrationStatus {
                    provider,
                    name,
                    auth_type,
                    scopes,
                    state,
                    required,
                    message,
                }
            })
            .collect();

        let browser_extensions = manifest
            .get("browserExtensions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|extension| {
                let id = extension
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("browser")
                    .to_string();
                let name = extension
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or("Navigateur")
                    .to_string();
                let capability = extension
                    .get("capability")
                    .and_then(Value::as_str)
                    .unwrap_or("browser")
                    .to_string();
                let required = extension
                    .get("required")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let enabled_in_settings = match capability.as_str() {
                    "computer_use" => settings.computer_use_enabled,
                    "chrome" => settings.chrome_control_enabled,
                    _ => settings.web_enabled,
                };
                let mcp_ready = extension
                    .get("mcpServer")
                    .and_then(Value::as_str)
                    .map(|server_id| mcp.get(server_id).is_some_and(|status| status.enabled))
                    .unwrap_or(true);
                let (state, message) = if !enabled_in_settings {
                    (
                        "disabled".into(),
                        "Cette capacité est désactivée dans les réglages de Bob Work.".into(),
                    )
                } else if !mcp_ready {
                    (
                        "disconnected".into(),
                        "L’extension ou le serveur MCP compatible n’est pas actif.".into(),
                    )
                } else {
                    (
                        "ready".into(),
                        if matches!(capability.as_str(), "computer_use" | "chrome") {
                            "Bob Work et l’outil compatible sont actifs. macOS confirme Accessibilité/Automation lors de la première action.".into()
                        } else {
                            "Accès web activé et outil compatible actif.".into()
                        },
                    )
                };
                PluginBrowserStatus {
                    id,
                    name,
                    capability,
                    state,
                    required,
                    message,
                }
            })
            .collect();

        Ok(PluginExtensionStatus {
            integrations,
            browser_extensions,
            hooks: parse_hooks(manifest),
            scheduled_task_templates: parse_schedule_templates(manifest),
        })
    }

    pub fn prepare_hooks(&self, manifest: &Value) -> AppResult<Vec<PreparedPluginHook>> {
        let Some(hooks) = manifest.get("hooks").and_then(Value::as_array) else {
            return Ok(vec![]);
        };
        if hooks.is_empty() {
            return Ok(vec![]);
        }
        let bundle_dir = manifest
            .get("bundlePath")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| {
                AppError::Plugin("Hooks are allowed only in a local agentic bundle".into())
            })?;
        let bundle_dir = std::fs::canonicalize(bundle_dir)?;
        let entrypoints = manifest
            .get("entrypoints")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut prepared = vec![];
        for hook in hooks {
            if hook.get("enabled").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let entrypoint_name = hook
                .get("entrypoint")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Plugin("Hook entrypoint is missing".into()))?;
            let entrypoint = entrypoints
                .iter()
                .find(|candidate| {
                    candidate.get("name").and_then(Value::as_str) == Some(entrypoint_name)
                })
                .ok_or_else(|| AppError::Plugin("Hook entrypoint is unknown".into()))?;
            let runtime = entrypoint
                .get("runtime")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !matches!(runtime, "python3" | "bash" | "sh") {
                return Err(AppError::Plugin("Unsupported hook runtime".into()));
            }
            let relative = entrypoint
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Plugin("Hook path is missing".into()))?;
            let relative = Path::new(relative);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|component| !matches!(component, Component::Normal(_)))
            {
                return Err(AppError::Plugin("Unsafe hook path".into()));
            }
            let path = std::fs::canonicalize(bundle_dir.join(relative))?;
            if !path.starts_with(&bundle_dir) || !path.is_file() {
                return Err(AppError::Plugin(
                    "Hook path must remain inside its bundle".into(),
                ));
            }
            prepared.push(PreparedPluginHook {
                id: hook
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("hook")
                    .to_string(),
                name: hook
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or(entrypoint_name)
                    .to_string(),
                event: hook
                    .get("event")
                    .and_then(Value::as_str)
                    .unwrap_or("before_task")
                    .to_string(),
                runtime: runtime.to_string(),
                path,
                bundle_dir: bundle_dir.clone(),
                args: string_array(hook.get("args")),
                required: hook
                    .get("required")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                timeout_seconds: hook
                    .get("timeoutSeconds")
                    .and_then(Value::as_u64)
                    .unwrap_or(30)
                    .clamp(1, 120),
            });
        }
        Ok(prepared)
    }

    fn mcp_status_by_id(
        &self,
        plugin_id: &str,
        manifest: &Value,
    ) -> AppResult<HashMap<String, crate::models::plugin::PluginMcpStatus>> {
        if !PluginMcpService::has_servers(manifest) {
            return Ok(HashMap::new());
        }
        let bundle_dir = PluginMcpService::bundle_dir(manifest)?;
        Ok(PluginMcpService::new()
            .status(plugin_id, manifest, &bundle_dir)?
            .into_iter()
            .map(|status| (status.id.clone(), status))
            .collect())
    }
}

fn parse_hooks(manifest: &Value) -> Vec<PluginHookStatus> {
    manifest
        .get("hooks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|hook| PluginHookStatus {
            id: hook
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("hook")
                .to_string(),
            name: hook
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or("Action automatique")
                .to_string(),
            event: hook
                .get("event")
                .and_then(Value::as_str)
                .unwrap_or("before_task")
                .to_string(),
            enabled: hook.get("enabled").and_then(Value::as_bool) != Some(false),
            required: hook
                .get("required")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        })
        .collect()
}

fn parse_schedule_templates(manifest: &Value) -> Vec<PluginScheduleTemplate> {
    manifest
        .get("scheduledTaskTemplates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|template| PluginScheduleTemplate {
            id: template
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("schedule")
                .to_string(),
            name: template
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Tâche planifiée")
                .to_string(),
            description: template
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string),
            instructions: template
                .get("instructions")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            cron_or_event: template
                .get("cronOrEvent")
                .and_then(Value::as_str)
                .unwrap_or("every day")
                .to_string(),
            plugin_or_mode: template
                .get("pluginOrMode")
                .and_then(Value::as_str)
                .map(str::to_string),
            offline_behavior: template
                .get("offlineBehavior")
                .and_then(Value::as_str)
                .unwrap_or("run_on_wake")
                .to_string(),
            overlap_policy: template
                .get("overlapPolicy")
                .and_then(Value::as_str)
                .unwrap_or("queue")
                .to_string(),
        })
        .collect()
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

fn safe_string_array(value: &Value, max_items: usize, max_length: usize) -> bool {
    value.as_array().is_some_and(|values| {
        values.len() <= max_items
            && values.iter().all(|value| {
                value.as_str().is_some_and(|value| {
                    value.len() <= max_length
                        && !value.contains('\0')
                        && !value.contains('\n')
                        && !value.contains('\r')
                })
            })
    })
}

fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
}

fn friendly_name(provider: &str) -> String {
    provider
        .split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_simulated_oauth_and_unsafe_hooks() {
        let manifest = serde_json::json!({
            "permissions": [],
            "integrations": [{"provider":"microsoft-graph","authType":"oauth","scopes":["mail.read"]}],
            "hooks": [{"id":"prepare","event":"before_task","entrypoint":"prepare"}]
        });
        let errors = PluginExtensionService::validate_schema(&manifest);
        assert!(errors
            .iter()
            .any(|error| error.contains("never simulates OAuth")));
        assert!(errors.iter().any(|error| error.contains("hook.execute")));
    }

    #[test]
    fn accepts_a_complete_agentic_extension_manifest() {
        let manifest = serde_json::json!({
            "bundlePath": "/tmp/example",
            "permissions": [
                {"type":"mcp.connect"}, {"type":"command.execute"},
                {"type":"hook.execute"}, {"type":"browser.control"}
            ],
            "entrypoints": [{"name":"prepare","runtime":"python3","path":"scripts/prepare.py"}],
            "mcpServers": {"cloud":{"command":"python3","args":["mcp/server.py"]}},
            "integrations": [{"provider":"cloud-account","authType":"oauth","mcpServer":"cloud","scopes":["read"]}],
            "browserExtensions": [{"id":"cloud-console","displayName":"Console cloud","capability":"computer_use","mcpServer":"cloud"}],
            "hooks": [{"id":"prepare","displayName":"Préparer le contexte","event":"before_task","entrypoint":"prepare"}],
            "scheduledTaskTemplates": [{"id":"weekly-review","name":"Revue cloud","instructions":"Analyse les changements.","cronOrEvent":"every week"}]
        });
        assert!(PluginExtensionService::validate_schema(&manifest).is_empty());
    }
}
