// ============================================================
// Bob Work - Main Tauri Application Entry Point
// ============================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod error;
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

            app_handle.manage(db);

            if let Ok(settings) = services::settings::SettingsService::new().get(&app_handle.state::<db::Database>()) {
                if let Some(tray) = app_handle.tray_by_id("main") {
                    let _ = tray.set_visible(settings.menu_bar_enabled);
                }
            }

            // Initialize Bob service
            let bob_service = services::bob::BobService::new(&data_dir);
            app_handle.manage(bob_service);

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
            app_handle.manage(plugin_service);

            // Initialize task service
            let task_service = services::task::TaskService::new();
            app_handle.manage(task_service);

            // Initialize artifact service
            let artifact_service = services::artifact::ArtifactService::new();
            app_handle.manage(artifact_service);

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
                        let db = ah2.state::<db::Database>();
                        let conv_service = ConversationService::new();
                        let content = if done.success {
                            done.full_output.clone()
                        } else {
                            done.error.clone().unwrap_or_else(|| done.full_output.clone())
                        };
                        let task_service = services::task::TaskService::new();
                        let task_cancelled = done.task_id.as_deref().and_then(|task_id| {
                            task_service.get_by_id(&db, task_id).ok().flatten()
                        }).is_some_and(|task| task.state == "cancelled");
                        if !content.trim().is_empty() && !task_cancelled {
                            let _ = conv_service.add_message(
                                &db,
                                AddMessageInput {
                                    conversation_id: done.conversation_id.clone(),
                                    author: "assistant".to_string(),
                                    content: content.clone(),
                                    attachments: None,
                                    sources: None,
                                },
                            );
                        }
                        if let Some(task_id) = done.task_id.as_deref() {
                            if task_cancelled {
                                return;
                            }
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

                            if let Ok(settings) = services::settings::SettingsService::new().get(&db) {
                                if settings.notifications_enabled && settings.notify_task_complete {
                                    use tauri_plugin_notification::NotificationExt;
                                    let title = if done.success { "Tâche Bob terminée" } else { "Tâche Bob en échec" };
                                    let body = if content.trim().is_empty() {
                                        done.error.as_deref().unwrap_or("Aucun résultat disponible")
                                    } else {
                                        content.trim()
                                    };
                                    let body: String = body.chars().take(180).collect();
                                    let _ = ah2.notification().builder().title(title).body(body).show();
                                }
                            }
                        }
                        if done.success {
                            match services::plugin::PluginService::new().sync_agentic_bundles(&db) {
                                Ok(plugins) if !plugins.is_empty() => {
                                    use tauri::Emitter;
                                    for plugin in plugins {
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
                                }
                                Ok(_) => {}
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

            info!("Bob Work initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Bob commands
            commands::bob::detect_bob,
            commands::bob::get_bob_capabilities,
            commands::bob::get_bob_profile,
            commands::bob::get_bob_modes,
            commands::bob::install_bob_shell,
            commands::bob::set_session_secret,
            commands::bob::has_session_secret,
            commands::bob::clear_session_secret,
            commands::bob::send_message,
            commands::bob::stop_task,
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
            commands::plugin::get_plugin_extension_status,
            commands::plugin::validate_plugin,
            commands::preview::prepare_file_preview,
            commands::preview::allow_composer_attachments,
            commands::preview::open_preview_resource,
            // Approval commands
            commands::approval::get_pending_approvals,
            commands::approval::resolve_approval,
            // Artifact commands
            commands::artifact::get_artifacts,
            commands::artifact::get_artifact,
            commands::artifact::delete_artifact,
            commands::artifact::open_artifact,
            // Settings commands
            commands::settings::get_settings,
            commands::settings::update_settings,
            // Search, skills, MCP, permissions and usage
            commands::workspace::search_workspace,
            commands::workspace::get_skills,
            commands::workspace::save_skill,
            commands::workspace::set_skill_enabled,
            commands::workspace::delete_skill,
            commands::workspace::install_builtin_integration,
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
            commands::workspace::save_mcp_server,
            commands::workspace::set_mcp_server_enabled,
            commands::workspace::delete_mcp_server,
            commands::workspace::get_permission_grants,
            commands::workspace::create_permission_grant,
            commands::workspace::revoke_permission_grant,
            commands::workspace::get_usage_status,
            // System commands
            commands::system::get_app_info,
            commands::system::open_data_dir,
            commands::system::open_macos_privacy_pane,
            commands::system::get_chrome_control_status,
            commands::system::export_diagnostics,
            #[cfg(feature = "e2e")]
            commands::system::e2e_ack_macos_automation,
            // Schedule commands
            commands::schedule::get_schedules,
            commands::schedule::create_schedule,
            commands::schedule::update_schedule_state,
            commands::schedule::delete_schedule,
            commands::schedule::get_schedule_logs,
            commands::schedule::get_schedule_runs,
            commands::schedule::run_schedule_now,
            // Artifact generation commands
            commands::artifact_gen::generate_artifact,
            commands::artifact_gen::get_artifacts_list,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Bob Work");
}
