// ============================================================
// Bob Work - Settings Service
// ============================================================
#![allow(dead_code)]

use crate::db::Database;
use crate::error::AppResult;
use crate::models::settings::AppSettings;
use chrono::Utc;
use rusqlite::params;

pub struct SettingsService;

impl SettingsService {
    pub fn new() -> Self {
        Self
    }

    pub fn get(&self, db: &Database) -> AppResult<AppSettings> {
        let conn = db.conn.lock().unwrap();
        let mut map = std::collections::HashMap::<String, String>::new();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (key, value) = row?;
            map.insert(key, value);
        }

        let get_val = |key: &str| -> Option<&String> { map.get(key) };

        Ok(AppSettings {
            theme: get_val("theme")
                .and_then(|v| serde_json::from_str(v).ok())
                .unwrap_or_else(|| "system".to_string()),
            language: get_val("language")
                .and_then(|v| serde_json::from_str(v).ok())
                .unwrap_or_else(|| "auto".to_string()),
            default_mode: get_val("default_mode")
                .and_then(|v| serde_json::from_str(v).ok())
                .unwrap_or_else(|| "general_work".to_string()),
            sidebar_width: get_val("sidebar_width")
                .and_then(|v| v.parse().ok())
                .unwrap_or(260),
            inspector_width: get_val("inspector_width")
                .and_then(|v| v.parse().ok())
                .unwrap_or(340),
            sidebar_visible: get_val("sidebar_visible")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            inspector_visible: get_val("inspector_visible")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            font_size: get_val("font_size")
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
            reduced_motion: get_val("reduced_motion")
                .map(|v| v.as_str() == "true")
                .unwrap_or(false),
            permission_policy: get_val("permission_policy")
                .and_then(|v| serde_json::from_str(v).ok())
                .unwrap_or_else(|| "ask_for_important".to_string()),
            launch_at_login: get_val("launch_at_login")
                .map(|v| v.as_str() == "true")
                .unwrap_or(false),
            menu_bar_enabled: get_val("menu_bar_enabled")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            global_hotkey: get_val("global_hotkey").and_then(|v| serde_json::from_str(v).ok()),
            global_instructions: get_val("global_instructions")
                .and_then(|v| serde_json::from_str(v).ok())
                .unwrap_or_default(),
            max_turns: get_val("max_turns")
                .and_then(|v| v.parse().ok())
                .unwrap_or(100),
            max_cost: get_val("max_cost")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0),
            mcp_enabled: get_val("mcp_enabled")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            subagents_enabled: get_val("subagents_enabled")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            web_enabled: get_val("web_enabled")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            notifications_enabled: get_val("notifications_enabled")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            notify_task_complete: get_val("notify_task_complete")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            voice_on_device: get_val("voice_on_device")
                .map(|v| v.as_str() == "true")
                .unwrap_or(true),
            task_retention_days: get_val("task_retention_days")
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            telemetry_enabled: get_val("telemetry_enabled")
                .map(|v| v.as_str() == "true")
                .unwrap_or(false),
            computer_use_enabled: get_val("computer_use_enabled")
                .map(|v| v.as_str() == "true")
                .unwrap_or(false),
            chrome_control_enabled: get_val("chrome_control_enabled")
                .map(|v| v.as_str() == "true")
                .unwrap_or(false),
            sandbox_mode: get_val("sandbox_mode")
                .map(|v| v.as_str() == "true")
                .unwrap_or(false),
            cross_conversation_context: get_val("cross_conversation_context")
                .map(|v| v.as_str() == "true")
                .unwrap_or(false),
        })
    }

    pub fn update_key(&self, db: &Database, key: &str, value: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn update_all(&self, db: &Database, settings: &AppSettings) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();

        let updates = vec![
            ("theme", serde_json::to_string(&settings.theme).unwrap()),
            (
                "language",
                serde_json::to_string(&settings.language).unwrap(),
            ),
            (
                "default_mode",
                serde_json::to_string(&settings.default_mode).unwrap(),
            ),
            ("sidebar_width", settings.sidebar_width.to_string()),
            ("inspector_width", settings.inspector_width.to_string()),
            ("sidebar_visible", settings.sidebar_visible.to_string()),
            ("inspector_visible", settings.inspector_visible.to_string()),
            ("font_size", settings.font_size.to_string()),
            ("reduced_motion", settings.reduced_motion.to_string()),
            (
                "permission_policy",
                serde_json::to_string(&settings.permission_policy).unwrap(),
            ),
            ("launch_at_login", settings.launch_at_login.to_string()),
            ("menu_bar_enabled", settings.menu_bar_enabled.to_string()),
            (
                "global_instructions",
                serde_json::to_string(&settings.global_instructions).unwrap(),
            ),
            ("max_turns", settings.max_turns.to_string()),
            ("max_cost", settings.max_cost.to_string()),
            ("mcp_enabled", settings.mcp_enabled.to_string()),
            ("subagents_enabled", settings.subagents_enabled.to_string()),
            ("web_enabled", settings.web_enabled.to_string()),
            (
                "notifications_enabled",
                settings.notifications_enabled.to_string(),
            ),
            (
                "notify_task_complete",
                settings.notify_task_complete.to_string(),
            ),
            ("voice_on_device", settings.voice_on_device.to_string()),
            (
                "task_retention_days",
                settings.task_retention_days.to_string(),
            ),
            ("telemetry_enabled", settings.telemetry_enabled.to_string()),
            (
                "computer_use_enabled",
                settings.computer_use_enabled.to_string(),
            ),
            (
                "chrome_control_enabled",
                settings.chrome_control_enabled.to_string(),
            ),
            ("sandbox_mode", settings.sandbox_mode.to_string()),
            (
                "cross_conversation_context",
                settings.cross_conversation_context.to_string(),
            ),
        ];

        for (key, value) in updates {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
                params![key, value, now],
            )?;
        }

        if let Some(hotkey) = &settings.global_hotkey {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
                params!["global_hotkey", serde_json::to_string(hotkey).unwrap(), now],
            )?;
        }

        Ok(())
    }
}
