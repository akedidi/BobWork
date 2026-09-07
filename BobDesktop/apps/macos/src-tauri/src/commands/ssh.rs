use crate::error::AppError;
use crate::models::ssh::*;
use crate::services::{
    bob::BobService,
    ssh::{SshService, SshTerminalManager},
};
use tauri::{AppHandle, Manager, State};

fn service(app: &AppHandle) -> Result<SshService, AppError> {
    Ok(SshService::new(
        app.path()
            .app_data_dir()
            .map_err(|e| AppError::Io(e.to_string()))?,
    ))
}

#[tauri::command]
pub async fn get_ssh_servers(app: AppHandle) -> Result<Vec<SshServer>, AppError> {
    Ok(service(&app)?.list())
}
#[tauri::command]
pub async fn save_ssh_server(
    app: AppHandle,
    input: SaveSshServerInput,
    bob: State<'_, BobService>,
) -> Result<SshServer, AppError> {
    let svc = service(&app)?;
    let result = svc.save(input)?;
    if let Some(path) = bob.get_binary_path() {
        svc.sync_mcp(&path)?;
    }
    Ok(result)
}
#[tauri::command]
pub async fn delete_ssh_server(
    app: AppHandle,
    id: String,
    bob: State<'_, BobService>,
) -> Result<(), AppError> {
    let svc = service(&app)?;
    svc.delete(&id)?;
    if let Some(path) = bob.get_binary_path() {
        svc.sync_mcp(&path)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn test_ssh_server(app: AppHandle, id: String) -> Result<SshExecResult, AppError> {
    tokio::task::spawn_blocking(move || service(&app)?.test(&id))
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?
}
#[tauri::command]
pub async fn ssh_exec(
    app: AppHandle,
    id: String,
    command: String,
) -> Result<SshExecResult, AppError> {
    tokio::task::spawn_blocking(move || service(&app)?.exec(&id, &command))
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?
}
#[tauri::command]
pub async fn ssh_read(
    app: AppHandle,
    id: String,
    path: String,
    max_bytes: Option<usize>,
) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        service(&app)?.read(&id, &path, max_bytes.unwrap_or(512_000))
    })
    .await
    .map_err(|e| AppError::Unknown(e.to_string()))?
}
#[tauri::command]
pub async fn ssh_write(
    app: AppHandle,
    id: String,
    path: String,
    content: String,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || service(&app)?.write(&id, &path, &content))
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?
}
#[tauri::command]
pub async fn browse_ssh_directory(
    app: AppHandle,
    id: String,
    path: String,
) -> Result<Vec<SshRemoteEntry>, AppError> {
    tokio::task::spawn_blocking(move || service(&app)?.browse(&id, &path))
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?
}
#[tauri::command]
pub async fn sync_ssh_workspace(
    app: AppHandle,
    id: String,
    direction: String,
) -> Result<SshSyncResult, AppError> {
    tokio::task::spawn_blocking(move || service(&app)?.sync(&id, &direction))
        .await
        .map_err(|e| AppError::Unknown(e.to_string()))?
}
#[tauri::command]
pub async fn start_ssh_terminal(
    app: AppHandle,
    id: String,
    session_id: String,
    terminals: State<'_, SshTerminalManager>,
) -> Result<String, AppError> {
    uuid::Uuid::parse_str(&session_id)
        .map_err(|_| AppError::ValidationFailed("Identifiant de terminal invalide.".into()))?;
    terminals.start(
        app.clone(),
        service(&app)?.terminal_command(&id)?,
        session_id,
    )
}
#[tauri::command]
pub async fn write_ssh_terminal(
    session_id: String,
    data: String,
    terminals: State<'_, SshTerminalManager>,
) -> Result<(), AppError> {
    terminals.write(&session_id, &data)
}
#[tauri::command]
pub async fn stop_ssh_terminal(
    session_id: String,
    terminals: State<'_, SshTerminalManager>,
) -> Result<(), AppError> {
    terminals.stop(&session_id)
}
