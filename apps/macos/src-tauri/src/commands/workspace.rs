use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::analytics::{BobalyticsQuery, BobalyticsReport};
use crate::models::workspace::{
    CreatePermissionGrantInput, McpServer, PermissionGrant, SaveMcpServerInput, SaveSkillInput,
    SearchResult, Skill, UsageStatus,
};
use crate::services::bob::BobService;
use crate::services::bob_analytics::BobAnalyticsService;
use crate::services::workspace::WorkspaceService;
use tauri::State;

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
    let mut result = crate::services::plugin_mcp::test_workspace_server(&server);
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
pub fn get_usage_status(
    force: Option<bool>,
    db: State<'_, Database>,
) -> Result<UsageStatus, AppError> {
    Ok(WorkspaceService::new().usage_status_with_refresh(&db, force.unwrap_or(false)))
}

#[tauri::command]
pub fn get_bobalytics(
    scope: Option<String>,
    range_days: Option<i64>,
    db: State<'_, Database>,
) -> Result<BobalyticsReport, AppError> {
    BobAnalyticsService::new().report(&db, BobalyticsQuery { scope, range_days })
}

#[tauri::command]
pub fn export_bobalytics(
    path: String,
    scope: Option<String>,
    range_days: Option<i64>,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    BobAnalyticsService::new().export_csv(&db, BobalyticsQuery { scope, range_days }, &path)
}
