use crate::db::Database;
use crate::error::AppError;
use crate::models::artifact::Artifact;
use crate::services::artifact::ArtifactService;
use tauri::State;

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
