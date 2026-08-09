use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub objective: Option<String>,
    pub color: Option<String>,
    pub image_url: Option<String>,
    pub local_path: Option<String>,
    pub custom_instructions: Option<String>,
    pub language: String,
    pub memory_enabled: bool,
    pub allowed_files: Vec<String>,
    pub allowed_plugins: Vec<String>,
    pub allowed_integrations: Vec<String>,
    pub default_mode: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub description: Option<String>,
    pub objective: Option<String>,
    pub color: Option<String>,
    pub local_path: Option<String>,
    pub custom_instructions: Option<String>,
    pub language: Option<String>,
    pub default_mode: Option<String>,
    pub template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub objective: Option<String>,
    pub color: Option<String>,
    pub local_path: Option<String>,
    pub custom_instructions: Option<String>,
    pub language: Option<String>,
    pub memory_enabled: Option<bool>,
    pub allowed_files: Option<Vec<String>>,
    pub allowed_plugins: Option<Vec<String>>,
    pub allowed_integrations: Option<Vec<String>>,
    pub default_mode: Option<String>,
}
