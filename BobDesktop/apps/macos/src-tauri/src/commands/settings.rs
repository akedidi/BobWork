use crate::db::Database;
use crate::error::AppError;
use crate::models::settings::AppSettings;
use crate::services::bob::BobService;
use crate::services::chrome_mcp::ChromeMcpService;
use crate::services::computer_use_mcp::ComputerUseMcpService;
use crate::services::map_mcp::MapMcpService;
use crate::services::remote_control::RemoteControlService;
use crate::services::settings::SettingsService;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub async fn get_settings(db: State<'_, Database>) -> Result<AppSettings, AppError> {
    SettingsService::new().get(&db)
}

#[tauri::command]
pub async fn update_settings(
    settings: AppSettings,
    db: State<'_, Database>,
    app_handle: AppHandle,
    bob: State<'_, BobService>,
    remote_control: State<'_, RemoteControlService>,
) -> Result<(), AppError> {
    let previous = SettingsService::new().get(&db)?;
    if previous.launch_at_login != settings.launch_at_login {
        let autostart = app_handle.autolaunch();
        let result = if settings.launch_at_login {
            autostart.enable()
        } else {
            autostart.disable()
        };
        result.map_err(|error| {
            AppError::Io(format!(
                "Impossible de modifier le lancement automatique : {}",
                error
            ))
        })?;
    }
    if previous.menu_bar_enabled != settings.menu_bar_enabled {
        if let Some(tray) = app_handle.tray_by_id("main") {
            tray.set_visible(settings.menu_bar_enabled)
                .map_err(|error| {
                    AppError::Io(format!(
                        "Impossible de modifier l’icône de barre des menus : {}",
                        error
                    ))
                })?;
        }
    }
    SettingsService::new().update_all(&db, &settings)?;
    MapMcpService.sync_location(
        settings.location_enabled,
        settings.current_latitude,
        settings.current_longitude,
        settings.current_location_updated_at.as_deref(),
    )?;
    let previous_remote_runtime = previous.remote_control_enabled || previous.mcp_gateway_enabled;
    let next_remote_runtime = settings.remote_control_enabled || settings.mcp_gateway_enabled;
    if previous_remote_runtime != next_remote_runtime {
        if next_remote_runtime {
            remote_control.start(app_handle.clone()).await?;
        } else {
            remote_control.stop(&app_handle);
        }
    }
    if previous.chrome_control_enabled != settings.chrome_control_enabled {
        if let Some(bob_path) = bob.get_binary_path() {
            ChromeMcpService::new().sync(&bob_path, settings.chrome_control_enabled)?;
        }
        #[cfg(all(target_os = "macos", not(feature = "e2e")))]
        if settings.chrome_control_enabled {
            // Register Bob Work under Automation (Bob Work → Google Chrome).
            let _ = crate::macos_permissions::request_chrome_automation();
        }
    }
    if previous.computer_use_enabled != settings.computer_use_enabled {
        if let Some(bob_path) = bob.get_binary_path() {
            ComputerUseMcpService::new().sync(&bob_path, settings.computer_use_enabled)?;
        }
        #[cfg(all(target_os = "macos", not(feature = "e2e")))]
        if settings.computer_use_enabled {
            // Register Bob Work under Accessibility (system prompt if needed).
            let _ = crate::macos_permissions::request_accessibility();
        }
    }
    Ok(())
}
