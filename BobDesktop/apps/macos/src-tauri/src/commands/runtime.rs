use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::runtime::{RuntimeInstallationPlan, RuntimeRecord, RuntimeStorageReport};
use crate::services::plugin::PluginService;
use crate::services::runtime_manager::RuntimeManager;
use tauri::State;

#[tauri::command]
pub async fn get_runtimes(
    db: State<'_, Database>,
    manager: State<'_, RuntimeManager>,
) -> AppResult<Vec<RuntimeRecord>> {
    manager.list(&db)
}

#[tauri::command]
pub async fn get_runtime_storage(
    db: State<'_, Database>,
    manager: State<'_, RuntimeManager>,
) -> AppResult<RuntimeStorageReport> {
    // Re-detect externally installed CLIs when the user refreshes the catalog.
    for plugin in PluginService::new().get_all(&db)? {
        manager.register_plugin_requirements(&db, &plugin.id, &plugin.manifest)?;
    }
    manager.storage_report(&db)
}

#[tauri::command]
pub async fn get_runtime_installation_plan(
    runtime_id: String,
    db: State<'_, Database>,
    manager: State<'_, RuntimeManager>,
) -> AppResult<RuntimeInstallationPlan> {
    manager.installation_plan(&db, &runtime_id)
}

#[tauri::command]
pub async fn install_external_runtime(
    runtime_id: String,
    accepted: bool,
    db: State<'_, Database>,
    manager: State<'_, RuntimeManager>,
) -> AppResult<RuntimeRecord> {
    manager
        .install_external_runtime(&db, &runtime_id, accepted)
        .await
}

#[tauri::command]
pub async fn remove_external_runtime(
    runtime_id: String,
    confirmed: bool,
    db: State<'_, Database>,
    manager: State<'_, RuntimeManager>,
) -> AppResult<()> {
    if !confirmed {
        return Err(AppError::PermissionDenied(
            "Runtime removal requires explicit user confirmation".into(),
        ));
    }
    manager.remove_runtime(&db, &runtime_id)
}

#[tauri::command]
pub async fn cancel_runtime_process(
    process_id: String,
    manager: State<'_, RuntimeManager>,
) -> AppResult<bool> {
    Ok(manager.cancel_process(&process_id))
}
