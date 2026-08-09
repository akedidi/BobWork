// ============================================================
// Bob Work - Artifact Generator Commands
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::models::artifact::Artifact;
use crate::services::artifact_generator::{ArtifactGeneratorService, CreateArtifactInput};
use tauri::{Manager, State};

#[tauri::command]
pub async fn generate_artifact(
    app_handle: tauri::AppHandle,
    input: CreateArtifactInput,
    db: State<'_, Database>,
) -> Result<Artifact, AppError> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Io("Cannot get app data dir".to_string()))?;
    let artifacts_dir = data_dir.join("artifacts");

    ArtifactGeneratorService::new().generate(&db, input, &artifacts_dir)
}

#[tauri::command]
pub async fn get_artifacts_list(db: State<'_, Database>) -> Result<Vec<Artifact>, AppError> {
    crate::services::artifact::ArtifactService::new().get_all(&db, None)
}
