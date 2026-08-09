use crate::db::Database;
use crate::error::AppError;
use crate::models::settings::AppSettings;
use crate::services::bob::BobService;
use crate::services::chrome_mcp::ChromeMcpService;
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
) -> Result<(), AppError> {
    let previous = SettingsService::new().get(&db)?;
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
    if let Some(tray) = app_handle.tray_by_id("main") {
        tray.set_visible(settings.menu_bar_enabled)
            .map_err(|error| {
                AppError::Io(format!(
                    "Impossible de modifier l’icône de barre des menus : {}",
                    error
                ))
            })?;
    }
    SettingsService::new().update_all(&db, &settings)?;
    if previous.chrome_control_enabled != settings.chrome_control_enabled {
        if let Some(bob_path) = bob.get_binary_path() {
            ChromeMcpService::new().sync(&bob_path, settings.chrome_control_enabled)?;
        }
    }
    Ok(())
}
