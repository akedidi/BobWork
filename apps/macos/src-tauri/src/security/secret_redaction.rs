#![allow(dead_code)]
use regex::Regex;

/// Redact secrets from text before logging or displaying
pub fn redact_secrets(text: &str) -> String {
    let mut result = text.to_string();

    // Simple bearer token pattern
    if let Ok(re) = Regex::new(r"(Bearer\s+)([a-zA-Z0-9_\-\.]{10,})") {
        result = re.replace_all(&result, "${1}***REDACTED***").to_string();
    }

    // API key pattern (api_key=VALUE or api-key=VALUE)
    if let Ok(re) = Regex::new(r"(?i)(api.{0,4}key\s*[=:]\s*)([a-zA-Z0-9_\-]{10,})") {
        result = re.replace_all(&result, "${1}***REDACTED***").to_string();
    }

    // Token pattern
    if let Ok(re) = Regex::new(r"(?i)(token\s*[=:]\s*)([a-zA-Z0-9_\-\.]{10,})") {
        result = re.replace_all(&result, "${1}***REDACTED***").to_string();
    }

    result
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
}
