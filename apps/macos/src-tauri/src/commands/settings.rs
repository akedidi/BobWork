use crate::db::Database;
use crate::error::AppError;
use crate::models::settings::AppSettings;
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
) -> Result<(), AppError> {
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
    SettingsService::new().update_all(&db, &settings)
}
