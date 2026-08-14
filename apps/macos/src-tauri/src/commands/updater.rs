use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

use crate::error::AppError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn updater_error(error: impl std::fmt::Display) -> AppError {
    AppError::Unknown(format!("Mise à jour indisponible : {error}"))
}

fn append_smoke_event(path: &std::path::Path, value: serde_json::Value) {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{value}");
    }
}

/// Release-only smoke hook used by the macOS updater certification workflow.
/// It remains inert unless both explicit environment variables are present.
pub fn start_updater_smoke_if_requested(app: AppHandle) {
    if std::env::var("BOB_WORK_UPDATER_SMOKE").as_deref() != Ok("1") {
        return;
    }
    let Some(marker_path) =
        std::env::var_os("BOB_WORK_UPDATER_SMOKE_FILE").map(std::path::PathBuf::from)
    else {
        return;
    };
    let expected = std::env::var("BOB_WORK_UPDATER_EXPECTED_VERSION").ok();
    tauri::async_runtime::spawn(async move {
        let current = app.package_info().version.to_string();
        let result = async {
            let updater = app.updater().map_err(updater_error)?;
            let Some(update) = updater.check().await.map_err(updater_error)? else {
                append_smoke_event(
                    &marker_path,
                    serde_json::json!({ "status": "current", "version": current }),
                );
                return Ok::<bool, AppError>(false);
            };
            if expected
                .as_deref()
                .is_some_and(|version| version != update.version)
            {
                return Err(AppError::ValidationFailed(format!(
                    "Expected updater version {}, received {}",
                    expected.as_deref().unwrap_or_default(),
                    update.version
                )));
            }
            let target = update.version.clone();
            append_smoke_event(
                &marker_path,
                serde_json::json!({ "status": "detected", "from": current, "to": target }),
            );
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(updater_error)?;
            append_smoke_event(
                &marker_path,
                serde_json::json!({ "status": "installed", "version": target }),
            );
            Ok(true)
        }
        .await;

        match result {
            Ok(true) => app.restart(),
            Ok(false) => {}
            Err(error) => append_smoke_event(
                &marker_path,
                serde_json::json!({ "status": "error", "message": error.to_string() }),
            ),
        }
    });
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, AppError> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(updater_error)?;
    let update = updater.check().await.map_err(updater_error)?;

    Ok(match update {
        Some(update) => UpdateCheckResult {
            current_version,
            available: true,
            version: Some(update.version),
            notes: update.body,
            published_at: update.date.map(|date| date.to_string()),
        },
        None => UpdateCheckResult {
            current_version,
            available: false,
            version: None,
            notes: None,
            published_at: None,
        },
    })
}

#[tauri::command]
pub async fn install_available_update(app: AppHandle) -> Result<(), AppError> {
    let updater = app.updater().map_err(updater_error)?;
    let Some(update) = updater.check().await.map_err(updater_error)? else {
        return Err(AppError::ValidationFailed(
            "Aucune mise à jour n’est disponible.".into(),
        ));
    };

    let mut downloaded = 0_u64;
    let progress_app = app.clone();
    let finished_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = progress_app.emit(
                    "app-update-progress",
                    UpdateDownloadProgress { downloaded, total },
                );
            },
            move || {
                let _ = finished_app.emit("app-update-downloaded", ());
            },
        )
        .await
        .map_err(updater_error)?;

    app.restart()
}
