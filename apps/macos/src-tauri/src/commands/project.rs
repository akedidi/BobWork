// ============================================================
// Bob Work - Project Commands
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::models::project::{CreateProjectInput, Project, UpdateProjectInput};
use crate::services::project::ProjectService;
use tauri::{AppHandle, Emitter, State};

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
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<Project, AppError> {
    let project = ProjectService::new().create(&db, input)?;
    let _ = app_handle.emit("project-updated", &project.id);
    Ok(project)
}

#[tauri::command]
pub async fn update_project(
    id: String,
    input: UpdateProjectInput,
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<Project, AppError> {
    let project = ProjectService::new().update(&db, &id, input)?;
    let _ = app_handle.emit("project-updated", &project.id);
    Ok(project)
}

#[tauri::command]
pub async fn delete_project(
    id: String,
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    ProjectService::new().delete(&db, &id)?;
    let _ = app_handle.emit("project-updated", &id);
    Ok(())
}

#[tauri::command]
pub async fn archive_project(
    id: String,
    archived: bool,
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    ProjectService::new().archive(&db, &id, archived)?;
    let _ = app_handle.emit("project-updated", &id);
    Ok(())
}
