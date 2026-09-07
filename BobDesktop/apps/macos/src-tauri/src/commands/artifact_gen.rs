// ============================================================
// Bob Work - Artifact Generator Commands
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::models::artifact::Artifact;
use crate::services::artifact_generator::{ArtifactGeneratorService, CreateArtifactInput};
use crate::services::runtime_manager::RuntimeManager;
use std::path::PathBuf;
use tauri::{Manager, State};

#[tauri::command]
pub async fn generate_artifact(
    app_handle: tauri::AppHandle,
    input: CreateArtifactInput,
    db: State<'_, Database>,
    runtime_manager: State<'_, RuntimeManager>,
) -> Result<Artifact, AppError> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Io("Cannot get app data dir".to_string()))?;
    let artifacts_dir = data_dir.join("artifacts");

    let python = if matches!(input.artifact_type.as_str(), "pptx" | "pdf") {
        Some(
            runtime_manager
                .resolve_platform_capability(&db, "bob-work.artifact-runtime", "python")?
                .executable
                .map(PathBuf::from)
                .ok_or_else(|| AppError::NotFound("Shared Python Runtime executable".into()))?,
        )
    } else {
        None
    };

    ArtifactGeneratorService::new().generate_with_python(
        &db,
        input,
        &artifacts_dir,
        python.as_deref(),
    )
}

#[tauri::command]
pub async fn get_artifacts_list(db: State<'_, Database>) -> Result<Vec<Artifact>, AppError> {
    crate::services::artifact::ArtifactService::new().get_all(&db, None)
}
