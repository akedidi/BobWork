use regex::Regex;
use std::sync::LazyLock;

static PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
        (
            Regex::new(r"(?i)(Bearer\s+)([A-Za-z0-9_\-\.=+/]{8,})").expect("bearer"),
            "${1}***REDACTED***",
        ),
        (
            Regex::new(r"(?i)(Authorization:\s*Basic\s+)([A-Za-z0-9+/=]{8,})").expect("basic"),
            "${1}***REDACTED***",
        ),
        (
            Regex::new(r#"(?i)((?:access_token|refresh_token|id_token|client_secret|api[_-]?key|password|secret|token)\s*["']?\s*[=:]\s*["']?)([A-Za-z0-9_\-./+=]{8,})"#)
                .expect("labeled secret"),
            "${1}***REDACTED***",
        ),
        (
            Regex::new(r#"(?i)("(access_token|refresh_token|id_token|client_secret|api_key|apiKey|token|password|secret)"\s*:\s*")([^"]{8,})(")"#)
                .expect("json secret"),
            r#"${1}***REDACTED***${4}"#,
        ),
        (
            Regex::new(r"\b(xox[baprs]-)[A-Za-z0-9-]{10,}").expect("slack"),
            "${1}***REDACTED***",
        ),
        (
            Regex::new(r"\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}").expect("github"),
            "${1}***REDACTED***",
        ),
        (
            Regex::new(r"\b(sk-[A-Za-z0-9]{16,})").expect("sk"),
            "***REDACTED***",
        ),
        (
            Regex::new(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----")
                .expect("pem"),
            "***REDACTED_PRIVATE_KEY***",
        ),
    ]
});

/// Redact secrets from text before logging or displaying.
pub fn redact_secrets(text: &str) -> String {
    let mut result = text.to_string();
    for (re, replacement) in PATTERNS.iter() {
        result = re.replace_all(&result, *replacement).into_owned();
    }
    result
}

/// Recursively redact string values in parsed JSON (stdout stream-json).
pub fn redact_json(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(text) => {
            *text = redact_secrets(text);
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_json(item);
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values_mut() {
                redact_json(item);
            }
        }
        _ => {}
    }
}

/// Show only last N characters of a secret
pub fn mask_secret(secret: &str, visible_chars: usize) -> String {
    if secret.len() <= visible_chars {
        return "***".to_string();
    }
    let visible = &secret[secret.len() - visible_chars..];
    format!("****-{}", visible)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_secret() {
        let secret = "super-secret-api-key-1234";
        let masked = mask_secret(secret, 4);
        assert!(masked.ends_with("1234"));
        assert!(masked.starts_with("****-"));
    }

    #[test]
    fn test_mask_short_secret() {
        let secret = "abc";
        let masked = mask_secret(secret, 4);
        assert_eq!(masked, "***");
    }

    #[test]
    fn test_redact_bearer() {
        let text = "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6";
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("eyJhbGciOiJSUzI1NiIsInR5cCI6"));
        assert!(redacted.contains("REDACTED"));
    }

    #[test]
    fn test_redact_json_access_token() {
        let text = r#"{"access_token":"ya29.secret-value-abcdef","ok":true}"#;
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("ya29.secret-value-abcdef"));
        assert!(redacted.contains("***REDACTED***"));
        assert!(redacted.contains(r#""ok":true"#));
    }

    #[test]
    fn test_redact_slack_and_github() {
        let text = "xoxb-1234567890-abcdefghijk ghp_abcdefghijklmnopqrstuv";
        let redacted = redact_secrets(text);
        assert!(!redacted.contains("1234567890-abcdefghijk"));
        assert!(!redacted.contains("abcdefghijklmnopqrstuv"));
        assert!(redacted.contains("xoxb-"));
        assert!(redacted.contains("ghp_"));
    }

    #[test]
    fn test_redact_json_tree() {
        let mut value = serde_json::json!({
            "content": "token=super-secret-key-9999",
            "nested": { "api_key": "sk-abcdefghijklmnopqrstuvwxyz" }
        });
        redact_json(&mut value);
        let dumped = value.to_string();
        assert!(!dumped.contains("super-secret-key-9999"));
        assert!(!dumped.contains("sk-abcdefghijklmnopqrstuvwxyz"));
        assert!(dumped.contains("***REDACTED***"));
    }
}
