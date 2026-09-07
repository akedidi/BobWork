use crate::services::integration_oauth::OAuthClientConfig;
use serde_json::Value;

const BUILTIN_CLIENTS_JSON: &str = include_str!("../../resources/oauth/builtin_clients.json");

pub fn builtin_oauth_client(provider: &str) -> Option<OAuthClientConfig> {
    let compiled_client_id = match provider {
        "github" => option_env!("BOBWORK_OAUTH_GITHUB_CLIENT_ID"),
        "slack" => option_env!("BOBWORK_OAUTH_SLACK_CLIENT_ID"),
        "monday" => option_env!("BOBWORK_OAUTH_MONDAY_CLIENT_ID"),
        "microsoft" => option_env!("BOBWORK_OAUTH_MICROSOFT_CLIENT_ID"),
        _ => None,
    }
    .map(str::trim)
    .filter(|value| !value.is_empty());
    if let Some(client_id) = compiled_client_id {
        return Some(OAuthClientConfig {
            client_id: client_id.to_string(),
            // Desktop/public OAuth clients must never embed a secret.
            client_secret: None,
        });
    }

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
            // ChatGPT-style Slack MCP authorize: rich `user_scope` + resource=
            // mcp.slack.com. Localhost PKCE cannot request bot scopes (ChatGPT
            // can, because its redirect is https://chatgpt.com) — leave `scope`
            // empty and put everything in user_scope for an xoxp- token.
            // Keep in sync with resources/oauth/slack_app_manifest.json.
            // Classic user scopes only — granular search:* scopes break Create from Manifest.
            "slack" => (
                &[],
                &[
                    "channels:history",
                    "channels:read",
                    "chat:write",
                    "files:read",
                    "groups:history",
                    "groups:read",
                    "im:history",
                    "im:read",
                    "mpim:history",
                    "mpim:read",
                    "search:read",
                    "users:read",
                ],
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
            "onenote" => (&["Notes.Read", "Notes.ReadWrite"], &[]),
            _ => return None,
        };
    Some(IntegrationScopes {
        scopes,
        user_scopes,
    })
}

/// Scopes always requested with Microsoft sign-in (identity + refresh token).
pub const MICROSOFT_BASE_SCOPES: &[&str] = &["openid", "profile", "offline_access", "User.Read"];

/// Whether the provider's token endpoint requires a client secret for the
/// authorization-code exchange. Slack, Microsoft and Monday MCP support
/// secret-less public clients via PKCE. GitHub OAuth Apps still require a
/// secret for the classic web exchange.
pub fn web_flow_requires_secret(provider: &str) -> bool {
    matches!(provider, "github")
}

/// Providers that use a public Client ID + PKCE (no client secret).
pub fn is_pkce_public_client(provider: &str) -> bool {
    matches!(provider, "slack" | "microsoft" | "monday")
}

/// Monday hosted MCP OAuth (same endpoints ChatGPT connectors use).
pub const MONDAY_MCP_AUTHORIZE_URL: &str = "https://mcp.monday.com/authorize";
pub const MONDAY_MCP_TOKEN_URL: &str = "https://mcp.monday.com/token";
pub const MONDAY_MCP_REGISTER_URL: &str = "https://mcp.monday.com/register";
pub const MONDAY_MCP_RESOURCE: &str = "https://mcp.monday.com/mcp";

/// Slack hosted MCP resource indicator (same as ChatGPT’s Slack connector).
/// Authorize stays on slack.com/oauth/v2/authorize with `resource` set here.
pub const SLACK_MCP_RESOURCE: &str = "https://mcp.slack.com";

/// Slack app manifest used to create a PKCE-enabled public client in one click.
/// After creation, only the Client ID is needed (no client secret).
pub fn slack_app_manifest_json() -> &'static str {
    include_str!("../../resources/oauth/slack_app_manifest.json")
}

/// Opens Slack's "Create New App from Manifest" page with Bob Work's PKCE app.
pub fn slack_create_app_url() -> String {
    let encoded = urlencoding_encode(slack_app_manifest_json());
    format!("https://api.slack.com/apps?new_app=1&manifest_json={encoded}")
}

/// Entra registration checklist for the Bob Work Microsoft public client.
pub fn microsoft_app_registration_json() -> &'static str {
    include_str!("../../resources/oauth/microsoft_app_registration.json")
}

/// Opens the Entra "App registrations" blade so the user can create the Bob Work
/// public client (PKCE + loopback redirect). Client ID is pasted once in Bob Work.
pub fn microsoft_create_app_url() -> String {
    "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade".into()
}

/// Opens the provider console to create a Bob Work OAuth app when no Client ID
/// is configured yet (same setup principle for every integration).
pub fn provider_setup_url(provider: &str) -> Option<String> {
    match provider {
        "slack" => Some(slack_create_app_url()),
        "microsoft" => Some(microsoft_create_app_url()),
        "github" => Some("https://github.com/settings/developers".into()),
        // Monday MCP uses Dynamic Client Registration — no Developer Center
        // visit required for the ChatGPT-style PKCE connect flow.
        "monday" => None,
        _ => None,
    }
}

fn urlencoding_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len() * 3);
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Public device-flow client IDs published by the vendors themselves.
/// Used only as a zero-config fallback when no Bob Work OAuth app is configured.
/// Microsoft intentionally has none: Graph PowerShell / Command Line Tools is
/// not a Bob Work app — Microsoft 365 uses web authorize + PKCE with a real
/// Bob Work Entra public client instead.
pub fn device_flow_client(provider: &str) -> Option<&'static str> {
    match provider {
        "github" => Some("178c6fc778ccc68e1d6a"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::builtin_oauth_client;

    #[test]
    fn builtin_catalog_parses_without_crashing() {
        let _ = builtin_oauth_client("github");
    }

    #[test]
    fn slack_microsoft_and_monday_are_pkce_public_clients() {
        assert!(!super::web_flow_requires_secret("slack"));
        assert!(!super::web_flow_requires_secret("microsoft"));
        assert!(!super::web_flow_requires_secret("monday"));
        assert!(super::is_pkce_public_client("slack"));
        assert!(super::is_pkce_public_client("microsoft"));
        assert!(super::is_pkce_public_client("monday"));
        assert!(super::web_flow_requires_secret("github"));
    }

    #[test]
    fn slack_create_app_url_embeds_manifest() {
        let url = super::slack_create_app_url();
        assert!(url.starts_with("https://api.slack.com/apps?new_app=1&manifest_json="));
        assert!(url.contains("Bob%20Work") || url.contains("Bob"));
        assert!(url.contains("pkce_enabled") || url.contains("pkce"));
    }

    #[test]
    fn microsoft_registration_guide_lists_loopback_redirect() {
        let guide = super::microsoft_app_registration_json();
        assert!(guide.contains("127.0.0.1:47823/oauth/callback"));
        assert!(guide.contains("isPublicClient"));
        assert!(guide.contains("Mail.ReadWrite"));
    }

    #[test]
    fn provider_setup_urls_cover_manual_oauth_providers() {
        assert!(super::provider_setup_url("slack")
            .unwrap()
            .contains("slack.com"));
        assert!(super::provider_setup_url("microsoft")
            .unwrap()
            .contains("entra.microsoft.com"));
        assert!(super::provider_setup_url("github")
            .unwrap()
            .contains("github.com"));
        assert!(super::provider_setup_url("monday").is_none());
    }

    #[test]
    fn microsoft_has_no_vendor_device_flow_fallback() {
        assert!(super::device_flow_client("github").is_some());
        assert!(super::device_flow_client("microsoft").is_none());
    }

    #[test]
    fn slack_scopes_are_user_only_for_desktop_pkce() {
        let scopes = super::integration_scopes("slack").expect("slack scopes");
        assert!(scopes.scopes.is_empty());
        assert!(scopes.user_scopes.contains(&"search:read"));
        assert!(scopes.user_scopes.contains(&"chat:write"));
    }
}
