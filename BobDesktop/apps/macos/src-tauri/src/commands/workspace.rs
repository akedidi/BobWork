use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::analytics::{BobalyticsQuery, BobalyticsReport};
use crate::models::workspace::{
    CreatePermissionGrantInput, McpServer, PermissionGrant, SaveApiConnectionInput,
    SaveMcpServerInput, SaveSkillInput, SearchResult, Skill, UsageStatus,
};
use crate::services::bob::BobService;
use crate::services::bob_analytics::BobAnalyticsService;
use crate::services::workspace::WorkspaceService;
use tauri::{Manager, State};
#[tauri::command]
pub async fn search_workspace(
    query: String,
    limit: Option<i64>,
    db: State<'_, Database>,
) -> Result<Vec<SearchResult>, AppError> {
    WorkspaceService::new().search(&db, &query, limit.unwrap_or(30))
}

#[tauri::command]
pub async fn get_skills(workspace: Option<String>) -> Result<Vec<Skill>, AppError> {
    Ok(WorkspaceService::new().list_skills(workspace.as_deref()))
}

#[tauri::command]
pub async fn save_skill(input: SaveSkillInput) -> Result<Skill, AppError> {
    WorkspaceService::new().save_skill(input)
}

#[tauri::command]
pub async fn set_skill_enabled(
    slug: String,
    scope: String,
    workspace: Option<String>,
    enabled: bool,
) -> Result<(), AppError> {
    WorkspaceService::new().set_skill_enabled(&slug, &scope, workspace.as_deref(), enabled)
}

#[tauri::command]
pub async fn delete_skill(slug: String, workspace: Option<String>) -> Result<(), AppError> {
    WorkspaceService::new().delete_skill(&slug, workspace.as_deref())
}

#[tauri::command]
pub async fn install_builtin_integration(integration_id: String) -> Result<Skill, AppError> {
    WorkspaceService::new().install_builtin_integration(&integration_id)
}

#[tauri::command]
pub async fn install_builtin_skill(skill_id: String) -> Result<Skill, AppError> {
    WorkspaceService::new().install_builtin_skill(&skill_id)
}

#[tauri::command]
pub async fn get_mcp_servers(db: State<'_, Database>) -> Result<Vec<McpServer>, AppError> {
    let tests = crate::services::connection_test::ConnectionTestService::new().list(&db)?;
    Ok(WorkspaceService::new()
        .list_mcp_servers()
        .into_iter()
        .map(|mut server| {
            server.last_test = tests
                .get(
                    &crate::services::connection_test::ConnectionTestService::mcp_key(&server.name),
                )
                .map(|record| record.summary());
            server
        })
        .collect())
}

#[tauri::command]
pub async fn test_mcp_server(
    name: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<crate::models::plugin::PluginMcpTestResult, AppError> {
    let workspace = WorkspaceService::new();
    let mut server = workspace
        .list_mcp_servers()
        .into_iter()
        .find(|item| item.name == name)
        .ok_or_else(|| AppError::NotFound(format!("Serveur MCP {name} introuvable")))?;
    // Restore secrets redacted from the UI payload so probes can authenticate.
    if let Some(raw) = workspace.read_mcp_server_config(&name) {
        server.raw = raw;
    }
    let integration_probe = match name.as_str() {
        crate::services::integration_mcp::GITHUB_MCP_NAME => Some((
            "github",
            "github",
            "github_list_repos",
            serde_json::json!({ "limit": 1 }),
        )),
        crate::services::integration_mcp::SLACK_MCP_NAME => Some((
            "slack",
            "slack",
            "slack_list_channels",
            serde_json::json!({ "limit": 1 }),
        )),
        crate::services::integration_mcp::MONDAY_MCP_NAME => Some((
            "monday",
            "monday",
            "monday_list_boards",
            serde_json::json!({ "limit": 1 }),
        )),
        crate::services::integration_mcp::MICROSOFT_MCP_NAME => Some((
            "microsoft",
            "outlook-mail",
            "graph_get_profile",
            serde_json::json!({}),
        )),
        _ => None,
    };
    let mut result = if let Some((provider, integration_id, tool, arguments)) = integration_probe {
        let oauth_token = crate::services::integration_oauth::IntegrationOAuthService::new()
            .access_token_for_provider(provider);
        let token = match oauth_token {
            Ok(Some(token)) => Some(zeroize::Zeroizing::new(token)),
            Ok(None) if provider != "microsoft" => {
                bob_service.integration_access_token(integration_id)
            }
            Ok(None) => None,
            Err(error) => {
                let message = if provider == "microsoft" {
                    format!(
                        "La connexion Microsoft a expiré et son renouvellement a échoué. Reconnectez le compte dans Intégrations. Détail : {error}"
                    )
                } else {
                    format!("Impossible de lire ou renouveler le jeton {provider} : {error}")
                };
                let mut failed = crate::models::plugin::PluginMcpTestResult {
                    id: name.clone(),
                    name: name.clone(),
                    ok: false,
                    message,
                    tools: vec![],
                    tested_at: None,
                };
                failed.message = crate::security::secret_redaction::redact_config_secrets(
                    &failed.message,
                    &server.raw,
                );
                let record = crate::services::connection_test::ConnectionTestService::new()
                    .save_mcp_test(&db, &failed)?;
                failed.tested_at = Some(record.tested_at);
                return Ok(failed);
            }
        };
        if let Some(token) = token {
            let object = server.raw.as_object_mut().ok_or_else(|| {
                AppError::ValidationFailed(format!("Configuration MCP {provider} invalide."))
            })?;
            let env = match provider {
                "github" => serde_json::json!({
                    "GITHUB_TOKEN": token.as_str(),
                    "GH_TOKEN": token.as_str(),
                }),
                "slack" => serde_json::json!({
                    "SLACK_BOT_TOKEN": token.as_str(),
                    "SLACK_ACCESS_TOKEN": token.as_str(),
                    "SLACK_USER_TOKEN": token.as_str(),
                }),
                "monday" => serde_json::json!({
                    "MONDAY_API_TOKEN": token.as_str(),
                }),
                "microsoft" => serde_json::json!({
                    "MICROSOFT_GRAPH_ACCESS_TOKEN": token.as_str(),
                }),
                _ => serde_json::json!({}),
            };
            object.insert("env".into(), env);
            crate::services::plugin_mcp::test_workspace_server_with_probe(&server, tool, &arguments)
        } else {
            crate::models::plugin::PluginMcpTestResult {
                id: name.clone(),
                name: name.clone(),
                ok: false,
                message: format!(
                    "{provider} est configuré, mais aucun jeton utilisable n’est disponible dans le coffre Bob Work. Reconnectez le compte dans Intégrations."
                ),
                tools: vec![],
                tested_at: None,
            }
        }
    } else {
        crate::services::plugin_mcp::test_workspace_server(&server)
    };
    result.message =
        crate::security::secret_redaction::redact_config_secrets(&result.message, &server.raw);
    let record = crate::services::connection_test::ConnectionTestService::new()
        .save_mcp_test(&db, &result)?;
    result.tested_at = Some(record.tested_at);
    Ok(result)
}

fn bob_path(service: &BobService) -> AppResult<String> {
    service
        .get_binary_path()
        .or_else(|| service.detect().path)
        .ok_or_else(|| AppError::BobNotFound("Bob Shell non détecté".into()))
}

#[tauri::command]
pub async fn save_mcp_server(
    input: SaveMcpServerInput,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    WorkspaceService::new().save_mcp_server(&bob_path(&bob_service)?, input)
}

#[tauri::command]
pub async fn save_api_connection(
    input: SaveApiConnectionInput,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    crate::services::integration_mcp::IntegrationMcpService::new()
        .save_api_connection(&bob_path(&bob_service)?, input)
}

#[tauri::command]
pub async fn set_mcp_server_enabled(
    name: String,
    enabled: bool,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    WorkspaceService::new().set_mcp_enabled(&bob_path(&bob_service)?, &name, enabled)
}

#[tauri::command]
pub async fn delete_mcp_server(
    name: String,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    WorkspaceService::new().delete_mcp_server(&bob_path(&bob_service)?, &name)
}

#[tauri::command]
pub async fn get_permission_grants(
    db: State<'_, Database>,
) -> Result<Vec<PermissionGrant>, AppError> {
    WorkspaceService::new().list_permission_grants(&db)
}

#[tauri::command]
pub async fn create_permission_grant(
    input: CreatePermissionGrantInput,
    db: State<'_, Database>,
) -> Result<PermissionGrant, AppError> {
    WorkspaceService::new().create_permission_grant(&db, input)
}

#[tauri::command]
pub async fn revoke_permission_grant(id: String, db: State<'_, Database>) -> Result<(), AppError> {
    WorkspaceService::new().revoke_permission_grant(&db, &id)
}

#[tauri::command]
pub async fn get_usage_status(
    force: Option<bool>,
    app: tauri::AppHandle,
) -> Result<UsageStatus, AppError> {
    tokio::task::spawn_blocking(move || {
        WorkspaceService::publish_usage_status(&app, force.unwrap_or(false))
    })
    .await
    .map_err(|e| AppError::Unknown(e.to_string()))
}

#[tauri::command]
pub async fn get_bobalytics(
    scope: Option<String>,
    range_days: Option<i64>,
    app: tauri::AppHandle,
) -> Result<BobalyticsReport, AppError> {
    tokio::task::spawn_blocking(move || {
        let db = app.state::<Database>();
        BobAnalyticsService::new().report(&db, BobalyticsQuery { scope, range_days })
    })
    .await
    .map_err(|e| AppError::Unknown(e.to_string()))?
}

#[tauri::command]
pub async fn export_bobalytics(
    path: String,
    scope: Option<String>,
    range_days: Option<i64>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let db = app.state::<Database>();
        BobAnalyticsService::new().export_csv(&db, BobalyticsQuery { scope, range_days }, &path)
    })
    .await
    .map_err(|e| AppError::Unknown(e.to_string()))?
}
