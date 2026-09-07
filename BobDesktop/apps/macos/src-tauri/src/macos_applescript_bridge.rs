//! Local AppleScript bridge so MCP runtimes (python) execute scripts
//! **inside Bob Work** (`com.bobwork.desktop`) instead of `/usr/bin/osascript`.
//!
//! That way Accessibility / Automation TCC prompts attach to Bob Work.

#![cfg(target_os = "macos")]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Deserialize)]
struct BridgeRequest {
    script: Option<String>,
    action: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<String>,
    clicks: Option<u8>,
    text: Option<String>,
    key_code: Option<u16>,
    command: Option<bool>,
    shift: Option<bool>,
    option: Option<bool>,
    control: Option<bool>,
    delta_x: Option<i32>,
    delta_y: Option<i32>,
    operation: Option<String>,
    app_name: Option<String>,
    summary: Option<String>,
    risk_level: Option<String>,
    task_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct BridgeResponse {
    ok: bool,
    stdout: String,
    stderr: String,
}

pub fn socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os("BOB_WORK_BRIDGE_SOCKET") {
        return PathBuf::from(path);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".bob")
        .join("run")
        .join("applescript.sock")
}

pub fn socket_path_string() -> String {
    socket_path().to_string_lossy().into_owned()
}

/// Start the bridge once (idempotent). Safe to call from Tauri setup.
pub fn start(app: AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::Builder::new()
        .name("bob-work-applescript-bridge".into())
        .spawn(move || {
            if let Err(error) = serve_forever(app) {
                tracing::warn!("AppleScript bridge stopped: {error}");
                STARTED.store(false, Ordering::SeqCst);
            }
        })
        .ok();
}

fn serve_forever(app: AppHandle) -> Result<(), String> {
    let path = socket_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // A second Bob Work instance must never unlink the live bridge owned by the
    // first one. That left the first process running with an unreachable socket.
    if path.exists() {
        if UnixStream::connect(&path).is_ok() {
            tracing::info!(
                "AppleScript bridge already owned by another Bob Work instance at {}",
                path.display()
            );
            return Ok(());
        }
        // No listener: this is a stale socket left by a terminated instance.
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    let listener = UnixListener::bind(&path).map_err(|e| e.to_string())?;
    // Restrict to the current user.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    tracing::info!("AppleScript bridge listening on {}", path.display());

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if let Err(error) = handle_client(stream, &app) {
                    tracing::debug!("AppleScript bridge client error: {error}");
                }
            }
            Err(error) => {
                tracing::warn!("AppleScript bridge accept failed: {error}");
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
    Ok(())
}

fn handle_client(stream: UnixStream, app: &AppHandle) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(130)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&stream);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    if line.trim().is_empty() {
        return Ok(());
    }
    let request: BridgeRequest = serde_json::from_str(line.trim()).map_err(|e| e.to_string())?;
    let result = if request.action.as_deref() == Some("authorize") {
        authorize_computer_action(app, &request)
    } else if let Some(script) = request.script.clone() {
        run_applescript_on_main_thread(app, script)
    } else {
        run_native_input_on_main_thread(app, request)
    };
    let response = match result {
        Ok(stdout) => BridgeResponse {
            ok: true,
            stdout,
            stderr: String::new(),
        },
        Err(stderr) => BridgeResponse {
            ok: false,
            stdout: String::new(),
            stderr,
        },
    };
    let mut payload = serde_json::to_string(&response).map_err(|e| e.to_string())?;
    payload.push('\n');
    let mut writer = &stream;
    writer
        .write_all(payload.as_bytes())
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn authorize_computer_action(app: &AppHandle, request: &BridgeRequest) -> Result<String, String> {
    let db = app.state::<crate::db::Database>();
    let settings = crate::services::settings::SettingsService::new()
        .get(&db)
        .map_err(|error| error.to_string())?;
    let risk = request.risk_level.as_deref().unwrap_or("medium");
    let must_ask = computer_action_requires_approval(&settings.permission_policy, risk);
    if !must_ask {
        return Ok("authorized by policy".into());
    }
    let task_id = request.task_id.as_deref().unwrap_or("").trim();
    if task_id.is_empty() {
        return Err("Action Computer Use refusée : aucune tâche active ne permet d’afficher une validation dans le chat.".into());
    }
    let operation = request.operation.as_deref().unwrap_or("action");
    let app_name = request.app_name.as_deref().unwrap_or("application");
    let resource = format!("{app_name}:{operation}");
    if crate::services::permission_governance::has_allow_grant(
        &db,
        "computer.use",
        &resource,
        Some(task_id),
    )
    .unwrap_or(false)
    {
        return Ok("authorized by grant".into());
    }

    let approval = crate::models::approval::Approval {
        id: format!("appr_computer_{}", uuid::Uuid::new_v4()),
        task_id: task_id.to_string(),
        action_type: "computer.use".into(),
        human_description: request
            .summary
            .clone()
            .unwrap_or_else(|| format!("Bob souhaite agir dans {app_name}.")),
        command_or_change: Some(resource),
        data_accessed: serde_json::json!([]),
        files_affected: serde_json::json!([]),
        network_destination: None,
        risk_level: if matches!(risk, "low" | "medium" | "high" | "critical") {
            risk.into()
        } else {
            "medium".into()
        },
        decision: "pending".into(),
        permission_duration: None,
        decided_by: None,
        decided_at: None,
        undo_possible: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO approvals (id, task_id, action_type, human_description, command_or_change, data_accessed, files_affected, network_destination, risk_level, decision, permission_duration, decided_by, decided_at, undo_possible, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, 'pending', NULL, NULL, NULL, 0, ?9)",
            rusqlite::params![
                approval.id,
                approval.task_id,
                approval.action_type,
                approval.human_description,
                approval.command_or_change,
                approval.data_accessed.to_string(),
                approval.files_affected.to_string(),
                approval.risk_level,
                approval.created_at,
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    let _ = app.emit("approval-required", &approval);
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    while std::time::Instant::now() < deadline {
        thread::sleep(Duration::from_millis(150));
        let (decision, task_state) = {
            let conn = db.conn.lock().unwrap();
            let decision = conn
                .query_row(
                    "SELECT decision FROM approvals WHERE id = ?1",
                    rusqlite::params![&approval.id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap_or_else(|_| "denied".into());
            let task_state = conn
                .query_row(
                    "SELECT state FROM tasks WHERE id = ?1",
                    rusqlite::params![task_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap_or_else(|_| "cancelled".into());
            (decision, task_state)
        };
        if matches!(task_state.as_str(), "cancelled" | "failed") {
            return Err("Action Computer Use interrompue avec la tâche.".into());
        }
        match decision.as_str() {
            "approved" | "modified" => return Ok("authorized".into()),
            "denied" => return Err("Action Computer Use refusée par l’utilisateur.".into()),
            _ => {}
        }
    }
    let conn = db.conn.lock().unwrap();
    let _ = conn.execute(
        "UPDATE approvals SET decision = 'denied', decided_at = ?1 WHERE id = ?2 AND decision = 'pending'",
        rusqlite::params![chrono::Utc::now().to_rfc3339(), &approval.id],
    );
    Err("Validation Computer Use expirée après 120 secondes.".into())
}

fn computer_action_requires_approval(policy: &str, risk: &str) -> bool {
    match crate::services::permission_governance::normalize_policy(policy) {
        "never_ask" => false,
        "ask_for_important" => matches!(risk, "high" | "critical"),
        _ => true,
    }
}

fn run_native_input_on_main_thread(
    app: &AppHandle,
    request: BridgeRequest,
) -> Result<String, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_native_input(&app_handle, &request)
        }))
        .unwrap_or_else(|_| Err("Le contrôle natif macOS a rencontré une erreur interne.".into()));
        let _ = sender.send(result);
    })
    .map_err(|error| format!("Impossible de planifier l’action native : {error}"))?;
    receiver
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| "L’action native macOS n’a pas répondu dans les 30 secondes.".to_string())?
}

fn show_bob_pointer(app: &AppHandle, x: f64, y: f64, click: bool) {
    let Some(pointer) = app.get_webview_window("bob-pointer") else {
        return;
    };
    let _ = pointer.set_position(tauri::PhysicalPosition::new(
        (x - 14.0).round() as i32,
        (y - 12.0).round() as i32,
    ));
    let _ = pointer.show();
    if click {
        let _ = pointer.eval("window.bobPointerClick && window.bobPointerClick()");
    }
    let delayed = pointer.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(if click { 850 } else { 500 }));
        let _ = delayed.hide();
    });
}

fn run_native_input(app: &AppHandle, request: &BridgeRequest) -> Result<String, String> {
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, ScrollEventUnit,
    };
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::CGPoint;

    if !crate::macos_permissions::accessibility_trusted() {
        return Err("Bob Work n’est pas autorisé dans Accessibilité.".into());
    }
    let source = || {
        CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| "Impossible de créer la source d’événements macOS.".to_string())
    };
    match request.action.as_deref() {
        Some("status") => Ok("accessibility granted".into()),
        Some("click") => {
            let point = CGPoint::new(request.x.unwrap_or(0.0), request.y.unwrap_or(0.0));
            show_bob_pointer(app, point.x, point.y, true);
            thread::sleep(Duration::from_millis(120));
            let right = request.button.as_deref() == Some("right");
            let button = if right {
                CGMouseButton::Right
            } else {
                CGMouseButton::Left
            };
            let down_type = if right {
                CGEventType::RightMouseDown
            } else {
                CGEventType::LeftMouseDown
            };
            let up_type = if right {
                CGEventType::RightMouseUp
            } else {
                CGEventType::LeftMouseUp
            };
            for _ in 0..request.clicks.unwrap_or(1).clamp(1, 2) {
                CGEvent::new_mouse_event(source()?, down_type, point, button)
                    .map_err(|_| "Impossible de créer le clic macOS.".to_string())?
                    .post(CGEventTapLocation::HID);
                CGEvent::new_mouse_event(source()?, up_type, point, button)
                    .map_err(|_| "Impossible de terminer le clic macOS.".to_string())?
                    .post(CGEventTapLocation::HID);
                thread::sleep(Duration::from_millis(120));
            }
            Ok("clicked".into())
        }
        Some("indicate") => {
            show_bob_pointer(
                app,
                request.x.unwrap_or(0.0),
                request.y.unwrap_or(0.0),
                request.clicks.unwrap_or(0) > 0,
            );
            Ok("indicated".into())
        }
        Some("scroll") => {
            let delta_y = request.delta_y.unwrap_or(0).clamp(-1200, 1200);
            let delta_x = request.delta_x.unwrap_or(0).clamp(-1200, 1200);
            let event = CGEvent::new_scroll_event(
                source()?,
                ScrollEventUnit::PIXEL,
                2,
                delta_y,
                delta_x,
                0,
            )
            .map_err(|_| "Impossible de créer le défilement macOS.".to_string())?;
            if let (Some(x), Some(y)) = (request.x, request.y) {
                event.set_location(CGPoint::new(x, y));
                show_bob_pointer(app, x, y, false);
            }
            event.post(CGEventTapLocation::HID);
            Ok("scrolled".into())
        }
        Some("type") => {
            let text = request.text.as_deref().unwrap_or("");
            let down = CGEvent::new_keyboard_event(source()?, 0, true)
                .map_err(|_| "Impossible de créer la saisie macOS.".to_string())?;
            down.set_string(text);
            down.post(CGEventTapLocation::HID);
            CGEvent::new_keyboard_event(source()?, 0, false)
                .map_err(|_| "Impossible de terminer la saisie macOS.".to_string())?
                .post(CGEventTapLocation::HID);
            Ok("typed".into())
        }
        Some("key") => {
            let key_code = request
                .key_code
                .ok_or_else(|| "key_code manquant".to_string())?;
            let mut flags = CGEventFlags::empty();
            if request.command.unwrap_or(false) {
                flags |= CGEventFlags::CGEventFlagCommand;
            }
            if request.shift.unwrap_or(false) {
                flags |= CGEventFlags::CGEventFlagShift;
            }
            if request.option.unwrap_or(false) {
                flags |= CGEventFlags::CGEventFlagAlternate;
            }
            if request.control.unwrap_or(false) {
                flags |= CGEventFlags::CGEventFlagControl;
            }
            for down_state in [true, false] {
                let event = CGEvent::new_keyboard_event(source()?, key_code, down_state)
                    .map_err(|_| "Impossible de créer la touche macOS.".to_string())?;
                event.set_flags(flags);
                event.post(CGEventTapLocation::HID);
            }
            Ok("key pressed".into())
        }
        _ => Err("Action native inconnue.".into()),
    }
}

fn run_applescript_on_main_thread(app: &AppHandle, script: String) -> Result<String, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(crate::macos_permissions::run_applescript(&script));
    })
    .map_err(|error| format!("Impossible de planifier AppleScript : {error}"))?;
    receiver
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| "AppleScript n’a pas répondu dans les 30 secondes.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::computer_action_requires_approval;

    #[test]
    fn computer_action_gate_follows_permission_policy_and_risk() {
        assert!(!computer_action_requires_approval("never_ask", "critical"));
        assert!(!computer_action_requires_approval(
            "ask_for_important",
            "low"
        ));
        assert!(computer_action_requires_approval(
            "ask_for_important",
            "high"
        ));
        assert!(computer_action_requires_approval(
            "ask_for_modifications",
            "low"
        ));
        assert!(computer_action_requires_approval("always_ask", "low"));
    }
}
