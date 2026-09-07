// ============================================================
// Native Bob context condensation (/condense)
// ============================================================

use serde::{Deserialize, Serialize};

pub const DEFAULT_AUTO_CONDENSE_THRESHOLD: f64 = 0.85;
pub const DEFAULT_CONTEXT_WINDOW: u64 = 128_000;
pub const AUTO_CONDENSE_COOLDOWN_SECS: f64 = 45.0;

/// Exact prompt Bob Work sends to `bob run`, matching the TUI command name.
pub const NATIVE_CONDENSE_PROMPT: &str = "/condense";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub tokens: u64,
    pub window: u64,
}

impl ContextUsage {
    pub fn ratio(&self) -> f64 {
        if self.window == 0 {
            return 0.0;
        }
        self.tokens as f64 / self.window as f64
    }
}

pub fn estimate_tokens(text: &str) -> u64 {
    (text.chars().count() as u64).div_ceil(4).max(1)
}

pub fn should_auto_condense(
    enabled: bool,
    usage: f64,
    threshold: f64,
    is_condensing: bool,
    seconds_since_last: Option<f64>,
    cooldown_secs: f64,
) -> bool {
    if !enabled || is_condensing {
        return false;
    }
    if !usage.is_finite() || usage < threshold {
        return false;
    }
    if let Some(elapsed) = seconds_since_last {
        if elapsed < cooldown_secs {
            return false;
        }
    }
    true
}

pub fn is_native_condense_command(message: &str) -> bool {
    let trimmed = message.trim();
    trimmed.eq_ignore_ascii_case("/condense") || trimmed.eq_ignore_ascii_case("/compact")
}

/// Slash commands go to Bob as-is. `/compact` is an alias for native `/condense`.
pub fn prompt_for_bob(message: &str) -> &str {
    if is_native_condense_command(message) {
        NATIVE_CONDENSE_PROMPT
    } else {
        message
    }
}

pub fn extract_context_usage(payload: &serde_json::Value) -> Option<ContextUsage> {
    let tokens = first_u64(
        payload,
        &[
            "contextTokens",
            "context_tokens",
            "input_tokens",
            "prompt_tokens",
        ],
    )?;
    let window = first_u64(
        payload,
        &["contextWindow", "context_window", "max_tokens", "limit"],
    )
    .unwrap_or(DEFAULT_CONTEXT_WINDOW);
    Some(ContextUsage { tokens, window })
}

fn first_u64(value: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    match value {
        serde_json::Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key).and_then(as_u64) {
                    return Some(found);
                }
            }
            for nested in map.values() {
                if let Some(found) = first_u64(nested, keys) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(items) => items.iter().find_map(|item| first_u64(item, keys)),
        _ => None,
    }
}

fn as_u64(value: &serde_json::Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|n| u64::try_from(n).ok()))
        .or_else(|| {
            value
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0.0)
                .map(|n| n.round() as u64)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_60_and_84_do_not_condense() {
        assert!(!should_auto_condense(
            true,
            0.60,
            0.85,
            false,
            None,
            AUTO_CONDENSE_COOLDOWN_SECS,
        ));
        assert!(!should_auto_condense(
            true,
            0.84,
            0.85,
            false,
            None,
            AUTO_CONDENSE_COOLDOWN_SECS,
        ));
    }

    #[test]
    fn threshold_86_triggers_condense() {
        assert!(should_auto_condense(
            true,
            0.86,
            0.85,
            false,
            None,
            AUTO_CONDENSE_COOLDOWN_SECS,
        ));
    }

    #[test]
    fn does_not_relaunch_while_condensing_or_during_cooldown() {
        assert!(!should_auto_condense(true, 0.90, 0.85, true, None, 45.0));
        assert!(!should_auto_condense(
            true,
            0.90,
            0.85,
            false,
            Some(10.0),
            45.0
        ));
        assert!(should_auto_condense(
            true,
            0.90,
            0.85,
            false,
            Some(46.0),
            45.0
        ));
    }

    #[test]
    fn disabled_setting_never_triggers() {
        assert!(!should_auto_condense(false, 0.99, 0.85, false, None, 45.0));
    }

    #[test]
    fn native_condense_command_detection() {
        assert!(is_native_condense_command(" /condense "));
        assert!(is_native_condense_command("/compact"));
        assert!(!is_native_condense_command(
            "/condense keep the authentication plan"
        ));
        assert!(!is_native_condense_command("/review"));
    }

    #[test]
    fn extracts_bob_spend_tokens() {
        let payload = serde_json::json!({
            "type": "usage",
            "usage": { "contextTokens": 110_080, "contextWindow": 128_000 }
        });
        let usage = extract_context_usage(&payload).expect("usage");
        assert_eq!(usage.tokens, 110_080);
        assert_eq!(usage.window, 128_000);
        assert!((usage.ratio() - 0.86).abs() < 0.01);
    }

    #[test]
    fn slash_condense_is_sent_as_native_command() {
        assert_eq!(prompt_for_bob(" /condense "), NATIVE_CONDENSE_PROMPT);
        assert_eq!(prompt_for_bob("/compact"), NATIVE_CONDENSE_PROMPT);
        assert_eq!(prompt_for_bob("continue the plan"), "continue the plan");
    }
}
