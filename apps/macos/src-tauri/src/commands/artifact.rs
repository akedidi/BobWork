use crate::db::Database;
use crate::error::AppError;
use crate::models::artifact::Artifact;
use crate::services::artifact::ArtifactService;
use tauri::{AppHandle, Emitter, Manager, State};

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
        let artifact_path = std::path::Path::new(&artifact.file_path);
        let inline_image = artifact_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "avif" | "gif" | "jpg" | "jpeg" | "png" | "svg" | "webp"
                )
            });
        if inline_image {
            app.asset_protocol_scope()
                .allow_file(artifact_path)
                .map_err(|error| {
                    AppError::Security(format!("Aperçu d’image locale refusé : {error}"))
                })?;
        }
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
