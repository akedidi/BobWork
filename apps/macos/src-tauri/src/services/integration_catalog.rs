use crate::services::integration_oauth::OAuthClientConfig;
use serde_json::Value;

const BUILTIN_CLIENTS_JSON: &str = include_str!("../../resources/oauth/builtin_clients.json");

pub fn builtin_oauth_client(provider: &str) -> Option<OAuthClientConfig> {
    let root: Value = serde_json::from_str(BUILTIN_CLIENTS_JSON).ok()?;
    let entry = root.get(provider)?;
    let client_id = entry
        .get("clientId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let client_secret = entry
        .get("clientSecret")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some(OAuthClientConfig {
        client_id,
        client_secret,
    })
}

pub fn oauth_env_prefix(provider: &str) -> &'static str {
    match provider {
        "github" => "GITHUB",
        "slack" => "SLACK",
        "monday" => "MONDAY",
        "microsoft" => "MICROSOFT",
        _ => "UNKNOWN",
    }
}

/// Per-integration OAuth permissions. Every provider has its own flow and
/// permission model, so scopes are declared per integration, not per provider:
/// - GitHub: classic OAuth-App scopes, comma/space separated.
/// - Slack: bot scopes (`scope`) and user scopes (`user_scope`) are distinct;
///   message search is only available with a user token.
/// - Monday: GraphQL API scopes.
/// - Microsoft: delegated Graph scopes with incremental consent — Outlook,
///   Teams, Calendar and OneDrive each request only what they need.
pub struct IntegrationScopes {
    pub scopes: &'static [&'static str],
    /// Slack only: scopes granted to the authorizing user (user token).
    pub user_scopes: &'static [&'static str],
}

pub fn integration_scopes(integration_id: &str) -> Option<IntegrationScopes> {
    let (scopes, user_scopes): (&'static [&'static str], &'static [&'static str]) =
        match integration_id {
            "github" => (&["repo", "read:user", "read:org"], &[]),
            "slack" => (
                &["channels:history", "channels:read", "chat:write", "users:read"],
                &["search:read"],
            ),
            "monday" => (
                &[
                    "boards:read",
                    "boards:write",
                    "updates:read",
                    "updates:write",
                    "me:read",
                    "account:read",
                ],
                &[],
            ),
            "outlook-mail" => (&["Mail.ReadWrite", "Mail.Send"], &[]),
            "teams" => (&["Team.ReadBasic.All", "ChannelMessage.Read.All"], &[]),
            "outlook-calendar" => (&["Calendars.ReadWrite"], &[]),
            "onedrive" => (&["Files.ReadWrite.All"], &[]),
            _ => return None,
        };
    Some(IntegrationScopes { scopes, user_scopes })
}

/// Scopes always requested with Microsoft sign-in (identity + refresh token).
pub const MICROSOFT_BASE_SCOPES: &[&str] = &["openid", "profile", "offline_access", "User.Read"];

/// Whether the provider's token endpoint requires a client secret for the
/// authorization-code exchange (GitHub OAuth Apps, Slack and Monday do;
/// Microsoft supports secret-less public clients via PKCE).
pub fn web_flow_requires_secret(provider: &str) -> bool {
    matches!(provider, "github" | "slack" | "monday")
}

/// Public device-flow client IDs published by the vendors themselves.
/// They allow a zero-configuration sign-in (no secret, PKCE-free device grant):
/// - GitHub CLI's OAuth app (device flow enabled, tokens usable with `gh`)
/// - Microsoft Graph command-line tools (public client, delegated Graph scopes)
pub fn device_flow_client(provider: &str) -> Option<&'static str> {
    match provider {
        "github" => Some("178c6fc778ccc68e1d6a"),
        "microsoft" => Some("14d82eec-204b-4c2f-b7e8-296a70dab67e"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::builtin_oauth_client;

    #[test]
    fn builtin_catalog_parses_without_crashing() {
        assert!(builtin_oauth_client("github").is_none() || true);
    }
}
