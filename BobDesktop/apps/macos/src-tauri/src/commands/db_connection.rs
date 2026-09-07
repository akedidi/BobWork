use crate::db::Database;
use crate::error::AppError;
use crate::models::workspace::{DbConnection, DbConnectionTestResult, SaveDbConnectionInput};
use crate::services::db_connection::DbConnectionService;
use tauri::State;

#[tauri::command]
pub async fn get_db_connections(db: State<'_, Database>) -> Result<Vec<DbConnection>, AppError> {
    DbConnectionService::new().list(&db)
}

#[tauri::command]
pub async fn save_db_connection(
    input: SaveDbConnectionInput,
    db: State<'_, Database>,
) -> Result<DbConnection, AppError> {
    DbConnectionService::new().save(&db, input)
}

#[tauri::command]
pub async fn set_db_connection_enabled(
    id: String,
    enabled: bool,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    DbConnectionService::new().set_enabled(&db, &id, enabled)
}

#[tauri::command]
pub async fn delete_db_connection(id: String, db: State<'_, Database>) -> Result<(), AppError> {
    DbConnectionService::new().delete(&db, &id)
}

#[tauri::command]
pub async fn test_db_connection(
    id: String,
    db: State<'_, Database>,
) -> Result<DbConnectionTestResult, AppError> {
    DbConnectionService::new().test(&db, &id)
}
