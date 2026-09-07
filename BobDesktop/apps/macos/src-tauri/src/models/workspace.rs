use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub snippet: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub source_path: String,
    pub scope: String,
    pub enabled: bool,
    /// Optional local key (`designer`) or HTTPS favicon URL.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon: String,
    /// Deployed by a Bob Work built-in plugin (`builtin-*`) or integration skill.
    #[serde(default)]
    pub builtin: bool,
    /// Filesystem birth time of `SKILL.md` when available.
    #[serde(default)]
    pub created_at: String,
    /// Filesystem mtime of `SKILL.md`.
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSkillInput {
    pub slug: String,
    pub description: String,
    pub content: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    pub transport: String,
    pub command_or_url: String,
    pub args: Vec<String>,
    pub enabled: bool,
    /// Managed by Bob Work or one of its built-in plugins.
    #[serde(default)]
    pub builtin: bool,
    pub status: String,
    pub raw: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_test: Option<crate::models::plugin::ConnectionTestSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMcpServerInput {
    #[serde(default)]
    pub original_name: Option<String>,
    pub name: String,
    pub transport: String,
    pub command_or_url: String,
    pub args: Vec<String>,
    pub enabled: bool,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    pub env_remove: Vec<String>,
    #[serde(default)]
    pub headers: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssl: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redis_index: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warehouse: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contact_points: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyspace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

impl Default for DbConnectionConfig {
    fn default() -> Self {
        Self {
            host: None,
            port: None,
            database: None,
            username: None,
            ssl: None,
            file_path: None,
            uri: None,
            redis_index: None,
            url: None,
            account: None,
            warehouse: None,
            contact_points: None,
            keyspace: None,
            region: None,
            project_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnection {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub config: DbConnectionConfig,
    pub has_secret: bool,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_test: Option<crate::models::plugin::ConnectionTestSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDbConnectionInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub engine: String,
    #[serde(default)]
    pub config: DbConnectionConfig,
    #[serde(default)]
    pub secret: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnectionTestResult {
    pub ok: bool,
    pub message: String,
    pub tested_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionGrant {
    pub id: String,
    pub action_type: String,
    pub resource: String,
    pub scope: String,
    pub scope_id: Option<String>,
    pub decision: String,
    pub expires_at: Option<String>,
    pub revoked_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePermissionGrantInput {
    pub action_type: String,
    pub resource: String,
    pub scope: String,
    pub scope_id: Option<String>,
    pub decision: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatus {
    pub available: bool,
    pub used_amount: Option<f64>,
    pub remaining_amount: Option<f64>,
    pub total_amount: Option<f64>,
    pub unit: Option<String>,
    pub captured_at: Option<String>,
    pub instance_label: Option<String>,
    #[serde(default)]
    pub account_email: Option<String>,
    #[serde(default)]
    pub instance_name: Option<String>,
    pub message: String,
}
