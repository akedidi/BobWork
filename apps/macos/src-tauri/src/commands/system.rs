use crate::db::Database;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub log_dir: String,
}

#[tauri::command]
pub async fn get_app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let log_dir = app
        .path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(AppInfo {
        app_version: app.package_info().version.to_string(),
        tauri_version: "2.x".to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir,
        log_dir,
    })
}

#[tauri::command]
pub async fn open_data_dir(app: AppHandle) -> Result<(), AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;

    open::that(&data_dir).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn export_diagnostics(
    app: AppHandle,
    _db: State<'_, Database>,
) -> Result<String, AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;

    let diagnostics = serde_json::json!({
        "app_version": app.package_info().version.to_string(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "data_dir": data_dir.to_string_lossy(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    let output_path = data_dir.join("diagnostics.json");
    std::fs::write(&output_path, serde_json::to_string_pretty(&diagnostics)?)?;

    Ok(output_path.to_string_lossy().to_string())
}
