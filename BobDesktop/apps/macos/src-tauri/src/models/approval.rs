use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: String,
    pub task_id: String,
    pub action_type: String,
    pub human_description: String,
    pub command_or_change: Option<String>,
    pub data_accessed: serde_json::Value,
    pub files_affected: serde_json::Value,
    pub network_destination: Option<String>,
    pub risk_level: String,
    pub decision: String,
    pub permission_duration: Option<String>,
    pub decided_by: Option<String>,
    pub decided_at: Option<String>,
    pub undo_possible: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApprovalInput {
    pub decision: String,
    pub permission_duration: Option<String>,
    pub modified_command: Option<String>,
}
