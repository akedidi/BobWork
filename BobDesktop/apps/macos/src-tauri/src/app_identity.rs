//! Runtime identity for Bob Work vs Bob Work-test.
//!
//! Keep these constants aligned with:
//! - `tauri.conf.json` / `tauri.test.conf.json`
//! - `scripts/app-identity.sh`
//! - `scripts/verify-release-bundle.mjs`

use std::sync::OnceLock;

pub const PROD_PRODUCT_NAME: &str = "Bob Work";
pub const PROD_IDENTIFIER: &str = "com.bobwork.desktop";
pub const PROD_EXECUTABLE: &str = "bob-work";
pub const TEST_PRODUCT_NAME: &str = "Bob Work-test";
pub const TEST_IDENTIFIER: &str = "com.bobwork.desktop.test";
pub const TEST_EXECUTABLE: &str = "bob-work-test";

static APP_DISPLAY_NAME: OnceLock<String> = OnceLock::new();

pub fn set_app_display_name(name: impl Into<String>) {
    let name = name.into();
    if !name.trim().is_empty() {
        let _ = APP_DISPLAY_NAME.set(name);
    }
}

/// Prefer the running bundle's display name over Cargo/`package_info` (often `bob-work`).
pub fn init_app_display_name(package_name: impl Into<String>) {
    let package_name = package_name.into();
    let detected = detect_app_display_name();
    let chosen = if detected != PROD_PRODUCT_NAME {
        detected
    } else if package_name.to_ascii_lowercase().contains("test") {
        TEST_PRODUCT_NAME.into()
    } else if package_name == PROD_EXECUTABLE || package_name.is_empty() {
        PROD_PRODUCT_NAME.into()
    } else {
        package_name
    };
    set_app_display_name(chosen);
}

pub fn app_display_name() -> String {
    APP_DISPLAY_NAME
        .get()
        .cloned()
        .unwrap_or_else(detect_app_display_name)
}

pub fn is_test_build() -> bool {
    bundle_identifier() == TEST_IDENTIFIER
        || app_display_name() == TEST_PRODUCT_NAME
        || current_exe_looks_like_test()
}

pub fn bundle_identifier() -> String {
    if let Ok(exe) = std::env::current_exe() {
        let path = exe.to_string_lossy();
        if path.contains("Bob Work-test.app") || path.contains(TEST_EXECUTABLE) {
            return TEST_IDENTIFIER.into();
        }
        if let Some(id) = bundle_plist_string(&exe, "CFBundleIdentifier") {
            return id;
        }
    }
    PROD_IDENTIFIER.into()
}

/// Env keys that identify the running Bob Work vs Bob Work-test process.
/// Global `mcp.json` must not leak the last writer's socket/bundle into the other app.
pub fn is_runtime_identity_env_key(key: &str) -> bool {
    matches!(
        key,
        "BOB_WORK_APPLESCRIPT_SOCKET" | "BOB_WORK_APP_NAME" | "BOB_WORK_BUNDLE_ID"
    )
}

pub fn runtime_identity_env() -> Vec<(String, String)> {
    vec![
        ("BOB_WORK_APP_NAME".into(), app_display_name()),
        ("BOB_WORK_BUNDLE_ID".into(), bundle_identifier()),
    ]
}

/// Prefix for UNUserNotificationCenter request ids (must stay distinct per app).
pub fn notification_id_prefix() -> &'static str {
    if is_test_build() {
        "bob-work-test|"
    } else {
        "bob-work|"
    }
}

fn current_exe_looks_like_test() -> bool {
    std::env::current_exe()
        .ok()
        .map(|exe| {
            let path = exe.to_string_lossy();
            path.contains("Bob Work-test.app") || path.contains(TEST_EXECUTABLE)
        })
        .unwrap_or(false)
}

fn detect_app_display_name() -> String {
    if let Ok(exe) = std::env::current_exe() {
        let path = exe.to_string_lossy();
        if path.contains("Bob Work-test.app") || path.contains(TEST_EXECUTABLE) {
            return TEST_PRODUCT_NAME.into();
        }
        if let Some(name) = bundle_plist_string(&exe, "CFBundleDisplayName")
            .or_else(|| bundle_plist_string(&exe, "CFBundleName"))
        {
            return name;
        }
    }
    PROD_PRODUCT_NAME.into()
}

fn bundle_plist_string(exe: &std::path::Path, key: &str) -> Option<String> {
    let macos_dir = exe.parent()?;
    let contents = macos_dir.parent()?;
    if !contents.ends_with("Contents") {
        return None;
    }
    let text = std::fs::read_to_string(contents.join("Info.plist")).ok()?;
    plist_string(&text, key)
}

fn plist_string(plist: &str, key: &str) -> Option<String> {
    let needle = format!("<key>{key}</key>");
    let start = plist.find(&needle)? + needle.len();
    let after = plist[start..].trim_start();
    let inner = after.strip_prefix("<string>")?;
    let value = inner.split("</string>").next()?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plist_reads_display_name() {
        let plist = r#"
            <key>CFBundleDisplayName</key>
            <string>Bob Work-test</string>
            <key>CFBundleName</key>
            <string>bob-work</string>
        "#;
        assert_eq!(
            plist_string(plist, "CFBundleDisplayName").as_deref(),
            Some("Bob Work-test")
        );
    }

    #[test]
    fn runtime_identity_keys_cover_shared_mcp_env() {
        assert!(is_runtime_identity_env_key("BOB_WORK_APPLESCRIPT_SOCKET"));
        assert!(is_runtime_identity_env_key("BOB_WORK_APP_NAME"));
        assert!(is_runtime_identity_env_key("BOB_WORK_BUNDLE_ID"));
        assert!(!is_runtime_identity_env_key("FINNHUB_API_KEY"));
    }

    #[test]
    fn identity_constants_stay_distinct() {
        assert_ne!(PROD_IDENTIFIER, TEST_IDENTIFIER);
        assert_ne!(PROD_EXECUTABLE, TEST_EXECUTABLE);
        assert_ne!(PROD_PRODUCT_NAME, TEST_PRODUCT_NAME);
        assert!(TEST_IDENTIFIER.ends_with(".test"));
        assert!(TEST_EXECUTABLE.ends_with("-test"));
    }
}
