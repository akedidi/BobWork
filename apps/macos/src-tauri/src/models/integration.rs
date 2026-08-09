#![allow(dead_code)]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Integration {
    pub id: String,
    pub provider: String,
    pub account: Option<String>,
    pub auth_type: String,
    pub scopes: serde_json::Value,
    pub available_tools: serde_json::Value,
    pub approval_permission: String,
    pub health_state: String,
    pub last_sync: Option<String>,
    pub allowed_projects: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}
