// ============================================================
// Bob Work - Integration Commands
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::services::bob::BobService;
use crate::services::integration_mcp::IntegrationMcpService;
use crate::services::integration_oauth::{
    IntegrationConnectionStatus, IntegrationOAuthService, OAuthClientConfig,
};
use crate::services::workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStartResult {
    pub integration_id: String,
    pub auth_url: String,
    pub state: String,
    /// "web" = classic OAuth authorization page, "device" = device-flow code.
    pub mode: String,
    pub user_code: Option<String>,
    pub verification_uri: Option<String>,
}

#[tauri::command]
pub async fn get_integration_statuses(
    bob_service: State<'_, BobService>,
    db: State<'_, Database>,
) -> Result<Vec<IntegrationConnectionStatus>, AppError> {
    let oauth = IntegrationOAuthService::new();
    let tests = crate::services::connection_test::ConnectionTestService::new().list(&db)?;
    let ids = [
        "github",
        "slack",
        "monday",
        "outlook-mail",
        "teams",
        "outlook-calendar",
        "onedrive",
        "onenote",
    ];
    Ok(ids
        .into_iter()
        .map(|integration_id| {
            let legacy = legacy_secret_exists(&bob_service, integration_id);
            let mut status = oauth.connection_status(integration_id, legacy);
            status.last_test = tests
                .get(
                    &crate::services::connection_test::ConnectionTestService::integration_key(
                        integration_id,
                    ),
                )
                .or_else(|| {
                    IntegrationOAuthService::provider_for(integration_id)
                        .and_then(IntegrationMcpService::mcp_name_for_provider)
                        .and_then(|name| {
                            tests.get(
                                &crate::services::connection_test::ConnectionTestService::mcp_key(
                                    name,
                                ),
                            )
                        })
                })
                .map(|record| record.summary());
            status
        })
        .collect())
}

#[tauri::command]
pub async fn get_oauth_client_config(
    integration_id: String,
) -> Result<Option<OAuthClientConfig>, AppError> {
    let provider = IntegrationOAuthService::provider_for(&integration_id)
        .ok_or_else(|| AppError::ValidationFailed("Intégration OAuth inconnue.".into()))?;
    IntegrationOAuthService::new().get_client_config(provider)
}

#[tauri::command]
pub async fn set_oauth_client_config(
    integration_id: String,
    client_id: String,
    client_secret: Option<String>,
) -> Result<(), AppError> {
    let provider = IntegrationOAuthService::provider_for(&integration_id)
        .ok_or_else(|| AppError::ValidationFailed("Intégration OAuth inconnue.".into()))?;
    IntegrationOAuthService::new().set_client_config(provider, &client_id, client_secret.as_deref())
}

#[tauri::command]
pub async fn start_integration_oauth(
    app_handle: AppHandle,
    integration_id: String,
) -> Result<OAuthStartResult, AppError> {
    let provider = IntegrationOAuthService::provider_for(&integration_id)
        .ok_or_else(|| AppError::ValidationFailed("Intégration OAuth inconnue.".into()))?;
    let oauth = IntegrationOAuthService::new();

    // Prefer web authorize + PKCE (ChatGPT-style). Slack / Microsoft: public
    // Client ID. Monday MCP: Dynamic Client Registration + PKCE on
    // mcp.monday.com (no Developer Center secret). GitHub web still needs a secret.
    let web_ready = match oauth.get_client_config(provider)? {
        Some(client) => {
            let secret_available = client
                .client_secret
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some();
            secret_available
                || !crate::services::integration_catalog::web_flow_requires_secret(provider)
        }
        // Monday registers a public MCP client on demand (DCR).
        None => provider == "monday",
    };
    if web_ready {
        return start_web_oauth(app_handle, integration_id, oauth).await;
    }

    // GitHub only: vendor-published device-flow client as zero-config fallback.
    // Microsoft no longer uses Graph PowerShell / Command Line Tools.
    if IntegrationOAuthService::device_flow_available(provider) {
        return start_device_oauth(app_handle, integration_id, oauth).await;
    }

    // No Bob Work Client ID yet: open the provider console so the user can
    // create the public app once. Slack has no DCR (unlike Monday) — after the
    // app exists, the UI asks for the Client ID once, then every later Connect
    // opens slack.com/oauth/v2/authorize like ChatGPT.
    if let Some(setup_url) = crate::services::integration_catalog::provider_setup_url(provider) {
        open::that(&setup_url).map_err(|error| AppError::Io(error.to_string()))?;
        return Ok(OAuthStartResult {
            integration_id,
            auth_url: setup_url,
            state: String::new(),
            mode: "setup".into(),
            user_code: None,
            verification_uri: None,
        });
    }

    Err(AppError::ValidationFailed(format!(
        "{integration_id} nécessite une application OAuth (Client ID) ou un jeton personnel. Configurez l’un des deux depuis la carte de l’intégration."
    )))
}

async fn start_web_oauth(
    app_handle: AppHandle,
    integration_id: String,
    oauth: IntegrationOAuthService,
) -> Result<OAuthStartResult, AppError> {
    let auth_url = oauth.begin_authorization(&integration_id).await?;
    let state = url::Url::parse(&auth_url)
        .ok()
        .and_then(|parsed| {
            parsed
                .query_pairs()
                .find(|(key, _)| key == "state")
                .map(|(_, value)| value.into_owned())
        })
        .unwrap_or_default();

    open::that(&auth_url).map_err(|error| AppError::Io(error.to_string()))?;

    let app = app_handle.clone();
    let integration = integration_id.clone();
    let state_for_task = state.clone();
    tokio::spawn(async move {
        let result = IntegrationOAuthService::new()
            .finish_authorization(&state_for_task)
            .await;
        finish_connection(&app, &integration, result);
    });

    Ok(OAuthStartResult {
        integration_id,
        auth_url,
        state,
        mode: "web".into(),
        user_code: None,
        verification_uri: None,
    })
}

async fn start_device_oauth(
    app_handle: AppHandle,
    integration_id: String,
    oauth: IntegrationOAuthService,
) -> Result<OAuthStartResult, AppError> {
    let session = oauth.begin_device_authorization(&integration_id).await?;
    let user_code = session.user_code.clone();
    let verification_uri = session.verification_uri.clone();

    open::that(&verification_uri).map_err(|error| AppError::Io(error.to_string()))?;

    let app = app_handle.clone();
    let integration = integration_id.clone();
    tokio::spawn(async move {
        let result = IntegrationOAuthService::new()
            .poll_device_authorization(&session)
            .await;
        finish_connection(&app, &integration, result);
    });

    Ok(OAuthStartResult {
        integration_id,
        auth_url: verification_uri.clone(),
        state: String::new(),
        mode: "device".into(),
        user_code: Some(user_code),
        verification_uri: Some(verification_uri),
    })
}

/// Shared post-authorization pipeline: install the builtin skill, sync the
/// integration MCP server, then notify the UI.
fn finish_connection(
    app: &AppHandle,
    integration: &str,
    result: Result<IntegrationConnectionStatus, AppError>,
) {
    match result {
        Ok(status) => {
            if let Err(error) = WorkspaceService::new().install_builtin_integration(integration) {
                warn!(
                    "Integration {} connected but skill install failed: {}",
                    integration, error
                );
                let _ = app.emit(
                    "integration-oauth-error",
                    format!("Connecté, mais skill local non installé : {error}"),
                );
                return;
            }
            if let Some(bob_path) = app.state::<BobService>().get_binary_path() {
                let legacy = legacy_secret_exists(&app.state::<BobService>(), integration);
                if let Err(error) = IntegrationMcpService::new().sync_for_integration(
                    &bob_path,
                    integration,
                    &IntegrationOAuthService::new(),
                    legacy,
                ) {
                    warn!(
                        "Integration {} connected but MCP sync failed: {}",
                        integration, error
                    );
                    let _ = app.emit(
                        "integration-oauth-error",
                        format!("Connecté, mais serveur MCP non synchronisé : {error}"),
                    );
                    return;
                }
            }
            focus_main_window(app);
            let _ = app.emit("integration-oauth-done", status);
        }
        Err(error) => {
            warn!(
                "Integration {} authorization failed: {}",
                integration, error
            );
            let _ = app.emit("integration-oauth-error", error.to_string());
        }
    }
}

#[tauri::command]
pub async fn disconnect_integration(
    integration_id: String,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    if let Some(secret_id) = legacy_secret_id(&integration_id) {
        let _ = bob_service.clear_session_secret(secret_id);
    }
    IntegrationOAuthService::new().clear_integration(&integration_id)?;
    if let Some(bob_path) = bob_service.get_binary_path() {
        let legacy = legacy_secret_exists(&bob_service, &integration_id);
        IntegrationMcpService::new().maybe_disable_after_disconnect(
            &bob_path,
            &integration_id,
            &IntegrationOAuthService::new(),
            legacy,
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn connect_integration_token(
    app_handle: AppHandle,
    integration_id: String,
    access_token: String,
    account_label: Option<String>,
    bob_service: State<'_, BobService>,
) -> Result<IntegrationConnectionStatus, AppError> {
    let provider = IntegrationOAuthService::provider_for(&integration_id)
        .ok_or_else(|| AppError::ValidationFailed("Intégration inconnue.".into()))?;
    let oauth = IntegrationOAuthService::new();
    oauth.store_personal_access_token(provider, &access_token, account_label.as_deref())?;
    if let Some(secret_id) = legacy_secret_id(&integration_id) {
        bob_service.set_session_secret(secret_id, access_token)?;
    }
    WorkspaceService::new().install_builtin_integration(&integration_id)?;
    if let Some(bob_path) = bob_service.get_binary_path() {
        IntegrationMcpService::new().sync_for_integration(
            &bob_path,
            &integration_id,
            &oauth,
            false,
        )?;
    }
    let status = oauth.connection_status(&integration_id, false);
    focus_main_window(&app_handle);
    let _ = app_handle.emit("integration-oauth-done", &status);
    Ok(status)
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_connect_integration(
    app_handle: AppHandle,
    integration_id: String,
    access_token: String,
    account_label: Option<String>,
) -> Result<IntegrationConnectionStatus, AppError> {
    if std::env::var_os("BOB_WORK_E2E_DATA_DIR").is_none() {
        return Err(AppError::ValidationFailed(
            "Cette commande est réservée aux builds E2E.".into(),
        ));
    }
    let provider = IntegrationOAuthService::provider_for(&integration_id)
        .ok_or_else(|| AppError::ValidationFailed("Intégration OAuth inconnue.".into()))?;
    let oauth = IntegrationOAuthService::new();
    oauth.seed_e2e_oauth_token(provider, &access_token, account_label.as_deref())?;
    WorkspaceService::new().install_builtin_integration(&integration_id)?;
    if let Some(bob_path) = app_handle.state::<BobService>().get_binary_path() {
        IntegrationMcpService::new().sync_for_integration(
            &bob_path,
            &integration_id,
            &oauth,
            false,
        )?;
    }
    let status = oauth.connection_status(&integration_id, false);
    focus_main_window(&app_handle);
    let _ = app_handle.emit("integration-oauth-done", &status);
    Ok(status)
}

#[tauri::command]
pub async fn e2e_seed_oauth_token(
    provider: String,
    access_token: String,
    account_label: Option<String>,
) -> Result<(), AppError> {
    if std::env::var_os("BOB_WORK_E2E_DATA_DIR").is_none() {
        return Err(AppError::ValidationFailed(
            "Cette commande est réservée aux builds E2E.".into(),
        ));
    }
    IntegrationOAuthService::new().seed_e2e_oauth_token(
        &provider,
        &access_token,
        account_label.as_deref(),
    )
}

fn legacy_secret_id(integration_id: &str) -> Option<&'static str> {
    match integration_id {
        "github" => Some(crate::services::bob::SECRET_GITHUB),
        "slack" => Some(crate::services::bob::SECRET_SLACK),
        "monday" => Some(crate::services::bob::SECRET_MONDAY),
        _ => None,
    }
}

fn legacy_secret_exists(bob_service: &BobService, integration_id: &str) -> bool {
    legacy_secret_id(integration_id)
        .and_then(|secret| bob_service.has_session_secret(secret).ok())
        .unwrap_or(false)
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[allow(dead_code)]
pub fn ensure_database(_db: &Database) {}
