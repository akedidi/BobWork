use crate::error::AppError;
use crate::services::remote_control::{RemoteControlService, RemoteControlStatus};
use tauri::State;

#[tauri::command]
pub async fn get_remote_control_status(
    service: State<'_, RemoteControlService>,
) -> Result<RemoteControlStatus, AppError> {
    Ok(service.status())
}

#[tauri::command]
pub async fn restart_remote_control(
    app_handle: tauri::AppHandle,
    service: State<'_, RemoteControlService>,
) -> Result<RemoteControlStatus, AppError> {
    service.stop(&app_handle);
    service.start(app_handle).await?;
    Ok(service
        .wait_until_link_or_error(std::time::Duration::from_secs(45))
        .await)
}
