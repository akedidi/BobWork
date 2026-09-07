// ============================================================
// Bob Work - Main Tauri Application Entry Point
// ============================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod error;
#[cfg(target_os = "macos")]
mod macos_applescript_bridge;
#[cfg(target_os = "macos")]
mod macos_notifications;
#[cfg(target_os = "macos")]
mod macos_permissions;
mod models;
mod security;
mod services;

#[cfg(test)]
mod tests;

use tauri::Manager;
use tracing::info;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("bob_work=debug".parse().unwrap())
                .add_directive("tauri=info".parse().unwrap()),
        )
        .init();

    info!("Starting Bob Work...");

    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    let _ = dotenvy::from_path(env_path);

    let builder = tauri::Builder::default();
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .on_tray_icon_event(|app, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();

            #[cfg(target_os = "macos")]
            {
                let pointer = tauri::WebviewWindowBuilder::new(
                    app,
                    "bob-pointer",
                    tauri::WebviewUrl::App("bob-pointer.html".into()),
                )
                .title("Bob pointer")
                .inner_size(96.0, 96.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .content_protected(true)
                .visible(false)
                .build()?;
                pointer.set_ignore_cursor_events(true)?;
            }

            // Initialize database
            #[cfg(feature = "e2e")]
            let data_dir = std::env::var_os("BOB_WORK_E2E_DATA_DIR")
                .map(std::path::PathBuf::from)
                .expect("BOB_WORK_E2E_DATA_DIR must be set for E2E builds");
            #[cfg(not(feature = "e2e"))]
            let data_dir = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(&data_dir).expect("Failed to create data dir");

            let db_path = data_dir.join("database.sqlite");
            info!("Database path: {:?}", db_path);

            let db = db::Database::new(&db_path).expect("Failed to initialize database");
            db.run_migrations().expect("Failed to run migrations");

            let runtime_manager = services::runtime_manager::RuntimeManager::new(&data_dir);
            runtime_manager
                .seed_registry(&db)
                .expect("Failed to initialize Runtime Architecture V2 registry");

            let backup_dir = data_dir.join("backups");
            if let Err(error) = db
                .create_backup(&backup_dir, true)
                .and_then(|_| db::Database::prune_backups(&backup_dir, 7))
            {
                tracing::warn!("Unable to create automatic database backup: {error}");
            }

            app_handle.manage(db);
            app_handle.manage(runtime_manager.clone());
            app_handle.manage(services::notify::NotificationInbox::new());
            app_handle.manage(services::ssh::SshTerminalManager::default());

            if let Ok(settings) = services::settings::SettingsService::new().get(&app_handle.state::<db::Database>()) {
                if let Some(tray) = app_handle.tray_by_id("main") {
                    let _ = tray.set_visible(settings.menu_bar_enabled);
                }
            }

            // Initialize Bob service
            let bob_service = services::bob::BobService::new(&data_dir);
            app_handle.manage(bob_service);

            #[cfg(target_os = "macos")]
            {
                // Run AppleScript inside Bob Work so TCC attaches to the app,
                // not python3/osascript used by MCP helpers.
                macos_applescript_bridge::start(app_handle.clone());
                macos_notifications::set_open_handler({
                    let app = app_handle.clone();
                    move |payload| {
                        use tauri::{Emitter, Manager};
                        let _ = app.emit("notification-open", &payload);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            }

            // Initialize project service
            let project_service = services::project::ProjectService::new();
            app_handle.manage(project_service);

            // Initialize conversation service
            let conversation_service = services::conversation::ConversationService::new();
            app_handle.manage(conversation_service);

            // Initialize plugin service
            let plugin_service = services::plugin::PluginService::new();
            if let Err(error) = plugin_service.ensure_builtin_plugins(&app_handle.state::<db::Database>()) {
                tracing::warn!("Unable to refresh built-in document plugins: {:?}", error);
            }
            if let Err(error) = services::workspace::WorkspaceService::new()
                .install_builtin_skill("meeting-minutes")
            {
                tracing::warn!("Unable to install built-in meeting-minutes skill: {:?}", error);
            }
            // Resolve Bob once during startup so built-in MCPs are registered
            // before the first prompt. A fresh BobService has no cached path.
            let bob_service = app_handle.state::<services::bob::BobService>();
            if bob_service.get_binary_path().is_none() {
                let _ = bob_service.detect();
            }
            if let Some(bob_path) = bob_service.get_binary_path() {
                if let Err(error) = services::codegraph_mcp::CodeGraphMcpService.sync(&bob_path) {
                    tracing::warn!("Unable to sync built-in CodeGraph MCP tools: {:?}", error);
                }
                if let Err(error) = services::map_mcp::MapMcpService.sync(&bob_path) {
                    tracing::warn!("Unable to sync built-in map MCP tools: {:?}", error);
                }
                let ssh_service = services::ssh::SshService::new(&data_dir);
                if !ssh_service.list().is_empty() {
                    if let Err(error) = ssh_service.sync_mcp(&bob_path) {
                        tracing::warn!("Unable to sync built-in SSH MCP tools: {:?}", error);
                    }
                }
                if let Err(error) = plugin_service.sync_installed_office_mcps(
                    &app_handle.state::<db::Database>(),
                    &bob_path,
                ) {
                    tracing::warn!("Unable to sync built-in Office MCP tools: {:?}", error);
                }
                if let Ok(settings) =
                    services::settings::SettingsService::new().get(&app_handle.state::<db::Database>())
                {
                    if let Err(error) = services::map_mcp::MapMcpService.sync_location(
                        settings.location_enabled,
                        settings.current_latitude,
                        settings.current_longitude,
                        settings.current_location_updated_at.as_deref(),
                    ) {
                        tracing::warn!("Unable to sync current location for map tools: {:?}", error);
                    }
                    if settings.chrome_control_enabled {
                        if let Err(error) =
                            services::chrome_mcp::ChromeMcpService::new().sync(&bob_path, true)
                        {
                            tracing::warn!("Unable to sync built-in Chrome MCP tools: {:?}", error);
                        }
                    }
                    if settings.computer_use_enabled
                        || services::computer_use_mcp::ComputerUseMcpService::new().is_configured()
                    {
                        // Always refresh server.py so background-control tools stay current.
                        if let Err(error) =
                            services::computer_use_mcp::ComputerUseMcpService::ensure_bundle()
                        {
                            tracing::warn!(
                                "Unable to refresh Computer Use MCP script: {:?}",
                                error
                            );
                        }
                    }
                    if settings.computer_use_enabled {
                        if let Err(error) = services::computer_use_mcp::ComputerUseMcpService::new()
                            .sync(&bob_path, true)
                        {
                            tracing::warn!(
                                "Unable to sync built-in Computer Use MCP tools: {:?}",
                                error
                            );
                        }
                    }
                }
                if let Err(error) = services::integration_mcp::IntegrationMcpService::new()
                    .sync_all_connected(&bob_path, &app_handle.state::<services::bob::BobService>())
                {
                    tracing::warn!("Unable to sync integration MCP connectors: {:?}", error);
                }
                // Refresh already-installed connector skills (e.g. GitHub MCP-first, no gh CLI).
                let workspace = services::workspace::WorkspaceService::new();
                let existing: std::collections::HashSet<String> = workspace
                    .list_skills(None)
                    .into_iter()
                    .map(|skill| skill.slug)
                    .collect();
                for (integration_id, slug) in [
                    ("github", "bob-work-github"),
                    ("slack", "bob-work-slack"),
                    ("monday", "bob-work-monday"),
                    ("outlook-mail", "bob-work-outlook-mail"),
                    ("outlook-calendar", "bob-work-outlook-calendar"),
                    ("teams", "bob-work-teams"),
                    ("onedrive", "bob-work-onedrive"),
                ] {
                    if existing.contains(slug) {
                        if let Err(error) = workspace.install_builtin_integration(integration_id) {
                            tracing::debug!(
                                "Unable to refresh builtin skill {slug}: {:?}",
                                error
                            );
                        }
                    }
                }
            }
            if let Some(bob_path) = app_handle.state::<services::bob::BobService>().get_binary_path() {
                if let Err(error) = plugin_service.sync_installed_office_mcps(
                    &app_handle.state::<db::Database>(),
                    &bob_path,
                ) {
                    tracing::warn!("Unable to sync built-in Office MCP tools: {:?}", error);
                }
                if let Ok(settings) =
                    services::settings::SettingsService::new().get(&app_handle.state::<db::Database>())
                {
                    if settings.chrome_control_enabled {
                        if let Err(error) =
                            services::chrome_mcp::ChromeMcpService::new().sync(&bob_path, true)
                        {
                            tracing::warn!("Unable to sync built-in Chrome MCP tools: {:?}", error);
                        }
                    }
                }
                if let Err(error) = services::integration_mcp::IntegrationMcpService::new()
                    .sync_all_connected(&bob_path, &app_handle.state::<services::bob::BobService>())
                {
                    tracing::warn!("Unable to sync integration MCP connectors: {:?}", error);
                }
            }
            if let Err(error) = plugin_service.sync_agentic_bundles(&app_handle.state::<db::Database>()) {
                tracing::warn!("Unable to import Bob-created plugin bundles: {:?}", error);
            }
            match plugin_service.get_all(&app_handle.state::<db::Database>()) {
                Ok(plugins) => {
                    for plugin in plugins {
                        if let Err(error) = runtime_manager.register_plugin_requirements(
                            &app_handle.state::<db::Database>(),
                            &plugin.id,
                            &plugin.manifest,
                        ) {
                            tracing::warn!(
                                "Unable to register runtime requirements for {}: {:?}",
                                plugin.id,
                                error
                            );
                        }
                    }
                }
                Err(error) => tracing::warn!("Unable to enumerate plugins for runtime registry: {:?}", error),
            }
            app_handle.manage(plugin_service);

            // Initialize task service
            let task_service = services::task::TaskService::new();
            match task_service.recover_orphaned_runs(&app_handle.state::<db::Database>()) {
                Ok(count) if count > 0 => tracing::warn!(
                    "Recovered {count} orphaned Bob task(s) left active by a previous app exit"
                ),
                Err(error) => tracing::warn!("Unable to recover orphaned Bob tasks: {error:?}"),
                _ => {}
            }
            app_handle.manage(task_service);

            // Initialize artifact service
            let artifact_service = services::artifact::ArtifactService::new();
            app_handle.manage(artifact_service);
            app_handle.manage(services::artifact_runtime::ArtifactRuntime::new());

            // Mobile remote control stays local until explicitly enabled in Settings.
            app_handle.manage(services::remote_control::RemoteControlService::new(&data_dir));

            // ── Background Scheduler Daemon ────────────────────────────
            {
                let ah_sched = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
                    loop {
                        interval.tick().await;
                        let db = ah_sched.state::<db::Database>();
                        let bob_service = ah_sched.state::<services::bob::BobService>();
                        let scheduler_service = services::scheduler::SchedulerService::new();

                        if let Err(e) = scheduler_service.tick_schedules(&db, &bob_service, &ah_sched) {
                            tracing::error!("Scheduler error: {:?}", e);
                        }
                    }
                });
            }

            // ── Bobcoins meter: other apps share the IBM Bob engine ────
            {
                let ah_usage = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
                        services::bob_usage::USAGE_REFRESH_INTERVAL_SECS,
                    ));
                    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                    interval.tick().await;
                    loop {
                        interval.tick().await;
                        let ah = ah_usage.clone();
                        let _ = tokio::task::spawn_blocking(move || {
                            services::workspace::WorkspaceService::publish_usage_status(&ah, false);
                        })
                        .await;
                    }
                });
            }

            // ── Listen for bob-session-done: persist reply + audit ─────
            {
                use tauri::Listener;
                use services::conversation::ConversationService;
                use services::audit::AuditService;
                use models::conversation::AddMessageInput;
                use services::bob::BobSessionDoneEvent;

                let ah2 = app_handle.clone();
                app_handle.listen("bob-session-done", move |event| {
                    let payload_str = event.payload();
                    if let Ok(done) = serde_json::from_str::<BobSessionDoneEvent>(payload_str) {
                        {
                            let ah_usage = ah2.clone();
                            std::thread::spawn(move || {
                                services::workspace::WorkspaceService::publish_usage_status(
                                    &ah_usage, true,
                                );
                            });
                        }
                        let db = ah2.state::<db::Database>();
                        let conv_service = ConversationService::new();
                        let content = if done.success {
                            done.full_output.clone()
                        } else {
                            done.error.clone().unwrap_or_else(|| done.full_output.clone())
                        };
                        let task_service = services::task::TaskService::new();
                        let task_cancelled = done.cancelled
                            || done.task_id.as_deref().and_then(|task_id| {
                                task_service.get_by_id(&db, task_id).ok().flatten()
                            }).is_some_and(|task| task.state == "cancelled");

                        // Capture deliverables Bob wrote (including diagrams in its workspace) → task IO + gallery.
                        let deliverable_paths = if done.deliverable_paths.is_empty() {
                            services::bob::collect_deliverable_file_paths_in_workspace(
                                &content,
                                done.workspace_path.as_deref().map(std::path::Path::new),
                            )
                        } else {
                            done.deliverable_paths.clone()
                        };
                        let mut source_items = Vec::new();
                        let mut associated_artifact_ids = Vec::new();
                        for path in &deliverable_paths {
                            if let Some(task_id) = done.task_id.as_deref() {
                                let file = std::path::Path::new(path);
                                let metadata = file.metadata().ok();
                                let _ = task_service.add_io(
                                    &db,
                                    task_id,
                                    done.run_id.as_deref(),
                                    "output",
                                    if file.is_dir() { "directory" } else { "file" },
                                    file.file_name()
                                        .and_then(|value| value.to_str())
                                        .unwrap_or(path),
                                    Some(path),
                                    None,
                                    metadata
                                        .as_ref()
                                        .filter(|value| value.is_file())
                                        .map(|value| value.len() as i64),
                                    None,
                                    &serde_json::json!({ "capturedBy": "bob-shell-reply" }),
                                );
                            }
                            if let Ok(Some(artifact)) = services::artifact::ArtifactService::new()
                                .register_external(&db, path, Some(done.conversation_id.as_str()))
                            {
                                associated_artifact_ids.push(artifact.id.clone());
                                source_items.push(serde_json::json!({
                                    "id": artifact.id,
                                    "title": artifact.title,
                                    "path": artifact.file_path,
                                }));
                            } else {
                                let name = std::path::Path::new(path)
                                    .file_name()
                                    .and_then(|value| value.to_str())
                                    .unwrap_or(path);
                                source_items.push(serde_json::json!({
                                    "id": path,
                                    "title": name,
                                    "path": path,
                                }));
                            }
                        }
                        if !associated_artifact_ids.is_empty() {
                            use tauri::Emitter;
                            let _ = ah2.emit("artifacts-updated", &associated_artifact_ids);
                        }

                        if (!content.trim().is_empty() && !task_cancelled)
                            || !done.file_changes.is_empty()
                        {
                            let sources = if source_items.is_empty() {
                                None
                            } else {
                                Some(serde_json::Value::Array(source_items))
                            };
                            if let Ok(message) = conv_service.add_message(
                                &db,
                                AddMessageInput {
                                    conversation_id: done.conversation_id.clone(),
                                    author: "assistant".to_string(),
                                    content: content.clone(),
                                    attachments: None,
                                    sources,
                                },
                            ) {
                                if let Some(task_id) = done.task_id.as_deref() {
                                    if let Ok(Some(detail)) = task_service.get_detail(&db, task_id) {
                                        // Task events are explicit Bob Shell actions (tool calls,
                                        // sources, steps and statuses), not private chain of thought.
                                        // Store the complete structured trace; presentation-level
                                        // filtering and start/result coalescing happen in the client.
                                        let value = serde_json::Value::Array(detail.events.iter().map(|event| {
                                            serde_json::json!({
                                                "name": event.tool_name.as_deref()
                                                    .or(event.title.as_deref())
                                                    .unwrap_or(event.event_type.as_str()),
                                                "timestamp": event.created_at,
                                                "eventType": event.event_type,
                                                "title": event.title,
                                                "content": event.content,
                                                "toolName": event.tool_name,
                                                "payload": event.payload,
                                                "createdAt": event.created_at,
                                            })
                                        }).collect());
                                        let _ = conv_service.set_message_tools_used(
                                            &db,
                                            &message.id,
                                            &value,
                                        );
                                    }
                                }
                                if !done.file_changes.is_empty() {
                                    if let Ok(value) = serde_json::to_value(&done.file_changes) {
                                        let _ = conv_service.set_message_file_changes(
                                            &db,
                                            &message.id,
                                            &value,
                                        );
                                    }
                                }
                            }
                        }
                        if task_cancelled {
                            if let Some(task_id) = done.task_id.as_deref() {
                                let _ = task_service.update_state(&db, task_id, "cancelled");
                                use tauri::Emitter;
                                let _ = ah2.emit("task-updated", task_id);
                            }
                            return;
                        }
                        if let Some(task_id) = done.task_id.as_deref() {
                            let _ = task_service.finish_run(
                                &db,
                                task_id,
                                done.run_id.as_deref(),
                                done.success,
                                &content,
                                done.error.as_deref(),
                                done.shell_task_id.as_deref(),
                            );
                            if !content.trim().is_empty() {
                                let _ = task_service.add_io(
                                    &db,
                                    task_id,
                                    done.run_id.as_deref(),
                                    "output",
                                    "response",
                                    "Réponse finale",
                                    None,
                                    Some("text/markdown"),
                                    Some(content.len() as i64),
                                    None,
                                    &serde_json::json!({ "success": done.success }),
                                );
                            }
                            let now = chrono::Utc::now().to_rfc3339();
                            let schedule_state = if done.success { "completed" } else { "failed" };
                            let _ = db.conn.lock().unwrap().execute(
                                "UPDATE schedule_runs SET state=?1,ended_at=?2,summary=?3,error=?4 WHERE task_id=?5 AND state IN ('queued','running')",
                                rusqlite::params![schedule_state, now, content, done.error.as_deref(), task_id],
                            );
                            use tauri::Emitter;
                            let _ = ah2.emit("task-updated", task_id);
                        }
                        // Sidebar + macOS banner: actual assistant reply and/or error text.
                        services::notify::notify_task_finished(
                            &ah2,
                            done.success,
                            &done.full_output,
                            done.error.as_deref(),
                            done.task_id.as_deref(),
                            Some(done.conversation_id.as_str()),
                        );
                        if done.success {
                            match services::plugin::PluginService::new().sync_agentic_bundles(&db) {
                                Ok(plugins) => {
                                    use tauri::Emitter;
                                    for plugin in &plugins {
                                        if services::plugin_mcp::PluginMcpService::has_servers(&plugin.manifest) {
                                            let bob_service = ah2.state::<services::bob::BobService>();
                                            let bob_path = bob_service
                                                .get_binary_path()
                                                .or_else(|| bob_service.detect().path);
                                            let bundle_dir = services::plugin_mcp::PluginMcpService::bundle_dir(&plugin.manifest);
                                            if let (Some(bob_path), Ok(bundle_dir)) = (bob_path, bundle_dir) {
                                                if let Err(error) = services::plugin_mcp::PluginMcpService::new().sync(
                                                    &bob_path,
                                                    &plugin.id,
                                                    &plugin.manifest,
                                                    &bundle_dir,
                                                    plugin.install_state == "installed",
                                                ) {
                                                    tracing::warn!("Unable to install plugin MCP tools: {:?}", error);
                                                }
                                            }
                                        }
                                        let _ = ah2.emit("plugin-updated", &plugin.id);
                                    }
                                    let user_text = services::conversation::ConversationService::new()
                                        .get_messages(&db, &done.conversation_id)
                                        .unwrap_or_default()
                                        .into_iter()
                                        .filter(|message| message.author == "user")
                                        .map(|message| message.content)
                                        .collect::<Vec<_>>()
                                        .join("\n");
                                    let blob = format!("{user_text}\n{}", done.full_output);
                                    let specs = services::db_prompt::parse_prompt_db_specs(&blob);
                                    if !specs.is_empty() {
                                        let mut targets: Vec<(String, String)> = plugins
                                            .iter()
                                            .map(|plugin| (plugin.id.clone(), plugin.name.clone()))
                                            .collect();
                                        if targets.is_empty() {
                                            if let Ok(all) = services::plugin::PluginService::new().get_all(&db) {
                                                let lower = blob.to_lowercase();
                                                targets = all
                                                    .into_iter()
                                                    .filter(|plugin| plugin.id.starts_with("agentic-"))
                                                    .filter(|plugin| {
                                                        lower.contains(&plugin.id.to_lowercase())
                                                            || lower.contains(&plugin.name.to_lowercase())
                                                            || plugin
                                                                .manifest
                                                                .get("slug")
                                                                .and_then(|value| value.as_str())
                                                                .is_some_and(|slug| lower.contains(&slug.to_lowercase()))
                                                    })
                                                    .map(|plugin| (plugin.id, plugin.name))
                                                    .collect();
                                            }
                                        }
                                        for (plugin_id, name) in targets {
                                            if let Err(error) = services::db_prompt::provision_for_plugin(
                                                &db,
                                                &plugin_id,
                                                &name,
                                                &specs,
                                            ) {
                                                tracing::warn!(
                                                    "Unable to attach prompt DB connection to plugin {plugin_id}: {error:?}"
                                                );
                                            } else {
                                                let _ = ah2.emit("plugin-updated", &plugin_id);
                                            }
                                        }
                                    }
                                }
                                Err(error) => tracing::warn!("Unable to import agent-created plugins: {:?}", error),
                            }
                        }
                        // Audit log
                        let _ = AuditService::new().bob_event(
                            &db,
                            if done.success { "bob.session_completed" } else { "bob.session_failed" },
                            &done.session_id,
                            &done.conversation_id,
                        );
                        info!("Persisted Bob response for conversation {}", done.conversation_id);
                    }
                });
            }

            // Install the completion listener before accepting a first mobile prompt.
            if services::settings::SettingsService::new()
                .get(&app_handle.state::<db::Database>())
                .is_ok_and(|settings| settings.remote_control_enabled || settings.mcp_gateway_enabled)
            {
                let remote_app = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let service = remote_app.state::<services::remote_control::RemoteControlService>();
                    if let Err(error) = service.start(remote_app.clone()).await {
                        tracing::warn!("Unable to start remote control: {error}");
                    }
                });
            }

            commands::updater::start_updater_smoke_if_requested(app_handle.clone());
            info!("Bob Work initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bob::detect_bob,
            commands::bob::get_bob_auth_snapshot,
            commands::bob::get_bob_capabilities,
            commands::bob::get_bob_profile,
            commands::bob::get_bob_modes,
            commands::bob::list_bob_slash_commands,
            commands::mode::list_mode_marketplace,
            commands::mode::install_bob_mode,
            commands::mode::uninstall_bob_mode,
            commands::mode::import_bob_mode_yaml,
            commands::bob::install_bob_shell,
            commands::bob::set_session_secret,
            commands::bob::has_session_secret,
            commands::bob::clear_session_secret,
            commands::bob::send_message,
            commands::bob::stop_task,
            commands::codegraph::get_codegraph_suggestion,
            // Project commands
            commands::project::get_projects,
            commands::project::get_project,
            commands::project::create_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::project::archive_project,
            // Conversation commands
            commands::conversation::get_conversations,
            commands::conversation::get_conversation,
            commands::conversation::create_conversation,
            commands::conversation::update_conversation,
            commands::conversation::delete_conversation,
            commands::conversation::get_messages,
            commands::conversation::add_message,
            commands::conversation::truncate_messages_from,
            commands::conversation::rewind_conversation_from_message,
            commands::conversation::import_conversations,
            commands::conversation::export_conversations,
            // Task commands
            commands::task::get_tasks,
            commands::task::get_task,
            commands::task::get_task_detail,
            commands::task::create_task,
            commands::task::update_task_state,
            commands::task::update_task_pinned,
            commands::task::cancel_task,
            // Plugin commands
            commands::plugin::get_plugins,
            commands::plugin::get_plugin,
            commands::plugin::get_plugin_versions,
            commands::plugin::compare_plugin_version,
            commands::plugin::install_plugin_update,
            commands::plugin::rollback_plugin_version,
            commands::plugin::create_plugin,
            commands::plugin::update_plugin,
            commands::plugin::delete_plugin,
            commands::plugin::install_plugin,
            commands::plugin::uninstall_plugin,
            commands::plugin::toggle_plugin,
            commands::plugin::get_plugin_mcp_status,
            commands::plugin::test_plugin_mcp,
            commands::plugin::get_plugin_extension_status,
            commands::plugin::get_plugin_resource_status,
            commands::plugin::list_plugin_file_resources,
            commands::plugin::upload_plugin_file_resource,
            commands::plugin::delete_plugin_file_resource,
            commands::plugin::list_plugin_linked_databases,
            commands::plugin::link_plugin_database,
            commands::plugin::unlink_plugin_database,
            commands::plugin::validate_plugin,
            commands::plugin::export_plugin_zip,
            commands::plugin::import_plugin_zip,
            commands::preview::prepare_file_preview,
            commands::preview::read_html_preview,
            commands::preview::prepare_fitted_html_preview,
            commands::preview::get_live_preview_revision,
            commands::preview::export_live_canvas_zip,
            commands::preview::allow_composer_attachments,
            commands::preview::open_preview_resource,
            commands::preview::reveal_in_file_manager,
            // Approval commands
            commands::approval::get_pending_approvals,
            commands::approval::resolve_approval,
            #[cfg(feature = "e2e")]
            commands::approval::e2e_seed_approval,
            #[cfg(feature = "e2e")]
            commands::approval::e2e_fail_next_approval_resolve,
            // Artifact commands
            commands::artifact::get_artifacts,
            commands::artifact::get_artifact,
            commands::artifact::delete_artifact,
            commands::artifact::register_external_artifact,
            commands::artifact::open_artifact,
            // Settings commands
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::memory::get_memories,
            commands::memory::create_memory,
            commands::memory::forget_memory,
            commands::ssh::get_ssh_servers,
            commands::ssh::save_ssh_server,
            commands::ssh::delete_ssh_server,
            commands::ssh::test_ssh_server,
            commands::ssh::ssh_exec,
            commands::ssh::ssh_read,
            commands::ssh::ssh_write,
            commands::ssh::browse_ssh_directory,
            commands::ssh::sync_ssh_workspace,
            commands::ssh::start_ssh_terminal,
            commands::ssh::write_ssh_terminal,
            commands::ssh::stop_ssh_terminal,
            commands::remote_control::get_remote_control_status,
            commands::remote_control::restart_remote_control,
            commands::runtime::get_runtimes,
            commands::runtime::get_runtime_storage,
            commands::runtime::get_runtime_installation_plan,
            commands::runtime::install_external_runtime,
            commands::runtime::remove_external_runtime,
            commands::runtime::cancel_runtime_process,
            commands::rendering::route_diagram_spec,
            commands::rendering::route_visualization_spec,
            commands::rendering::get_renderer_capabilities,
            commands::qiskit::validate_quantum_circuit,
            commands::qiskit::analyze_quantum_circuit,
            commands::qiskit::transpile_quantum_circuit,
            commands::qiskit::simulate_quantum_circuit,
            commands::qiskit::simulate_quantum_circuit_with_visualization,
            commands::data_analytics::execute_data_analysis,
            // Search, skills, MCP, permissions and usage
            commands::workspace::search_workspace,
            commands::workspace::get_skills,
            commands::workspace::save_skill,
            commands::workspace::set_skill_enabled,
            commands::workspace::delete_skill,
            commands::workspace::install_builtin_integration,
            commands::workspace::install_builtin_skill,
            commands::integration::get_integration_statuses,
            commands::integration::get_oauth_client_config,
            commands::integration::set_oauth_client_config,
            commands::integration::start_integration_oauth,
            commands::integration::connect_integration_token,
            commands::integration::disconnect_integration,
            #[cfg(feature = "e2e")]
            commands::integration::e2e_connect_integration,
            #[cfg(feature = "e2e")]
            commands::integration::e2e_seed_oauth_token,
            commands::workspace::get_mcp_servers,
            commands::workspace::test_mcp_server,
            commands::workspace::save_mcp_server,
            commands::workspace::set_mcp_server_enabled,
            commands::workspace::delete_mcp_server,
            commands::db_connection::get_db_connections,
            commands::db_connection::save_db_connection,
            commands::db_connection::set_db_connection_enabled,
            commands::db_connection::delete_db_connection,
            commands::db_connection::test_db_connection,
            commands::workspace::get_permission_grants,
            commands::workspace::create_permission_grant,
            commands::workspace::revoke_permission_grant,
            commands::workspace::get_usage_status,
            commands::workspace::get_bobalytics,
            commands::workspace::export_bobalytics,
            // System commands
            commands::system::get_app_info,
            commands::system::open_data_dir,
            commands::system::create_database_backup,
            commands::system::list_database_backups,
            commands::system::restore_database_backup,
            commands::system::purge_app_cache,
            commands::system::open_macos_privacy_pane,
            commands::system::get_voice_dictation_availability,
            commands::system::microphone_authorization_state,
            commands::system::request_microphone_permission,
            commands::system::request_voice_dictation_permission,
            commands::native_audio_recording::start_native_audio_recording,
            commands::native_audio_recording::stop_native_audio_recording,
            commands::native_audio_recording::native_audio_recording_level,
            commands::system::notification_authorization_state,
            commands::system::request_notification_authorization,
            commands::system::list_app_notifications,
            commands::system::take_pending_notification_open,
            commands::system::request_accessibility_permission,
            commands::system::request_chrome_automation_permission,
            commands::system::get_chrome_control_status,
            commands::system::get_computer_use_status,
            commands::system::export_diagnostics,
            commands::updater::check_for_updates,
            commands::updater::install_available_update,
            #[cfg(feature = "e2e")]
            commands::system::e2e_ack_macos_automation,
            // Schedule commands
            commands::schedule::get_schedules,
            commands::schedule::create_schedule,
            commands::schedule::update_schedule,
            commands::schedule::update_schedule_state,
            commands::schedule::delete_schedule,
            commands::schedule::get_schedule_logs,
            commands::schedule::get_schedule_runs,
            commands::schedule::run_schedule_now,
            // Artifact generation commands
            commands::artifact_gen::generate_artifact,
            commands::artifact_gen::get_artifacts_list,
            commands::designer::create_designer_preview,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Bob Work");
}
