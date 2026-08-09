// ============================================================
// Bob Work - Project Commands
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::models::project::{CreateProjectInput, Project, UpdateProjectInput};
use crate::services::project::ProjectService;
use tauri::State;

#[tauri::command]
pub async fn get_projects(db: State<'_, Database>) -> Result<Vec<Project>, AppError> {
    ProjectService::new().get_all(&db)
}

#[tauri::command]
pub async fn get_project(id: String, db: State<'_, Database>) -> Result<Option<Project>, AppError> {
    ProjectService::new().get_by_id(&db, &id)
}

#[tauri::command]
pub async fn create_project(
    input: CreateProjectInput,
    db: State<'_, Database>,
) -> Result<Project, AppError> {
    ProjectService::new().create(&db, input)
}

#[tauri::command]
pub async fn update_project(
    id: String,
    input: UpdateProjectInput,
    db: State<'_, Database>,
) -> Result<Project, AppError> {
    ProjectService::new().update(&db, &id, input)
}

#[tauri::command]
pub async fn delete_project(id: String, db: State<'_, Database>) -> Result<(), AppError> {
    ProjectService::new().delete(&db, &id)
}

#[tauri::command]
pub async fn archive_project(
    id: String,
    archived: bool,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    ProjectService::new().archive(&db, &id, archived)
}
