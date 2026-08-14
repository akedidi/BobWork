use crate::db::Database;
use crate::error::AppError;
use crate::services::chrome_mcp::{ChromeMcpService, MacosChromeControlStatus};
use crate::services::computer_use_mcp::{ComputerUseMcpService, MacosComputerUseStatus};
use crate::services::notify::{AppNotificationEvent, NotificationInbox};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

fn database_backup_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Io(error.to_string()))?
        .join("backups"))
}

#[tauri::command]
pub async fn create_database_backup(
    app: AppHandle,
    database: State<'_, Database>,
) -> Result<crate::db::DatabaseBackup, AppError> {
    let backup_dir = database_backup_dir(&app)?;
    database.create_backup(&backup_dir, false)
}

#[tauri::command]
pub async fn list_database_backups(
    app: AppHandle,
) -> Result<Vec<crate::db::DatabaseBackup>, AppError> {
    Database::list_backups(&database_backup_dir(&app)?)
}

#[tauri::command]
pub async fn restore_database_backup(
    app: AppHandle,
    database: State<'_, Database>,
    name: String,
) -> Result<(), AppError> {
    if name.contains('/')
        || name.contains('\\')
        || !name.starts_with("bob-work-")
        || !name.ends_with(".sqlite")
    {
        return Err(AppError::ValidationFailed("Invalid backup name".into()));
    }
    let backup_dir = database_backup_dir(&app)?;
    let selected = backup_dir.join(name);
    if !selected.is_file() {
        return Err(AppError::NotFound("Database backup not found".into()));
    }

    // Always preserve the current state before replacing it.
    database.create_backup(&backup_dir, false)?;
    database.restore_backup(&selected)?;
    database.run_migrations()?;
    Ok(())
}

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
    match pane {
        "accessibility" => Ok((
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility"
                .into(),
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility".into(),
        )),
        "automation" => Ok((
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation"
                .into(),
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation".into(),
        )),
        "notifications" => Ok((
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension".into(),
            "x-apple.systempreferences:com.apple.preference.notifications".into(),
        )),
        "microphone" => Ok((
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone"
                .into(),
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone".into(),
        )),
        "speech" => Ok((
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_SpeechRecognition"
                .into(),
            "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition".into(),
        )),
        other => Err(AppError::ValidationFailed(format!(
            "Panneau macOS inconnu : {other}"
        ))),
    }
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

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDictationAvailability {
    pub available: bool,
    pub reason: Option<String>,
}

fn voice_dictation_availability_for_executable(executable: &Path) -> VoiceDictationAvailability {
    if std::env::consts::OS != "macos" {
        return VoiceDictationAvailability {
            available: false,
            reason: Some("unsupported_platform".into()),
        };
    }

    let Some(contents_dir) = executable
        .parent()
        .filter(|directory| directory.file_name().and_then(|name| name.to_str()) == Some("MacOS"))
        .and_then(Path::parent)
        .filter(|directory| {
            directory.file_name().and_then(|name| name.to_str()) == Some("Contents")
        })
    else {
        return VoiceDictationAvailability {
            available: false,
            reason: Some("requires_app_bundle".into()),
        };
    };

    let info = std::fs::read(contents_dir.join("Info.plist")).unwrap_or_default();
    let has_microphone_description = info
        .windows(b"NSMicrophoneUsageDescription".len())
        .any(|window| window == b"NSMicrophoneUsageDescription");
    let has_speech_description = info
        .windows(b"NSSpeechRecognitionUsageDescription".len())
        .any(|window| window == b"NSSpeechRecognitionUsageDescription");

    if !has_microphone_description || !has_speech_description {
        return VoiceDictationAvailability {
            available: false,
            reason: Some("missing_usage_description".into()),
        };
    }

    VoiceDictationAvailability {
        available: true,
        reason: None,
    }
}

#[tauri::command]
pub async fn get_voice_dictation_availability() -> VoiceDictationAvailability {
    match std::env::current_exe() {
        Ok(executable) => voice_dictation_availability_for_executable(&executable),
        Err(_) => VoiceDictationAvailability {
            available: false,
            reason: Some("executable_unavailable".into()),
        },
    }
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachePurgeResult {
    pub freed_bytes: u64,
    pub cleared_paths: Vec<String>,
}

#[tauri::command]
pub async fn purge_app_cache(app: AppHandle) -> Result<CachePurgeResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || purge_app_cache_sync(&app))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

fn purge_app_cache_sync(app: &AppHandle) -> Result<CachePurgeResult, AppError> {
    let mut cleared_paths = Vec::new();
    let mut freed_bytes = 0_u64;

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(cache_dir) = app.path().app_cache_dir() {
        candidates.push(cache_dir);
    }
    if let Ok(log_dir) = app.path().app_log_dir() {
        candidates.push(log_dir);
    }

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Library/Caches/bob-work"));
        candidates.push(home.join("Library/Caches/com.bobwork.desktop"));
        candidates.push(home.join("Library/Caches/com.bobwork.app"));
        candidates.push(home.join("Library/WebKit/com.bobwork.desktop"));
        candidates.push(home.join("Library/HTTPStorages/com.bobwork.desktop"));
        candidates.push(home.join(".bob/logs"));
        candidates.push(home.join(".bob/run/applescript.sock"));
    }

    // Temporary preview artifacts inside app data (never DB / vault / workspaces).
    if let Ok(data_dir) = app.path().app_data_dir() {
        candidates.push(data_dir.join("previews"));
        candidates.push(data_dir.join("tmp"));
        candidates.push(data_dir.join("cache"));
    }

    for path in candidates {
        if !path.exists() {
            continue;
        }
        let size = dir_size(&path);
        let remove_result = if path.is_file() || path.is_symlink() {
            std::fs::remove_file(&path)
        } else {
            std::fs::remove_dir_all(&path)
        };
        match remove_result {
            Ok(()) => {
                freed_bytes = freed_bytes.saturating_add(size);
                cleared_paths.push(path.to_string_lossy().into_owned());
            }
            Err(error) => {
                tracing::warn!("Cache purge skipped {}: {error}", path.display());
            }
        }
    }

    // Recreate empty log dir so subsequent writes don't fail unexpectedly.
    if let Some(home) = dirs::home_dir() {
        let _ = std::fs::create_dir_all(home.join(".bob/logs"));
        let _ = std::fs::create_dir_all(home.join(".bob/run"));
    }
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let _ = std::fs::create_dir_all(cache_dir);
    }

    Ok(CachePurgeResult {
        freed_bytes,
        cleared_paths,
    })
}

fn dir_size(path: &std::path::Path) -> u64 {
    if path.is_file() || path.is_symlink() {
        return std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0_u64;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            total = total.saturating_add(dir_size(&child));
        } else {
            total = total.saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(0));
        }
    }
    total
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

#[tauri::command]
pub async fn get_computer_use_status() -> Result<MacosComputerUseStatus, AppError> {
    Ok(ComputerUseMcpService::new().status())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationOpenTarget {
    pub conversation_id: Option<String>,
    pub task_id: Option<String>,
}

#[tauri::command]
pub fn list_app_notifications(inbox: State<'_, NotificationInbox>) -> Vec<AppNotificationEvent> {
    inbox.list()
}

#[tauri::command]
pub fn take_pending_notification_open() -> Option<NotificationOpenTarget> {
    #[cfg(target_os = "macos")]
    {
        crate::macos_notifications::take_pending_open().map(|open| NotificationOpenTarget {
            conversation_id: open.conversation_id,
            task_id: open.task_id,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[tauri::command]
pub async fn notification_authorization_state() -> Result<String, AppError> {
    #[cfg(target_os = "macos")]
    {
        if !crate::macos_notifications::is_available() {
            // Bare cargo/tauri-dev binary: UN would crash; surface clearly to UI.
            return Ok("unavailable".into());
        }
        let state = tokio::task::spawn_blocking(crate::macos_notifications::authorization_state)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?
            .map_err(AppError::Io)?;
        Ok(auth_state_key(state))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("authorized".into())
    }
}

#[tauri::command]
pub async fn request_notification_authorization() -> Result<String, AppError> {
    #[cfg(target_os = "macos")]
    {
        if !crate::macos_notifications::is_available() {
            return Err(AppError::ValidationFailed(
                "Bob Work n’apparaît dans Réglages → Notifications que depuis un vrai .app signé (Apple Development). Avec « pnpm dev:tauri », utilisez « pnpm install:dev-app » puis ouvrez /Applications/Bob Work.app."
                    .into(),
            ));
        }
        let state = tokio::task::spawn_blocking(crate::macos_notifications::request_authorization)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?
            .map_err(AppError::Io)?;
        if state.is_granted() {
            let _ = tokio::task::spawn_blocking(|| {
                crate::macos_notifications::send(
                    "Bob Work",
                    "Les notifications macOS sont activées.",
                    None,
                    None,
                )
            })
            .await;
        }
        Ok(auth_state_key(state))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("authorized".into())
    }
}

#[tauri::command]
pub async fn request_accessibility_permission() -> Result<bool, AppError> {
    #[cfg(target_os = "macos")]
    {
        let trusted = tokio::task::spawn_blocking(crate::macos_permissions::request_accessibility)
            .await
            .map_err(|e| AppError::Io(e.to_string()))?;
        Ok(trusted)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub async fn request_chrome_automation_permission() -> Result<String, AppError> {
    #[cfg(target_os = "macos")]
    {
        let (state, message) = tokio::task::spawn_blocking(|| {
            let _ = crate::macos_permissions::request_chrome_automation();
            crate::macos_permissions::probe_chrome_automation_in_process()
        })
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
        if state == "denied" || state == "unknown" {
            return Err(AppError::ValidationFailed(message));
        }
        Ok(state)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("unavailable".into())
    }
}

#[cfg(target_os = "macos")]
fn auth_state_key(state: crate::macos_notifications::AuthState) -> String {
    match state {
        crate::macos_notifications::AuthState::NotDetermined => "not_determined",
        crate::macos_notifications::AuthState::Denied => "denied",
        crate::macos_notifications::AuthState::Authorized => "authorized",
        crate::macos_notifications::AuthState::Provisional => "provisional",
        crate::macos_notifications::AuthState::Ephemeral => "ephemeral",
    }
    .into()
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_ack_macos_automation() -> Result<(), AppError> {
    let data_dir = std::env::var_os("BOB_WORK_E2E_DATA_DIR")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| {
            AppError::ValidationFailed(
                "e2e_ack_macos_automation requires BOB_WORK_E2E_DATA_DIR".into(),
            )
        })?;
    std::fs::write(data_dir.join("e2e-automation-ack"), "acknowledged")?;
    Ok(())
}

#[cfg(test)]
mod privacy_url_tests {
    use super::{macos_privacy_urls, voice_dictation_availability_for_executable};
    use std::path::Path;

    #[test]
    fn builds_modern_and_legacy_privacy_urls() {
        let (modern, legacy) = macos_privacy_urls("accessibility").unwrap();
        assert!(modern.contains("PrivacySecurity.extension?Privacy_Accessibility"));
        assert!(legacy.contains("preference.security?Privacy_Accessibility"));

        let (modern, legacy) = macos_privacy_urls("automation").unwrap();
        assert!(modern.contains("Privacy_Automation"));
        assert!(legacy.contains("Privacy_Automation"));

        let (modern, legacy) = macos_privacy_urls("notifications").unwrap();
        assert!(modern.contains("Notifications-Settings.extension"));
        assert!(legacy.contains("preference.notifications"));

        let (modern, legacy) = macos_privacy_urls("microphone").unwrap();
        assert!(modern.contains("Privacy_Microphone"));
        assert!(legacy.contains("Privacy_Microphone"));
    }

    #[test]
    fn dictation_requires_a_real_app_bundle() {
        let availability = voice_dictation_availability_for_executable(Path::new(
            "/tmp/bob-work/target/debug/bob-work",
        ));
        assert!(!availability.available);
        assert_eq!(availability.reason.as_deref(), Some("requires_app_bundle"));
    }

    #[test]
    fn dictation_requires_both_usage_descriptions() {
        let root = std::env::temp_dir().join(format!(
            "bob-work-voice-availability-{}",
            uuid::Uuid::new_v4()
        ));
        let contents = root.join("Bob Work.app/Contents");
        let executable = contents.join("MacOS/bob-work");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(
            contents.join("Info.plist"),
            b"<key>NSMicrophoneUsageDescription</key>",
        )
        .unwrap();

        let availability = voice_dictation_availability_for_executable(&executable);
        assert!(!availability.available);
        assert_eq!(
            availability.reason.as_deref(),
            Some("missing_usage_description")
        );

        std::fs::write(
            contents.join("Info.plist"),
            b"<key>NSMicrophoneUsageDescription</key><key>NSSpeechRecognitionUsageDescription</key>",
        )
        .unwrap();
        let availability = voice_dictation_availability_for_executable(&executable);
        assert!(availability.available);
        assert_eq!(availability.reason, None);
        let _ = std::fs::remove_dir_all(root);
    }
}
