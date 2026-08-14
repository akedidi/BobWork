use crate::db::Database;
use crate::error::AppError;
use crate::models::artifact::Artifact;
use crate::services::artifact::ArtifactService;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_artifacts(db: State<'_, Database>) -> Result<Vec<Artifact>, AppError> {
    ArtifactService::new().get_all(&db, None)
}

#[tauri::command]
pub async fn get_artifact(
    id: String,
    db: State<'_, Database>,
) -> Result<Option<Artifact>, AppError> {
    ArtifactService::new().get_by_id(&db, &id)
}

#[tauri::command]
pub async fn delete_artifact(id: String, db: State<'_, Database>) -> Result<(), AppError> {
    ArtifactService::new().delete(&db, &id)
}

/// Register a file Bob Shell wrote outside the app artifacts folder (Desktop, …).
#[tauri::command]
pub async fn register_external_artifact(
    path: String,
    conversation_id: Option<String>,
    db: State<'_, Database>,
    app: AppHandle,
) -> Result<Option<Artifact>, AppError> {
    let artifact =
        ArtifactService::new().register_external(&db, &path, conversation_id.as_deref())?;
    if let Some(ref artifact) = artifact {
        let _ = app.emit("artifacts-updated", vec![artifact.id.clone()]);
    }
    Ok(artifact)
}

#[tauri::command]
pub async fn open_artifact(id: String, db: State<'_, Database>) -> Result<(), AppError> {
    if let Some(artifact) = ArtifactService::new().get_by_id(&db, &id)? {
        let path = std::path::Path::new(&artifact.file_path);
        if path.exists() {
            open::that(&artifact.file_path).map_err(|e| AppError::Io(e.to_string()))?;
        }
    }
    Ok(())
}
