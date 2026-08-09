use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub artifact_type: String,
    pub title: String,
    pub file_path: String,
    pub version: i64,
    pub preview_path: Option<String>,
    pub origin: Option<String>,
    pub sources: serde_json::Value,
    pub validation_status: String,
    pub validation_notes: Option<String>,
    pub exported: bool,
    pub created_at: String,
    pub size: Option<i64>,
}
