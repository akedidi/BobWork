//! Local AppleScript bridge so MCP runtimes (python) execute scripts
//! **inside Bob Work** (`com.bobwork.desktop`) instead of `/usr/bin/osascript`.
//!
//! That way Accessibility / Automation TCC prompts attach to Bob Work.

#![cfg(target_os = "macos")]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

static STARTED: AtomicBool = AtomicBool::new(false);
static POINTER_POSITION: Mutex<Option<(f64, f64)>> = Mutex::new(None);
static POINTER_GENERATION: AtomicU64 = AtomicU64::new(0);
/// Hide the ghost pointer only after this many milliseconds without a new action.
const POINTER_IDLE_HIDE_MS: u64 = 12_000;
/// Below this distance (logical px), snap instantly — UI micro-adjustments feel immediate.
const POINTER_SNAP_DISTANCE: f64 = 48.0;

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
    preserve_frontmost: Option<bool>,
    instant: Option<bool>,
    output_path: Option<String>,
    window_id: Option<String>,
    region: Option<String>,
}

#[derive(Debug, Serialize)]
struct BridgeResponse {
    ok: bool,
    stdout: String,
    stderr: String,
}

pub fn socket_file_name_for_bundle(bundle_id: &str) -> &'static str {
    if bundle_id == crate::app_identity::TEST_IDENTIFIER || bundle_id.ends_with(".test") {
        "applescript-test.sock"
    } else {
        "applescript.sock"
    }
}

pub fn socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os("BOB_WORK_BRIDGE_SOCKET") {
        return PathBuf::from(path);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".bob")
        .join("run")
        .join(socket_file_name_for_bundle(
            &crate::app_identity::bundle_identifier(),
        ))
}

pub fn socket_path_string() -> String {
    socket_path().to_string_lossy().into_owned()
}

/// Identity of the running GUI process so MCP children talk to this app's bridge,
/// not whichever Bob Work last wrote `~/.bob/settings/mcp.json`.
pub fn identity_env_pairs() -> Vec<(String, String)> {
    let mut pairs = crate::app_identity::runtime_identity_env();
    pairs.push((
        "BOB_WORK_APPLESCRIPT_SOCKET".into(),
        socket_path_string(),
    ));
    pairs
}

/// Apple Event from this GUI process on the main thread so Automation lists
/// the running app (Bob Work vs Bob Work-test), not a background helper.
pub fn request_chrome_automation_on_main_thread(app: &AppHandle) -> Result<(), String> {
    if !std::path::Path::new("/Applications/Google Chrome.app").exists() {
        return Err("Google Chrome n’est pas installé.".into());
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let consent = crate::macos_permissions::request_chrome_automation_consent(true);
        let result = match consent {
            Ok(()) => crate::macos_permissions::run_applescript(
                crate::macos_permissions::CHROME_AUTOMATION_SCRIPT,
            )
            .map(|_| ()),
            Err(error) => Err(error),
        };
        let _ = sender.send(result);
    })
    .map_err(|error| format!("Impossible de planifier Automatisation Chrome : {error}"))?;
    receiver
        .recv_timeout(Duration::from_secs(60))
        .map_err(|_| "Automatisation Chrome n’a pas répondu dans les 60 secondes.".to_string())?
}

pub fn probe_chrome_automation_on_main_thread(
    app: &AppHandle,
    app_name: &str,
) -> (String, String) {
    if !std::path::Path::new("/Applications/Google Chrome.app").exists() {
        return (
            "chrome_missing".into(),
            "Installez Google Chrome pour utiliser le contrôle navigateur.".into(),
        );
    }
    crate::macos_permissions::classify_chrome_automation(
        app_name,
        request_chrome_automation_on_main_thread(app),
    )
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
    // A second instance of the *same* app must never unlink the live bridge.
    // Bob Work and Bob Work-test use distinct sockets so Automation TCC
    // attaches to the app that actually sent the Apple Event.
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
    } else if request.action.as_deref() == Some("screencapture") {
        run_screencapture(&request)
    } else if let Some(script) = request.script.clone() {
        run_applescript_on_main_thread(app, script, request.preserve_frontmost.unwrap_or(true))
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
    // Native CGEvent input and pointer animation are safe off the UI thread.
    // Keeping this work on the bridge worker lets WebKit/macOS repaint every
    // intermediate pointer position instead of showing only the final frame.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_native_input(app, &request)
    }))
    .unwrap_or_else(|_| Err("Le contrôle natif macOS a rencontré une erreur interne.".into()))
}

fn store_pointer_position(x: f64, y: f64) {
    if let Ok(mut position) = POINTER_POSITION.lock() {
        *position = Some((x, y));
    }
}

fn current_pointer_position() -> Option<(f64, f64)> {
    POINTER_POSITION.lock().ok().and_then(|position| *position)
}

fn pointer_generation_active(generation: u64) -> bool {
    POINTER_GENERATION.load(Ordering::SeqCst) == generation
}

fn update_bob_pointer(app: &AppHandle, x: f64, y: f64, show: bool, click: bool, retarget: bool) {
    store_pointer_position(x, y);
    let dispatcher = app.clone();
    let window_app = app.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        let Some(pointer) = window_app.get_webview_window("bob-pointer") else {
            return;
        };
        // CGEvent coordinates are expressed in macOS logical points. Using a
        // logical Tauri position keeps the visible pointer aligned on Retina
        // and non-Retina displays alike.
        let _ = pointer.set_position(tauri::LogicalPosition::new(x, y));
        if show {
            let _ = pointer.show();
        }
        if retarget {
            let _ = pointer.eval("window.bobPointerRetarget && window.bobPointerRetarget()");
        }
        if click {
            let _ = pointer.eval("window.bobPointerClick && window.bobPointerClick()");
        }
    });
}

fn hide_bob_pointer(app: &AppHandle) {
    let dispatcher = app.clone();
    let window_app = app.clone();
    let _ = dispatcher.run_on_main_thread(move || {
        if let Some(pointer) = window_app.get_webview_window("bob-pointer") {
            let _ = pointer.hide();
        }
    });
}

fn schedule_pointer_idle_hide(app: &AppHandle, generation: u64) {
    let delayed_app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(POINTER_IDLE_HIDE_MS));
        if POINTER_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        hide_bob_pointer(&delayed_app);
    });
}

fn show_bob_pointer(app: &AppHandle, x: f64, y: f64, click: bool, instant: bool) {
    if app.get_webview_window("bob-pointer").is_none() {
        return;
    }
    let target = (x - 14.0, y - 12.0);
    let generation = POINTER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let start = current_pointer_position();

    let distance = start
        .map(|(sx, sy)| ((target.0 - sx).powi(2) + (target.1 - sy).powi(2)).sqrt())
        .unwrap_or(f64::INFINITY);
    let snap = instant || distance <= POINTER_SNAP_DISTANCE;

    if let Some((sx, sy)) = start {
        if !snap {
            update_bob_pointer(app, sx, sy, true, false, false);
            let steps = ((distance / 80.0).ceil() as u32).clamp(2, 7);
            for step in 1..=steps {
                if !pointer_generation_active(generation) {
                    return;
                }
                let progress = step as f64 / steps as f64;
                let eased = 1.0 - (1.0 - progress).powi(3);
                let current_x = sx + (target.0 - sx) * eased;
                let current_y = sy + (target.1 - sy) * eased;
                update_bob_pointer(app, current_x, current_y, true, false, false);
                thread::sleep(Duration::from_millis(6));
            }
        }
    }

    if !pointer_generation_active(generation) {
        return;
    }
    update_bob_pointer(app, target.0, target.1, true, click, snap);
    schedule_pointer_idle_hide(app, generation);
}

fn run_native_input(app: &AppHandle, request: &BridgeRequest) -> Result<String, String> {
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, ScrollEventUnit,
    };
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::CGPoint;

    if !crate::macos_permissions::accessibility_trusted() {
        let app_name = crate::app_identity::app_display_name();
        return Err(format!("{app_name} n’est pas autorisé dans Accessibilité."));
    }
    let source = || {
        CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| "Impossible de créer la source d’événements macOS.".to_string())
    };
    match request.action.as_deref() {
        Some("status") => Ok("accessibility granted".into()),
        Some("click") => {
            let point = CGPoint::new(request.x.unwrap_or(0.0), request.y.unwrap_or(0.0));
            show_bob_pointer(app, point.x, point.y, true, false);
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
                request.instant.unwrap_or(false),
            );
            Ok("indicated".into())
        }
        Some("pointer_hide") => {
            POINTER_GENERATION.fetch_add(1, Ordering::SeqCst);
            hide_bob_pointer(app);
            Ok("pointer hidden".into())
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
                show_bob_pointer(app, x, y, false, false);
            }
            event.post(CGEventTapLocation::HID);
            Ok("scrolled".into())
        }
        Some("type") => {
            let text = request.text.as_deref().unwrap_or("");
            // Some native apps (notably Calculator) consume only the first
            // character when a whole string is attached to one keyboard event.
            // Emit a complete key-down/key-up pair per Unicode scalar instead.
            for character in text.chars() {
                let value = character.to_string();
                let down = CGEvent::new_keyboard_event(source()?, 0, true)
                    .map_err(|_| "Impossible de créer la saisie macOS.".to_string())?;
                down.set_string(&value);
                down.post(CGEventTapLocation::HID);
                let up = CGEvent::new_keyboard_event(source()?, 0, false)
                    .map_err(|_| "Impossible de terminer la saisie macOS.".to_string())?;
                up.set_string(&value);
                up.post(CGEventTapLocation::HID);
                thread::sleep(Duration::from_millis(12));
            }
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

/// Spawn `/usr/sbin/screencapture` from this GUI process so Screen Recording
/// TCC lists Bob Work / Bob Work-test, never python3.
fn run_screencapture(request: &BridgeRequest) -> Result<String, String> {
    let output = request
        .output_path
        .as_deref()
        .or(request.text.as_deref())
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "Chemin de capture manquant.".to_string())?;
    let executable = "/usr/sbin/screencapture";
    if !std::path::Path::new(executable).exists() {
        return Err("screencapture_unavailable".into());
    }
    let mut command = std::process::Command::new(executable);
    command.arg("-x");
    if let Some(format) = request.operation.as_deref() {
        if matches!(format, "png" | "jpg" | "jpeg" | "pdf") {
            command.arg("-t").arg(format);
        }
    }
    if let Some(region) = request.region.as_deref().filter(|value| !value.is_empty()) {
        command.arg("-o");
        command.arg(format!("-R{region}"));
    } else if let Some(window_id) = request
        .window_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        command.arg("-l").arg(window_id);
    }
    command.arg(output);
    let completed = command
        .output()
        .map_err(|error| format!("screencapture: {error}"))?;
    if !completed.status.success() {
        let stderr = String::from_utf8_lossy(&completed.stderr);
        let stdout = String::from_utf8_lossy(&completed.stdout);
        let message = stderr.trim();
        if message.is_empty() {
            return Err(if stdout.trim().is_empty() {
                "screen_recording_permission_required".into()
            } else {
                stdout.trim().to_string()
            });
        }
        return Err(message.to_string());
    }
    if !std::path::Path::new(output).is_file() {
        return Err("screencapture n’a pas écrit le fichier.".into());
    }
    Ok(output.to_string())
}

/// Apple Event to System Events from the GUI main thread so Accessibility /
/// Automation lists the running app, not a background helper.
pub fn probe_system_events_on_main_thread(app: &AppHandle) -> String {
    let script =
        r#"tell application "System Events" to get name of first process whose frontmost is true"#
            .to_string();
    match run_applescript_on_main_thread(app, script, true) {
        Ok(_) => "granted".into(),
        Err(message) => {
            let lower = message.to_ascii_lowercase();
            if lower.contains("not allowed")
                || lower.contains("not authorized")
                || lower.contains("autorisation")
                || lower.contains("(-1719)")
                || lower.contains("1002")
            {
                "denied".into()
            } else {
                "unknown".into()
            }
        }
    }
}

fn run_applescript_on_main_thread(
    app: &AppHandle,
    script: String,
    preserve_frontmost: bool,
) -> Result<String, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        use objc2_app_kit::{NSApplicationActivationOptions, NSWorkspace};

        let workspace = NSWorkspace::sharedWorkspace();
        let previous_frontmost = workspace.frontmostApplication();
        let result = crate::macos_permissions::run_applescript(&script);
        if preserve_frontmost {
            if let Some(previous) = previous_frontmost {
                // NSAppleScript may activate its owner, Bob Work, even for a
                // read-only AX query. Return focus to the user's target app.
                let _ = previous.activateWithOptions(NSApplicationActivationOptions::empty());
            }
        }
        let _ = sender.send(result);
    })
    .map_err(|error| format!("Impossible de planifier AppleScript : {error}"))?;
    receiver
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| "AppleScript n’a pas répondu dans les 30 secondes.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{computer_action_requires_approval, identity_env_pairs, socket_file_name_for_bundle};

    #[test]
    fn test_bundle_does_not_share_production_applescript_socket() {
        assert_eq!(
            socket_file_name_for_bundle("com.bobwork.desktop"),
            "applescript.sock"
        );
        assert_eq!(
            socket_file_name_for_bundle("com.bobwork.desktop.test"),
            "applescript-test.sock"
        );
    }

    #[test]
    fn identity_env_pairs_name_the_running_app() {
        let pairs = identity_env_pairs();
        let keys: Vec<_> = pairs.iter().map(|(key, _)| key.as_str()).collect();
        assert!(keys.contains(&"BOB_WORK_APPLESCRIPT_SOCKET"));
        assert!(keys.contains(&"BOB_WORK_APP_NAME"));
        assert!(keys.contains(&"BOB_WORK_BUNDLE_ID"));
        let socket = pairs
            .iter()
            .find(|(key, _)| key == "BOB_WORK_APPLESCRIPT_SOCKET")
            .map(|(_, value)| value.as_str())
            .unwrap_or_default();
        assert!(socket.contains("applescript.sock"));
    }

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
