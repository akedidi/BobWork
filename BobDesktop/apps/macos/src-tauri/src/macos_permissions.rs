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
    /// Official Automation TCC registration API. Sending NSAppleScript alone
    /// can attribute events incorrectly when two apps share the same Mach-O
    /// basename (`bob-work`); this call pins consent to the running bundle.
    fn AEDeterminePermissionToAutomateTarget(
        target: *const AEDesc,
        type_: u32,
        id: u32,
        ask_user_if_needed: u8,
    ) -> i32;
    fn AECreateDesc(desc_type: u32, data_ptr: *const c_void, data_size: isize, result: *mut AEDesc)
        -> i32;
    fn AEDisposeDesc(desc: *mut AEDesc) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: *const c_void;
}

#[repr(C)]
struct AEDesc {
    descriptor_type: u32,
    data_handle: *mut c_void,
}

const TYPE_APPLICATION_BUNDLE_ID: u32 = u32::from_be_bytes(*b"bund");
const TYPE_WILDCARD: u32 = u32::from_be_bytes(*b"****");
const NO_ERR: i32 = 0;
const ERR_AE_EVENT_NOT_PERMITTED: i32 = -1743;
const ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT: i32 = -1744;
const CHROME_BUNDLE_ID: &str = "com.google.Chrome";

/// Ask macOS to record / prompt Automation for this process → Google Chrome.
/// Returns Ok(()) when already allowed, Err with a classified message otherwise.
pub fn request_chrome_automation_consent(ask_user: bool) -> Result<(), String> {
    if !std::path::Path::new("/Applications/Google Chrome.app").exists() {
        return Err("Google Chrome n’est pas installé.".into());
    }
    let mut target = AEDesc {
        descriptor_type: 0,
        data_handle: std::ptr::null_mut(),
    };
    let status = unsafe {
        let create = AECreateDesc(
            TYPE_APPLICATION_BUNDLE_ID,
            CHROME_BUNDLE_ID.as_ptr() as *const c_void,
            CHROME_BUNDLE_ID.len() as isize,
            &mut target,
        );
        if create != NO_ERR {
            return Err(format!(
                "Impossible de cibler Google Chrome pour Automatisation (AECreateDesc {create})."
            ));
        }
        let status = AEDeterminePermissionToAutomateTarget(
            &target,
            TYPE_WILDCARD,
            TYPE_WILDCARD,
            if ask_user { 1 } else { 0 },
        );
        AEDisposeDesc(&mut target);
        status
    };
    match status {
        NO_ERR => Ok(()),
        ERR_AE_EVENT_NOT_PERMITTED => Err("not authorized to send Apple events to Google Chrome (-1743)".into()),
        ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT => {
            Err("Automation would require user consent for Google Chrome (-1744)".into())
        }
        other => Err(format!(
            "Automatisation Google Chrome indisponible (statut {other})."
        )),
    }
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

pub const CHROME_AUTOMATION_SCRIPT: &str = r#"tell application "Google Chrome"
  if (count of windows) = 0 then return "NO_WINDOW"
  return title of active tab of front window
end tell"#;

/// Sends an Apple Event from this process → Google Chrome so Automation lists
/// the running app (Bob Work or Bob Work-test), never osascript / python3.
///
/// `ask_user` must be `true` only from an explicit UI action ("Request Automation").
/// Status checks / Recheck must pass `false` so opening Settings never pops TCC.
pub fn check_chrome_automation(ask_user: bool) -> Result<(), String> {
    request_chrome_automation_consent(ask_user)?;
    run_applescript(CHROME_AUTOMATION_SCRIPT).map(|_| ())
}

pub fn request_chrome_automation() -> Result<(), String> {
    check_chrome_automation(true)
}

pub fn probe_chrome_automation_in_process() -> (String, String) {
    probe_chrome_automation_in_process_for_app(&crate::app_identity::app_display_name())
}

pub fn probe_chrome_automation_in_process_for_app(app_name: &str) -> (String, String) {
    if !std::path::Path::new("/Applications/Google Chrome.app").exists() {
        return (
            "chrome_missing".into(),
            "Installez Google Chrome pour utiliser le contrôle navigateur.".into(),
        );
    }
    classify_chrome_automation(app_name, check_chrome_automation(false))
}

pub fn classify_chrome_automation(app_name: &str, result: Result<(), String>) -> (String, String) {
    match result {
        Ok(()) => (
            "granted".into(),
            format!(
                "Automatisation accordée à {app_name} pour Google Chrome (actions via {app_name})."
            ),
        ),
        Err(message) => {
            let lower = message.to_ascii_lowercase();
            if lower.contains("not authorized")
                || lower.contains("autorisation")
                || lower.contains("(-1743)")
                || lower.contains("not allowed")
            {
                ("denied".into(), automation_denied_message(app_name))
            } else if lower.contains("would require user consent") || lower.contains("(-1744)") {
                (
                    "unknown".into(),
                    format!(
                        "Automatisation non encore demandée pour {app_name} → Google Chrome. \
Cliquez « Demander Automatisation » pour afficher l’invite macOS."
                    ),
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

pub fn automation_denied_message(app_name: &str) -> String {
    format!("Autorisez {app_name} → Google Chrome dans Automatisation, puis cliquez « Revérifier ».")
}

#[cfg(test)]
mod tests {
    use super::{automation_denied_message, classify_chrome_automation};

    #[test]
    fn automation_denied_message_stays_short() {
        let message = automation_denied_message("Bob Work-test");
        assert!(message.contains("Bob Work-test"));
        assert!(!message.contains("Demander Automatisation"));
        assert!(message.len() < 160);
    }

    #[test]
    fn classify_silent_consent_needed_as_unknown_not_denied() {
        let (state, message) = classify_chrome_automation(
            "Bob Work",
            Err("Automation would require user consent for Google Chrome (-1744)".into()),
        );
        assert_eq!(state, "unknown");
        assert!(message.contains("Demander Automatisation"));
    }

    #[test]
    fn classify_not_authorized_as_denied() {
        let (state, _) = classify_chrome_automation(
            "Bob Work",
            Err("not authorized to send Apple events to Google Chrome (-1743)".into()),
        );
        assert_eq!(state, "denied");
    }
}

pub fn accessibility_status_for_app() -> (String, String) {
    accessibility_status_for_named_app(&crate::app_identity::app_display_name())
}

pub fn accessibility_status_for_named_app(app_name: &str) -> (String, String) {
    if accessibility_trusted() {
        (
            "granted".into(),
            format!("{app_name} est autorisé dans Accessibilité (Computer Use / actions UI)."),
        )
    } else {
        (
            "denied".into(),
            format!(
                "Autorisez {app_name} dans Réglages Système → Confidentialité et sécurité → Accessibilité. \
Requis pour Computer Use uniquement — pas pour le contrôle Chrome."
            ),
        )
    }
}

// Keep NSObject visible for downcast helpers in some objc2 versions.
#[allow(dead_code)]
fn _nsobject_marker(_: &NSObject) {}
