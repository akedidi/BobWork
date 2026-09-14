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
use which::which;

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

    let mut python = None;
    let mut python_env = Vec::new();
    match input.artifact_type.as_str() {
        "pptx" => {
            let handle = runtime_manager.resolve_platform_capability(
                &db,
                "bob-work.artifact-runtime",
                "pptx",
            )?;
            python = handle
                .executable
                .map(PathBuf::from)
                .or_else(|| which::which("python3").ok());
            for (key, value) in handle.environment {
                python_env.push((key, value));
            }
        }
        "pdf" => {
            python = Some(
                runtime_manager
                    .resolve_platform_capability(&db, "bob-work.artifact-runtime", "python")?
                    .executable
                    .map(PathBuf::from)
                    .ok_or_else(|| AppError::NotFound("Shared Python Runtime executable".into()))?,
            );
        }
        _ => {}
    }

    let env_refs = python_env
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect::<Vec<_>>();

    ArtifactGeneratorService::new().generate_with_python(
        &db,
        input,
        &artifacts_dir,
        python.as_deref(),
        &env_refs,
    )
}

#[tauri::command]
pub async fn get_artifacts_list(db: State<'_, Database>) -> Result<Vec<Artifact>, AppError> {
    crate::services::artifact::ArtifactService::new().get_all(&db, None)
}
