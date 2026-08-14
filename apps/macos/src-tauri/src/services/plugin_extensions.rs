use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::plugin::{
    PluginBrowserStatus, PluginExtensionStatus, PluginHookStatus, PluginIntegrationStatus,
    PluginScheduleTemplate,
};
use crate::services::bob::BobService;
use crate::services::chrome_mcp::{ChromeMcpService, CHROME_MCP_NAME};
use crate::services::computer_use_mcp::{ComputerUseMcpService, COMPUTER_USE_MCP_NAME};
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

        if let Some(value) = manifest
            .get("integrations")
            .filter(|value| !value.is_null())
        {
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
                if auth_type == "mcp" {
                    let Some(server_id) = mcp_server else {
                        errors.push(format!(
                            "Integration {} must reference an MCP server",
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
                } else if auth_type == "oauth" {
                    if let Some(server_id) = mcp_server {
                        if !valid_slug(server_id)
                            || mcp_servers.is_none_or(|servers| !servers.contains_key(server_id))
                        {
                            errors.push(format!(
                                "Integration {} references an unknown MCP server: {}",
                                provider, server_id
                            ));
                        }
                    } else if crate::services::integration_catalog::integration_scopes(provider)
                        .is_none()
                    {
                        // Unknown OAuth providers would be simulated — refuse.
                        // First-party catalog integrations (Outlook, OneNote, …)
                        // may rely on Bob Work’s OAuth vault without a plugin MCP.
                        errors.push(format!(
                            "Integration {} must reference an MCP server; Bob Work never simulates OAuth",
                            provider
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
                    let uses_builtin_control = matches!(
                        (capability, server_id),
                        ("chrome", Some(name)) if name == CHROME_MCP_NAME
                    ) || matches!(
                        (capability, server_id),
                        ("computer_use", Some(name)) if name == COMPUTER_USE_MCP_NAME
                    );
                    if !uses_builtin_control
                        && (server_id.is_none()
                            || server_id.is_some_and(|server_id| {
                                mcp_servers.is_none_or(|servers| !servers.contains_key(server_id))
                            }))
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
        let mcp = self.mcp_status_by_id(plugin_id, manifest, db)?;
        let tests = crate::services::connection_test::ConnectionTestService::new()
            .list(db)
            .unwrap_or_default();
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
                let last_test = tests
                    .get(
                        &crate::services::connection_test::ConnectionTestService::integration_key(
                            &provider,
                        ),
                    )
                    .map(|record| record.summary());
                let (state, message) = if let Some(server_id) =
                    integration.get("mcpServer").and_then(Value::as_str)
                {
                    match mcp.get(server_id) {
                        Some(status) => integration_state_from_mcp(status, &auth_type),
                        _ => (
                            "disconnected".into(),
                            "Le connecteur MCP autorisé doit être configuré.".into(),
                        ),
                    }
                } else if bob.has_integration_credential(&provider) {
                    match last_test.as_ref() {
                        Some(test) if test.ok => (
                            "connected".into(),
                            if test.message.is_empty() {
                                "Compte authentifié et testé.".into()
                            } else {
                                test.message.clone()
                            },
                        ),
                        Some(test) => (
                            "failed".into(),
                            format!(
                                "Compte enregistré dans le coffre, dernier test en échec : {}",
                                test.message
                            ),
                        ),
                        None => (
                            "connected".into(),
                            "Autorisation enregistrée dans le coffre. Testez la connexion pour confirmer.".into(),
                        ),
                    }
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
                let mcp_ready = match capability.as_str() {
                    "chrome" => ChromeMcpService::new().is_enabled(),
                    "computer_use" => ComputerUseMcpService::new().is_enabled(),
                    _ => extension
                        .get("mcpServer")
                        .and_then(Value::as_str)
                        .map(|server_id| mcp.get(server_id).is_some_and(|status| status.enabled))
                        .unwrap_or(true),
                };
                let (state, message) = if !enabled_in_settings {
                    (
                        "disabled".into(),
                        "Cette capacité est désactivée dans les réglages de Bob Work.".into(),
                    )
                } else if !mcp_ready {
                    (
                        "disconnected".into(),
                        if capability == "chrome" {
                            "Activez le contrôle Chrome dans les réglages pour installer le serveur MCP intégré.".into()
                        } else if capability == "computer_use" {
                            "Activez « Contrôle de l’ordinateur » dans les réglages pour installer bob-work-computer-use.".into()
                        } else {
                            "L’extension ou le serveur MCP compatible n’est pas actif.".into()
                        },
                    )
                } else if capability == "chrome" {
                    let (automation, automation_message) =
                        ChromeMcpService::probe_chrome_automation();
                    if automation == "granted" {
                        ("ready".into(), automation_message)
                    } else {
                        (
                            "disconnected".into(),
                            format!(
                                "MCP Chrome installé, mais Automatisation macOS non accordée. {automation_message}"
                            ),
                        )
                    }
                } else if capability == "computer_use" {
                    let (accessibility, accessibility_message) =
                        ComputerUseMcpService::probe_accessibility();
                    if accessibility == "granted" {
                        ("ready".into(), accessibility_message)
                    } else {
                        (
                            "disconnected".into(),
                            format!(
                                "MCP Computer Use installé, mais Accessibilité macOS non accordée. {accessibility_message}"
                            ),
                        )
                    }
                } else {
                    (
                        "ready".into(),
                        "Accès web activé et outil compatible actif.".into(),
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

    /// Live readiness for each declared `resources[]` entry (API keys, MCP, etc.).
    pub fn resource_status(
        &self,
        plugin_id: &str,
        manifest: &Value,
        db: &Database,
        bob: &BobService,
    ) -> AppResult<Vec<crate::models::plugin::PluginResourceStatus>> {
        use crate::models::plugin::PluginResourceStatus;
        use crate::services::settings::SettingsService;

        let settings = SettingsService::new().get(db)?;
        let mcp = self.mcp_status_by_id(plugin_id, manifest, db)?;
        let bob_ready = bob.detect().found;

        let resources = manifest
            .get("resources")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let mut out = Vec::new();
        for (index, resource) in resources.iter().enumerate() {
            let kind = resource
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("mcp")
                .to_string();
            let label = resource
                .get("label")
                .and_then(Value::as_str)
                .or_else(|| resource.get("provider").and_then(Value::as_str))
                .unwrap_or(kind.as_str())
                .to_string();
            let optional = resource
                .get("optional")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let env_key = resource
                .get("env")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    resource
                        .get("notes")
                        .and_then(Value::as_str)
                        .and_then(extract_env_key_hint)
                });
            let mcp_server = resource
                .get("mcpServer")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    if kind != "mcp" || optional {
                        return None;
                    }
                    manifest
                        .get("mcpServers")
                        .and_then(Value::as_object)
                        .into_iter()
                        .flatten()
                        .find(|(_, server)| {
                            server
                                .get("required")
                                .and_then(Value::as_bool)
                                .unwrap_or(true)
                        })
                        .map(|(id, _)| id.clone())
                });

            let (state, message, setup_hint) = match kind.as_str() {
                "api-public" => (
                    "ready".into(),
                    "Prêt · API publique, aucune clé requise.".into(),
                    None,
                ),
                "api-key" => {
                    let key = env_key.clone().unwrap_or_else(|| "API_KEY".into());
                    if api_key_available(&key) {
                        (
                            "ready".into(),
                            format!("Clé détectée ({key}) — fallback / enrichissement actif."),
                            None,
                        )
                    } else if optional {
                        (
                            "needs_key".into(),
                            format!("Optionnel · définissez {key} pour activer cette source."),
                            Some(format!(
                                "Configurez {key} dans Intégrations → APIs (mode variable d’environnement)."
                            )),
                        )
                    } else {
                        (
                            "needs_key".into(),
                            format!("Clé API requise ({key})."),
                            Some(format!(
                                "Ajoutez {key} dans Intégrations → APIs (mode variable d’environnement)."
                            )),
                        )
                    }
                }
                "mcp" => {
                    if let Some(server_id) = mcp_server.as_deref() {
                        match mcp.get(server_id) {
                            Some(status) if status.enabled => match status.last_test.as_ref() {
                                Some(test) if test.ok => {
                                    ("ready".into(), "Serveur MCP du plugin testé.".into(), None)
                                }
                                Some(test) => (
                                    "needs_setup".into(),
                                    format!("Dernier test MCP en échec : {}", test.message),
                                    Some(
                                        "Relancez le test MCP ou vérifiez la configuration.".into(),
                                    ),
                                ),
                                None => (
                                    "ready".into(),
                                    "Serveur MCP installé · connexion non testée.".into(),
                                    None,
                                ),
                            },
                            Some(status) if status.configured => (
                                "inactive".into(),
                                "Serveur MCP installé mais désactivé.".into(),
                                Some("Activez le plugin ou le serveur MCP associé.".into()),
                            ),
                            _ => (
                                "needs_setup".into(),
                                "Serveur MCP du plugin non configuré.".into(),
                                Some("Activez le plugin pour installer le MCP local.".into()),
                            ),
                        }
                    } else if let Some(key) = env_key.as_deref() {
                        // Optional remote MCP pointed by env URL.
                        if api_key_available(key) {
                            (
                                "ready".into(),
                                format!("URL distante détectée ({key})."),
                                None,
                            )
                        } else if optional {
                            (
                                "inactive".into(),
                                "Optionnel · aucun MCP distant configuré.".into(),
                                Some(format!(
                                    "Ajoutez un serveur dans Intégrations → MCP, ou définissez {key}."
                                )),
                            )
                        } else {
                            (
                                "needs_setup".into(),
                                "MCP distant requis non configuré.".into(),
                                Some(format!("Configurez {key} ou un serveur MCP distant.")),
                            )
                        }
                    } else if optional {
                        (
                            "inactive".into(),
                            "Optionnel · non configuré.".into(),
                            Some("Ajoutez un serveur MCP dans Intégrations si besoin.".into()),
                        )
                    } else {
                        ("needs_setup".into(), "MCP à configurer.".into(), None)
                    }
                }
                "stdio-cli" => (
                    "ready".into(),
                    "CLI locale du plugin (disponible à l’activation).".into(),
                    None,
                ),
                "bob-llm" => {
                    if bob_ready {
                        (
                            "always_on".into(),
                            "Bob Shell détecté — synthèse via le LLM Bob.".into(),
                            None,
                        )
                    } else {
                        (
                            "needs_setup".into(),
                            "Bob Shell introuvable pour la synthèse.".into(),
                            Some("Installez / connectez Bob Shell dans Réglages.".into()),
                        )
                    }
                }
                "web-search" => {
                    if settings.web_enabled {
                        (
                            "ready".into(),
                            "Accès web activé dans Réglages.".into(),
                            None,
                        )
                    } else if optional {
                        (
                            "inactive".into(),
                            "Optionnel · Accès web désactivé.".into(),
                            Some("Activez Accès web dans Réglages → Accès et contrôle.".into()),
                        )
                    } else {
                        (
                            "needs_setup".into(),
                            "Accès web requis mais désactivé.".into(),
                            Some("Activez Accès web dans Réglages.".into()),
                        )
                    }
                }
                other => (
                    "inactive".into(),
                    format!("Source « {other} » déclarée."),
                    None,
                ),
            };

            let configure_tab = match kind.as_str() {
                "api-key" => Some("apis".into()),
                "mcp" => Some("mcp".into()),
                "oauth" => Some("integrations".into()),
                _ => None,
            };
            let configure_url = match (kind.as_str(), env_key.as_deref()) {
                ("api-key", Some("FINNHUB_API_KEY")) => {
                    Some("https://finnhub.io/api/v1/quote".into())
                }
                _ => None,
            };

            out.push(PluginResourceStatus {
                id: format!("{kind}-{index}"),
                label,
                kind,
                optional,
                state,
                message,
                setup_hint,
                configure_tab,
                env_key,
                configure_url,
            });
        }

        Ok(out)
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
            let joined = bundle_dir.join(relative);
            crate::security::path_validation::validate_symlink(&joined, &[bundle_dir.clone()])
                .map_err(|error| AppError::Plugin(error.to_string()))?;
            let path =
                crate::security::path_validation::validate_path(&joined, &[bundle_dir.clone()])
                    .map_err(|error| AppError::Plugin(error.to_string()))?;
            if !path.is_file() {
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
        db: &Database,
    ) -> AppResult<HashMap<String, crate::models::plugin::PluginMcpStatus>> {
        if !PluginMcpService::has_servers(manifest) {
            return Ok(HashMap::new());
        }
        let bundle_dir = PluginMcpService::bundle_dir(manifest)?;
        let tests = crate::services::connection_test::ConnectionTestService::new()
            .list(db)
            .unwrap_or_default();
        Ok(PluginMcpService::new()
            .status(plugin_id, manifest, &bundle_dir)?
            .into_iter()
            .map(|mut status| {
                status.last_test = tests
                    .get(
                        &crate::services::connection_test::ConnectionTestService::plugin_mcp_key(
                            plugin_id, &status.id,
                        ),
                    )
                    .or_else(|| {
                        tests.get(
                            &crate::services::connection_test::ConnectionTestService::mcp_key(
                                &status.id,
                            ),
                        )
                    })
                    .map(|record| record.summary());
                (status.id.clone(), status)
            })
            .collect())
    }
}

fn integration_state_from_mcp(
    status: &crate::models::plugin::PluginMcpStatus,
    auth_type: &str,
) -> (String, String) {
    if !status.configured {
        return (
            "disconnected".into(),
            "Le connecteur MCP autorisé doit être configuré.".into(),
        );
    }
    if !status.enabled {
        return (
            "disabled".into(),
            "Le connecteur est installé mais désactivé.".into(),
        );
    }
    match status.last_test.as_ref() {
        Some(test) if test.ok => (
            "connected".into(),
            if test.message.is_empty() {
                "Connexion MCP testée avec succès.".into()
            } else {
                test.message.clone()
            },
        ),
        Some(test) => (
            "failed".into(),
            if test.message.is_empty() {
                "Dernier test de connexion MCP en échec.".into()
            } else {
                format!("Dernier test en échec : {}", test.message)
            },
        ),
        None if auth_type == "oauth" => (
            "configured".into(),
            "Connecteur MCP prêt. Le compte OAuth n’est pas encore authentifié — testez ou connectez le fournisseur.".into(),
        ),
        None => (
            "configured".into(),
            "Outils MCP installés, connexion non testée.".into(),
        ),
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

fn env_var_present(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
}

fn api_key_available(key: &str) -> bool {
    if env_var_present(key) || env_var_present(&format!("BOB_{key}")) {
        return true;
    }
    let workspace = crate::services::workspace::WorkspaceService::new();
    workspace.mcp_env_key_present(key) || workspace.mcp_env_key_present(&format!("BOB_{key}"))
}

fn extract_env_key_hint(notes: &str) -> Option<String> {
    for token in notes.split(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == '/') {
        let cleaned = token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_');
        if cleaned
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            && cleaned.contains('_')
            && cleaned.len() >= 6
            && (cleaned.contains("KEY") || cleaned.contains("TOKEN") || cleaned.contains("URL"))
        {
            return Some(cleaned.to_string());
        }
    }
    None
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
    fn accepts_first_party_oauth_without_plugin_mcp() {
        let manifest = serde_json::json!({
            "permissions": [{"type":"network.request"}],
            "integrations": [{
                "provider": "onenote",
                "displayName": "Microsoft OneNote",
                "authType": "oauth",
                "scopes": ["Notes.Read", "Notes.ReadWrite"],
                "optional": true
            }]
        });
        assert!(PluginExtensionService::validate_schema(&manifest).is_empty());
    }

    #[test]
    fn accepts_builtin_computer_use_mcp_without_local_plugin_server() {
        let manifest = serde_json::json!({
            "permissions": [{"type":"browser.control"}],
            "browserExtensions": [{
                "id": "desktop",
                "displayName": "Contrôle bureau",
                "capability": "computer_use",
                "mcpServer": "bob-work-computer-use",
                "required": true
            }]
        });
        assert!(PluginExtensionService::validate_schema(&manifest).is_empty());
    }

    #[test]
    fn accepts_builtin_chrome_mcp_without_local_plugin_server() {
        let manifest = serde_json::json!({
            "permissions": [{"type":"browser.control"}],
            "browserExtensions": [{
                "id": "chrome",
                "displayName": "Contrôle Google Chrome",
                "capability": "chrome",
                "mcpServer": "bob-work-chrome-control",
                "required": true
            }]
        });
        assert!(PluginExtensionService::validate_schema(&manifest).is_empty());
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

    fn temp_db() -> crate::db::Database {
        let db = crate::db::Database::new_in_memory().expect("in-memory db");
        db.run_migrations().expect("migrations");
        db
    }

    fn temp_bob() -> (std::path::PathBuf, crate::services::bob::BobService) {
        let root =
            std::env::temp_dir().join(format!("bob-work-browser-ext-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temp dir");
        (root.clone(), crate::services::bob::BobService::new(&root))
    }

    fn browser_manifest(capability: &str, required: bool) -> serde_json::Value {
        serde_json::json!({
            "permissions": [{"type":"browser.control"}],
            "browserExtensions": [{
                "id": "desktop-control",
                "displayName": "Contrôle bureau",
                "capability": capability,
                "required": required
            }]
        })
    }

    fn set_computer_use_enabled(db: &crate::db::Database, enabled: bool) {
        crate::services::settings::SettingsService::new()
            .update_key(
                db,
                "computer_use_enabled",
                if enabled { "true" } else { "false" },
            )
            .expect("update computer_use_enabled");
    }

    fn set_chrome_control_enabled(db: &crate::db::Database, enabled: bool) {
        crate::services::settings::SettingsService::new()
            .update_key(
                db,
                "chrome_control_enabled",
                if enabled { "true" } else { "false" },
            )
            .expect("update chrome_control_enabled");
    }

    fn set_web_enabled(db: &crate::db::Database, enabled: bool) {
        crate::services::settings::SettingsService::new()
            .update_key(db, "web_enabled", if enabled { "true" } else { "false" })
            .expect("update web_enabled");
    }

    #[test]
    fn browser_extension_requires_computer_use_setting() {
        let db = temp_db();
        let (_root, bob) = temp_bob();
        let manifest = browser_manifest("computer_use", true);
        set_computer_use_enabled(&db, false);

        let status = PluginExtensionService::new()
            .status("plugin-desktop", &manifest, &db, &bob)
            .expect("status");
        assert_eq!(status.browser_extensions.len(), 1);
        assert_eq!(status.browser_extensions[0].state, "disabled");
        assert!(status.browser_extensions[0]
            .message
            .to_lowercase()
            .contains("réglages"));

        set_computer_use_enabled(&db, true);
        let status = PluginExtensionService::new()
            .status("plugin-desktop", &manifest, &db, &bob)
            .expect("status");
        // Setting on: ready only if MCP + Accessibilité OK; otherwise disconnected
        // (MCP missing and/or TCC denied) — never pretend ready without TCC.
        let state = status.browser_extensions[0].state.as_str();
        let message = status.browser_extensions[0].message.to_lowercase();
        assert!(matches!(state, "disconnected" | "ready"));
        assert_ne!(state, "disabled");
        if state == "ready" {
            assert!(message.contains("accessibilité") || message.contains("accord"));
        } else {
            assert!(
                message.contains("bob-work-computer-use")
                    || message.contains("accessibilité")
                    || message.contains("autorisez")
            );
        }
    }

    #[test]
    fn browser_extension_requires_chrome_control_setting() {
        let db = temp_db();
        let (_root, bob) = temp_bob();
        let manifest = browser_manifest("chrome", true);
        set_chrome_control_enabled(&db, false);

        let status = PluginExtensionService::new()
            .status("plugin-chrome", &manifest, &db, &bob)
            .expect("status");
        assert_eq!(status.browser_extensions[0].state, "disabled");

        set_chrome_control_enabled(&db, true);
        let status = PluginExtensionService::new()
            .status("plugin-chrome", &manifest, &db, &bob)
            .expect("status");
        let state = status.browser_extensions[0].state.as_str();
        let message = status.browser_extensions[0].message.to_lowercase();
        assert!(matches!(state, "disconnected" | "ready"));
        assert_ne!(state, "disabled");
        if state == "ready" {
            assert!(message.contains("automatisation") || message.contains("accord"));
        } else {
            assert!(
                message.contains("chrome")
                    || message.contains("automatisation")
                    || message.contains("autorisez")
            );
        }
    }

    #[test]
    fn generic_browser_extension_follows_web_setting() {
        let db = temp_db();
        let (_root, bob) = temp_bob();
        let manifest = browser_manifest("browser", false);
        set_web_enabled(&db, false);

        let status = PluginExtensionService::new()
            .status("plugin-browser", &manifest, &db, &bob)
            .expect("status");
        assert_eq!(status.browser_extensions[0].state, "disabled");

        set_web_enabled(&db, true);
        let status = PluginExtensionService::new()
            .status("plugin-browser", &manifest, &db, &bob)
            .expect("status");
        assert_eq!(status.browser_extensions[0].state, "ready");
    }

    #[test]
    fn mcp_integration_state_distinguishes_configured_connected_and_failed() {
        let base = crate::models::plugin::PluginMcpStatus {
            id: "s".into(),
            name: "S".into(),
            description: None,
            transport: "stdio".into(),
            tools: vec![],
            configured: true,
            enabled: true,
            required: true,
            last_test: None,
        };
        let (state, message) = integration_state_from_mcp(&base, "oauth");
        assert_eq!(state, "configured");
        assert!(message.contains("OAuth") || message.contains("authentifié"));

        let mut tested = base.clone();
        tested.last_test = Some(crate::models::plugin::ConnectionTestSummary {
            ok: true,
            message: "ok".into(),
            tested_at: "now".into(),
            tools: vec![],
        });
        assert_eq!(integration_state_from_mcp(&tested, "mcp").0, "connected");

        tested.last_test = Some(crate::models::plugin::ConnectionTestSummary {
            ok: false,
            message: "refused".into(),
            tested_at: "now".into(),
            tools: vec![],
        });
        let (failed_state, failed_message) = integration_state_from_mcp(&tested, "mcp");
        assert_eq!(failed_state, "failed");
        assert!(failed_message.contains("refused"));
    }
}
