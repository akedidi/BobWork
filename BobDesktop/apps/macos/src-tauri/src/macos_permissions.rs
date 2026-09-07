//! macOS permission registration for Bob Work's own process identity.
//!
//! Chrome / Computer Use MCP helpers still launch as `python3`, but AppleScript
//! must execute inside Bob Work via `macos_applescript_bridge` so Accessibility /
//! Automation TCC attaches to `com.bobwork.desktop` — never python3/osascript.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::sync::mpsc;

use block2::RcBlock;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{AnyThread, ClassType};
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
use objc2_foundation::{
    NSAppleScript, NSAppleScriptErrorMessage, NSDictionary, NSObject, NSString,
};
use objc2_speech::{SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus};

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

/// Mirrors AVAuthorizationStatus for the microphone in a UI-safe format.
///
/// WebKit's getUserMedia prompt is not consistently surfaced by WKWebView.
/// Asking AVFoundation from Bob Work's process ensures macOS presents the
/// first-run TCC prompt for the correct app identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicrophoneAuthorization {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
}

impl MicrophoneAuthorization {
    pub fn key(self) -> &'static str {
        match self {
            Self::NotDetermined => "not_determined",
            Self::Denied => "denied",
            Self::Restricted => "restricted",
            Self::Authorized => "authorized",
        }
    }

    pub fn is_authorized(self) -> bool {
        matches!(self, Self::Authorized)
    }
}

fn audio_media_type() -> Result<&'static objc2_av_foundation::AVMediaType, String> {
    // AVMediaTypeAudio is a framework constant and is present on every
    // supported macOS release. The generated binding exposes it as optional
    // because it is an external Objective-C symbol.
    unsafe { AVMediaTypeAudio.as_ref() }
        .ok_or_else(|| "Le type audio AVFoundation est indisponible.".into())
        .copied()
}

fn map_microphone_status(status: AVAuthorizationStatus) -> MicrophoneAuthorization {
    match status {
        AVAuthorizationStatus::Authorized => MicrophoneAuthorization::Authorized,
        AVAuthorizationStatus::Denied => MicrophoneAuthorization::Denied,
        AVAuthorizationStatus::Restricted => MicrophoneAuthorization::Restricted,
        _ => MicrophoneAuthorization::NotDetermined,
    }
}

pub fn microphone_authorization() -> Result<MicrophoneAuthorization, String> {
    let media_type = audio_media_type()?;
    Ok(map_microphone_status(unsafe {
        AVCaptureDevice::authorizationStatusForMediaType(media_type)
    }))
}

/// Requests microphone access for Bob Work and waits for macOS's response.
/// macOS only displays its sheet once; later calls simply return the stored
/// decision, which lets the UI route a refusal to System Settings.
pub fn request_microphone_access() -> Result<MicrophoneAuthorization, String> {
    let current = microphone_authorization()?;
    if current != MicrophoneAuthorization::NotDetermined {
        return Ok(current);
    }

    let media_type = audio_media_type()?;
    let (tx, rx) = mpsc::channel::<bool>();
    let handler = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(granted.as_bool());
    });
    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &handler);
    }
    // Keep the Objective-C block alive until AVFoundation has called it.
    let granted = rx
        .recv()
        .map_err(|error| format!("La demande microphone n’a pas abouti : {error}"))?;
    if granted {
        Ok(MicrophoneAuthorization::Authorized)
    } else {
        microphone_authorization()
    }
}

/// Mirrors SFSpeechRecognizerAuthorizationStatus for the dictation flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpeechRecognitionAuthorization {
    NotDetermined,
    Denied,
    Restricted,
    Authorized,
}

impl SpeechRecognitionAuthorization {
    pub fn key(self) -> &'static str {
        match self {
            Self::NotDetermined => "not_determined",
            Self::Denied => "denied",
            Self::Restricted => "restricted",
            Self::Authorized => "authorized",
        }
    }
}

fn map_speech_status(
    status: SFSpeechRecognizerAuthorizationStatus,
) -> SpeechRecognitionAuthorization {
    match status {
        SFSpeechRecognizerAuthorizationStatus::Authorized => {
            SpeechRecognitionAuthorization::Authorized
        }
        SFSpeechRecognizerAuthorizationStatus::Denied => SpeechRecognitionAuthorization::Denied,
        SFSpeechRecognizerAuthorizationStatus::Restricted => {
            SpeechRecognitionAuthorization::Restricted
        }
        _ => SpeechRecognitionAuthorization::NotDetermined,
    }
}

pub fn speech_recognition_authorization() -> SpeechRecognitionAuthorization {
    map_speech_status(unsafe { SFSpeechRecognizer::authorizationStatus() })
}

/// Requests Apple's Speech Recognition authorization when it has not already
/// been decided. This is separate from microphone permission on macOS.
pub fn request_speech_recognition_access() -> Result<SpeechRecognitionAuthorization, String> {
    let current = speech_recognition_authorization();
    if current != SpeechRecognitionAuthorization::NotDetermined {
        return Ok(current);
    }

    let (tx, rx) = mpsc::channel::<SpeechRecognitionAuthorization>();
    let handler = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
        let _ = tx.send(map_speech_status(status));
    });
    unsafe {
        SFSpeechRecognizer::requestAuthorization(&handler);
    }
    rx.recv()
        .map_err(|error| format!("La demande de reconnaissance vocale n’a pas abouti : {error}"))
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
    let descriptor: Option<Retained<AnyObject>> =
        unsafe { objc2::msg_send_id![&script, executeAndReturnError: Some(&mut error_info)] };

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

    let text: Option<Retained<NSString>> = unsafe {
        if let Some(desc) = descriptor {
            msg_send![&*desc, stringValue]
        } else {
            None
        }
    };
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
