use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub scope: String,
    pub category: String,
    pub manifest: serde_json::Value,
    pub install_state: String,
    pub validation_state: String,
    pub signature: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_executed_at: Option<String>,
    pub available_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginVersion {
    pub plugin_id: String,
    pub version: String,
    pub release_notes: Option<String>,
    pub created_at: String,
    pub installed_at: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginVersionDiff {
    pub from_version: String,
    pub to_version: String,
    pub changes: Vec<String>,
    pub warnings: Vec<String>,
    pub permissions_changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePluginInput {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub scope: Option<String>,
    pub category: String,
    pub manifest: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginValidationResult {
    pub valid: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub risk_level: String,
    pub dangerous_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMcpStatus {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub transport: String,
    pub tools: Vec<String>,
    pub configured: bool,
    pub enabled: bool,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginIntegrationStatus {
    pub provider: String,
    pub name: String,
    pub auth_type: String,
    pub scopes: Vec<String>,
    pub state: String,
    pub required: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginBrowserStatus {
    pub id: String,
    pub name: String,
    pub capability: String,
    pub state: String,
    pub required: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHookStatus {
    pub id: String,
    pub name: String,
    pub event: String,
    pub enabled: bool,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginScheduleTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub instructions: String,
    pub cron_or_event: String,
    pub plugin_or_mode: Option<String>,
    pub offline_behavior: String,
    pub overlap_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginExtensionStatus {
    pub integrations: Vec<PluginIntegrationStatus>,
    pub browser_extensions: Vec<PluginBrowserStatus>,
    pub hooks: Vec<PluginHookStatus>,
    pub scheduled_task_templates: Vec<PluginScheduleTemplate>,
}
