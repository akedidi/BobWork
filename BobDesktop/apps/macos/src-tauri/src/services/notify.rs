//! Local + system notifications for Bob Work.
//!
//! Both the in-app feed and macOS banners respect `notifications_enabled`.
//! On macOS, banners go through `UNUserNotificationCenter` so Bob Work
//! appears under System Settings → Notifications.

use crate::db::Database;
use crate::services::settings::SettingsService;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

const INBOX_CAP: usize = 40;

/// In-memory feed so the UI can hydrate notifications missed before `listen()`.
#[derive(Default)]
pub struct NotificationInbox {
    items: Mutex<VecDeque<AppNotificationEvent>>,
}

impl NotificationInbox {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, event: AppNotificationEvent) {
        if let Ok(mut items) = self.items.lock() {
            items.push_front(event);
            while items.len() > INBOX_CAP {
                items.pop_back();
            }
        }
    }

    pub fn list(&self) -> Vec<AppNotificationEvent> {
        self.items
            .lock()
            .map(|items| items.iter().cloned().collect())
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppNotificationEvent {
    pub id: String,
    pub title: String,
    pub body: String,
    pub kind: String,
    pub created_at: String,
    pub task_id: Option<String>,
    pub conversation_id: Option<String>,
}

pub fn push_notification<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    body: &str,
    kind: &str,
    task_id: Option<&str>,
    conversation_id: Option<&str>,
    require_notify_task_complete: bool,
) {
    let settings = app
        .try_state::<Database>()
        .and_then(|db| SettingsService::new().get(&db).ok());
    let notifications_enabled = settings
        .as_ref()
        .map(|value| value.notifications_enabled)
        .unwrap_or(true);
    let notify_task_complete = settings
        .as_ref()
        .map(|value| value.notify_task_complete)
        .unwrap_or(true);
    if !notifications_enabled {
        return;
    }
    if require_notify_task_complete && !notify_task_complete {
        return;
    }

    // Keep banners readable while preserving the start of the reply/error.
    let body: String = {
        let trimmed = body.trim();
        let mut chars = trimmed.chars();
        let head: String = chars.by_ref().take(280).collect();
        if chars.next().is_some() {
            format!("{head}…")
        } else {
            head
        }
    };
    let event = AppNotificationEvent {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        body: body.clone(),
        kind: kind.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        task_id: task_id.map(str::to_string),
        conversation_id: conversation_id.map(str::to_string),
    };
    if let Some(inbox) = app.try_state::<NotificationInbox>() {
        inbox.push(event.clone());
    }
    let _ = app.emit("app-notification", &event);

    if let Err(error) = show_system_notification(app, title, &body, conversation_id, task_id) {
        tracing::warn!(
            "System notification failed (check macOS permission): {}",
            error
        );
    }
}

fn show_system_notification<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    body: &str,
    conversation_id: Option<&str>,
    task_id: Option<&str>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if crate::macos_notifications::is_available() {
            // Never block Tauri's event/UI thread while waiting for the
            // asynchronous UserNotifications completion handler.
            let title = title.to_string();
            let body = body.to_string();
            let conversation_id = conversation_id.map(str::to_string);
            let task_id = task_id.map(str::to_string);
            std::thread::spawn(move || {
                if let Err(error) = crate::macos_notifications::send(
                    &title,
                    &body,
                    conversation_id.as_deref(),
                    task_id.as_deref(),
                ) {
                    tracing::warn!("Native macOS notification failed: {}", error);
                }
            });
            return Ok(());
        }
        // Bare `tauri dev` / cargo run: UN crashes without a .app bundle.
        // Fall back to the plugin (may attribute to Terminal in some setups).
        tracing::debug!("UN unavailable outside .app; falling back to notification plugin");
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Body shown in the sidebar + macOS banner: the assistant reply and/or the error.
pub fn session_notification_body(success: bool, full_output: &str, error: Option<&str>) -> String {
    let reply = collapse_whitespace(full_output);
    let error = error
        .map(collapse_whitespace)
        .filter(|text| !text.is_empty());
    let generic_error = |text: &str| {
        matches!(
            text,
            "Bob Shell a renvoyé une erreur."
                | "Bob a terminé avec une erreur."
                | "Bob a signalé une erreur."
        ) || text.eq_ignore_ascii_case("error")
            || text.eq_ignore_ascii_case("erreur")
    };

    if success {
        if reply.is_empty() {
            "Bob a terminé sans texte de réponse.".into()
        } else {
            reply
        }
    } else {
        match (error.as_deref(), reply.is_empty()) {
            (Some(err), false) if !generic_error(err) && err != reply => {
                format!("{err}\n\n{reply}")
            }
            (Some(err), _) if !generic_error(err) => err.to_string(),
            (_, false) => reply,
            (Some(err), true) => err.to_string(),
            (None, true) => {
                "Bob Shell a renvoyé une erreur. Ouvrez le chat ou Tâches pour le détail.".into()
            }
        }
    }
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn notify_task_finished<R: Runtime>(
    app: &AppHandle<R>,
    success: bool,
    full_output: &str,
    error: Option<&str>,
    task_id: Option<&str>,
    conversation_id: Option<&str>,
) {
    let title = if success {
        "Réponse de Bob"
    } else {
        "Erreur Bob Shell"
    };
    let body = session_notification_body(success, full_output, error);
    if body.trim().is_empty() {
        return;
    }
    // Success respects « Notifier quand une tâche se termine ».
    // Failures always notify when the master notifications toggle is on.
    push_notification(
        app,
        title,
        &body,
        if success {
            "bob_completed"
        } else {
            "task_failed"
        },
        task_id,
        conversation_id,
        success,
    );
}

pub fn notify_approval_required<R: Runtime>(
    app: &AppHandle<R>,
    description: &str,
    task_id: Option<&str>,
    conversation_id: Option<&str>,
) {
    push_notification(
        app,
        "Bob attend votre autorisation",
        description,
        "approval",
        task_id,
        conversation_id,
        false,
    );
}

#[cfg(test)]
mod tests {
    use super::{session_notification_body, AppNotificationEvent, NotificationInbox};

    #[test]
    fn success_uses_reply_text() {
        let body = session_notification_body(true, "  Voici la synthèse  du contrat. ", None);
        assert_eq!(body, "Voici la synthèse du contrat.");
    }

    #[test]
    fn failure_prefers_concrete_error_then_reply() {
        let body = session_notification_body(
            false,
            "J’ai échoué à lire le fichier.",
            Some("Permission denied"),
        );
        assert!(body.starts_with("Permission denied"));
        assert!(body.contains("échoué"));
    }

    #[test]
    fn failure_skips_generic_error_when_reply_exists() {
        let body = session_notification_body(
            false,
            "Erreur API : quota dépassé.",
            Some("Bob Shell a renvoyé une erreur."),
        );
        assert_eq!(body, "Erreur API : quota dépassé.");
    }

    #[test]
    fn chat_and_task_titles_differ() {
        // Titles are chosen in notify_task_finished; keep body helpers honest for both.
        assert_eq!(
            session_notification_body(true, "Brief CTO prêt.", None),
            "Brief CTO prêt."
        );
        assert_eq!(
            session_notification_body(false, "", Some("timeout")),
            "timeout"
        );
    }

    #[test]
    fn inbox_keeps_newest_first_and_caps() {
        let inbox = NotificationInbox::new();
        for i in 0..45 {
            inbox.push(AppNotificationEvent {
                id: format!("n{i}"),
                title: "Réponse de Bob".into(),
                body: format!("msg {i}"),
                kind: "bob_completed".into(),
                created_at: "2026-08-13T00:00:00Z".into(),
                task_id: None,
                conversation_id: Some("c1".into()),
            });
        }
        let items = inbox.list();
        assert_eq!(items.len(), 40);
        assert_eq!(items[0].id, "n44");
        assert_eq!(items[39].id, "n5");
    }
}
