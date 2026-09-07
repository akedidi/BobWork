use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::data_analytics::{DatasetAnalysisRequest, DatasetAnalysisResult};
use crate::services::data_analytics::DataAnalyticsService;
use crate::services::plugin::PluginService;
use crate::services::runtime_manager::RuntimeManager;
use serde_json::Value;
use tauri::State;

const DATA_ANALYTICS_PLUGIN_ID: &str = "builtin-data-analytics";

fn manifest(db: &Database) -> AppResult<Value> {
    let plugin = PluginService::new()
        .get_by_id(db, DATA_ANALYTICS_PLUGIN_ID)?
        .ok_or_else(|| AppError::NotFound("Data Analytics Built-in is unavailable".into()))?;
    if plugin.install_state != "installed" {
        return Err(AppError::PermissionDenied(
            "Data Analytics Built-in is disabled".into(),
        ));
    }
    Ok(plugin.manifest)
}

#[tauri::command]
pub async fn execute_data_analysis(
    request: DatasetAnalysisRequest,
    db: State<'_, Database>,
    runtime_manager: State<'_, RuntimeManager>,
) -> AppResult<DatasetAnalysisResult> {
    DataAnalyticsService
        .execute(&db, &runtime_manager, &manifest(&db)?, request)
        .await
}
