// ============================================================
// Bob Work - Integration OAuth (PKCE + local callback)
// ============================================================

use crate::error::{AppError, AppResult};
use crate::services::integration_catalog::{
    builtin_oauth_client, device_flow_client, integration_scopes, oauth_env_prefix,
    web_flow_requires_secret, MICROSOFT_BASE_SCOPES,
};
use crate::services::keychain::KeychainService;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration as StdDuration;
use tracing::{info, warn};

pub const OAUTH_CALLBACK_PORT: u16 = 47_823;
pub const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:47823/oauth/callback";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenBundle {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub account_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthClientConfig {
    pub client_id: String,
    pub client_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationConnectionStatus {
    pub integration_id: String,
    pub connected: bool,
    pub auth_method: Option<String>,
    pub account_label: Option<String>,
    pub expires_at: Option<String>,
    pub oauth_client_configured: bool,
    pub device_flow_available: bool,
    /// False when a provider token exists but its granted scopes do not cover
    /// this integration (e.g. Microsoft 365 signed in for Outlook only, while
    /// Teams needs additional delegated permissions).
    pub scope_satisfied: bool,
}

/// Codes returned by the provider when a device-flow authorization starts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFlowStart {
    pub integration_id: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in_seconds: u64,
    #[serde(skip_serializing)]
    pub device_code: String,
    #[serde(skip_serializing)]
    pub poll_interval_seconds: u64,
    #[serde(skip_serializing)]
    pub client_id: String,
    #[serde(skip_serializing)]
    pub provider: &'static str,
}

#[derive(Debug, Clone)]
struct PendingOAuthSession {
    provider: &'static str,
    integration_id: String,
    state: String,
    code_verifier: String,
}

static PENDING_SESSIONS: OnceLock<Mutex<HashMap<String, PendingOAuthSession>>> = OnceLock::new();

fn pending_sessions() -> &'static Mutex<HashMap<String, PendingOAuthSession>> {
    PENDING_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct IntegrationOAuthService;

impl IntegrationOAuthService {
    pub fn new() -> Self {
        Self
    }

    pub fn provider_for(integration_id: &str) -> Option<&'static str> {
        match integration_id {
            "github" => Some("github"),
            "slack" => Some("slack"),
            "monday" => Some("monday"),
            "outlook-mail" | "teams" | "outlook-calendar" | "onedrive" => Some("microsoft"),
            _ => None,
        }
    }

    pub fn microsoft_integrations() -> &'static [&'static str] {
        &["outlook-mail", "teams", "outlook-calendar", "onedrive"]
    }

    fn token_vault_key(provider: &str) -> String {
        format!("oauth_tokens_{provider}")
    }

    fn client_id_vault_key(provider: &str) -> String {
        format!("oauth_client_{provider}_id")
    }

    fn client_secret_vault_key(provider: &str) -> String {
        format!("oauth_client_{provider}_secret")
    }

    pub fn get_client_config(&self, provider: &str) -> AppResult<Option<OAuthClientConfig>> {
        if let Some(config) = self.load_client_config_from_env_or_vault(provider)? {
            return Ok(Some(config));
        }
        Ok(builtin_oauth_client(provider))
    }

    pub fn oauth_provider_ready(&self, provider: &str) -> bool {
        self.get_client_config(provider)
            .ok()
            .flatten()
            .is_some()
    }

    fn load_client_config_from_env_or_vault(
        &self,
        provider: &str,
    ) -> AppResult<Option<OAuthClientConfig>> {
        let vault = KeychainService::new();
        let env_prefix = oauth_env_prefix(provider);
        let client_id = std::env::var(format!("BOBWORK_OAUTH_{env_prefix}_CLIENT_ID"))
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                vault
                    .get(&Self::client_id_vault_key(provider))
                    .ok()
                    .flatten()
            });
        let Some(client_id) = client_id else {
            return Ok(None);
        };
        let client_secret = std::env::var(format!("BOBWORK_OAUTH_{env_prefix}_CLIENT_SECRET"))
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                vault
                    .get(&Self::client_secret_vault_key(provider))
                    .ok()
                    .flatten()
            });
        Ok(Some(OAuthClientConfig {
            client_id,
            client_secret,
        }))
    }

    pub fn set_client_config(
        &self,
        provider: &str,
        client_id: &str,
        client_secret: Option<&str>,
    ) -> AppResult<()> {
        if client_id.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "L’identifiant client OAuth est obligatoire.".into(),
            ));
        }
        let vault = KeychainService::new();
        vault.set(&Self::client_id_vault_key(provider), client_id.trim())?;
        match client_secret.map(str::trim).filter(|value| !value.is_empty()) {
            Some(secret) => vault.set(&Self::client_secret_vault_key(provider), secret)?,
            None => {
                let _ = vault.delete(&Self::client_secret_vault_key(provider));
            }
        }
        Ok(())
    }

    pub fn clear_client_config(&self, provider: &str) -> AppResult<()> {
        let vault = KeychainService::new();
        let _ = vault.delete(&Self::client_id_vault_key(provider));
        let _ = vault.delete(&Self::client_secret_vault_key(provider));
        Ok(())
    }

    pub fn has_oauth_tokens(&self, provider: &str) -> bool {
        self.load_tokens(provider)
            .ok()
            .flatten()
            .is_some_and(|tokens| !tokens.access_token.is_empty())
    }

    pub fn has_connection(&self, integration_id: &str, legacy_secret_exists: bool) -> bool {
        if legacy_secret_exists {
            return true;
        }
        let Some(provider) = Self::provider_for(integration_id) else {
            return false;
        };
        self.has_oauth_tokens(provider)
    }

    pub fn device_flow_available(provider: &str) -> bool {
        device_flow_client(provider).is_some()
    }

    /// Parses a granted-scope string; providers use different separators
    /// (Microsoft: spaces, GitHub/Slack: commas).
    fn parse_scope_list(raw: &str) -> Vec<String> {
        raw.split([' ', ','])
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase)
            .collect()
    }

    /// Microsoft is the only provider whose single token backs several
    /// integrations, each with distinct Graph permissions. A token with an
    /// unknown scope (personal access token, E2E seed) is assumed sufficient.
    fn scopes_cover_integration(integration_id: &str, bundle: &OAuthTokenBundle) -> bool {
        if Self::provider_for(integration_id) != Some("microsoft") {
            return true;
        }
        let Some(raw) = bundle.scope.as_deref().filter(|value| !value.trim().is_empty()) else {
            return true;
        };
        let granted = Self::parse_scope_list(raw);
        let Some(required) = integration_scopes(integration_id) else {
            return true;
        };
        required
            .scopes
            .iter()
            .all(|scope| granted.iter().any(|value| value == &scope.to_lowercase()))
    }

    pub fn connection_status(
        &self,
        integration_id: &str,
        legacy_secret_exists: bool,
    ) -> IntegrationConnectionStatus {
        let provider = Self::provider_for(integration_id);
        let oauth_client_configured = provider
            .map(|value| self.oauth_provider_ready(value))
            .unwrap_or(false);
        let device_flow_available = provider
            .map(Self::device_flow_available)
            .unwrap_or(false);
        let tokens = provider
            .and_then(|value| self.load_tokens(value).ok().flatten());
        let scope_satisfied = tokens
            .as_ref()
            .map(|bundle| Self::scopes_cover_integration(integration_id, bundle))
            .unwrap_or(true);
        let connected = legacy_secret_exists || (tokens.is_some() && scope_satisfied);
        IntegrationConnectionStatus {
            integration_id: integration_id.to_string(),
            connected,
            auth_method: if tokens.is_some() {
                if tokens
                    .as_ref()
                    .and_then(|bundle| bundle.refresh_token.as_ref())
                    .filter(|value| !value.is_empty())
                    .is_some()
                {
                    Some("oauth".into())
                } else {
                    Some("token".into())
                }
            } else if legacy_secret_exists {
                Some("token".into())
            } else {
                None
            },
            account_label: tokens.as_ref().and_then(|bundle| bundle.account_label.clone()),
            expires_at: tokens.as_ref().and_then(|bundle| bundle.expires_at.clone()),
            oauth_client_configured,
            device_flow_available,
            scope_satisfied,
        }
    }

    pub fn clear_tokens(&self, provider: &str) -> AppResult<()> {
        KeychainService::new().delete(&Self::token_vault_key(provider))
    }

    pub fn clear_integration(&self, integration_id: &str) -> AppResult<()> {
        if let Some(provider) = Self::provider_for(integration_id) {
            self.clear_tokens(provider)?;
        }
        Ok(())
    }

    /// Seeds OAuth tokens during E2E runs without opening a browser.
    pub fn seed_e2e_oauth_token(
        &self,
        provider: &str,
        access_token: &str,
        account_label: Option<&str>,
    ) -> AppResult<()> {
        if access_token.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "Le jeton OAuth E2E ne peut pas être vide.".into(),
            ));
        }
        self.store_tokens(
            provider,
            &OAuthTokenBundle {
                access_token: access_token.trim().to_string(),
                refresh_token: Some("e2e-refresh-token".into()),
                token_type: Some("Bearer".into()),
                // Unknown scope: coverage is assumed, like personal tokens.
                scope: None,
                expires_at: None,
                account_label: account_label.map(str::to_string),
            },
        )
    }

    pub fn access_token_for_provider(&self, provider: &str) -> AppResult<Option<String>> {
        let Some(mut bundle) = self.load_tokens(provider)? else {
            return Ok(None);
        };
        if Self::token_expired(&bundle) {
            if bundle.refresh_token.is_some() {
                bundle = self.refresh_tokens(provider, &bundle)?;
            } else {
                return Ok(None);
            }
        }
        Ok(Some(bundle.access_token))
    }

    /// Stores a personal access token when OAuth app credentials are unavailable.
    pub fn store_personal_access_token(
        &self,
        provider: &str,
        access_token: &str,
        account_label: Option<&str>,
    ) -> AppResult<()> {
        if access_token.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "Le jeton d’accès ne peut pas être vide.".into(),
            ));
        }
        self.store_tokens(
            provider,
            &OAuthTokenBundle {
                access_token: access_token.trim().to_string(),
                refresh_token: None,
                token_type: Some("Bearer".into()),
                scope: None,
                expires_at: None,
                account_label: account_label.map(str::to_string),
            },
        )
    }

    /// Space-separated Microsoft scope string: base identity scopes, the
    /// integration's own Graph permissions, plus everything already granted
    /// (incremental consent keeps previous integrations working).
    fn microsoft_scope_request(&self, integration_id: &str) -> String {
        let mut scopes: Vec<String> = MICROSOFT_BASE_SCOPES
            .iter()
            .map(|scope| (*scope).to_string())
            .collect();
        let mut push_unique = |scope: &str| {
            if !scopes.iter().any(|value| value.eq_ignore_ascii_case(scope)) {
                scopes.push(scope.to_string());
            }
        };
        if let Some(required) = integration_scopes(integration_id) {
            for scope in required.scopes {
                push_unique(scope);
            }
        }
        if let Ok(Some(bundle)) = self.load_tokens("microsoft") {
            if let Some(granted) = bundle.scope.as_deref() {
                for scope in granted.split([' ', ',']).filter(|value| !value.trim().is_empty()) {
                    push_unique(scope.trim());
                }
            }
        }
        scopes.join(" ")
    }

    pub fn begin_authorization(&self, integration_id: &str) -> AppResult<String> {
        let provider = Self::provider_for(integration_id).ok_or_else(|| {
            AppError::ValidationFailed("Intégration OAuth non prise en charge.".into())
        })?;
        let client = self.get_client_config(provider)?.ok_or_else(|| {
            AppError::ValidationFailed(format!(
                "Connexion {provider} indisponible : l’application OAuth Bob Work n’est pas configurée pour cette version."
            ))
        })?;
        if web_flow_requires_secret(provider)
            && client
                .client_secret
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
        {
            return Err(AppError::ValidationFailed(format!(
                "L’échange de code {provider} exige un client secret (contrairement à Microsoft qui accepte PKCE seul). Ajoutez le secret de votre application OAuth."
            )));
        }

        let scope_request = if provider == "microsoft" {
            Some(self.microsoft_scope_request(integration_id))
        } else {
            None
        };

        let (code_verifier, code_challenge) = generate_pkce_pair();
        let state = random_url_safe(32);
        let auth_url = build_authorize_url(
            provider,
            integration_id,
            &client.client_id,
            &state,
            &code_challenge,
            scope_request.as_deref(),
        )?;

        pending_sessions().lock().unwrap().insert(
            state.clone(),
            PendingOAuthSession {
                provider,
                integration_id: integration_id.to_string(),
                state: state.clone(),
                code_verifier,
            },
        );

        info!(
            "Started OAuth flow for integration {} via provider {}",
            integration_id, provider
        );
        Ok(auth_url)
    }

    pub async fn finish_authorization(&self, state: &str) -> AppResult<IntegrationConnectionStatus> {
        let session = pending_sessions()
            .lock()
            .unwrap()
            .remove(state)
            .ok_or_else(|| AppError::ValidationFailed("Session OAuth expirée ou inconnue.".into()))?;

        let code = wait_for_oauth_callback(state, StdDuration::from_secs(300)).await?;
        let client = self.get_client_config(session.provider)?.ok_or_else(|| {
            AppError::ValidationFailed("Configuration OAuth client manquante.".into())
        })?;
        let bundle = exchange_code(
            session.provider,
            &client,
            &code,
            &session.code_verifier,
        )
        .await?;
        let enriched = self.enrich_profile(session.provider, bundle).await?;
        self.store_tokens(session.provider, &enriched)?;
        info!(
            "OAuth authorization completed for integration {} ({})",
            session.integration_id, session.provider
        );
        Ok(self.connection_status(&session.integration_id, false))
    }

    /// Starts a zero-configuration device-flow authorization (GitHub, Microsoft).
    /// The user lands on the provider's official authorization page and grants
    /// the requested permissions there, like ChatGPT/Claude connectors.
    pub async fn begin_device_authorization(
        &self,
        integration_id: &str,
    ) -> AppResult<DeviceFlowStart> {
        let provider = Self::provider_for(integration_id).ok_or_else(|| {
            AppError::ValidationFailed("Intégration OAuth non prise en charge.".into())
        })?;
        let client_id = device_flow_client(provider)
            .ok_or_else(|| {
                AppError::ValidationFailed(format!(
                    "{provider} ne propose pas de connexion sans application OAuth. Configurez un client OAuth ou utilisez un jeton."
                ))
            })?
            .to_string();
        let (device_endpoint, scope) = match provider {
            "github" => (
                "https://github.com/login/device/code",
                integration_scopes("github")
                    .map(|spec| spec.scopes.join(" "))
                    .unwrap_or_default(),
            ),
            "microsoft" => (
                "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode",
                self.microsoft_scope_request(integration_id),
            ),
            _ => {
                return Err(AppError::ValidationFailed(
                    "Fournisseur sans device flow.".into(),
                ))
            }
        };

        let response = reqwest::Client::new()
            .post(device_endpoint)
            .header("Accept", "application/json")
            .form(&[("client_id", client_id.as_str()), ("scope", scope.as_str())])
            .send()
            .await
            .map_err(|error| {
                AppError::Unknown(format!("Démarrage de l’autorisation impossible : {error}"))
            })?;
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|error| AppError::Serialization(format!("Réponse device flow invalide : {error}")))?;

        let field = |name: &str| {
            body.get(name)
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| {
                    AppError::ValidationFailed(format!("Réponse device flow incomplète : {body}"))
                })
        };
        let device_code = field("device_code")?;
        let user_code = field("user_code")?;
        let verification_uri = field("verification_uri")?;
        let expires_in_seconds = body
            .get("expires_in")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(900);
        let poll_interval_seconds = body
            .get("interval")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(5)
            .max(5);

        info!(
            "Started device-flow authorization for integration {} via provider {}",
            integration_id, provider
        );
        Ok(DeviceFlowStart {
            integration_id: integration_id.to_string(),
            user_code,
            verification_uri,
            expires_in_seconds,
            device_code,
            poll_interval_seconds,
            client_id,
            provider,
        })
    }

    /// Polls the provider until the user approves (or denies) the device-flow
    /// authorization, then stores the tokens like the web OAuth flow.
    pub async fn poll_device_authorization(
        &self,
        session: &DeviceFlowStart,
    ) -> AppResult<IntegrationConnectionStatus> {
        let token_url = match session.provider {
            "github" => "https://github.com/login/oauth/access_token",
            "microsoft" => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            _ => {
                return Err(AppError::ValidationFailed(
                    "Fournisseur sans device flow.".into(),
                ))
            }
        };
        let deadline =
            tokio::time::Instant::now() + StdDuration::from_secs(session.expires_in_seconds);
        let mut interval = session.poll_interval_seconds;
        let http = reqwest::Client::new();

        loop {
            tokio::time::sleep(StdDuration::from_secs(interval)).await;
            if tokio::time::Instant::now() > deadline {
                return Err(AppError::ValidationFailed(
                    "Code d’autorisation expiré. Relancez la connexion.".into(),
                ));
            }

            let response = http
                .post(token_url)
                .header("Accept", "application/json")
                .form(&[
                    ("client_id", session.client_id.as_str()),
                    ("device_code", session.device_code.as_str()),
                    (
                        "grant_type",
                        "urn:ietf:params:oauth:grant-type:device_code",
                    ),
                ])
                .send()
                .await
                .map_err(|error| AppError::Unknown(format!("Vérification OAuth impossible : {error}")))?;
            let body: serde_json::Value = response
                .json()
                .await
                .map_err(|error| AppError::Serialization(error.to_string()))?;

            if let Some(error) = body.get("error").and_then(serde_json::Value::as_str) {
                match error {
                    "authorization_pending" => continue,
                    "slow_down" => {
                        interval += 5;
                        continue;
                    }
                    "expired_token" | "expired_code" => {
                        return Err(AppError::ValidationFailed(
                            "Code d’autorisation expiré. Relancez la connexion.".into(),
                        ))
                    }
                    "access_denied" => {
                        return Err(AppError::ValidationFailed(
                            "Autorisation refusée sur la page du fournisseur.".into(),
                        ))
                    }
                    other => {
                        let description = body
                            .get("error_description")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or(other);
                        return Err(AppError::ValidationFailed(format!(
                            "Connexion refusée : {description}"
                        )));
                    }
                }
            }

            let bundle = parse_token_response(session.provider, &body)?;
            let enriched = self.enrich_profile(session.provider, bundle).await?;
            self.store_tokens(session.provider, &enriched)?;
            info!(
                "Device-flow authorization completed for integration {} ({})",
                session.integration_id, session.provider
            );
            return Ok(self.connection_status(&session.integration_id, false));
        }
    }

    fn load_tokens(&self, provider: &str) -> AppResult<Option<OAuthTokenBundle>> {
        let Some(raw) = KeychainService::new().get(&Self::token_vault_key(provider))? else {
            return Ok(None);
        };
        serde_json::from_str(&raw)
            .map(Some)
            .map_err(|error| AppError::Serialization(error.to_string()))
    }

    fn store_tokens(&self, provider: &str, bundle: &OAuthTokenBundle) -> AppResult<()> {
        let raw = serde_json::to_string(bundle)?;
        KeychainService::new().set(&Self::token_vault_key(provider), &raw)
    }

    fn token_expired(bundle: &OAuthTokenBundle) -> bool {
        let Some(expires_at) = bundle.expires_at.as_deref() else {
            return false;
        };
        chrono::DateTime::parse_from_rfc3339(expires_at)
            .map(|value| value.with_timezone(&Utc) < Utc::now() + Duration::minutes(2))
            .unwrap_or(false)
    }

    fn refresh_tokens(&self, provider: &str, bundle: &OAuthTokenBundle) -> AppResult<OAuthTokenBundle> {
        let refresh_token = bundle
            .refresh_token
            .as_deref()
            .ok_or_else(|| AppError::ValidationFailed("Jeton OAuth expiré sans refresh.".into()))?;
        let client = self.get_client_config(provider)?.ok_or_else(|| {
            AppError::ValidationFailed("Configuration OAuth client manquante.".into())
        })?;
        let refreshed = refresh_access_token(provider, &client, refresh_token)?;
        let merged = OAuthTokenBundle {
            account_label: bundle.account_label.clone(),
            ..refreshed
        };
        self.store_tokens(provider, &merged)?;
        Ok(merged)
    }

    async fn enrich_profile(
        &self,
        provider: &str,
        mut bundle: OAuthTokenBundle,
    ) -> AppResult<OAuthTokenBundle> {
        let label = match provider {
            "github" => fetch_github_profile(&bundle.access_token).await,
            "slack" => fetch_slack_profile(&bundle.access_token).await,
            "microsoft" => fetch_microsoft_profile(&bundle.access_token).await,
            "monday" => fetch_monday_profile(&bundle.access_token).await,
            _ => Ok(None),
        };
        match label {
            Ok(value) => bundle.account_label = value,
            Err(error) => warn!("Unable to fetch OAuth profile for {}: {}", provider, error),
        }
        Ok(bundle)
    }
}

fn generate_pkce_pair() -> (String, String) {
    let verifier = random_url_safe(64);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

fn random_url_safe(length: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut bytes = vec![0_u8; length];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
        .into_iter()
        .map(|byte| ALPHABET[(byte as usize) % ALPHABET.len()] as char)
        .collect()
}

fn build_authorize_url(
    provider: &str,
    integration_id: &str,
    client_id: &str,
    state: &str,
    code_challenge: &str,
    scope_override: Option<&str>,
) -> AppResult<String> {
    let authorize_url = match provider {
        "github" => "https://github.com/login/oauth/authorize",
        "slack" => "https://slack.com/oauth/v2/authorize",
        "microsoft" => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "monday" => "https://auth.monday.com/oauth2/authorize",
        _ => return Err(AppError::ValidationFailed("Fournisseur OAuth inconnu.".into())),
    };

    let declared = integration_scopes(integration_id);
    // Slack separates bot scopes (`scope`) from user scopes (`user_scope`,
    // required for message search); other providers use a single list.
    let scope = match (scope_override, &declared) {
        (Some(value), _) => value.to_string(),
        (None, Some(spec)) if provider == "slack" => spec.scopes.join(","),
        (None, Some(spec)) => spec.scopes.join(" "),
        (None, None) => String::new(),
    };
    let slack_user_scope = declared
        .as_ref()
        .filter(|_| provider == "slack")
        .map(|spec| spec.user_scopes.join(","))
        .filter(|value| !value.is_empty());

    let mut url = url::Url::parse(authorize_url).map_err(|error| AppError::Unknown(error.to_string()))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", client_id);
        query.append_pair("redirect_uri", OAUTH_REDIRECT_URI);
        query.append_pair("response_type", "code");
        query.append_pair("scope", &scope);
        if let Some(user_scope) = slack_user_scope.as_deref() {
            query.append_pair("user_scope", user_scope);
        }
        query.append_pair("state", state);
        // PKCE: enforced by Microsoft public clients, ignored by providers
        // that do not support it (GitHub OAuth Apps, Slack, Monday).
        query.append_pair("code_challenge", code_challenge);
        query.append_pair("code_challenge_method", "S256");
        if provider == "microsoft" {
            query.append_pair("prompt", "consent");
        }
    }
    Ok(url.to_string())
}

async fn exchange_code(
    provider: &str,
    client: &OAuthClientConfig,
    code: &str,
    code_verifier: &str,
) -> AppResult<OAuthTokenBundle> {
    let (token_url, extra) = match provider {
        "github" => ("https://github.com/login/oauth/access_token", vec![]),
        "slack" => ("https://slack.com/api/oauth.v2.access", vec![]),
        "microsoft" => (
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            vec![],
        ),
        "monday" => ("https://auth.monday.com/oauth2/token", vec![]),
        _ => return Err(AppError::ValidationFailed("Fournisseur OAuth inconnu.".into())),
    };

    let client_secret = client.client_secret.clone().unwrap_or_default();
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.to_string()),
        ("redirect_uri", OAUTH_REDIRECT_URI.to_string()),
        ("client_id", client.client_id.clone()),
        ("code_verifier", code_verifier.to_string()),
    ];
    if !client_secret.is_empty() {
        form.push(("client_secret", client_secret));
    }
    form.extend(extra);

    let http = reqwest::Client::new();
    let response = http
        .post(token_url)
        .header("Accept", "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|error| AppError::Unknown(format!("Échange OAuth impossible : {error}")))?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| AppError::Serialization(format!("Réponse OAuth invalide : {error}")))?;

    if !status.is_success() {
        return Err(AppError::ValidationFailed(format!(
            "OAuth refusé ({status}) : {}",
            body
        )));
    }

    if provider == "slack" && body.get("ok").and_then(serde_json::Value::as_bool) == Some(false) {
        return Err(AppError::ValidationFailed(format!("Slack OAuth : {body}")));
    }

    parse_token_response(provider, &body)
}

fn parse_token_response(provider: &str, body: &serde_json::Value) -> AppResult<OAuthTokenBundle> {
    let access_token = body
        .pointer("/access_token")
        .or_else(|| body.pointer("/authed_user/access_token"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::ValidationFailed(format!("Réponse OAuth incomplète : {body}")))?
        .to_string();

    let refresh_token = body
        .get("refresh_token")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let token_type = body
        .get("token_type")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let scope = body
        .get("scope")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let expires_at = body
        .get("expires_in")
        .and_then(serde_json::Value::as_i64)
        .map(|seconds| (Utc::now() + Duration::seconds(seconds)).to_rfc3339());

    if provider == "slack" {
        let team = body
            .pointer("/team/name")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        return Ok(OAuthTokenBundle {
            access_token,
            refresh_token,
            token_type,
            scope,
            expires_at,
            account_label: team,
        });
    }

    Ok(OAuthTokenBundle {
        access_token,
        refresh_token,
        token_type,
        scope,
        expires_at,
        account_label: None,
    })
}

fn refresh_access_token(
    provider: &str,
    client: &OAuthClientConfig,
    refresh_token: &str,
) -> AppResult<OAuthTokenBundle> {
    if !matches!(provider, "microsoft" | "monday") {
        return Err(AppError::ValidationFailed(
            "Ce fournisseur ne supporte pas le refresh OAuth.".into(),
        ));
    }
    let token_url = match provider {
        "microsoft" => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "monday" => "https://auth.monday.com/oauth2/token",
        _ => unreachable!(),
    };
    let client_secret = client.client_secret.clone().unwrap_or_default();
    let mut form = vec![
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token.to_string()),
        ("client_id", client.client_id.clone()),
    ];
    if !client_secret.is_empty() {
        form.push(("client_secret", client_secret));
    }

    let response = reqwest::blocking::Client::new()
        .post(token_url)
        .header("Accept", "application/json")
        .form(&form)
        .send()
        .map_err(|error| AppError::Unknown(format!("Refresh OAuth impossible : {error}")))?;
    let body: serde_json::Value = response
        .json()
        .map_err(|error| AppError::Serialization(error.to_string()))?;
    parse_token_response(provider, &body)
}

async fn fetch_github_profile(token: &str) -> AppResult<Option<String>> {
    let response = reqwest::Client::new()
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Bob-Work")
        .send()
        .await
        .map_err(|error| AppError::Unknown(error.to_string()))?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    Ok(body
        .get("login")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string))
}

async fn fetch_slack_profile(token: &str) -> AppResult<Option<String>> {
    let response = reqwest::Client::new()
        .get("https://slack.com/api/auth.test")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|error| AppError::Unknown(error.to_string()))?;
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    Ok(body
        .get("team")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string))
}

async fn fetch_microsoft_profile(token: &str) -> AppResult<Option<String>> {
    let response = reqwest::Client::new()
        .get("https://graph.microsoft.com/v1.0/me")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|error| AppError::Unknown(error.to_string()))?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    Ok(body
        .get("userPrincipalName")
        .or_else(|| body.get("mail"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string))
}

async fn fetch_monday_profile(token: &str) -> AppResult<Option<String>> {
    let response = reqwest::Client::new()
        .post("https://api.monday.com/v2")
        .header("Authorization", token)
        .json(&serde_json::json!({ "query": "{ me { name email } }" }))
        .send()
        .await
        .map_err(|error| AppError::Unknown(error.to_string()))?;
    let body: serde_json::Value = response.json().await.unwrap_or_default();
    Ok(body
        .pointer("/data/me/email")
        .or_else(|| body.pointer("/data/me/name"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string))
}

async fn wait_for_oauth_callback(expected_state: &str, timeout: StdDuration) -> AppResult<String> {
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{OAUTH_CALLBACK_PORT}"))
        .await
        .map_err(|error| {
            AppError::Io(format!(
                "Impossible d’ouvrir le port OAuth local {OAUTH_CALLBACK_PORT} : {error}"
            ))
        })?;

    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(AppError::ValidationFailed(
                "Délai OAuth dépassé. Relancez l’autorisation.".into(),
            ));
        }

        let accept = tokio::time::timeout(remaining, listener.accept()).await;
        let (mut stream, _) = accept
            .map_err(|_| {
                AppError::ValidationFailed("Délai OAuth dépassé. Relancez l’autorisation.".into())
            })?
            .map_err(|error| AppError::Io(error.to_string()))?;

        let mut buffer = vec![0_u8; 8192];
        let read = tokio::time::timeout(StdDuration::from_secs(5), stream.readable())
            .await
            .map_err(|_| AppError::Io("Lecture OAuth interrompue.".into()))?
            .map_err(|error| AppError::Io(error.to_string()))?;
        let _ = read;
        let size = stream
            .try_read(&mut buffer)
            .map_err(|error| AppError::Io(error.to_string()))?;
        let request = String::from_utf8_lossy(&buffer[..size]);
        let first_line = request.lines().next().unwrap_or_default();
        let path = first_line
            .split_whitespace()
            .nth(1)
            .unwrap_or_default()
            .split('?')
            .next()
            .unwrap_or_default();
        if path != "/oauth/callback" {
            write_oauth_response(&mut stream, 404, "Route OAuth inconnue.", false).await?;
            continue;
        }

        let query = first_line
            .split_whitespace()
            .nth(1)
            .and_then(|value| value.split('?').nth(1))
            .unwrap_or_default();
        let params: HashMap<_, _> = url::form_urlencoded::parse(query.as_bytes()).collect();
        if params.get("state").map(|value| value.as_ref()) != Some(expected_state) {
            write_oauth_response(&mut stream, 400, "État OAuth invalide.", false).await?;
            continue;
        }
        if let Some(error) = params.get("error") {
            write_oauth_response(
                &mut stream,
                400,
                &format!("Autorisation refusée : {error}"),
                false,
            )
            .await?;
            return Err(AppError::ValidationFailed(format!(
                "Autorisation refusée : {error}"
            )));
        }
        let Some(code) = params.get("code").map(|value| value.to_string()) else {
            write_oauth_response(&mut stream, 400, "Code OAuth manquant.", false).await?;
            continue;
        };

        write_oauth_response(
            &mut stream,
            200,
            "Autorisation réussie. Retour à Bob Work…",
            true,
        )
        .await?;
        return Ok(code);
    }
}

async fn write_oauth_response(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    message: &str,
    success: bool,
) -> AppResult<()> {
    let title = if success { "Bob Work" } else { "Erreur OAuth" };
    let close_script = if success {
        "<script>setTimeout(() => window.close(), 1200)</script>"
    } else {
        ""
    };
    let body = format!(
        "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>{title}</title></head><body style=\"font-family:-apple-system,sans-serif;padding:32px;max-width:480px;\"><h1>{title}</h1><p>{message}</p>{close_script}</body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status} OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    use tokio::io::AsyncWriteExt;
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| AppError::Io(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_integrations_to_oauth_providers() {
        assert_eq!(IntegrationOAuthService::provider_for("github"), Some("github"));
        assert_eq!(
            IntegrationOAuthService::provider_for("outlook-mail"),
            Some("microsoft")
        );
        assert_eq!(IntegrationOAuthService::provider_for("unknown"), None);
    }

    #[test]
    fn builds_authorize_urls_with_pkce() {
        let url = build_authorize_url("github", "github", "client-id", "state-123", "challenge", None)
            .expect("authorize url");
        assert!(url.contains("client_id=client-id"));
        assert!(url.contains("state=state-123"));
        assert!(url.contains("code_challenge=challenge"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("repo"));
        assert!(url.contains("read%3Aorg"));
    }

    #[test]
    fn slack_authorize_url_separates_bot_and_user_scopes() {
        let url = build_authorize_url("slack", "slack", "client-id", "state", "challenge", None)
            .expect("authorize url");
        assert!(url.contains("scope=channels%3Ahistory%2Cchannels%3Aread%2Cchat%3Awrite%2Cusers%3Aread"));
        assert!(url.contains("user_scope=search%3Aread"));
    }

    #[test]
    fn microsoft_authorize_url_requests_integration_specific_scopes() {
        let teams_scope = "openid profile offline_access User.Read Team.ReadBasic.All ChannelMessage.Read.All";
        let url = build_authorize_url(
            "microsoft",
            "teams",
            "client-id",
            "state",
            "challenge",
            Some(teams_scope),
        )
        .expect("authorize url");
        assert!(url.contains("Team.ReadBasic.All"));
        assert!(url.contains("ChannelMessage.Read.All"));
        assert!(!url.contains("Mail.ReadWrite"));
        assert!(url.contains("prompt=consent"));
    }

    #[test]
    fn microsoft_scope_coverage_is_checked_per_integration() {
        let outlook_only = OAuthTokenBundle {
            access_token: "token".into(),
            refresh_token: None,
            token_type: None,
            scope: Some("openid profile User.Read Mail.ReadWrite Mail.Send".into()),
            expires_at: None,
            account_label: None,
        };
        assert!(IntegrationOAuthService::scopes_cover_integration(
            "outlook-mail",
            &outlook_only
        ));
        assert!(!IntegrationOAuthService::scopes_cover_integration(
            "teams",
            &outlook_only
        ));
        assert!(!IntegrationOAuthService::scopes_cover_integration(
            "onedrive",
            &outlook_only
        ));
    }

    #[test]
    fn unknown_scope_tokens_cover_every_integration() {
        let personal_token = OAuthTokenBundle {
            access_token: "token".into(),
            refresh_token: None,
            token_type: None,
            scope: None,
            expires_at: None,
            account_label: None,
        };
        assert!(IntegrationOAuthService::scopes_cover_integration(
            "teams",
            &personal_token
        ));
        assert!(IntegrationOAuthService::scopes_cover_integration(
            "github",
            &personal_token
        ));
    }

    #[test]
    fn device_flow_is_available_for_github_and_microsoft_only() {
        assert!(IntegrationOAuthService::device_flow_available("github"));
        assert!(IntegrationOAuthService::device_flow_available("microsoft"));
        assert!(!IntegrationOAuthService::device_flow_available("slack"));
        assert!(!IntegrationOAuthService::device_flow_available("monday"));
    }

    #[test]
    fn parses_github_device_token_response() {
        let body = serde_json::json!({
            "access_token": "gho_test",
            "token_type": "bearer",
            "scope": "repo,read:org"
        });
        let bundle = parse_token_response("github", &body).expect("token bundle");
        assert_eq!(bundle.access_token, "gho_test");
        assert!(bundle.refresh_token.is_none());
    }

    #[test]
    fn parses_microsoft_device_token_response_with_refresh() {
        let body = serde_json::json!({
            "access_token": "eyJ-test",
            "refresh_token": "refresh-test",
            "token_type": "Bearer",
            "expires_in": 3599,
            "scope": "User.Read Mail.ReadWrite"
        });
        let bundle = parse_token_response("microsoft", &body).expect("token bundle");
        assert_eq!(bundle.access_token, "eyJ-test");
        assert_eq!(bundle.refresh_token.as_deref(), Some("refresh-test"));
        assert!(bundle.expires_at.is_some());
    }
}
