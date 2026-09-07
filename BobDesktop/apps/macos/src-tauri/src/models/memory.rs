use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistentMemory {
    pub id: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub content: String,
    pub source_conversation_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoryInput {
    pub scope: String,
    pub project_id: Option<String>,
    pub content: String,
}
