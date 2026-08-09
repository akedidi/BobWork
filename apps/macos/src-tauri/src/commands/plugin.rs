use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::plugin::{
    CreatePluginInput, Plugin, PluginExtensionStatus, PluginMcpStatus, PluginValidationResult,
    PluginVersion, PluginVersionDiff,
};
use crate::services::bob::BobService;
use crate::services::plugin::PluginService;
use crate::services::plugin_extensions::PluginExtensionService;
use crate::services::plugin_mcp::PluginMcpService;
use tauri::State;

fn bob_path(service: &BobService) -> AppResult<String> {
    service
        .get_binary_path()
        .or_else(|| service.detect().path)
        .ok_or_else(|| {
            AppError::BobNotFound(
                "Bob Shell non détecté pour installer les outils MCP du plugin".into(),
            )
        })
}

fn sync_plugin_mcp(service: &BobService, plugin: &Plugin, enabled: bool) -> AppResult<()> {
    if !PluginMcpService::has_servers(&plugin.manifest) {
        return Ok(());
    }
    let bundle_dir = PluginMcpService::bundle_dir(&plugin.manifest)?;
    PluginMcpService::new()
        .sync(
            &bob_path(service)?,
            &plugin.id,
            &plugin.manifest,
            &bundle_dir,
            enabled,
        )
        .map(|_| ())
}

fn reconcile_plugin_tools(service: &BobService, previous: &Plugin, next: &Plugin) -> AppResult<()> {
    let enabled = next.install_state == "installed";
    if PluginMcpService::has_servers(&next.manifest) {
        sync_plugin_mcp(service, next, enabled)?;
    }
    if PluginMcpService::has_servers(&previous.manifest) {
        let old_dir = PluginMcpService::bundle_dir(&previous.manifest)?;
        if PluginMcpService::has_servers(&next.manifest) {
            let new_dir = PluginMcpService::bundle_dir(&next.manifest)?;
            PluginMcpService::new().remove_obsolete(
                &bob_path(service)?,
                &next.id,
                &previous.manifest,
                &old_dir,
                &next.manifest,
                &new_dir,
            )?;
        } else {
            PluginMcpService::new().remove(
                &bob_path(service)?,
                &previous.id,
                &previous.manifest,
                &old_dir,
            )?;
        }
    }
    Ok(())
}

fn switch_plugin_version(
    db: &Database,
    bob_service: &BobService,
    plugin_id: &str,
    version: &str,
) -> AppResult<Plugin> {
    let service = PluginService::new();
    let previous = service
        .get_by_id(db, plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    let next = service.activate_version(db, plugin_id, version)?;
    if let Err(error) = reconcile_plugin_tools(bob_service, &previous, &next) {
        if let Ok(restored) = service.activate_version(db, plugin_id, &previous.version) {
            let _ = reconcile_plugin_tools(bob_service, &next, &restored);
        }
        return Err(error);
    }
    Ok(next)
}

#[tauri::command]
pub async fn get_plugins(
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<Vec<Plugin>, AppError> {
    PluginService::new().sync_agentic_bundles(&db)?;
    let plugins = PluginService::new().get_all(&db)?;
    for plugin in plugins
        .iter()
        .filter(|plugin| plugin.install_state == "installed")
    {
        if PluginMcpService::has_servers(&plugin.manifest) {
            let needs_install = PluginMcpService::bundle_dir(&plugin.manifest)
                .and_then(|bundle_dir| {
                    PluginMcpService::new().status(&plugin.id, &plugin.manifest, &bundle_dir)
                })
                .map(|servers| servers.iter().any(|server| !server.configured))
                .unwrap_or(true);
            if needs_install {
                if let Err(error) = sync_plugin_mcp(&bob_service, plugin, true) {
                    tracing::warn!(
                        "Unable to reconcile MCP tools for plugin {}: {:?}",
                        plugin.id,
                        error
                    );
                }
            }
        }
    }
    Ok(plugins)
}

#[tauri::command]
pub async fn get_plugin(id: String, db: State<'_, Database>) -> Result<Option<Plugin>, AppError> {
    PluginService::new().get_by_id(&db, &id)
}

#[tauri::command]
pub async fn get_plugin_versions(
    plugin_id: String,
    db: State<'_, Database>,
) -> Result<Vec<PluginVersion>, AppError> {
    PluginService::new().list_versions(&db, &plugin_id)
}

#[tauri::command]
pub async fn compare_plugin_version(
    plugin_id: String,
    version: String,
    db: State<'_, Database>,
) -> Result<PluginVersionDiff, AppError> {
    PluginService::new().compare_version(&db, &plugin_id, &version)
}

#[tauri::command]
pub async fn install_plugin_update(
    plugin_id: String,
    version: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<Plugin, AppError> {
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    if plugin.available_version.as_deref() != Some(version.as_str()) {
        return Err(AppError::ValidationFailed(
            "Cette mise à jour n’est plus disponible. Actualisez la liste des plugins.".into(),
        ));
    }
    switch_plugin_version(&db, &bob_service, &plugin_id, &version)
}

#[tauri::command]
pub async fn rollback_plugin_version(
    plugin_id: String,
    version: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<Plugin, AppError> {
    switch_plugin_version(&db, &bob_service, &plugin_id, &version)
}

#[tauri::command]
pub async fn create_plugin(
    input: CreatePluginInput,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<Plugin, AppError> {
    let plugin = PluginService::new().create(&db, input)?;
    if let Err(error) = sync_plugin_mcp(&bob_service, &plugin, true) {
        let _ = PluginService::new().uninstall(&db, &plugin.id);
        return Err(error);
    }
    Ok(plugin)
}

#[tauri::command]
pub async fn update_plugin(
    plugin_id: String,
    input: CreatePluginInput,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<Plugin, AppError> {
    let previous = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    let plugin = PluginService::new().update(&db, &plugin_id, input)?;
    if PluginMcpService::has_servers(&plugin.manifest) {
        sync_plugin_mcp(&bob_service, &plugin, plugin.install_state == "installed")?;
    }
    if PluginMcpService::has_servers(&previous.manifest) {
        let old_dir = PluginMcpService::bundle_dir(&previous.manifest)?;
        let new_dir = PluginMcpService::bundle_dir(&plugin.manifest)?;
        PluginMcpService::new().remove_obsolete(
            &bob_path(&bob_service)?,
            &plugin.id,
            &previous.manifest,
            &old_dir,
            &plugin.manifest,
            &new_dir,
        )?;
    }
    Ok(plugin)
}

#[tauri::command]
pub async fn delete_plugin(
    plugin_id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    if PluginMcpService::has_servers(&plugin.manifest) {
        let bundle_dir = PluginMcpService::bundle_dir(&plugin.manifest)?;
        PluginMcpService::new().remove(
            &bob_path(&bob_service)?,
            &plugin.id,
            &plugin.manifest,
            &bundle_dir,
        )?;
    }
    PluginService::new().uninstall(&db, &plugin_id)
}

#[tauri::command]
pub async fn install_plugin(
    plugin_id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    PluginService::new().install(&db, &plugin_id)?;
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    if let Err(error) = sync_plugin_mcp(&bob_service, &plugin, true) {
        let _ = PluginService::new().toggle(&db, &plugin_id, false);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn uninstall_plugin(
    plugin_id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    delete_plugin(plugin_id, db, bob_service).await
}

#[tauri::command]
pub async fn toggle_plugin(
    plugin_id: String,
    enabled: bool,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    if !enabled && PluginMcpService::has_servers(&plugin.manifest) {
        let bundle_dir = PluginMcpService::bundle_dir(&plugin.manifest)?;
        PluginMcpService::new().set_enabled(
            &bob_path(&bob_service)?,
            &plugin.id,
            &plugin.manifest,
            &bundle_dir,
            false,
        )?;
    }
    PluginService::new().toggle(&db, &plugin_id, enabled)?;
    if enabled {
        if let Err(error) = sync_plugin_mcp(&bob_service, &plugin, true) {
            let _ = PluginService::new().toggle(&db, &plugin_id, false);
            return Err(error);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_plugin_mcp_status(
    plugin_id: String,
    db: State<'_, Database>,
) -> Result<Vec<PluginMcpStatus>, AppError> {
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    if !PluginMcpService::has_servers(&plugin.manifest) {
        return Ok(vec![]);
    }
    let bundle_dir = PluginMcpService::bundle_dir(&plugin.manifest)?;
    PluginMcpService::new().status(&plugin.id, &plugin.manifest, &bundle_dir)
}

#[tauri::command]
pub async fn get_plugin_extension_status(
    plugin_id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<PluginExtensionStatus, AppError> {
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    PluginExtensionService::new().status(&plugin.id, &plugin.manifest, &db, &bob_service)
}

#[tauri::command]
pub async fn validate_plugin(
    manifest: serde_json::Value,
) -> Result<PluginValidationResult, AppError> {
    Ok(PluginService::new().validate(&manifest))
}
