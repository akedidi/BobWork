use crate::db::Database;
use crate::error::AppError;
use crate::models::artifact::Artifact;
use crate::services::artifact_generator::{ArtifactGeneratorService, CreateArtifactInput};
use crate::services::designer;
use serde::Deserialize;
use serde_json::Value;
use tauri::{Manager, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDesignerPreviewInput {
    pub title: String,
    pub document: Value,
    pub conversation_id: Option<String>,
}

/// Persists a canonical Design IR JSON alongside a self-contained, sandboxed
/// preview artifact. Clients render the HTML inline on desktop and mobile.
#[tauri::command]
pub async fn create_designer_preview(
    app_handle: tauri::AppHandle,
    input: CreateDesignerPreviewInput,
    db: State<'_, Database>,
) -> Result<(Artifact, Artifact, Artifact), AppError> {
    designer::validate_design_ir(&input.document)?;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Io("Cannot get app data dir".into()))?;
    let artifacts_dir = data_dir.join("artifacts");
    let source = ArtifactGeneratorService::new().generate(
        &db,
        CreateArtifactInput {
            artifact_type: "json".into(),
            title: format!("{} — Design IR", input.title),
            content: serde_json::to_string_pretty(&input.document)
                .map_err(|error| AppError::ValidationFailed(error.to_string()))?,
            conversation_id: input.conversation_id.clone(),
        },
        &artifacts_dir,
    )?;
    let preview = ArtifactGeneratorService::new().generate(
        &db,
        CreateArtifactInput {
            artifact_type: "html".into(),
            title: input.title.clone(),
            content: designer::render_html(&input.document)?,
            conversation_id: input.conversation_id.clone(),
        },
        &artifacts_dir,
    )?;
    let sketch = ArtifactGeneratorService::new().generate(
        &db,
        CreateArtifactInput {
            artifact_type: "sketch".into(),
            title: format!("{} — Sketch", input.title),
            content: serde_json::to_string(&input.document)
                .map_err(|error| AppError::Serialization(error.to_string()))?,
            conversation_id: input.conversation_id,
        },
        &artifacts_dir,
    )?;
    Ok((source, preview, sketch))
}
