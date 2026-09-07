// ============================================================
// Bob Work - Modes marketplace commands
// ============================================================

use crate::error::AppError;
use crate::services::bob::{BobMode, BobService};
use crate::services::mode::{ModeCatalogEntry, ModeService};
use tauri::State;

#[tauri::command]
pub async fn list_mode_marketplace(
    workspace: Option<String>,
    bob_service: State<'_, BobService>,
) -> Result<Vec<ModeCatalogEntry>, AppError> {
    let installed = bob_service.discover_modes(workspace.as_deref());
    Ok(ModeService::list_marketplace(
        &installed,
        workspace.as_deref(),
    ))
}

#[tauri::command]
pub async fn install_bob_mode(slug: String) -> Result<BobMode, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Io("Impossible de résoudre le dossier home.".into()))?;
    ModeService::install_mode(&home, &slug)
}

#[tauri::command]
pub async fn uninstall_bob_mode(slug: String) -> Result<(), AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Io("Impossible de résoudre le dossier home.".into()))?;
    ModeService::uninstall_mode(&home, &slug)
}

#[tauri::command]
pub async fn import_bob_mode_yaml(yaml: String) -> Result<BobMode, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Io("Impossible de résoudre le dossier home.".into()))?;
    ModeService::import_mode_yaml(&home, &yaml)
}
