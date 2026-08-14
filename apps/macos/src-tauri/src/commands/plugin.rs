use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::plugin::{
    CreatePluginInput, Plugin, PluginExtensionStatus, PluginMcpStatus, PluginMcpTestResult,
    PluginResourceStatus, PluginValidationResult, PluginVersion, PluginVersionDiff,
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

fn mcp_sync_error(plugin_name: &str, error: AppError) -> AppError {
    AppError::Plugin(format!(
        "Sync MCP échouée pour « {plugin_name} » : {error}. Les outils du plugin ne sont pas prêts — vérifiez Bob Shell (`bob mcp`) puis réessayez d’activer le plugin."
    ))
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
    // Keep the activated plugin even if Bob Shell MCP sync fails — otherwise
    // Office builtins stay stuck on "Prête à être installée" forever.
    // Retry MCP sync on the next install / toggle of this plugin.
    if let Err(error) = reconcile_plugin_tools(bob_service, &previous, &next) {
        tracing::warn!(
            "Plugin {} switched to {} but MCP tools sync failed: {:?}",
            plugin_id,
            version,
            error
        );
    }
    Ok(next)
}

#[tauri::command]
pub async fn get_plugins(
    db: State<'_, Database>,
    _bob_service: State<'_, BobService>,
) -> Result<Vec<Plugin>, AppError> {
    let service = PluginService::new();
    // Apply any staged built-in package bumps (e.g. 1.0 → 1.1) so the Plugins
    // screen does not stay stuck on "Prête à être installée".
    if let Err(error) = service.ensure_builtin_plugins(&db) {
        tracing::warn!("Unable to refresh built-in plugins: {:?}", error);
    }
    service.sync_agentic_bundles(&db)?;
    // Do not reconcile Bob MCP on list — each `bob mcp add-json` used to block
    // the Plugins screen for ~1s per plugin (and forever when workspace-scoped
    // mcp.json was missing). MCP is synced on install / toggle / version switch.
    Ok(service.get_all(&db)?)
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
        return Err(mcp_sync_error(&plugin.name, error));
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
        return Err(mcp_sync_error(&plugin.name, error));
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
            return Err(mcp_sync_error(&plugin.name, error));
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
    let tests = crate::services::connection_test::ConnectionTestService::new().list(&db)?;
    let mut statuses = PluginMcpService::new().status(&plugin.id, &plugin.manifest, &bundle_dir)?;
    for status in &mut statuses {
        status.last_test = tests
            .get(
                &crate::services::connection_test::ConnectionTestService::plugin_mcp_key(
                    &plugin_id, &status.id,
                ),
            )
            .or_else(|| {
                tests.get(
                    &crate::services::connection_test::ConnectionTestService::mcp_key(&status.id),
                )
            })
            .map(|record| record.summary());
    }
    Ok(statuses)
}

#[tauri::command]
pub async fn test_plugin_mcp(
    plugin_id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<Vec<PluginMcpTestResult>, AppError> {
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    if !PluginMcpService::has_servers(&plugin.manifest) {
        return Err(AppError::ValidationFailed(
            "Ce plugin ne déclare aucun serveur MCP.".into(),
        ));
    }
    let bundle_dir = PluginMcpService::bundle_dir(&plugin.manifest)?;
    // Best-effort register in Bob Shell so status stays in sync after a successful probe.
    if plugin.install_state == "installed" {
        if let Err(error) = sync_plugin_mcp(&bob_service, &plugin, true) {
            tracing::warn!(
                "MCP sync before test for {} failed (probe continues): {:?}",
                plugin_id,
                error
            );
        }
    }
    let mut results = PluginMcpService::new().test(&plugin.id, &plugin.manifest, &bundle_dir)?;
    let saved = crate::services::connection_test::ConnectionTestService::new()
        .save_plugin_mcp_tests(&db, &plugin_id, &results)?;
    for (result, record) in results.iter_mut().zip(saved.into_iter()) {
        result.tested_at = Some(record.tested_at);
    }
    Ok(results)
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
pub async fn get_plugin_resource_status(
    plugin_id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<Vec<PluginResourceStatus>, AppError> {
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
    PluginExtensionService::new().resource_status(&plugin.id, &plugin.manifest, &db, &bob_service)
}

#[tauri::command]
pub async fn validate_plugin(
    manifest: serde_json::Value,
) -> Result<PluginValidationResult, AppError> {
    Ok(PluginService::new().validate(&manifest))
}

#[tauri::command]
pub async fn export_plugin_zip(
    plugin_id: String,
    destination: String,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    let plugin = PluginService::new()
        .get_by_id(&db, &plugin_id)?
        .ok_or_else(|| AppError::NotFound(format!("Plugin {plugin_id} not found")))?;
    let bundle_dir = PluginMcpService::bundle_dir(&plugin.manifest)?;
    crate::services::plugin_archive::PluginArchiveService::new()
        .export_dir_to_zip(&bundle_dir, std::path::Path::new(&destination))
}

#[tauri::command]
pub async fn import_plugin_zip(
    source: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<Plugin, AppError> {
    let bundle = crate::services::plugin_archive::PluginArchiveService::new()
        .import_zip_to_skills(std::path::Path::new(&source))?;
    let slug = bundle
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let service = PluginService::new();
    let _ = service.sync_agentic_bundles(&db)?;
    let plugin = service
        .get_all(&db)?
        .into_iter()
        .find(|plugin| {
            plugin
                .manifest
                .get("slug")
                .and_then(|value| value.as_str())
                == Some(slug.as_str())
                || plugin.id == format!("agentic-{slug}")
        })
        .ok_or_else(|| {
            AppError::Plugin(
                "Import terminé mais aucun plugin détecté — vérifiez .bob-work-plugin.json dans l’archive."
                    .into(),
            )
        })?;
    if plugin.install_state == "installed" {
        if let Err(error) = sync_plugin_mcp(&bob_service, &plugin, true) {
            tracing::warn!(
                "Plugin {} imported but MCP sync failed: {:?}",
                plugin.id,
                error
            );
        }
    }
    Ok(plugin)
}
