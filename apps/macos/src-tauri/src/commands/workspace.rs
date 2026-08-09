use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::workspace::{
    CreatePermissionGrantInput, McpServer, PermissionGrant, SaveMcpServerInput, SaveSkillInput,
    SearchResult, Skill, UsageStatus,
};
use crate::services::bob::BobService;
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
pub async fn get_mcp_servers() -> Result<Vec<McpServer>, AppError> {
    Ok(WorkspaceService::new().list_mcp_servers())
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
pub async fn get_usage_status(db: State<'_, Database>) -> Result<UsageStatus, AppError> {
    Ok(WorkspaceService::new().usage_status(&db))
}
