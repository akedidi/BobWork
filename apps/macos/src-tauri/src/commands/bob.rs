// ============================================================
// Bob Work - Bob Commands
// send_message: non-blocking async + streaming via Tauri events
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::models::conversation::AddMessageInput;
use crate::models::task::CreateTaskInput;
use crate::services::audit::AuditService;
use crate::services::bob::{
    BobDetectionResult, BobMode, BobRunOptions, BobService, CapabilityInfo, ShellProfile,
};
use crate::services::conversation::ConversationService;
use crate::services::plugin_extensions::PluginExtensionService;
use crate::services::settings::SettingsService;
use crate::services::task::TaskService;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{Emitter, Manager, State};
use tracing::{debug, info};

// ── detect_bob ────────────────────────────────────────────────

#[tauri::command]
pub async fn detect_bob(
    bob_service: State<'_, BobService>,
) -> Result<BobDetectionResult, AppError> {
    Ok(bob_service.detect())
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
        let trusted_local_office = plugin.manifest.get("builtin") == Some(&serde_json::Value::Bool(true))
            && plugin.manifest.get("specializedMode").is_some();
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
            let unavailable = crate::services::plugin_mcp::PluginMcpService::new()
                .status(&plugin.id, &plugin.manifest, &bundle_dir)?
                .into_iter()
                .filter(|server| server.required && (!server.configured || !server.enabled))
                .map(|server| server.name)
                .collect::<Vec<_>>();
            if !unavailable.is_empty() {
                return Err(AppError::PermissionDenied(format!(
                    "Les outils connectés du plugin {} ne sont pas actifs : {}. Réactivez le plugin avant de relancer la demande.",
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

    // 1. Persist user message
    let attachment_paths = attachment_paths.unwrap_or_default();
    let attachment_json = serde_json::Value::Array(
        attachment_paths
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
            .collect(),
    );
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
        let err_msg = "Bob Shell exige une clé API pour bob run. Activez-la uniquement pour cette session dans Bob Work.".to_string();
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

    let session_id = format!("sess_{}", uuid::Uuid::new_v4());
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
    for path in &attachment_paths {
        let p = std::path::Path::new(path);
        if !p.exists() {
            continue;
        }
        let metadata = p.metadata().ok();
        let _ = TaskService::new().add_io(
            &db,
            &task.id,
            Some(&run.id),
            "input",
            if p.is_dir() { "directory" } else { "file" },
            p.file_name().and_then(|v| v.to_str()).unwrap_or(path),
            Some(path),
            None,
            metadata
                .as_ref()
                .filter(|m| m.is_file())
                .map(|m| m.len() as i64),
            None,
            &serde_json::json!({ "accessMode": "reference" }),
        );
    }

    info!(
        "Starting streaming session {} for conversation {} in {} mode",
        session_id, conversation_id, mode
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

    // 5. Build context-aware prompt with history
    let shell_message = translate_prompt_mentions(&db, &message);
    let mut integration_ids = project
        .as_ref()
        .map(|value| value.allowed_integrations.clone())
        .filter(|values| !values.is_empty())
        .unwrap_or_else(|| vec!["github".into(), "slack".into(), "monday".into(), "outlook-mail".into(), "teams".into(), "outlook-calendar".into(), "onedrive".into()]);
    integration_ids.extend(plugin_integration_ids);
    integration_ids.sort();
    integration_ids.dedup();
    let prompt = build_prompt_with_history(
        &shell_message,
        &mode,
        &history,
        &settings.global_instructions,
        project
            .as_ref()
            .and_then(|p| p.custom_instructions.as_deref()),
        &attachment_paths,
        settings.web_enabled,
        &available_integration_context(&bob_service, &integration_ids),
        build_office_specialized_context(&office_plugins, &attachment_paths),
    );

    // 6. Audit log: session started
    let _ =
        AuditService::new().bob_event(&db, "bob.session_started", &session_id, &conversation_id);

    // 6.5. Get project path if project_id is provided
    let project_path = project.as_ref().and_then(|value| value.local_path.clone());

    // 7. Start non-blocking streaming session
    // The BobService spawns a tokio task that:
    //   - runs `bob --non-interactive --mode=<bob_mode>`
    //   - pipes the prompt to stdin
    //   - reads stdout line-by-line
    //   - emits `bob-token` events for each chunk
    //   - emits `bob-session-done` when finished
    bob_service.start_streaming_session(
        app_handle.clone(),
        session_id.clone(),
        conversation_id.clone(),
        mode,
        prompt,
        project_path,
        BobRunOptions {
            task_id: Some(task.id.clone()),
            run_id: Some(run.id),
            max_turns: Some(settings.max_turns),
            max_cost: (settings.max_cost > 0.0).then_some(settings.max_cost),
            mcp_enabled: settings.mcp_enabled,
            subagents_enabled: settings.subagents_enabled,
            attachment_paths,
            integration_ids,
            plugin_hooks,
            resume_task_id: task
                .shell_task_id
                .clone()
                .filter(|_| resume_task_id.is_some()),
        },
    )?;

    if should_generate_title {
        let title_app_handle = app_handle.clone();
        let title_conversation_id = conversation_id.clone();
        let title_prompt = message.clone();
        tokio::spawn(async move {
            generate_first_prompt_title(title_app_handle, title_conversation_id, title_prompt)
                .await;
        });
    }

    // 8. Return session_id so the frontend can correlate events
    Ok(StartSessionResult {
        session_id,
        task_id: task.id,
        user_message_id: user_message.id,
    })
}

fn is_automatic_title_placeholder(title: &str) -> bool {
    matches!(title.trim(), "" | "Nouvelle conversation" | "Nouveau chat")
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
    let still_automatic = service
        .get_by_id(&db, &conversation_id)
        .ok()
        .flatten()
        .is_some_and(|conversation| is_automatic_title_placeholder(&conversation.title));
    if !still_automatic {
        return;
    }
    if service.update_title(&db, &conversation_id, &title).is_ok() {
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
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
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
            "Tu es en mode création de plugin. Mène un entretien structuré pour créer un plugin.",
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
        plugin_creation_protocol(message),
        office_context,
        (!attachment_paths.is_empty()).then(|| format!(
            "Pièces jointes autorisées pour cette demande (fichiers locaux — ne pas uploader vers un cloud) :\n{}",
            attachment_paths.iter().map(|path| format!("- {}", path)).collect::<Vec<_>>().join("\n")
        )),
        (!web_enabled).then(|| "Politique locale Bob Work : n’utilise aucun accès web ou réseau pour cette demande.".to_string()),
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
        let workflow = mode.get("workflow").and_then(|value| value.as_str()).unwrap_or("");
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
            "Mode spécialisé actif — {} :\n- Format de sortie attendu : {}\n- Outils autorisés : {}\n- Bibliothèques Python recommandées : {}\n- Workflow : {}\n- Utilise d’abord le MCP local office-tools du plugin (use_mcp_tool), puis une commande Python si nécessaire.\n- Traitement 100 % local : ne pas uploader les pièces jointes.",
            label, output_formats, allowed_tools, libraries, workflow
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
    let asks_for_plugin = normalized.contains("plugin") || normalized.contains("skill");
    let asks_to_create = ["crée", "cree", "créer", "creer", "create", "build"]
        .iter()
        .any(|word| normalized.contains(word));
    if !asks_for_plugin || !asks_to_create {
        return None;
    }
    Some(
        r#"Protocole Bob Work — création de plugin agentique local :
- Crée un bundle dans ~/.bob/skills/<slug>/, sans écrire ailleurs pour l’installation du plugin.
- Le slug doit utiliser uniquement a-z, 0-9 et des tirets.
- Crée obligatoirement SKILL.md avec un frontmatter `name`, `description`, `user-invocable: true`, puis des instructions détaillant quand agir, quelles validations faire et comment utiliser les outils Bob.
- Crée obligatoirement .bob-work-plugin.json avec schemaVersion=1, name, slug, version, description, category, permissions, runtime et entrypoints.
- Pour un plugin Python/CLI, place le code sous scripts/, déclare chaque fichier dans entrypoints avec runtime `python3` et un chemin relatif, et fournis une interface argparse. N’ajoute aucune dépendance réseau implicite.
- Lorsque le plugin bénéficie d’outils déterministes ou connectés, intègre-les au même bundle sous `mcp/` et déclare `mcpServers` dans .bob-work-plugin.json. Chaque entrée MCP utilise un identifiant a-z/0-9/tirets, un `displayName`, une description, `required`, une liste `tools`, puis une configuration Bob MCP locale (`command`, `args`, `cwd`) ou distante (`type`, `url`). Pour un serveur local Python, utilise `command: "python3"`, un script sous `mcp/` dans `args`, et `cwd: "."`.
- Un serveur MCP local doit réellement implémenter JSON-RPC sur stdin/stdout et au minimum `initialize`, `tools/list` et `tools/call`. Vérifie sa syntaxe et teste localement l’initialisation et un appel d’outil sans effet externe.
- Déclare `mcp.connect` pour tout MCP, `command.execute` pour un serveur local, `network.request` pour un serveur distant, puis les permissions fichier/réseau réellement nécessaires. Ne stocke aucun secret dans le bundle ; utilise uniquement des références à des variables d’environnement ou un vrai flux OAuth géré séparément.
- Pour une connexion externe, déclare `integrations` avec `provider`, `displayName`, `authType` (`oauth`, `mcp` ou `token`), `scopes`, `optional` et, pour OAuth/MCP, `mcpServer`. Un connecteur OAuth doit toujours être adossé à un vrai serveur MCP qui gère l’autorisation ; ne crée jamais de faux état « connecté ».
- Si le workflow peut être récurrent, ajoute `scheduledTaskTemplates` avec `id`, `name`, `description`, `instructions`, `cronOrEvent`, `offlineBehavior` et `overlapPolicy`. Les instructions doivent être utilisables sans secret et la planification restera modifiable avant activation.
- Si le plugin exige le navigateur, déclare `browserExtensions` avec `id`, `displayName`, `capability` (`browser`, `computer_use` ou `chrome`), `required` et le `mcpServer` compatible pour tout contrôle. Déclare aussi `browser.control`. Bob Work n’active pas Computer Use ou Chrome sans réglage utilisateur et outil réellement connecté.
- Pour une action locale avant/après tâche, déclare un script dans `entrypoints`, puis un `hook` avec `id`, `displayName`, `event` (`before_task`, `after_task` ou `task_error`), `entrypoint`, `required` et un délai court. Déclare `hook.execute` et `command.execute`. Les hooks reçoivent uniquement un environnement minimal, jamais les clés Bob ou les jetons d’intégration.
- Tu peux vérifier la syntaxe du script, mais n’exécute aucune action cloud réelle pendant l’installation.
- Bob Work importera le bundle dans sa liste Plugins à la fin de cette tâche. N’annonce la réussite que si tous les fichiers requis ont été écrits et validés."#.to_string(),
    )
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
}
