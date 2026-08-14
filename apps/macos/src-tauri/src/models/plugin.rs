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
pub struct ConnectionTestSummary {
    pub ok: bool,
    pub message: String,
    pub tested_at: String,
    #[serde(default)]
    pub tools: Vec<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_test: Option<ConnectionTestSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMcpTestResult {
    pub id: String,
    pub name: String,
    pub ok: bool,
    pub message: String,
    pub tools: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tested_at: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginResourceStatus {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub optional: bool,
    /// ready | needs_key | needs_setup | inactive | always_on
    pub state: String,
    pub message: String,
    pub setup_hint: Option<String>,
    /// integrations | apis | mcp — where the UI should send the user to configure this source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configure_tab: Option<String>,
    /// Environment variable name when kind is api-key (e.g. FINNHUB_API_KEY).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_key: Option<String>,
    /// Suggested HTTPS base URL when configuring via Intégrations → APIs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configure_url: Option<String>,
}
