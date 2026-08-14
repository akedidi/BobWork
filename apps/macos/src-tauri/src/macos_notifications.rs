//! macOS `UNUserNotificationCenter` wrapper.
//!
//! `tauri-plugin-notification` → notify-rust still uses the deprecated
//! `NSUserNotificationCenter` path. On modern macOS that often means:
//! - no real permission prompt
//! - no entry under System Settings → Notifications for Bob Work
//! - in `tauri dev`, banners attributed to Terminal (`com.apple.Terminal`)
//!
//! Talking to UserNotifications ourselves registers `com.bobwork.desktop`
//! (or the current .app bundle id) and shows banners correctly.
//!
//! Caveat: `UNUserNotificationCenter` **crashes** if the process is not a
//! real `.app` bundle (`bundleProxyForCurrentProcess is nil`). That happens
//! with bare `cargo run` / some `tauri dev` layouts under `target/debug/`.
//! Callers must check [`is_available`] first.

#![cfg(target_os = "macos")]

use std::ptr::NonNull;
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread};
use objc2_foundation::{ns_string, NSBundle, NSDictionary, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSettings, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthState {
    NotDetermined,
    Denied,
    Authorized,
    Provisional,
    Ephemeral,
}

impl AuthState {
    pub fn is_granted(self) -> bool {
        matches!(
            self,
            AuthState::Authorized | AuthState::Provisional | AuthState::Ephemeral
        )
    }
}

impl From<UNAuthorizationStatus> for AuthState {
    fn from(status: UNAuthorizationStatus) -> Self {
        match status {
            UNAuthorizationStatus::NotDetermined => AuthState::NotDetermined,
            UNAuthorizationStatus::Denied => AuthState::Denied,
            UNAuthorizationStatus::Authorized => AuthState::Authorized,
            UNAuthorizationStatus::Provisional => AuthState::Provisional,
            UNAuthorizationStatus::Ephemeral => AuthState::Ephemeral,
            _ => AuthState::NotDetermined,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationOpen {
    pub conversation_id: Option<String>,
    pub task_id: Option<String>,
}

type OpenHandler = Box<dyn Fn(NotificationOpen) + Send + Sync>;

static OPEN_HANDLER: Mutex<Option<OpenHandler>> = Mutex::new(None);
static PENDING_OPEN: Mutex<Option<NotificationOpen>> = Mutex::new(None);
static DELEGATE: OnceLock<Retained<BobWorkNotificationDelegate>> = OnceLock::new();

/// `true` when the process runs inside a `.app` (required by UN).
pub fn is_available() -> bool {
    let path = NSBundle::mainBundle().bundlePath().to_string();
    path.ends_with(".app") || path.contains(".app/")
}

fn require_app_bundle() -> Result<(), String> {
    if is_available() {
        Ok(())
    } else {
        Err(
            "Notifications système indisponibles hors bundle .app (ex. tauri dev / cargo run). Utilisez un build packagé pour enregistrer Bob Work dans Réglages → Notifications."
                .into(),
        )
    }
}

/// Prompt once (macOS caches the decision). Returns the live auth state.
pub fn request_authorization() -> Result<AuthState, String> {
    require_app_bundle()?;
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let options = UNAuthorizationOptions::Alert
        | UNAuthorizationOptions::Sound
        | UNAuthorizationOptions::Badge;

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let tx_clone = tx.clone();
    let handler = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
        let result = if error.is_null() {
            Ok(())
        } else {
            Err(ns_error_message(error))
        };
        let _ = tx_clone.send(result);
    });

    center.requestAuthorizationWithOptions_completionHandler(options, &handler);
    drop(tx);

    rx.recv()
        .map_err(|e| format!("UN auth completion never fired: {e}"))??;

    authorization_state()
}

/// Query without prompting.
pub fn authorization_state() -> Result<AuthState, String> {
    require_app_bundle()?;
    let center = UNUserNotificationCenter::currentNotificationCenter();

    let (tx, rx) = mpsc::channel::<AuthState>();
    let tx_clone = tx.clone();
    let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let state = unsafe { settings.as_ref().authorizationStatus() }.into();
        let _ = tx_clone.send(state);
    });

    center.getNotificationSettingsWithCompletionHandler(&handler);
    drop(tx);

    rx.recv()
        .map_err(|e| format!("UN settings completion never fired: {e}"))
}

/// Deliver immediately (no trigger). The delegate opts into banners while the
/// app is foregrounded; a click opens the related conversation.
pub fn send(
    title: &str,
    body: &str,
    conversation_id: Option<&str>,
    task_id: Option<&str>,
) -> Result<(), String> {
    require_app_bundle()?;
    // Required to opt into Banner/List/Sound while Bob Work is foregrounded.
    install_delegate();
    let center = UNUserNotificationCenter::currentNotificationCenter();

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    // `Sound` in the authorization/presentation options only permits sound;
    // the notification content must explicitly request one. Use the user's
    // macOS notification sound so task completion stays subtle and respects
    // system volume, Focus and per-app notification settings.
    let sound = UNNotificationSound::defaultSound();
    content.setSound(Some(&sound));

    let conv = conversation_id.unwrap_or("");
    let task = task_id.unwrap_or("");
    let conv_ns = NSString::from_str(conv);
    let task_ns = NSString::from_str(task);
    let user_info = NSDictionary::from_slices(
        &[ns_string!("conversationId"), ns_string!("taskId")],
        &[&*conv_ns, &*task_ns],
    );
    unsafe {
        content.setUserInfo((&*user_info).cast_unchecked());
    }

    let id_ns = NSString::from_str(&notification_identifier(conversation_id, task_id));
    let request =
        UNNotificationRequest::requestWithIdentifier_content_trigger(&id_ns, &content, None);

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let tx_clone = tx.clone();
    let handler = RcBlock::new(move |error: *mut NSError| {
        let result = if error.is_null() {
            Ok(())
        } else {
            Err(ns_error_message(error))
        };
        let _ = tx_clone.send(result);
    });

    center.addNotificationRequest_withCompletionHandler(&request, Some(&handler));
    drop(tx);

    rx.recv()
        .map_err(|e| format!("UN add completion never fired: {e}"))?
}

pub fn notification_identifier(conversation_id: Option<&str>, task_id: Option<&str>) -> String {
    format!(
        "bob-work|{}|{}|{}",
        conversation_id.unwrap_or(""),
        task_id.unwrap_or(""),
        monotonic_nanos()
    )
}

pub fn parse_notification_open(identifier: &str) -> NotificationOpen {
    let Some(rest) = identifier.strip_prefix("bob-work|") else {
        return NotificationOpen::default();
    };
    let mut parts = rest.splitn(3, '|');
    let conversation_id = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let task_id = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    NotificationOpen {
        conversation_id,
        task_id,
    }
}

pub fn take_pending_open() -> Option<NotificationOpen> {
    PENDING_OPEN.lock().ok()?.take()
}

/// Keep a strong delegate (UN's `delegate` is weak) and forward banner clicks.
pub fn set_open_handler(handler: impl Fn(NotificationOpen) + Send + Sync + 'static) {
    if let Ok(mut slot) = OPEN_HANDLER.lock() {
        *slot = Some(Box::new(handler));
    }
    if is_available() {
        install_delegate();
    }
}

fn dispatch_open(payload: NotificationOpen) {
    if let Ok(mut pending) = PENDING_OPEN.lock() {
        *pending = Some(payload.clone());
    }
    if let Ok(handler) = OPEN_HANDLER.lock() {
        if let Some(handler) = handler.as_ref() {
            handler(payload);
        }
    }
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "BobWorkNotificationDelegate"]
    struct BobWorkNotificationDelegate;

    unsafe impl NSObjectProtocol for BobWorkNotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for BobWorkNotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let identifier = response.notification().request().identifier().to_string();
            dispatch_open(parse_notification_open(&identifier));
            completion_handler.call(());
        }
    }
);

fn install_delegate() {
    DELEGATE.get_or_init(|| {
        let allocated = BobWorkNotificationDelegate::alloc().set_ivars(());
        let delegate: Retained<BobWorkNotificationDelegate> =
            unsafe { msg_send![super(allocated), init] };
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let protocol = ProtocolObject::from_ref(&*delegate);
        center.setDelegate(Some(protocol));
        delegate
    });
}

fn ns_error_message(error: *mut NSError) -> String {
    let err = unsafe { Retained::retain(error) };
    err.map(|e| e.localizedDescription().to_string())
        .unwrap_or_else(|| "unknown UN error".into())
}

fn monotonic_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{parse_notification_open, NotificationOpen};

    #[test]
    fn parses_conversation_and_task_from_identifier() {
        assert_eq!(
            parse_notification_open("bob-work|conv-1|task-9|123"),
            NotificationOpen {
                conversation_id: Some("conv-1".into()),
                task_id: Some("task-9".into()),
            }
        );
    }

    #[test]
    fn parses_conversation_only() {
        assert_eq!(
            parse_notification_open("bob-work|conv-1||99"),
            NotificationOpen {
                conversation_id: Some("conv-1".into()),
                task_id: None,
            }
        );
    }

    #[test]
    fn ignores_legacy_identifiers() {
        assert_eq!(
            parse_notification_open("bob-work-123456"),
            NotificationOpen {
                conversation_id: None,
                task_id: None,
            }
        );
    }
}
