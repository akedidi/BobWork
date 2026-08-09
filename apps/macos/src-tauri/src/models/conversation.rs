use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    pub conversation_type: String,
    pub business_mode: Option<String>,
    pub bob_mode: Option<String>,
    pub date: String,
    pub pinned: bool,
    pub local_only: bool,
    pub summary: Option<String>,
    pub bob_context_state: serde_json::Value,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationInput {
    pub project_id: Option<String>,
    pub title: String,
    pub conversation_type: Option<String>,
    pub business_mode: Option<String>,
    pub bob_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub author: String,
    pub content: String,
    pub attachments: serde_json::Value,
    pub sources: serde_json::Value,
    pub citations: serde_json::Value,
    pub tools_used: serde_json::Value,
    pub send_state: String,
    pub errors: serde_json::Value,
    pub associated_artifacts: serde_json::Value,
    pub associated_approvals: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMessageInput {
    pub conversation_id: String,
    pub author: String,
    pub content: String,
    pub attachments: Option<serde_json::Value>,
    pub sources: Option<serde_json::Value>,
}
