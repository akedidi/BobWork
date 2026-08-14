//! Local AppleScript bridge so MCP runtimes (python) execute scripts
//! **inside Bob Work** (`com.bobwork.desktop`) instead of `/usr/bin/osascript`.
//!
//! That way Accessibility / Automation TCC prompts attach to Bob Work.

#![cfg(target_os = "macos")]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
struct BridgeRequest {
    script: String,
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
pub fn start() {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::Builder::new()
        .name("bob-work-applescript-bridge".into())
        .spawn(|| {
            if let Err(error) = serve_forever() {
                tracing::warn!("AppleScript bridge stopped: {error}");
                STARTED.store(false, Ordering::SeqCst);
            }
        })
        .ok();
}

fn serve_forever() -> Result<(), String> {
    let path = socket_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&path);
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
                if let Err(error) = handle_client(stream) {
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

fn handle_client(stream: UnixStream) -> Result<(), String> {
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
    let response = match crate::macos_permissions::run_applescript(&request.script) {
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
