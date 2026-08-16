// ============================================================
// Bob Work - Bob Commands
// send_message: non-blocking async + streaming via Tauri events
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::models::conversation::AddMessageInput;
use crate::models::task::CreateTaskInput;
use crate::models::workspace::McpServer;
use crate::services::audit::AuditService;
use crate::services::bob::{
    BobDetectionResult, BobMode, BobRunOptions, BobService, CapabilityInfo, PendingBobLaunch,
    ShellProfile,
};
use crate::services::conversation::ConversationService;
use crate::services::permission_governance::{self, RiskContext, ACTION_SESSION_START};
use crate::services::plugin_extensions::PluginExtensionService;
use crate::services::settings::SettingsService;
use crate::services::task::TaskService;
use crate::services::workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{Emitter, Manager, State};
use tracing::{debug, info};

// ── detect_bob ────────────────────────────────────────────────

#[tauri::command]
pub async fn detect_bob(bob_service: State<'_, BobService>) -> Result<BobDetectionResult, AppError> {
    Ok(bob_service.detect())
}

#[tauri::command]
pub async fn get_bob_auth_snapshot(
    bob_service: State<'_, BobService>,
) -> Result<crate::services::bob::BobAuthSnapshot, AppError> {
    Ok(bob_service.auth_snapshot())
}

// ── get_bob_capabilities ──────────────────────────────────────

#[tauri::command]
pub async fn get_bob_capabilities(
    bob_service: State<'_, BobService>,
) -> Result<HashMap<String, CapabilityInfo>, AppError> {
    Ok(bob_service.get_capabilities())
}

#[tauri::command]
pub async fn get_bob_profile(
    workspace: Option<String>,
    bob_service: State<'_, BobService>,
) -> Result<ShellProfile, AppError> {
    Ok(bob_service.get_profile(workspace.as_deref()))
}

#[tauri::command]
pub async fn get_bob_modes(
    workspace: Option<String>,
    bob_service: State<'_, BobService>,
) -> Result<Vec<BobMode>, AppError> {
    Ok(bob_service.discover_modes(workspace.as_deref()))
}

// ── Volatile session secrets ──────────────────────────────────

#[tauri::command]
pub async fn set_session_secret(
    account: String,
    secret: String,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    bob_service.set_session_secret(&account, secret)
}

#[tauri::command]
pub async fn has_session_secret(
    account: String,
    bob_service: State<'_, BobService>,
) -> Result<bool, AppError> {
    bob_service.has_session_secret(&account)
}

#[tauri::command]
pub async fn clear_session_secret(
    account: String,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    bob_service.clear_session_secret(&account)
}

// ── install_bob_shell ─────────────────────────────────────────

#[tauri::command]
pub async fn install_bob_shell() -> Result<bool, AppError> {
    let version_output = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "30", "https://s3.us-south.cloud-object-storage.appdomain.cloud/bob-shell/bobshell2-version.txt"])
        .output()
        .map_err(|e| AppError::BobExecutionFailed(format!("Téléchargement de la version impossible : {}", e)))?;
    if !version_output.status.success() {
        return Err(AppError::BobExecutionFailed(
            "IBM n'a pas renvoyé la version de Bob Shell.".into(),
        ));
    }
    let version = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string();
    if !regex::Regex::new(r"^\d+\.\d+\.\d+([-.][A-Za-z0-9.]+)?$")
        .unwrap()
        .is_match(&version)
    {
        return Err(AppError::BobExecutionFailed(
            "Version Bob Shell invalide reçue du serveur.".into(),
        ));
    }

    let temp_dir = std::env::temp_dir().join(format!("bob-work-install-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)?;
    let package_path = temp_dir.join(format!("bobshell-{}.tgz", version));
    let package_url = format!(
        "https://s3.us-south.cloud-object-storage.appdomain.cloud/bob-shell/bobshell-{}.tgz",
        version
    );
    let checksum_url = format!("{}.sha256", package_url);
    let download = std::process::Command::new("curl")
        .args([
            "-fSL",
            "--retry",
            "3",
            "--max-time",
            "300",
            &package_url,
            "-o",
        ])
        .arg(&package_path)
        .output()
        .map_err(|e| {
            AppError::BobExecutionFailed(format!("Téléchargement du paquet impossible : {}", e))
        })?;
    if !download.status.success() {
        return Err(AppError::BobExecutionFailed(
            String::from_utf8_lossy(&download.stderr).to_string(),
        ));
    }
    let checksum_output = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "30", &checksum_url])
        .output()
        .map_err(|e| {
            AppError::BobExecutionFailed(format!("Somme de contrôle indisponible : {}", e))
        })?;
    let expected = String::from_utf8_lossy(&checksum_output.stdout)
        .trim()
        .to_lowercase();
    let actual_output = std::process::Command::new("shasum")
        .args(["-a", "256"])
        .arg(&package_path)
        .output()
        .map_err(|e| {
            AppError::BobExecutionFailed(format!("Vérification SHA-256 impossible : {}", e))
        })?;
    let actual = String::from_utf8_lossy(&actual_output.stdout)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_lowercase();
    if expected.is_empty() || expected != actual {
        return Err(AppError::BobExecutionFailed(
            "Le paquet Bob Shell a échoué la vérification SHA-256.".into(),
        ));
    }

    let prefix = dirs::home_dir()
        .ok_or_else(|| AppError::Io("Dossier utilisateur introuvable".into()))?
        .join(".local");
    let install = std::process::Command::new("npm")
        .args([
            "install",
            "--registry=https://registry.npmjs.org/",
            "--progress=false",
            "--loglevel=error",
            "-g",
            "--prefix",
        ])
        .arg(&prefix)
        .arg(&package_path)
        .output()
        .map_err(|e| {
            AppError::BobExecutionFailed(format!("Installation npm impossible : {}", e))
        })?;
    let _ = std::fs::remove_file(&package_path);
    let _ = std::fs::remove_dir(&temp_dir);
    if !install.status.success() {
        return Err(AppError::BobExecutionFailed(
            String::from_utf8_lossy(&install.stderr).to_string(),
        ));
    }
    Ok(true)
}

// ── send_message ──────────────────────────────────────────────
//
// Non-blocking: saves user message to DB, starts a background
// streaming session and returns immediately.
// The frontend receives tokens via `bob-token` and knows when
// the session is done via `bob-session-done`.

#[tauri::command]
pub async fn send_message(
    app_handle: tauri::AppHandle,
    conversation_id: String,
    message: String,
    mode: String,
    project_id: Option<String>,
    attachment_paths: Option<Vec<String>>,
    resume_task_id: Option<String>,
    approved_plugin_ids: Option<Vec<String>>,
    bob_service: State<'_, BobService>,
    db: State<'_, Database>,
) -> Result<StartSessionResult, AppError> {
    let conv_service = ConversationService::new();
    let approved_plugin_ids = approved_plugin_ids.unwrap_or_default();
    let project = if let Some(project_id) = project_id.as_deref() {
        crate::services::project::ProjectService::new().get_by_id(&db, project_id)?
    } else {
        None
    };
    if let Some(project) = project
        .as_ref()
        .filter(|value| !value.allowed_plugins.is_empty())
    {
        for captures in regex::Regex::new(r"@skill:([a-z0-9-]+)")
            .unwrap()
            .captures_iter(&message)
        {
            let permission = format!("skill:{}", &captures[1]);
            if !project.allowed_plugins.contains(&permission) {
                return Err(AppError::PermissionDenied(format!(
                    "Le skill {} n’est pas autorisé dans ce projet.",
                    &captures[1]
                )));
            }
        }
        for captures in regex::Regex::new(r"@plugin:([A-Za-z0-9-]+)")
            .unwrap()
            .captures_iter(&message)
        {
            if !project
                .allowed_plugins
                .iter()
                .any(|value| value == &captures[1])
            {
                return Err(AppError::PermissionDenied(
                    "Ce plugin n’est pas autorisé dans ce projet.".into(),
                ));
            }
        }
    }

    let mut plugin_integration_ids = vec![];
    let mut plugin_hooks = vec![];
    let mut office_plugins = vec![];
    let mut checked_plugin_ids = std::collections::HashSet::new();
    for captures in regex::Regex::new(r"@plugin:([A-Za-z0-9-]+)")
        .unwrap()
        .captures_iter(&message)
    {
        let plugin_id = &captures[1];
        if !checked_plugin_ids.insert(plugin_id.to_string()) {
            continue;
        }
        let plugin = crate::services::plugin::PluginService::new()
            .get_by_id(&db, plugin_id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} introuvable", plugin_id)))?;
        if plugin.install_state != "installed" {
            return Err(AppError::PermissionDenied(format!(
                "Le plugin {} est désactivé.",
                plugin.name
            )));
        }
        let requires_preflight = plugin
            .manifest
            .get("permissions")
            .and_then(|value| value.as_array())
            .is_some_and(|permissions| {
                permissions.iter().any(|permission| {
                    matches!(
                        permission.get("type").and_then(|value| value.as_str()),
                        Some(
                            "command.execute"
                                | "file.delete"
                                | "network.request"
                                | "mcp.connect"
                                | "hook.execute"
                                | "browser.control"
                        )
                    )
                })
            });
        // Packaged Work modes (Brief Mission IBM, CTO Invest…) use specializedMode with
        // builtin:false so they stay out of the "native skill" catalog — still trusted locally.
        let trusted_local_office = plugin.manifest.get("specializedMode").is_some();
        if requires_preflight
            && !trusted_local_office
            && !approved_plugin_ids.iter().any(|value| value == plugin_id)
        {
            return Err(AppError::PermissionDenied(format!(
                "Le plugin {} nécessite une autorisation explicite avant cette exécution.",
                plugin.name
            )));
        }
        if crate::services::plugin_mcp::PluginMcpService::has_servers(&plugin.manifest) {
            let bundle_dir =
                crate::services::plugin_mcp::PluginMcpService::bundle_dir(&plugin.manifest)?;
            let mcp = crate::services::plugin_mcp::PluginMcpService::new();
            let mut unavailable = mcp
                .status(&plugin.id, &plugin.manifest, &bundle_dir)?
                .into_iter()
                .filter(|server| server.required && (!server.configured || !server.enabled))
                .map(|server| server.name)
                .collect::<Vec<_>>();
            // Local specialized modes: register/enable MCP on first use instead of a dead-end error.
            if !unavailable.is_empty() && trusted_local_office {
                if let Some(bob_path) = bob_service.get_binary_path() {
                    match mcp.sync(&bob_path, &plugin.id, &plugin.manifest, &bundle_dir, true) {
                        Ok(_) => {
                            unavailable = mcp
                                .status(&plugin.id, &plugin.manifest, &bundle_dir)?
                                .into_iter()
                                .filter(|server| {
                                    server.required && (!server.configured || !server.enabled)
                                })
                                .map(|server| server.name)
                                .collect();
                        }
                        Err(error) => {
                            return Err(AppError::PermissionDenied(format!(
                                "Impossible d’activer les outils MCP du plugin {} : {}. Vérifiez que Bob Shell est installé, puis réessayez depuis Plugins.",
                                plugin.name,
                                error
                            )));
                        }
                    }
                }
            }
            if !unavailable.is_empty() {
                return Err(AppError::PermissionDenied(format!(
                    "Les outils connectés du plugin {} ne sont pas actifs : {}. Activez le plugin dans Plugins (MCP) puis relancez.",
                    plugin.name,
                    unavailable.join(", ")
                )));
            }
        }
        let extensions = PluginExtensionService::new().status(
            &plugin.id,
            &plugin.manifest,
            &db,
            &bob_service,
        )?;
        let missing_integrations = extensions
            .integrations
            .iter()
            .filter(|integration| {
                integration.required
                    && !matches!(integration.state.as_str(), "connected" | "configured")
            })
            .map(|integration| integration.name.clone())
            .collect::<Vec<_>>();
        if !missing_integrations.is_empty() {
            return Err(AppError::PermissionDenied(format!(
                "Le plugin {} nécessite une vraie connexion : {}. Autorisez-la dans Intégrations et MCP avant de relancer la demande.",
                plugin.name,
                missing_integrations.join(", ")
            )));
        }
        let missing_browser = extensions
            .browser_extensions
            .iter()
            .filter(|extension| extension.required && extension.state != "ready")
            .map(|extension| extension.name.clone())
            .collect::<Vec<_>>();
        if !missing_browser.is_empty() {
            return Err(AppError::PermissionDenied(format!(
                "Le plugin {} nécessite une capacité navigateur autorisée : {}. Activez-la dans Réglages Bob Work → Accès et contrôle, puis configurez l’outil MCP compatible.",
                plugin.name,
                missing_browser.join(", ")
            )));
        }
        plugin_integration_ids.extend(
            extensions
                .integrations
                .iter()
                .filter(|integration| integration.state == "connected")
                .map(|integration| integration.provider.clone()),
        );
        plugin_hooks.extend(PluginExtensionService::new().prepare_hooks(&plugin.manifest)?);
        if plugin.manifest.get("specializedMode").is_some() {
            office_plugins.push(plugin);
        }
    }

    // 1. Resolve a Bob-accessible workspace and stage attachments into it.
    // Composer paths (e.g. ~/Downloads) are outside Bob Shell's sandbox unless
    // we copy them under `--workspace` first.
    let requested_attachment_paths = attachment_paths.unwrap_or_default();
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Io(error.to_string()))?;
    let workspace_root = crate::services::attachment_staging::resolve_workspace_root(
        project
            .as_ref()
            .and_then(|value| value.local_path.as_deref()),
        &app_data_dir,
        &conversation_id,
    )?;
    let session_id = format!("sess_{}", uuid::Uuid::new_v4());
    let staged_attachments = crate::services::attachment_staging::stage_attachments(
        &workspace_root,
        &session_id,
        &requested_attachment_paths,
    )?;
    let attachment_json = serde_json::Value::Array(if staged_attachments.is_empty() {
        requested_attachment_paths
            .iter()
            .map(|path| {
                let p = std::path::Path::new(path);
                serde_json::json!({
                    "name": p.file_name().and_then(|v| v.to_str()).unwrap_or(path),
                    "path": path,
                    "type": if p.is_dir() { "directory" } else { "file" },
                    "size": p.metadata().ok().filter(|m| m.is_file()).map(|m| m.len()).unwrap_or(0),
                })
            })
            .collect()
    } else {
        staged_attachments
            .iter()
            .map(|attachment| {
                serde_json::json!({
                    "name": attachment.name,
                    "path": attachment.source_path,
                    "stagedPath": attachment.staged_path,
                    "type": if attachment.is_directory { "directory" } else { "file" },
                    "size": attachment.size,
                })
            })
            .collect()
    });
    let user_message = conv_service.add_message(
        &db,
        AddMessageInput {
            conversation_id: conversation_id.clone(),
            author: "user".to_string(),
            content: message.clone(),
            attachments: Some(attachment_json),
            sources: None,
        },
    )?;
    // The conversation list updates *after* the title is generated to avoid 
    // flashing "Nouvelle conversation" before the summary is ready.
    // let _ = app_handle.emit("conversation-updated", &conversation_id);
    let should_generate_title = conv_service
        .get_by_id(&db, &conversation_id)
        .ok()
        .flatten()
        .is_some_and(|conversation| is_automatic_title_placeholder(&conversation.title))
        && conv_service
            .get_messages(&db, &conversation_id)
            .map(|messages| messages.iter().filter(|item| item.author == "user").count() == 1)
            .unwrap_or(false);

    // 2. Check Bob availability
    let bob_info = bob_service.detect();
    if !bob_info.found {
        let err_msg =
            "Bob Shell n'est pas installé. Veuillez installer IBM Bob Shell depuis bob.ibm.com."
                .to_string();
        conv_service.add_message(
            &db,
            AddMessageInput {
                conversation_id: conversation_id.clone(),
                author: "assistant".to_string(),
                content: err_msg.clone(),
                attachments: None,
                sources: None,
            },
        )?;
        return Err(AppError::BobNotFound(err_msg));
    }
    if !bob_info.authenticated {
        let err_msg = "Bob Shell exige une authentification pour bob run. Connectez IBM Bob (SSO) ou enregistrez une clé d’inférence dans Réglages → IBM Bob Shell.".to_string();
        conv_service.add_message(
            &db,
            AddMessageInput {
                conversation_id: conversation_id.clone(),
                author: "assistant".to_string(),
                content: err_msg.clone(),
                attachments: None,
                sources: None,
            },
        )?;
        return Err(AppError::BobAuthFailed(err_msg));
    }

    // 3. Create a persistent task, or start a new attempt for a resumable Shell task.
    let settings = SettingsService::new().get(&db)?;
    let task = if let Some(task_id) = resume_task_id.as_deref() {
        let existing = TaskService::new()
            .get_by_id(&db, task_id)?
            .ok_or_else(|| AppError::NotFound("Tâche à reprendre introuvable".into()))?;
        if existing.shell_task_id.is_none() || !existing.resumable {
            return Err(AppError::ValidationFailed(
                "Cette tâche n’est pas reprenable par Bob Shell.".into(),
            ));
        }
        if existing.conversation_id.as_deref() != Some(conversation_id.as_str()) {
            return Err(AppError::ValidationFailed(
                "La tâche et la conversation ne correspondent pas.".into(),
            ));
        }
        existing
    } else {
        TaskService::new().create(
            &db,
            CreateTaskInput {
                objective: message.clone(),
                project_id: project_id.clone(),
                conversation_id: Some(conversation_id.clone()),
                mode: Some(mode.clone()),
                permission_policy: Some(settings.permission_policy.clone()),
                budget: (settings.max_cost > 0.0).then_some(settings.max_cost),
                max_time: None,
                schedule_id: None,
            },
        )?
    };
    TaskService::new().update_state(&db, &task.id, "starting")?;

    let run = TaskService::new().start_run(&db, &task.id, &session_id)?;

    // Make the running task observable immediately. Waiting for the final
    // session event left the Tasks view empty during the first execution.
    let _ = app_handle.emit("task-updated", &task.id);
    let _ = TaskService::new().add_event(
        &db,
        &task.id,
        Some(&run.id),
        "task_started",
        Some("Tâche démarrée"),
        Some(&message),
        None,
        &serde_json::json!({ "mode": mode, "conversationId": conversation_id }),
    );
    let _ = TaskService::new().add_io(
        &db,
        &task.id,
        Some(&run.id),
        "input",
        "prompt",
        "Demande utilisateur",
        None,
        Some("text/plain"),
        Some(message.len() as i64),
        None,
        &serde_json::json!({ "mode": mode }),
    );
    for attachment in &staged_attachments {
        let _ = TaskService::new().add_io(
            &db,
            &task.id,
            Some(&run.id),
            "input",
            if attachment.is_directory {
                "directory"
            } else {
                "file"
            },
            &attachment.name,
            Some(&attachment.staged_path),
            None,
            (!attachment.is_directory).then_some(attachment.size as i64),
            None,
            &serde_json::json!({
                "accessMode": "staged",
                "sourcePath": attachment.source_path,
            }),
        );
    }

    info!(
        "Starting streaming session {} for conversation {} in {} mode (workspace {})",
        session_id,
        conversation_id,
        mode,
        workspace_root.display()
    );

    // 4. Load conversation history (last 10 messages) for context
    let history = conv_service
        .get_messages(&db, &conversation_id)
        .unwrap_or_default()
        .into_iter()
        .rev()
        .take(10)
        .rev()
        .collect::<Vec<_>>();

    let mut prompt_attachment_paths = staged_attachments
        .iter()
        .map(|attachment| attachment.staged_path.clone())
        .collect::<Vec<_>>();
    if prompt_attachment_paths.is_empty() {
        // Follow-ups like “ok, déplace-les” must keep the prior images in context.
        prompt_attachment_paths =
            crate::services::attachment_staging::attachment_paths_from_history(&history);
    }

    // 5. Build context-aware prompt with history
    let shell_message = translate_prompt_mentions(&db, &message);
    let mut integration_ids = project
        .as_ref()
        .map(|value| value.allowed_integrations.clone())
        .filter(|values| !values.is_empty())
        .unwrap_or_else(|| {
            vec![
                "github".into(),
                "slack".into(),
                "monday".into(),
                "outlook-mail".into(),
                "teams".into(),
                "outlook-calendar".into(),
                "onedrive".into(),
                "onenote".into(),
            ]
        });
    integration_ids.extend(plugin_integration_ids);
    integration_ids.sort();
    integration_ids.dedup();
    let plugin_creation =
        plugin_creation_protocol(&message).or_else(|| skill_creation_protocol(&message, &mode));
    let mcp_catalog = WorkspaceService::new().list_mcp_servers();
    let creation_environment = plugin_creation
        .as_ref()
        .filter(|text| text.contains("création de plugin"))
        .map(|_| {
            plugin_creation_environment_context(
                settings.web_enabled,
                settings.computer_use_enabled,
                settings.chrome_control_enabled,
                &mcp_catalog,
                &available_integration_context(&bob_service, &integration_ids),
                &integration_ids,
            )
        });
    let related_context = if settings.cross_conversation_context {
        // Project-level « Conserver le contexte local » gates sibling chats.
        let allow_search = project
            .as_ref()
            .map(|project| project.memory_enabled)
            .unwrap_or(true);
        if allow_search {
            let scope = project.as_ref().map(|project| project.id.as_str());
            ConversationService::new()
                .related_context_snippets(&db, &message, &conversation_id, scope, 4)
                .unwrap_or_default()
        } else {
            vec![]
        }
    } else {
        vec![]
    };
    let related_context_block =
        crate::services::conversation::RelatedContextSnippet::format_block(&related_context);
    let prompt = build_prompt_with_history(
        &shell_message,
        &mode,
        &history,
        &settings.global_instructions,
        project
            .as_ref()
            .and_then(|p| p.custom_instructions.as_deref()),
        &prompt_attachment_paths,
        settings.web_enabled && !settings.sandbox_mode,
        &available_integration_context(&bob_service, &integration_ids),
        build_office_specialized_context(&office_plugins, &prompt_attachment_paths),
        plugin_creation,
        creation_environment,
        settings.sandbox_mode,
        settings.computer_use_enabled && !settings.sandbox_mode,
        settings.chrome_control_enabled && !settings.sandbox_mode,
        related_context_block,
    );

    // 6. Audit log: session started
    let _ =
        AuditService::new().bob_event(&db, "bob.session_started", &session_id, &conversation_id);

    // 7. Permission governance: session start is default-allow (no popup).
    // `--trust` remains conditional. Mid-run risky actions use other paths.
    let workspace_path = Some(workspace_root.to_string_lossy().to_string());
    let workspace_resource = workspace_root.to_string_lossy().to_string();
    let risk = RiskContext {
        computer_use: settings.computer_use_enabled,
        chrome: settings.chrome_control_enabled,
        mcp: settings.mcp_enabled,
        web: settings.web_enabled,
    }
    .with_sandbox(settings.sandbox_mode);
    let has_grant = permission_governance::has_allow_grant(
        &db,
        ACTION_SESSION_START,
        &workspace_resource,
        Some(task.id.as_str()),
    )?;
    let run_options = BobRunOptions {
        task_id: Some(task.id.clone()),
        run_id: Some(run.id.clone()),
        max_turns: Some(settings.max_turns),
        max_cost: (settings.max_cost > 0.0).then_some(settings.max_cost),
        mcp_enabled: settings.mcp_enabled,
        subagents_enabled: settings.subagents_enabled,
        attachment_paths: prompt_attachment_paths,
        integration_ids,
        plugin_hooks,
        resume_task_id: task
            .shell_task_id
            .clone()
            .filter(|_| resume_task_id.is_some()),
        trust_workspace: false,
    };

    let awaiting_approval = if permission_governance::needs_preflight(
        &settings.permission_policy,
        &risk,
        has_grant,
    ) {
        let approval_id = format!("appr_{}", uuid::Uuid::new_v4());
        let approval = crate::models::approval::Approval {
            id: approval_id.clone(),
            task_id: task.id.clone(),
            action_type: ACTION_SESSION_START.into(),
            human_description: format!(
                "Autoriser Bob Shell à démarrer cette session ? Capacité : {}{}.",
                risk.summary(),
                if settings.sandbox_mode {
                    " · mode sandbox (workspace uniquement, sans --trust)"
                } else {
                    ""
                }
            ),
            command_or_change: Some(format!(
                "bob run --workspace {} (politique : {}{})",
                workspace_resource,
                permission_governance::policy_label(&settings.permission_policy),
                if settings.sandbox_mode {
                    ", sandbox"
                } else {
                    ""
                }
            )),
            data_accessed: serde_json::json!([]),
            files_affected: serde_json::json!([]),
            // Used as grant resource so later sessions on the same workspace can skip preflight.
            network_destination: Some(workspace_resource.clone()),
            risk_level: risk.risk_level().into(),
            decision: "pending".into(),
            permission_duration: None,
            decided_by: None,
            decided_at: None,
            undo_possible: false,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO approvals (id, task_id, action_type, human_description, command_or_change, data_accessed, files_affected, network_destination, risk_level, decision, permission_duration, decided_by, decided_at, undo_possible, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                rusqlite::params![
                    approval.id,
                    approval.task_id,
                    approval.action_type,
                    approval.human_description,
                    approval.command_or_change,
                    approval.data_accessed.to_string(),
                    approval.files_affected.to_string(),
                    approval.network_destination,
                    approval.risk_level,
                    approval.decision,
                    approval.permission_duration,
                    approval.decided_by,
                    approval.decided_at,
                    approval.undo_possible,
                    approval.created_at
                ],
            )?;
        }
        TaskService::new().update_state(&db, &task.id, "awaiting_approval")?;
        bob_service.queue_pending_launch(
            approval_id,
            PendingBobLaunch {
                session_id: session_id.clone(),
                conversation_id: conversation_id.clone(),
                mode: mode.clone(),
                prompt: prompt.clone(),
                project_path: workspace_path.clone(),
                options: run_options,
            },
        );
        let _ = app_handle.emit("approval-required", &approval);
        crate::services::notify::notify_approval_required(
            &app_handle,
            &approval.human_description,
            Some(task.id.as_str()),
            Some(conversation_id.as_str()),
        );
        true
    } else {
        let mut options = run_options;
        options.trust_workspace = permission_governance::should_pass_trust(
            &settings.permission_policy,
            false,
            has_grant,
            settings.sandbox_mode,
        );
        bob_service.start_streaming_session(
            app_handle.clone(),
            session_id.clone(),
            conversation_id.clone(),
            mode,
            prompt,
            workspace_path,
            options,
        )?;
        false
    };

    if should_generate_title {
        let title_app_handle = app_handle.clone();
        let title_conversation_id = conversation_id.clone();
        let title_prompt = message.clone();
        tokio::spawn(async move {
            generate_first_prompt_title(title_app_handle, title_conversation_id, title_prompt)
                .await;
        });
    } else {
        // If we are not generating a title (e.g. subsequent prompts), 
        // emit the update immediately so the sidebar sorts by recent activity.
        let _ = app_handle.emit("conversation-updated", &conversation_id);
    }

    // 8. Return session_id so the frontend can correlate events
    Ok(StartSessionResult {
        session_id,
        task_id: task.id,
        user_message_id: user_message.id,
        awaiting_approval,
    })
}

fn is_automatic_title_placeholder(title: &str) -> bool {
    matches!(title.trim(), "" | "Nouvelle conversation" | "Nouveau chat" | "[Planifié]")
}

async fn generate_first_prompt_title(
    app_handle: tauri::AppHandle,
    conversation_id: String,
    first_prompt: String,
) {
    let generated = {
        let bob_service = app_handle.state::<BobService>();
        bob_service.generate_conversation_title(&first_prompt).await
    };
    let title = match generated {
        Ok(value) => value,
        Err(error) => {
            debug!(
                "Silent title generation failed for conversation {}: {}",
                conversation_id, error
            );
            return;
        }
    };

    let db = app_handle.state::<Database>();
    let service = ConversationService::new();
    let current_title = service
        .get_by_id(&db, &conversation_id)
        .ok()
        .flatten()
        .map(|c| c.title)
        .unwrap_or_default();

    if !is_automatic_title_placeholder(&current_title) {
        return;
    }

    let final_title = if current_title.trim() == "[Planifié]" {
        format!("[Planifié] {}", title)
    } else {
        title
    };

    if service.update_title(&db, &conversation_id, &final_title).is_ok() {
        let _ = app_handle.emit("conversation-updated", &conversation_id);
    }
}

/// Bob Work presents ChatGPT-style `@skill:name` / `@plugin:id` mentions,
/// while Bob Shell 2 invokes skills with `$name`.
fn translate_prompt_mentions(db: &Database, message: &str) -> String {
    let skill_re = regex::Regex::new(r"@skill:([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)").unwrap();
    let mut translated = skill_re.replace_all(message, "$$$1").to_string();
    let plugin_re = regex::Regex::new(r"@plugin:([A-Za-z0-9-]+)").unwrap();
    translated = plugin_re
        .replace_all(&translated, |captures: &regex::Captures| {
            let id = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            let slug = crate::services::plugin::PluginService::new()
                .get_by_id(db, id)
                .ok()
                .flatten()
                .map(|plugin| {
                    plugin
                        .manifest
                        .get("slug")
                        .and_then(|value| value.as_str())
                        .unwrap_or(&plugin.name)
                        .to_string()
                })
                .map(|value| {
                    value
                        .to_lowercase()
                        .chars()
                        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                        .collect::<String>()
                });
            slug.map(|value| format!("${}", value.trim_matches('-')))
                .unwrap_or_else(|| captures[0].to_string())
        })
        .to_string();
    translated
}

// ── stop_task ─────────────────────────────────────────────────

#[tauri::command]
pub async fn stop_task(
    session_id: String,
    app_handle: tauri::AppHandle,
    db: State<'_, crate::db::Database>,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    if let Some(task_id) = bob_service.session_task_id(&session_id) {
        let _ = crate::services::task::TaskService::new().update_state(&db, &task_id, "cancelled");
        let _ = app_handle.emit("task-updated", &task_id);
    }
    bob_service.cancel_session(&session_id)
}

// ── Helpers ───────────────────────────────────────────────────

/// Build a contextual prompt with conversation history so Bob has context.
fn build_prompt_with_history(
    message: &str,
    mode: &str,
    history: &[crate::models::conversation::Message],
    global_instructions: &str,
    project_instructions: Option<&str>,
    attachment_paths: &[String],
    web_enabled: bool,
    integration_context: &[String],
    office_context: Option<String>,
    plugin_creation: Option<String>,
    plugin_creation_environment: Option<String>,
    sandbox_mode: bool,
    computer_use_enabled: bool,
    chrome_control_enabled: bool,
    related_context: Option<String>,
) -> String {
    let prefix = match mode {
        "ask" | "quick_chat" =>
            "Réponds de façon concise et directe.",
        "plan" | "planning" =>
            "Génère un plan structuré, validable étape par étape, avant toute action.",
        "presentation" =>
            "Tu dois créer une présentation professionnelle. Commence par proposer le plan des slides.",
        "document" =>
            "Crée un document structuré avec titres, sections et conclusion.",
        "research" =>
            "Effectue une recherche approfondie avec sources et niveau de confiance.",
        "spreadsheet" =>
            "Analyse les données et produis des tableaux et insights clairs.",
        "orchestrator" =>
            "Décompose l'objectif en étapes avec dépendances. Liste chaque étape clairement.",
        "plugin_builder" =>
            "Tu es en mode création de plugin. Mène un entretien structuré (objectif → outils → permissions → fichiers → validation). description = bénéfice utilisateur ; intégrations dans resources.",
        "skill_builder" =>
            "Tu es en mode création de skill. Mène un entretien court puis écris un SKILL.md local (pas un plugin agentique).",
        _ =>
            "Tu es un assistant de travail professionnel.",
    };

    // Build conversation context (skip the last message — that's the current one)
    // Collect into vec first, then slice to last 8
    let filtered: Vec<_> = history
        .iter()
        .filter(|m| m.content != message) // exclude current message
        .collect();
    let start = if filtered.len() > 8 {
        filtered.len() - 8
    } else {
        0
    };
    let prev_messages = &filtered[start..];

    let instruction_context = [
        (!global_instructions.trim().is_empty()).then(|| format!("Instructions globales :\n{}", global_instructions.trim())),
        project_instructions.filter(|v| !v.trim().is_empty()).map(|v| format!("Instructions du projet :\n{}", v.trim())),
        related_context,
        plugin_creation,
        plugin_creation_environment,
        office_context,
        (!attachment_paths.is_empty()).then(|| format!(
            "Pièces jointes déjà disponibles dans le workspace courant (chemins locaux accessibles — lis-les directement, ne demande pas de les déplacer ni de les uploader ; les images peuvent être des copies compressées pour l’analyse) :\n{}",
            attachment_paths.iter().map(|path| format!("- {}", path)).collect::<Vec<_>>().join("\n")
        )),
        (!web_enabled).then(|| "Politique locale Bob Work : n’utilise aucun accès web ou réseau pour cette demande.".to_string()),
        sandbox_mode.then(|| "Mode sandbox Bob Work : reste strictement dans le workspace fourni. N’accède pas au bureau macOS, à Chrome, ni à des chemins hors workspace. N’utilise pas --trust / hors périmètre.".to_string()),
        computer_use_enabled.then(|| "Contrôle bureau Bob Work : utilise uniquement les outils MCP bob-work-computer-use (accessibility_status, list_apps, open_app, focus_app, get_app_state, ui_click, ui_set_value, app_command, capture_screen, desktop_click, desktop_type, press_key). Style ChatGPT Work : reste dans Bob Work et pilote les apps en arrière-plan. open_app sans activate (défaut). Préfère get_app_state puis ui_click / ui_set_value / app_command — sans focus_app. N’appelle focus_app ni bring_to_front=true qu’en dernier recours (fenêtre masquée, saisie clavier globale indispensable). Ne vérifie pas que frontmost=true avant d’agir. Si l’arbre AX est pauvre, capture_screen sans bring_to_front (max 3). Jamais d’action dans Bob Work ou ChatGPT. Ne raconte pas chaque micro-action. N’utilise jamais un aperçu Chrome pour une app Mac ni une URI non HTTP(S). N’exécute jamais osascript/python3/Terminal pour piloter l’UI. Si Accessibilité ou Enregistrement de l’écran est refusé, demande d’autoriser **Bob Work**.".to_string()),
        chrome_control_enabled.then(|| "Contrôle Chrome Bob Work : utilise uniquement bob-work-chrome-control. N’utilise pas osascript/python3. Si Automatisation est refusée, demande d’autoriser **Bob Work → Google Chrome** dans Réglages Système → Confidentialité et sécurité → Automatisation.".to_string()),
        (!integration_context.is_empty()).then(|| format!("Intégrations locales disponibles (utilise les variables d’environnement nommées, sans jamais les afficher) :\n{}", integration_context.join("\n"))),
    ].into_iter().flatten().collect::<Vec<_>>().join("\n\n");

    if prev_messages.is_empty() {
        format!("{}\n\n{}\n\n{}", prefix, instruction_context, message)
    } else {
        let ctx: String = prev_messages
            .iter()
            .map(|m| {
                let role = if m.author == "user" {
                    "Utilisateur"
                } else {
                    "Bob"
                };
                format!(
                    "[{}]: {}",
                    role,
                    m.content.chars().take(300).collect::<String>()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            "{}\n\n--- Historique de la conversation ---\n{}\n--- Fin de l'historique ---\n\nNouveau message: {}",
            format!("{}\n\n{}", prefix, instruction_context), ctx, message
        )
    }
}

fn build_office_specialized_context(
    plugins: &[crate::models::plugin::Plugin],
    attachment_paths: &[String],
) -> Option<String> {
    if plugins.is_empty() {
        return None;
    }

    let matched_attachments = attachment_paths
        .iter()
        .filter(|path| {
            let ext = std::path::Path::new(path)
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| format!(".{}", value.to_lowercase()))
                .unwrap_or_default();
            plugins
                .iter()
                .any(|plugin| plugin_matches_extension(&plugin.manifest, &ext))
        })
        .cloned()
        .collect::<Vec<_>>();

    let mut blocks = vec![];
    for plugin in plugins {
        let Some(mode) = plugin.manifest.get("specializedMode") else {
            continue;
        };
        let label = mode
            .get("label")
            .and_then(|value| value.as_str())
            .unwrap_or(&plugin.name);
        let workflow = mode
            .get("workflow")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let allowed_tools = mode
            .get("allowedTools")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|value| value.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let output_formats = mode
            .get("outputFormats")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|value| value.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let libraries = mode
            .get("preferredLibraries")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|value| value.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();

        blocks.push(format!(
            "Mode spécialisé actif — {} :\n- Format de sortie attendu : {}\n- Outils autorisés : {}\n- Bibliothèques Python recommandées : {}\n- Workflow : {}\n- Utilise d’abord le MCP du plugin via use_mcp_tool, puis une commande Python si nécessaire.\n{}",
            label,
            output_formats,
            allowed_tools,
            libraries,
            workflow,
            if mode
                .get("sandbox")
                .and_then(|value| value.as_str())
                == Some("market-data")
            {
                "- Données de marché publiques et informatives uniquement (pas un conseil en investissement personnalisé)."
            } else {
                "- Traitement 100 % local : ne pas uploader les pièces jointes."
            }
        ));
    }

    if !matched_attachments.is_empty() {
        blocks.push(format!(
            "Fichiers Office/documents joints à traiter en priorité :\n{}",
            matched_attachments
                .iter()
                .map(|path| format!("- {}", path))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }

    Some(format!(
        "Protocole Bob Work — plugins Microsoft/Documents (équivalent ChatGPT Work, sandbox locale)\n\n{}",
        blocks.join("\n\n")
    ))
}

fn plugin_matches_extension(manifest: &serde_json::Value, extension: &str) -> bool {
    manifest
        .get("fileExtensions")
        .and_then(|value| value.as_array())
        .is_some_and(|items| {
            items.iter().any(|item| {
                item.as_str()
                    .is_some_and(|candidate| candidate.eq_ignore_ascii_case(extension))
            })
        })
}

fn plugin_creation_protocol(message: &str) -> Option<String> {
    let normalized = message.to_lowercase();
    let asks_for_plugin = normalized.contains("plugin");
    let asks_to_create = [
        "crée",
        "cree",
        "créer",
        "creer",
        "create",
        "build",
        "mets à jour",
        "met a jour",
        "update",
    ]
    .iter()
    .any(|word| normalized.contains(word));
    if !asks_for_plugin || !asks_to_create {
        return None;
    }
    // Skill-only prompts mention « skill » + « pas un plugin » — don't inject Work plugin bar.
    if normalized.contains("skill")
        && (normalized.contains("pas un plugin") || normalized.contains("pas de plugin"))
    {
        return None;
    }
    Some(
        r#"Protocole Bob Work — création de plugin (niveau ChatGPT Work) :

## Barre qualité (obligatoire)
- Un skill seul (SKILL.md d’instructions) n’est PAS un plugin Work-level. Le plugin doit être un produit : mode spécialisé + surface exécutable + connecteurs déclarés.
- Minimum : (1) `specializedMode` avec label/outils/workflow, (2) au moins une surface réelle parmi CLI `entrypoints`, MCP local `mcp/`, ou MCP distant HTTPS, (3) permissions honnêtes, (4) zéro secret en clair.
- À la fin de la création, explique explicitement tes choix : pourquoi local vs distant, quelles APIs/MCP, ce qui est optionnel, et comment l’utilisateur active les connecteurs.

## Exploration obligatoire des intégrations (avant d’écrire les fichiers)
Explore TOUTES les familles pertinentes pour le cas d’usage, même si certaines restent optionnelles :
1. OAuth catalogue Bob (GitHub, Slack, Monday, Microsoft Graph / Outlook / Teams / Calendar / OneDrive / OneNote)
2. MCP locaux du bundle et MCP déjà configurés dans Bob Work
3. APIs publiques (sans clé) et APIs avec clé (`${ENV}` / headers)
4. Autre MCP distant HTTPS / streamable-http / SSE (OAuth côté serveur distant)
5. Recherche web Bob (si le réglage Accès web est actif) — permission `network.request`
6. Appel au LLM Bob (toujours disponible dans le chat ; déclare-le dans `resources` si le workflow raisonne / synthétise)
7. Computer Use / Contrôle Chrome si le workflow pilote le bureau ou le navigateur
Ne retiens que ce qui sert le workflow, mais DOCUMENTÉ ce que tu as exploré et écarté.

## Description & resources (obligatoire dans .bob-work-plugin.json)
- `description` = bénéfice utilisateur en 1–2 phrases claires (ce que le plugin fait / pour qui / résultat). Interdit : jargon d’implémentation seul (« MCP », « CLI », « Work-level », listes de connecteurs).
  Exemple bon : « Propose des idées d’actions chiffrées pour un CTO français. »
  Exemple mauvais : « Plugin Work-level + CLI/MCP Python + Stooq. »
- Les intégrations (y compris optionnelles) vont dans `resources` et `connectorStrategy`, PAS dans `description`.
- Déclare `resources` (tableau) avec chaque ressource explorée/retenue :
  `{ "kind": "oauth"|"mcp"|"api-public"|"api-key"|"web-search"|"bob-llm"|"computer-use"|"chrome"|"stdio-cli", "label": "…", "optional": true|false, "provider": "…", "notes": "…" }`
- `connectorStrategy` résume les tiers (T1–T5) + fallback + `explored` (liste courte des familles examinées).
- `capabilities` doit refléter les usages (ex. `web.search`, `llm.synthesize`, `slack.post` si applicable).

## Tiers de connecteurs
- T1 API ouverte sans clé — préférer si suffisant.
- T2 API ouverte avec `${ENV_API_KEY}` — enrichissement optionnel.
- T3 MCP/CLI Python local dans le bundle.
- T4 MCP HTTPS public / URL utilisateur.
- T5 OAuth catalogue Bob — vrai flux ; ne jamais simuler.
- + Web search Bob et LLM Bob selon le workflow (déclarés dans `resources`).

## Fichiers & structure
- Bundle uniquement dans ~/.bob/skills/<slug>/ (slug a-z, 0-9, tirets).
- Obligatoire : SKILL.md + `.bob-work-plugin.json` (schemaVersion, name, slug, version, description, category, permissions, runtime, entrypoints, specializedMode, connectorStrategy, resources, icon).
- `icon` (obligatoire) : clé locale adaptée à la fonction (`word`, `excel`, `powerpoint`, `onenote`, `document`, `invest`, `computer`, `chrome`, `github`, `slack`, `monday`, `outlook`, `teams`, `calendar`, `onedrive`, `agentic`, `plugin`) **ou** URL HTTPS d’un logo/favicon trouvé sur internet (ex. `https://www.google.com/s2/favicons?domain=notion.so&sz=128`). Jamais laisser `icon` vide.
- Ne crée pas de second plugin pour un slug déjà couvert par un builtin Bob Work (Word/Excel/PowerPoint/OneNote/Documents/Computer Use/Chrome…).
- MCP / CLI / integrations / browserExtensions selon le besoin réel. Secrets = `${PLACEHOLDER}` ou OAuth catalogue uniquement.

## Annonce
- Succès seulement si fichiers écrits et validés.
- Après succès, invite l’utilisateur à ouvrir Plugins → le plugin pour lancer « Mise en service » (validate / sync MCP / test).
- Section finale « Choix de conception » : ressources retenues vs écartées, activation utilisateur, limites."#.to_string(),
    )
}

fn skill_creation_protocol(message: &str, mode: &str) -> Option<String> {
    let normalized = message.to_lowercase();
    let mode_skill = mode == "skill_builder";
    let asks_for_skill = normalized.contains("skill");
    let asks_to_create = [
        "crée",
        "cree",
        "créer",
        "creer",
        "create",
        "build",
        "importe",
        "import",
        "rapatrier",
    ]
    .iter()
    .any(|word| normalized.contains(word));
    if !mode_skill && (!asks_for_skill || !asks_to_create) {
        return None;
    }
    if normalized.contains("plugin")
        && !normalized.contains("pas un plugin")
        && !normalized.contains("pas de plugin")
        && !mode_skill
    {
        return None;
    }
    Some(
        r#"Protocole Bob Work — création / import de skill :

## Qu’est-ce qu’un skill
- Un skill = instructions markdown (`SKILL.md`), pas un plugin agentique (pas de MCP/CLI Python obligatoire).
- Si l’utilisateur a besoin d’outils exécutables, oriente-le vers le Plugin Builder.

## Format
- Dossier `~/.bob/skills/<slug>/SKILL.md`
- Frontmatter YAML : `name`, `description` (bénéfice utilisateur 1–2 phrases), `user-invocable: true`
- Corps : consignes claires, limites, exemples.

## Annonce
- Succès seulement si le fichier est écrit.
- Demande de rafraîchir la page Skills."#.to_string(),
    )
}

fn plugin_creation_environment_context(
    web_enabled: bool,
    computer_use_enabled: bool,
    chrome_control_enabled: bool,
    mcp_servers: &[McpServer],
    connected_integration_lines: &[String],
    considered_integration_ids: &[String],
) -> String {
    let mut lines = vec![
        "Catalogue à explorer pour ce plugin (état runtime Bob Work) :".into(),
        "- bob-llm : toujours disponible (raisonnement / synthèse dans le chat Bob Work)".into(),
        format!(
            "- web-search : {}",
            if web_enabled {
                "réglage Accès web ACTIF — déclarable via network.request + resources.kind=web-search"
            } else {
                "réglage Accès web INACTIF — ne pas dépendre d’une recherche web obligatoire"
            }
        ),
        format!(
            "- computer-use : {}",
            if computer_use_enabled {
                "ACTIF (MCP bob-work-computer-use) — déclarable si le workflow pilote le bureau"
            } else {
                "inactif — optionnel via Réglages → Contrôle de l’ordinateur"
            }
        ),
        format!(
            "- chrome-control : {}",
            if chrome_control_enabled {
                "ACTIF (MCP bob-work-chrome-control)"
            } else {
                "inactif — optionnel via Réglages → Contrôle de Chrome"
            }
        ),
        "- oauth-catalog : github, slack, monday, outlook-mail, teams, outlook-calendar, onedrive, onenote".into(),
        format!(
            "- oauth considérés pour ce projet/session : {}",
            if considered_integration_ids.is_empty() {
                "(aucun)".into()
            } else {
                considered_integration_ids.join(", ")
            }
        ),
    ];
    if connected_integration_lines.is_empty() {
        lines.push(
            "- oauth déjà connectés : aucun pour l’instant (déclare optional:true si utile)".into(),
        );
    } else {
        lines.push("- oauth déjà connectés :".into());
        lines.extend(connected_integration_lines.iter().cloned());
    }
    if mcp_servers.is_empty() {
        lines.push("- mcp configurés : aucun serveur global pour l’instant".into());
    } else {
        lines.push("- mcp déjà configurés dans Bob Work :".into());
        for server in mcp_servers.iter().take(24) {
            lines.push(format!(
                "  • {} ({}) {}{}",
                server.name,
                server.transport,
                if server.enabled {
                    "actif"
                } else {
                    "désactivé"
                },
                if server.command_or_url.is_empty() {
                    String::new()
                } else {
                    format!(" — {}", server.command_or_url)
                }
            ));
        }
    }
    lines.push(
        "Inclure les intégrations retenues dans `resources` (pas dans `description`) ; noter brièvement celles écartées dans Choix de conception."
            .into(),
    );
    lines.join("\n")
}

fn available_integration_context(bob_service: &BobService, ids: &[String]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| {
            let description = match id.as_str() {
                "github" => "- GitHub via GH_TOKEN/GITHUB_TOKEN et le skill $bob-work-github",
                "slack" => "- Slack via SLACK_BOT_TOKEN et le skill $bob-work-slack",
                "monday" => "- Monday.com via MONDAY_API_TOKEN et le skill $bob-work-monday",
                "outlook-mail" => "- Outlook via MICROSOFT_GRAPH_ACCESS_TOKEN et le skill $bob-work-outlook-mail",
                "outlook-calendar" => "- Outlook Calendar via MICROSOFT_GRAPH_ACCESS_TOKEN et le skill $bob-work-outlook-calendar",
                "teams" => "- Microsoft Teams via MICROSOFT_GRAPH_ACCESS_TOKEN et le skill $bob-work-teams",
                "onedrive" => "- OneDrive via MICROSOFT_GRAPH_ACCESS_TOKEN et le skill $bob-work-onedrive",
                _ => return None,
            };
            bob_service
                .has_integration_credential(id)
                .then(|| description.to_string())
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionResult {
    pub session_id: String,
    pub task_id: String,
    pub user_message_id: String,
    #[serde(default)]
    pub awaiting_approval: bool,
}

#[cfg(test)]
mod plugin_creation_protocol_tests {
    use super::plugin_creation_protocol;

    #[test]
    fn injects_work_level_bar_and_connector_tiers_when_creating_a_plugin() {
        let protocol = plugin_creation_protocol("Crée un plugin Python pour analyser mon CTO")
            .expect("protocol");
        assert!(protocol.contains("niveau ChatGPT Work"));
        assert!(protocol.contains("connectorStrategy"));
        assert!(protocol.contains("T1"));
        assert!(protocol.contains("Choix de conception"));
        assert!(protocol.contains("specializedMode"));
        assert!(protocol.contains("resources"));
        assert!(protocol.contains("web-search"));
        assert!(protocol.contains("bob-llm"));
        assert!(protocol.contains("Exploration obligatoire"));
        assert!(protocol.contains("bénéfice utilisateur"));
        assert!(protocol.contains("PAS dans `description`"));
        assert!(protocol.contains("Mise en service"));
    }

    #[test]
    fn skill_prompt_gets_skill_protocol_not_plugin_bar() {
        let protocol = super::skill_creation_protocol(
            "Crée avec moi un skill personnel Bob Work (pas un plugin agentique).",
            "skill_builder",
        )
        .expect("skill protocol");
        assert!(protocol.contains("création / import de skill"));
        assert!(plugin_creation_protocol(
            "Crée avec moi un skill personnel Bob Work (pas un plugin agentique)."
        )
        .is_none());
    }

    #[test]
    fn prompt_includes_related_context_block() {
        let prompt = super::build_prompt_with_history(
            "Relance le screening",
            "agent",
            &[],
            "",
            None,
            &[],
            true,
            &[],
            None,
            None,
            None,
            false,
            false,
            false,
            Some(
                "Contexte lié (autres conversations, extrait local — à utiliser seulement s’il aide vraiment) :\n- « Brief » : AIR.PA"
                    .into(),
            ),
        );
        assert!(prompt.contains("Contexte lié"));
        assert!(prompt.contains("AIR.PA"));
        assert!(prompt.contains("Relance le screening"));
    }

    #[test]
    fn prompt_tells_bob_to_grant_bob_work_not_python3() {
        let prompt = super::build_prompt_with_history(
            "Joue Blue sur Spotify",
            "agent",
            &[],
            "",
            None,
            &[],
            true,
            &[],
            None,
            None,
            None,
            false,
            true,
            false,
            None,
        );
        assert!(prompt.contains("Bob Work"));
        assert!(prompt.contains("Accessibilité"));
        assert!(prompt.contains("osascript"));
        assert!(prompt.contains("pas python3"));
        assert!(prompt.contains("bob-work-computer-use"));
    }

    #[test]
    fn environment_context_lists_web_llm_and_mcp_catalog() {
        let context = super::plugin_creation_environment_context(
            true,
            true,
            false,
            &[crate::models::workspace::McpServer {
                name: "bob-work-computer-use".into(),
                transport: "stdio".into(),
                command_or_url: "python3".into(),
                args: vec![],
                enabled: true,
                status: "configured".into(),
                raw: serde_json::json!({}),
                last_test: None,
            }],
            &["- GitHub via GH_TOKEN".into()],
            &["github".into(), "slack".into()],
        );
        assert!(context.contains("bob-llm"));
        assert!(context.contains("web-search"));
        assert!(context.contains("ACTIF"));
        assert!(context.contains("bob-work-computer-use"));
        assert!(context.contains("github, slack"));
    }
}

#[cfg(test)]
mod cto_invest_prompt_tests {
    use super::{build_office_specialized_context, translate_prompt_mentions};
    use crate::db::Database;
    use crate::services::plugin::PluginService;

    #[test]
    fn cto_invest_mention_translates_and_injects_market_mode_into_prompt() {
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        PluginService::new()
            .ensure_builtin_plugins(&db)
            .expect("builtins");

        let translated = translate_prompt_mentions(
            &db,
            "@plugin:bob-work-cto-invest Quelles actions CTO regarder maintenant ?",
        );
        assert!(
            translated.contains("$bob-work-cto-invest"),
            "plugin mention must become Bob skill token: {translated}"
        );

        let plugin = PluginService::new()
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .expect("plugin");
        let context =
            build_office_specialized_context(&[plugin], &[]).expect("specialized context");
        assert!(context.contains("Mode CTO Investissements"));
        assert!(context.contains("cto_screen_ideas"));
        assert!(context.contains("pas un conseil en investissement"));
    }

    #[test]
    fn ibm_pursuit_plugin_mention_injects_open_api_brief_mode() {
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        PluginService::new()
            .ensure_builtin_plugins(&db)
            .expect("builtins");

        let translated = translate_prompt_mentions(
            &db,
            "@plugin:bob-work-ibm-pursuit Prépare un brief mission Schneider Electric",
        );
        assert!(
            translated.contains("$bob-work-ibm-pursuit"),
            "plugin mention must become Bob skill token: {translated}"
        );

        let plugin = PluginService::new()
            .get_by_id(&db, "bob-work-ibm-pursuit")
            .expect("lookup")
            .expect("plugin");
        let context =
            build_office_specialized_context(&[plugin], &[]).expect("specialized context");
        assert!(context.contains("Mode Brief Mission IBM"));
        assert!(context.contains("ibm_screen_plays"));
        assert!(context.contains("Ne jamais utiliser Slack"));
    }
}
