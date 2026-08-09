use crate::db::Database;
use crate::error::AppError;
use crate::services::chrome_mcp::{ChromeMcpService, MacosChromeControlStatus};
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

fn macos_privacy_urls(pane: &str) -> Result<(String, String), AppError> {
    let anchor = match pane {
        "accessibility" => "Privacy_Accessibility",
        "automation" => "Privacy_Automation",
        other => {
            return Err(AppError::ValidationFailed(format!(
                "Panneau macOS inconnu : {other}"
            )));
        }
    };
    Ok((
        format!("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?{anchor}"),
        format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"),
    ))
}

#[tauri::command]
pub async fn open_macos_privacy_pane(pane: String) -> Result<(), AppError> {
    if std::env::consts::OS != "macos" {
        return Err(AppError::ValidationFailed(
            "Les raccourcis Réglages Système ne sont disponibles que sur macOS.".into(),
        ));
    }
    let (modern, legacy) = macos_privacy_urls(&pane)?;
    if open::that(&modern).is_err() {
        open::that(&legacy).map_err(|error| AppError::Io(error.to_string()))?;
    }
    Ok(())
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

#[tauri::command]
pub async fn get_chrome_control_status() -> Result<MacosChromeControlStatus, AppError> {
    Ok(ChromeMcpService::new().status())
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_ack_macos_automation() -> Result<(), AppError> {
    let data_dir = std::env::var_os("BOB_WORK_E2E_DATA_DIR")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| {
            AppError::ValidationFailed("e2e_ack_macos_automation requires BOB_WORK_E2E_DATA_DIR".into())
        })?;
    std::fs::write(data_dir.join("e2e-automation-ack"), "acknowledged")?;
    Ok(())
}

#[cfg(test)]
mod privacy_url_tests {
    use super::macos_privacy_urls;

    #[test]
    fn builds_modern_and_legacy_privacy_urls() {
        let (modern, legacy) = macos_privacy_urls("accessibility").unwrap();
        assert!(modern.contains("PrivacySecurity.extension?Privacy_Accessibility"));
        assert!(legacy.contains("preference.security?Privacy_Accessibility"));

        let (modern, legacy) = macos_privacy_urls("automation").unwrap();
        assert!(modern.contains("Privacy_Automation"));
        assert!(legacy.contains("Privacy_Automation"));
    }
}
