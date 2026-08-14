use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub language: String,
    pub default_mode: String,
    pub sidebar_width: i64,
    pub inspector_width: i64,
    pub sidebar_visible: bool,
    pub inspector_visible: bool,
    pub font_size: i64,
    pub reduced_motion: bool,
    pub permission_policy: String,
    pub launch_at_login: bool,
    pub menu_bar_enabled: bool,
    pub global_hotkey: Option<String>,
    pub global_instructions: String,
    pub max_turns: i64,
    pub max_cost: f64,
    pub mcp_enabled: bool,
    pub subagents_enabled: bool,
    pub web_enabled: bool,
    pub notifications_enabled: bool,
    pub notify_task_complete: bool,
    pub voice_on_device: bool,
    pub task_retention_days: i64,
    pub telemetry_enabled: bool,
    pub computer_use_enabled: bool,
    pub chrome_control_enabled: bool,
    /// Confine bob run to the workspace (never pass `--trust`; no Computer Use / Chrome for the session).
    pub sandbox_mode: bool,
    /// When true, Bob Work may retrieve short excerpts from other conversations
    /// (same project when applicable) to enrich the prompt — ChatGPT-style.
    pub cross_conversation_context: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            language: "auto".to_string(),
            default_mode: "general_work".to_string(),
            sidebar_width: 260,
            inspector_width: 340,
            sidebar_visible: true,
            inspector_visible: true,
            font_size: 15,
            reduced_motion: false,
            permission_policy: "ask_for_important".to_string(),
            launch_at_login: false,
            menu_bar_enabled: true,
            global_hotkey: None,
            global_instructions: String::new(),
            max_turns: 100,
            max_cost: 0.0,
            mcp_enabled: true,
            subagents_enabled: true,
            web_enabled: true,
            notifications_enabled: true,
            notify_task_complete: true,
            voice_on_device: true,
            task_retention_days: 30,
            telemetry_enabled: false,
            computer_use_enabled: false,
            chrome_control_enabled: false,
            sandbox_mode: false,
            cross_conversation_context: false,
        }
    }
}
