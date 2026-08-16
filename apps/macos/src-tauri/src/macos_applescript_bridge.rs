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
use tauri::AppHandle;

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
}

#[derive(Debug, Serialize)]
struct BridgeResponse {
    ok: bool,
    stdout: String,
    stderr: String,
}

pub fn socket_path() -> PathBuf {
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
        .set_read_timeout(Some(Duration::from_secs(30)))
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
    let result = if let Some(script) = request.script.clone() {
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

fn run_native_input_on_main_thread(
    app: &AppHandle,
    request: BridgeRequest,
) -> Result<String, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_native_input(&request)
        }))
        .unwrap_or_else(|_| Err("Le contrôle natif macOS a rencontré une erreur interne.".into()));
        let _ = sender.send(result);
    })
    .map_err(|error| format!("Impossible de planifier l’action native : {error}"))?;
    receiver
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| "L’action native macOS n’a pas répondu dans les 30 secondes.".to_string())?
}

fn run_native_input(request: &BridgeRequest) -> Result<String, String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton};
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
            let right = request.button.as_deref() == Some("right");
            let button = if right { CGMouseButton::Right } else { CGMouseButton::Left };
            let down_type = if right { CGEventType::RightMouseDown } else { CGEventType::LeftMouseDown };
            let up_type = if right { CGEventType::RightMouseUp } else { CGEventType::LeftMouseUp };
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
            let key_code = request.key_code.ok_or_else(|| "key_code manquant".to_string())?;
            let mut flags = CGEventFlags::empty();
            if request.command.unwrap_or(false) { flags |= CGEventFlags::CGEventFlagCommand; }
            if request.shift.unwrap_or(false) { flags |= CGEventFlags::CGEventFlagShift; }
            if request.option.unwrap_or(false) { flags |= CGEventFlags::CGEventFlagAlternate; }
            if request.control.unwrap_or(false) { flags |= CGEventFlags::CGEventFlagControl; }
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
