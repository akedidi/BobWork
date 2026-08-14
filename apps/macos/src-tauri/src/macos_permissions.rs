//! macOS permission registration for Bob Work's own process identity.
//!
//! Chrome / Computer Use MCP helpers still launch as `python3`, but AppleScript
//! must execute inside Bob Work via `macos_applescript_bridge` so Accessibility /
//! Automation TCC attaches to `com.bobwork.desktop` — never python3/osascript.

#![cfg(target_os = "macos")]

use std::ffi::c_void;

use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{AnyThread, ClassType};
use objc2_foundation::{
    NSAppleScript, NSAppleScriptErrorMessage, NSDictionary, NSObject, NSString,
};

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> Bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> Bool;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: *const c_void;
}

pub fn accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }.as_bool()
}

/// Registers Bob Work under System Settings → Accessibility and may show the
/// system prompt. Return value is the *current* trust state (prompt is async).
pub fn request_accessibility() -> bool {
    if accessibility_trusted() {
        return true;
    }
    unsafe {
        let keys: [*mut AnyObject; 1] = [kAXTrustedCheckOptionPrompt as *mut AnyObject];
        let vals: [*mut AnyObject; 1] = [kCFBooleanTrue as *mut AnyObject];
        let dict: *mut AnyObject = msg_send![
            NSDictionary::<AnyObject, AnyObject>::class(),
            dictionaryWithObjects: vals.as_ptr(),
            forKeys: keys.as_ptr(),
            count: 1usize
        ];
        AXIsProcessTrustedWithOptions(dict.cast()).as_bool()
    }
}

pub fn run_applescript(source: &str) -> Result<String, String> {
    let ns_source = NSString::from_str(source);
    let script = NSAppleScript::initWithSource(NSAppleScript::alloc(), &ns_source)
        .ok_or_else(|| "Impossible de créer NSAppleScript".to_string())?;

    let mut error_info: Option<Retained<NSDictionary<NSString, AnyObject>>> = None;
    let descriptor = unsafe { script.executeAndReturnError(Some(&mut error_info)) };

    if let Some(info) = error_info {
        let message = unsafe {
            let value: Option<Retained<AnyObject>> =
                msg_send![&*info, objectForKey: &*NSAppleScriptErrorMessage];
            value
                .and_then(|obj| obj.downcast_ref::<NSString>().map(|s| s.to_string()))
                .unwrap_or_else(|| "AppleScript refusé".into())
        };
        return Err(message);
    }

    let text: Option<Retained<NSString>> = unsafe { msg_send![&*descriptor, stringValue] };
    Ok(text.map(|s| s.to_string()).unwrap_or_default())
}

/// Sends an Apple Event from Bob Work → Google Chrome so Automation lists
/// **Bob Work** (not osascript / python3).
pub fn request_chrome_automation() -> Result<(), String> {
    if !std::path::Path::new("/Applications/Google Chrome.app").exists() {
        return Err("Google Chrome n’est pas installé.".into());
    }
    let script = r#"tell application "Google Chrome"
  if (count of windows) = 0 then return "NO_WINDOW"
  return title of active tab of front window
end tell"#;
    run_applescript(script).map(|_| ())
}

pub fn probe_chrome_automation_in_process() -> (String, String) {
    if !std::path::Path::new("/Applications/Google Chrome.app").exists() {
        return (
            "chrome_missing".into(),
            "Installez Google Chrome pour utiliser le contrôle navigateur.".into(),
        );
    }
    match request_chrome_automation() {
        Ok(()) => (
            "granted".into(),
            "Automatisation accordée à Bob Work pour Google Chrome (actions via Bob Work).".into(),
        ),
        Err(message) => {
            let lower = message.to_ascii_lowercase();
            if lower.contains("not authorized")
                || lower.contains("autorisation")
                || lower.contains("(-1743)")
                || lower.contains("not allowed")
            {
                (
                    "denied".into(),
                    "Autorisez Bob Work → Google Chrome dans Réglages Système → Confidentialité et sécurité → Automatisation.".into(),
                )
            } else {
                (
                    "unknown".into(),
                    format!("Impossible de vérifier Automatisation : {message}"),
                )
            }
        }
    }
}

pub fn accessibility_status_for_app() -> (String, String) {
    if accessibility_trusted() {
        (
            "granted".into(),
            "Bob Work est autorisé dans Accessibilité (actions UI via Bob Work).".into(),
        )
    } else {
        (
            "denied".into(),
            "Autorisez Bob Work dans Réglages Système → Confidentialité et sécurité → Accessibilité.".into(),
        )
    }
}

// Keep NSObject visible for downcast helpers in some objc2 versions.
#[allow(dead_code)]
fn _nsobject_marker(_: &NSObject) {}
