// ============================================================
// Bob Work - Plugin Service
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::plugin::{
    CreatePluginInput, Plugin, PluginValidationResult, PluginVersion, PluginVersionDiff,
};
use crate::services::plugin_deploy::PluginDeployService;
use crate::services::plugin_extensions::PluginExtensionService;
use crate::services::plugin_mcp::PluginMcpService;
use chrono::Utc;
use rusqlite::params;
use semver::Version;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use tracing::{info, warn};
use uuid::Uuid;

pub struct PluginService;

impl PluginService {
    pub fn new() -> Self {
        Self
    }

    /// Keep Bob Work's first-party document capabilities available as native
    /// Bob Shell skills. A newer packaged built-in is activated automatically;
    /// only a failed activation falls back to an explicit staged update.
    pub fn ensure_builtin_plugins(&self, db: &Database) -> AppResult<()> {
        // Keep packaged work entries current before legacy migrations: one bad
        // local legacy row must not leave their classification stale.
        self.ensure_packaged_work_plugins(db)?;
        self.promote_legacy_cloud_architect(db)?;
        self.promote_legacy_ibm_agentic_plugins(db)?;
        for builtin in builtin_document_plugins() {
            let now = Utc::now().to_rfc3339();
            let Some(existing) = self.get_by_id(db, builtin.id)? else {
                let conn = db.conn.lock().unwrap();
                conn.execute(
                    "INSERT INTO plugins
                     (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at)
                     VALUES (?1,?2,?3,'Bob Work',?4,'personal',?5,?6,'installed','valid',?7,?7)
                    ",
                    params![
                        builtin.id,
                        builtin.name,
                        builtin.version,
                        builtin.description,
                        builtin.category,
                        builtin.manifest.to_string(),
                        now,
                    ],
                )?;
                drop(conn);
                let plugin = self.get_by_id(db, builtin.id)?.ok_or_else(|| {
                    AppError::NotFound(format!("Plugin {} not found", builtin.id))
                })?;
                self.persist_version(db, &plugin, None, true)?;
                PluginDeployService::new().deploy(builtin.id, &builtin.manifest)?;
                continue;
            };

            let packaged_version = Self::parse_version(builtin.version)?;
            let current_version = Self::parse_version(&existing.version)?;
            if packaged_version > current_version {
                let candidate = Plugin {
                    id: builtin.id.into(),
                    name: builtin.name.into(),
                    version: builtin.version.into(),
                    author: Some("Bob Work".into()),
                    description: Some(builtin.description.into()),
                    scope: existing.scope.clone(),
                    category: builtin.category.into(),
                    manifest: builtin.manifest.clone(),
                    install_state: existing.install_state.clone(),
                    validation_state: "valid".into(),
                    signature: None,
                    created_at: existing.created_at.clone(),
                    updated_at: now.clone(),
                    last_executed_at: existing.last_executed_at.clone(),
                    available_version: Some(builtin.version.into()),
                };
                if !self.version_exists(db, builtin.id, builtin.version)? {
                    self.persist_version(db, &candidate, None, false)?;
                } else {
                    // Refresh the packaged snapshot so a bad staged manifest
                    // (e.g. invalid OAuth schema) cannot block activation forever.
                    self.refresh_builtin_version(db, &candidate)?;
                }
                // Packaged builtin bumps are applied automatically. Staging them
                // as "Prête à être installée" left the Update button as the only
                // path, and that path often failed on MCP/deploy side-effects.
                match self.activate_version(db, builtin.id, builtin.version) {
                    Ok(_) => {
                        info!(
                            "Auto-activated built-in plugin {} to {}",
                            builtin.id, builtin.version
                        );
                    }
                    Err(error) => {
                        warn!(
                            "Could not auto-activate built-in plugin {} to {}: {}",
                            builtin.id, builtin.version, error
                        );
                        let keep_available = existing
                            .available_version
                            .as_deref()
                            .and_then(|value| Self::parse_version(value).ok())
                            .filter(|version| version > &packaged_version)
                            .map(|version| version.to_string())
                            .unwrap_or_else(|| builtin.version.into());
                        let conn = db.conn.lock().unwrap();
                        conn.execute(
                            "UPDATE plugins SET available_version=?1,updated_at=?2 WHERE id=?3",
                            params![keep_available, now, builtin.id],
                        )?;
                    }
                }
            } else if packaged_version == current_version {
                if existing.available_version.is_some() {
                    let conn = db.conn.lock().unwrap();
                    conn.execute(
                        "UPDATE plugins SET available_version=NULL,updated_at=?1 WHERE id=?2",
                        params![now, builtin.id],
                    )?;
                }
                if Self::normalized_manifest(&existing.manifest)
                    != Self::normalized_manifest(&builtin.manifest)
                {
                    info!(
                        "Refreshing built-in plugin {} catalog metadata at version {}",
                        builtin.id, builtin.version
                    );
                    let conn = db.conn.lock().unwrap();
                    conn.execute(
                        "UPDATE plugins SET name=?1,description=?2,category=?3,manifest=?4,updated_at=?5 WHERE id=?6",
                        params![
                            builtin.name,
                            builtin.description,
                            builtin.category,
                            builtin.manifest.to_string(),
                            now,
                            builtin.id,
                        ],
                    )?;
                    drop(conn);
                    let refreshed = Plugin {
                        id: builtin.id.into(),
                        name: builtin.name.into(),
                        version: builtin.version.into(),
                        author: existing.author.clone(),
                        description: Some(builtin.description.into()),
                        scope: existing.scope.clone(),
                        category: builtin.category.into(),
                        manifest: builtin.manifest.clone(),
                        install_state: existing.install_state.clone(),
                        validation_state: "valid".into(),
                        signature: existing.signature.clone(),
                        created_at: existing.created_at.clone(),
                        updated_at: now.clone(),
                        last_executed_at: existing.last_executed_at.clone(),
                        available_version: None,
                    };
                    if self.version_exists(db, builtin.id, builtin.version)? {
                        self.refresh_builtin_version(db, &refreshed)?;
                    }
                }
            }
            let active = self.get_by_id(db, builtin.id)?.unwrap_or(existing.clone());
            if active.install_state == "installed" {
                let active_matches_packaged =
                    Self::parse_version(&active.version)? == packaged_version;
                let deploy_manifest = if active_matches_packaged {
                    &builtin.manifest
                } else {
                    &active.manifest
                };
                let deployer = PluginDeployService::new();
                // Refresh only when the on-disk skill is missing/stale — rewriting
                // every launch was wiping newer installed versions (and local edits).
                if !deployer.is_current_deploy(builtin.id, &active.version, deploy_manifest) {
                    let result = if active_matches_packaged {
                        deployer.deploy(builtin.id, deploy_manifest)
                    } else {
                        deployer.deploy_preserving_embedded(builtin.id, deploy_manifest)
                    };
                    if let Err(error) = result {
                        warn!(
                            "Built-in plugin {} deploy failed (non-fatal): {}",
                            builtin.id, error
                        );
                    }
                }
            }
            if !self.version_exists(db, builtin.id, &active.version)? {
                self.persist_version(db, &active, None, true)?;
            }
        }
        if let Err(error) = self.prune_shadow_agentic_plugins(db) {
            warn!("Unable to prune shadow agentic plugins: {}", error);
        }
        Ok(())
    }

    /// Work-level packaged plugins that ship with Bob Work. Personal bundles stay
    /// editable; manifests marked built-in are protected by their catalog metadata.
    fn ensure_packaged_work_plugins(&self, db: &Database) -> AppResult<()> {
        self.demote_legacy_cto_builtin(db)?;
        for packaged in packaged_work_plugins() {
            if self.is_packaged_work_dismissed(db, packaged.id)? {
                continue;
            }
            let now = Utc::now().to_rfc3339();
            let packaged_builtin = packaged
                .manifest
                .get("builtin")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let Some(existing) = self.get_by_id(db, packaged.id)? else {
                let conn = db.conn.lock().unwrap();
                conn.execute(
                    "INSERT INTO plugins
                     (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at)
                     VALUES (?1,?2,?3,'Bob Work',?4,'personal',?5,?6,'installed','valid',?7,?7)
                    ",
                    params![
                        packaged.id,
                        packaged.name,
                        packaged.version,
                        packaged.description,
                        packaged.category,
                        packaged.manifest.to_string(),
                        now,
                    ],
                )?;
                drop(conn);
                let plugin = self.get_by_id(db, packaged.id)?.ok_or_else(|| {
                    AppError::NotFound(format!("Plugin {} not found", packaged.id))
                })?;
                self.persist_version(db, &plugin, None, true)?;
                PluginDeployService::new().deploy(packaged.id, &packaged.manifest)?;
                continue;
            };

            let packaged_version = Self::parse_version(packaged.version)?;
            let current_version = Self::parse_version(&existing.version)?;
            let mut force_redeploy = false;
            if packaged_version > current_version {
                let candidate = Plugin {
                    id: packaged.id.into(),
                    name: packaged.name.into(),
                    version: packaged.version.into(),
                    author: Some("Bob Work".into()),
                    description: Some(packaged.description.into()),
                    scope: existing.scope.clone(),
                    category: packaged.category.into(),
                    manifest: packaged.manifest.clone(),
                    install_state: existing.install_state.clone(),
                    validation_state: "valid".into(),
                    signature: None,
                    created_at: existing.created_at.clone(),
                    updated_at: now.clone(),
                    last_executed_at: existing.last_executed_at.clone(),
                    available_version: Some(packaged.version.into()),
                };
                if !self.version_exists(db, packaged.id, packaged.version)? {
                    self.persist_version(db, &candidate, None, false)?;
                }
                // Stage only — do not auto-activate (Restaurer / Mettre à jour stay honest).
                let keep_available = existing
                    .available_version
                    .as_deref()
                    .and_then(|value| Self::parse_version(value).ok())
                    .filter(|version| version > &packaged_version)
                    .map(|version| version.to_string())
                    .unwrap_or_else(|| packaged.version.into());
                let conn = db.conn.lock().unwrap();
                conn.execute(
                    "UPDATE plugins SET available_version=?1,updated_at=?2 WHERE id=?3",
                    params![keep_available, now, packaged.id],
                )?;
            } else if packaged_version == current_version {
                let mut manifest = packaged.manifest.clone();
                if let Some(object) = manifest.as_object_mut() {
                    object.insert("builtin".into(), serde_json::Value::Bool(packaged_builtin));
                }
                if Self::normalized_manifest(&existing.manifest)
                    != Self::normalized_manifest(&manifest)
                {
                    let conn = db.conn.lock().unwrap();
                    conn.execute(
                        "UPDATE plugins SET name=?1,description=?2,category=?3,manifest=?4,available_version=NULL,updated_at=?5 WHERE id=?6",
                        params![
                            packaged.name,
                            packaged.description,
                            packaged.category,
                            manifest.to_string(),
                            now,
                            packaged.id,
                        ],
                    )?;
                    // Packaged metadata changed without a semver bump — refresh disk once.
                    force_redeploy = true;
                } else if existing.available_version.is_some() {
                    let conn = db.conn.lock().unwrap();
                    conn.execute(
                        "UPDATE plugins SET available_version=NULL,updated_at=?1 WHERE id=?2",
                        params![now, packaged.id],
                    )?;
                }
            }

            let active = self.get_by_id(db, packaged.id)?.unwrap_or(existing);
            if active.install_state == "installed" {
                let active_matches_packaged =
                    Self::parse_version(&active.version)? == packaged_version;
                let deploy_manifest = if active_matches_packaged {
                    &packaged.manifest
                } else {
                    &active.manifest
                };
                let deployer = PluginDeployService::new();
                let needs_deploy = force_redeploy
                    || !deployer.is_current_deploy(packaged.id, &active.version, deploy_manifest);
                if needs_deploy {
                    let result = if active_matches_packaged {
                        deployer.deploy(packaged.id, deploy_manifest)
                    } else {
                        // Active version is ahead of (or diverged from) the app
                        // package — refresh SKILL/metadata only; keep Python edits.
                        deployer.deploy_preserving_embedded(packaged.id, deploy_manifest)
                    };
                    if let Err(error) = result {
                        warn!(
                            "Packaged work plugin {} deploy failed (non-fatal): {}",
                            packaged.id, error
                        );
                    }
                }
            }
            if !self.version_exists(db, packaged.id, &active.version)? {
                self.persist_version(db, &active, None, true)?;
            }
        }
        Ok(())
    }

    /// Rewrite legacy `builtin-cto-invest` rows to the non-protected packaged id.
    fn demote_legacy_cto_builtin(&self, db: &Database) -> AppResult<()> {
        const LEGACY_ID: &str = "builtin-cto-invest";
        const TARGET_ID: &str = "bob-work-cto-invest";
        let Some(legacy) = self.get_by_id(db, LEGACY_ID)? else {
            return Ok(());
        };
        if self.get_by_id(db, TARGET_ID)?.is_some() {
            let conn = db.conn.lock().unwrap();
            let _ = conn.execute(
                "DELETE FROM plugin_versions WHERE plugin_id=?1",
                params![LEGACY_ID],
            );
            conn.execute("DELETE FROM plugins WHERE id=?1", params![LEGACY_ID])?;
            info!("Removed legacy builtin CTO row (target {TARGET_ID} already present)");
            return Ok(());
        }

        let mut manifest = legacy.manifest.clone();
        if let Some(object) = manifest.as_object_mut() {
            object.insert("builtin".into(), serde_json::Value::Bool(false));
            object.insert("slug".into(), serde_json::Value::String(TARGET_ID.into()));
        }
        let now = Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().unwrap();
            // Insert target row first so plugin_versions FK can be remapped safely.
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,signature,created_at,updated_at,last_executed_at,available_version)
                 SELECT ?1,name,version,author,description,scope,category,?2,install_state,validation_state,signature,created_at,?3,last_executed_at,available_version
                 FROM plugins WHERE id=?4",
                params![TARGET_ID, manifest.to_string(), now, LEGACY_ID],
            )?;
            conn.execute(
                "UPDATE plugin_versions SET plugin_id=?1 WHERE plugin_id=?2",
                params![TARGET_ID, LEGACY_ID],
            )?;
            conn.execute("DELETE FROM plugins WHERE id=?1", params![LEGACY_ID])?;
        }
        if legacy.install_state == "installed" {
            if let Err(error) = PluginDeployService::new().deploy(TARGET_ID, &manifest) {
                warn!("CTO demotion deploy failed (non-fatal): {}", error);
            }
        }
        info!("Demoted legacy {LEGACY_ID} → {TARGET_ID}");
        Ok(())
    }

    /// Promote the former personal Senior Cloud Architect plugin to the protected
    /// first-party Cloud Architect identity while preserving its version history.
    fn promote_legacy_cloud_architect(&self, db: &Database) -> AppResult<()> {
        const LEGACY_ID: &str = "agentic-senior-cloud-architect";
        const TARGET_ID: &str = "builtin-cloud-architect";
        let Some(legacy) = self.get_by_id(db, LEGACY_ID)? else {
            return Ok(());
        };
        if self.get_by_id(db, TARGET_ID)?.is_some() {
            let conn = db.conn.lock().unwrap();
            let _ = conn.execute(
                "DELETE FROM plugin_versions WHERE plugin_id=?1",
                params![LEGACY_ID],
            );
            conn.execute("DELETE FROM plugins WHERE id=?1", params![LEGACY_ID])?;
        } else {
            let mut manifest = legacy.manifest.clone();
            if let Some(object) = manifest.as_object_mut() {
                object.insert("builtin".into(), serde_json::Value::Bool(true));
                object.insert(
                    "name".into(),
                    serde_json::Value::String("Cloud Architect".into()),
                );
                object.insert(
                    "slug".into(),
                    serde_json::Value::String("cloud-architect".into()),
                );
            }
            let now = Utc::now().to_rfc3339();
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,signature,created_at,updated_at,last_executed_at,available_version)
                 SELECT ?1,'Cloud Architect',version,'Bob Work',description,scope,category,?2,install_state,validation_state,signature,created_at,?3,last_executed_at,available_version
                 FROM plugins WHERE id=?4",
                params![TARGET_ID, manifest.to_string(), now, LEGACY_ID],
            )?;
            conn.execute(
                "UPDATE plugin_versions SET plugin_id=?1 WHERE plugin_id=?2",
                params![TARGET_ID, LEGACY_ID],
            )?;
            conn.execute("DELETE FROM plugins WHERE id=?1", params![LEGACY_ID])?;
        }
        let deployer = PluginDeployService::new();
        let _ = deployer.undeploy(LEGACY_ID);
        let _ = deployer.retire_agentic_bundle(LEGACY_ID);
        info!("Promoted legacy {LEGACY_ID} → {TARGET_ID}");
        Ok(())
    }

    /// Fold pre-catalog agentic copies (`agentic-ibm-agentic-*`) into the
    /// protected built-in ids so "Mettre à jour" is not stuck on a version row
    /// that was never snapshotted.
    fn promote_legacy_ibm_agentic_plugins(&self, db: &Database) -> AppResult<()> {
        for builtin in builtin_document_plugins() {
            if !builtin.id.starts_with("builtin-ibm-agentic-") {
                continue;
            }
            let Some(slug) = builtin
                .manifest
                .get("slug")
                .and_then(|value| value.as_str())
            else {
                continue;
            };
            let legacy_ids = [format!("agentic-{slug}"), slug.to_string()];
            for legacy_id in legacy_ids {
                if legacy_id == builtin.id {
                    continue;
                }
                if self.get_by_id(db, &legacy_id)?.is_none() {
                    continue;
                }
                if self.get_by_id(db, builtin.id)?.is_some() {
                    let conn = db.conn.lock().unwrap();
                    let _ = conn.execute(
                        "DELETE FROM plugin_versions WHERE plugin_id=?1",
                        params![legacy_id],
                    );
                    conn.execute("DELETE FROM plugins WHERE id=?1", params![legacy_id])?;
                    drop(conn);
                    info!(
                        "Removed legacy IBM agentic row {} (target {} already present)",
                        legacy_id, builtin.id
                    );
                    continue;
                }
                let legacy = self
                    .get_by_id(db, &legacy_id)?
                    .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", legacy_id)))?;
                let mut manifest = legacy.manifest.clone();
                if let Some(object) = manifest.as_object_mut() {
                    object.insert("builtin".into(), serde_json::Value::Bool(true));
                    object.insert("slug".into(), serde_json::Value::String(slug.into()));
                    object.remove("bundlePath");
                    object.remove("sourceBundlePath");
                }
                let now = Utc::now().to_rfc3339();
                {
                    let conn = db.conn.lock().unwrap();
                    conn.execute(
                        "INSERT INTO plugins
                         (id,name,version,author,description,scope,category,manifest,install_state,validation_state,signature,created_at,updated_at,last_executed_at,available_version)
                         SELECT ?1,name,version,author,description,scope,category,?2,install_state,validation_state,signature,created_at,?3,last_executed_at,available_version
                         FROM plugins WHERE id=?4",
                        params![builtin.id, manifest.to_string(), now, legacy_id],
                    )?;
                    conn.execute(
                        "UPDATE plugin_versions SET plugin_id=?1 WHERE plugin_id=?2",
                        params![builtin.id, legacy_id],
                    )?;
                    conn.execute("DELETE FROM plugins WHERE id=?1", params![legacy_id])?;
                }
                info!("Promoted legacy {legacy_id} → {}", builtin.id);
            }
        }
        Ok(())
    }

    fn is_packaged_work_plugin(plugin_id: &str) -> bool {
        packaged_work_plugins()
            .iter()
            .any(|plugin| plugin.id == plugin_id)
    }

    fn is_protected_builtin(plugin_id: &str) -> bool {
        plugin_id.starts_with("builtin-")
            || builtin_document_plugins()
                .iter()
                .any(|plugin| plugin.id == plugin_id)
            || packaged_work_plugins().iter().any(|plugin| {
                plugin.id == plugin_id
                    && plugin
                        .manifest
                        .get("builtin")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false)
            })
    }

    fn dismissed_packaged_work_plugins(db: &Database) -> AppResult<BTreeSet<String>> {
        let conn = db.conn.lock().unwrap();
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params!["dismissed_packaged_plugins"],
                |row| row.get(0),
            )
            .ok();
        let Some(raw) = raw else {
            return Ok(BTreeSet::new());
        };
        let parsed: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
        Ok(parsed.into_iter().collect())
    }

    fn is_packaged_work_dismissed(&self, db: &Database, plugin_id: &str) -> AppResult<bool> {
        Ok(Self::dismissed_packaged_work_plugins(db)?.contains(plugin_id))
    }

    fn dismiss_packaged_work_plugin(&self, db: &Database, plugin_id: &str) -> AppResult<()> {
        let mut dismissed = Self::dismissed_packaged_work_plugins(db)?;
        if !dismissed.insert(plugin_id.to_string()) {
            return Ok(());
        }
        let now = Utc::now().to_rfc3339();
        let value = serde_json::to_string(&dismissed.into_iter().collect::<Vec<_>>())?;
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params!["dismissed_packaged_plugins", value, now],
        )?;
        Ok(())
    }

    /// Drop agentic-* registry rows that duplicate a first-party / packaged slug.
    /// Those shadows were imported before owned-by skips and usually
    /// have no `manifest.icon`, producing icon-less duplicates in the UI.
    pub fn prune_shadow_agentic_plugins(&self, db: &Database) -> AppResult<usize> {
        let plugins = self.get_all(db)?;
        let keepers: Vec<&Plugin> = plugins
            .iter()
            .filter(|plugin| !plugin.id.starts_with("agentic-"))
            .collect();
        let canonical_slug_keys: BTreeSet<String> = keepers
            .iter()
            .flat_map(|plugin| {
                plugin
                    .manifest
                    .get("slug")
                    .and_then(|value| value.as_str())
                    .map(catalog_slug_keys)
                    .unwrap_or_default()
            })
            .collect();
        let canonical_names: BTreeSet<String> = keepers
            .iter()
            .filter(|plugin| {
                Self::is_protected_builtin(&plugin.id) || Self::is_packaged_work_plugin(&plugin.id)
            })
            .map(|plugin| plugin.name.trim().to_ascii_lowercase())
            .filter(|name| !name.is_empty())
            .collect();
        let mut removed = 0usize;
        for plugin in plugins {
            if !plugin.id.starts_with("agentic-") {
                continue;
            }
            let slug = plugin.manifest.get("slug").and_then(|value| value.as_str());
            let slug_duplicate = slug
                .map(catalog_slug_keys)
                .is_some_and(|keys| keys.intersection(&canonical_slug_keys).next().is_some());
            let name_duplicate = canonical_names.contains(&plugin.name.trim().to_ascii_lowercase());
            if !slug_duplicate && !name_duplicate {
                continue;
            }
            // Retire discovery for this agentic id only — do not undeploy the
            // shared skill directory owned by the canonical plugin.
            if let Err(error) = PluginDeployService::new().retire_agentic_bundle(&plugin.id) {
                warn!(
                    "Could not retire shadow agentic bundle {}: {}",
                    plugin.id, error
                );
            }
            let conn = db.conn.lock().unwrap();
            let _ = conn.execute(
                "DELETE FROM plugin_versions WHERE plugin_id=?1",
                params![plugin.id],
            );
            conn.execute("DELETE FROM plugins WHERE id=?1", params![plugin.id])?;
            drop(conn);
            info!(
                "Pruned shadow agentic plugin {} (slug {})",
                plugin.id,
                slug.unwrap_or("")
            );
            removed += 1;
        }
        Ok(removed)
    }

    fn slug_owned_by_canonical_plugin(&self, db: &Database, slug: &str) -> AppResult<bool> {
        let incoming = catalog_slug_keys(slug);
        Ok(self.get_all(db)?.iter().any(|plugin| {
            if plugin.id.starts_with("agentic-") {
                return false;
            }
            plugin
                .manifest
                .get("slug")
                .and_then(|value| value.as_str())
                .is_some_and(|owned| {
                    catalog_slug_keys(owned)
                        .intersection(&incoming)
                        .next()
                        .is_some()
                })
        }))
    }

    /// Register local Office / packaged MCP servers for installed plugins that ship with Bob Work.
    pub fn sync_installed_office_mcps(&self, db: &Database, bob_path: &str) -> AppResult<()> {
        let packaged = builtin_document_plugins()
            .into_iter()
            .chain(packaged_work_plugins());
        for builtin in packaged {
            if !PluginMcpService::has_servers(&builtin.manifest) {
                continue;
            }
            let Some(plugin) = self.get_by_id(db, builtin.id)? else {
                continue;
            };
            if plugin.install_state != "installed" {
                continue;
            }
            let manifest = if PluginMcpService::has_servers(&plugin.manifest) {
                plugin.manifest.clone()
            } else {
                builtin.manifest.clone()
            };
            let bundle_dir = PluginMcpService::bundle_dir(&manifest)?;
            PluginMcpService::new()
                .sync(bob_path, builtin.id, &manifest, &bundle_dir, true)
                .map(|_| ())?;
        }
        Ok(())
    }

    pub fn get_all(&self, db: &Database) -> AppResult<Vec<Plugin>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, version, author, description, scope, category,
             manifest, install_state, validation_state, signature,
             created_at, updated_at, last_executed_at, available_version
             FROM plugins ORDER BY updated_at DESC",
        )?;

        let plugins = stmt
            .query_map([], |row| {
                Ok(Plugin {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    version: row.get(2)?,
                    author: row.get(3)?,
                    description: row.get(4)?,
                    scope: row.get(5)?,
                    category: row.get(6)?,
                    manifest: serde_json::from_str(
                        &row.get::<_, String>(7).unwrap_or("{}".to_string()),
                    )
                    .unwrap_or_default(),
                    install_state: row.get(8)?,
                    validation_state: row.get(9)?,
                    signature: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                    last_executed_at: row.get(13)?,
                    available_version: row.get(14)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(Self::sort_for_display(plugins))
    }

    /// User/agentic plugins first (newest created first), then builtins.
    fn sort_for_display(mut plugins: Vec<Plugin>) -> Vec<Plugin> {
        plugins.sort_by(|left, right| {
            let left_builtin = Self::is_protected_builtin(&left.id);
            let right_builtin = Self::is_protected_builtin(&right.id);
            match (left_builtin, right_builtin) {
                (false, true) => std::cmp::Ordering::Less,
                (true, false) => std::cmp::Ordering::Greater,
                _ => right
                    .created_at
                    .cmp(&left.created_at)
                    .then_with(|| left.name.cmp(&right.name)),
            }
        });
        plugins
    }

    pub fn get_by_id(&self, db: &Database, id: &str) -> AppResult<Option<Plugin>> {
        let conn = db.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, name, version, author, description, scope, category,
             manifest, install_state, validation_state, signature,
             created_at, updated_at, last_executed_at, available_version
             FROM plugins WHERE id = ?1",
            params![id],
            |row| {
                Ok(Plugin {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    version: row.get(2)?,
                    author: row.get(3)?,
                    description: row.get(4)?,
                    scope: row.get(5)?,
                    category: row.get(6)?,
                    manifest: serde_json::from_str(
                        &row.get::<_, String>(7).unwrap_or("{}".to_string()),
                    )
                    .unwrap_or_default(),
                    install_state: row.get(8)?,
                    validation_state: row.get(9)?,
                    signature: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                    last_executed_at: row.get(13)?,
                    available_version: row.get(14)?,
                })
            },
        );
        match result {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    /// Import agent-created Bob Shell skill bundles into Bob Work's plugin
    /// registry. A bundle is declarative: SKILL.md describes the agent
    /// behavior, `.bob-work-plugin.json` declares permissions/runtime, and
    /// optional entrypoints and MCP servers live below the same directory.
    pub fn sync_agentic_bundles(&self, db: &Database) -> AppResult<Vec<Plugin>> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".to_string()))?;
        self.sync_agentic_bundles_from(db, &home.join(".bob").join("skills"))
    }

    fn sync_agentic_bundles_from(
        &self,
        db: &Database,
        skills_root: &Path,
    ) -> AppResult<Vec<Plugin>> {
        if !skills_root.is_dir() {
            return Ok(vec![]);
        }
        let mut imported = vec![];
        for entry in std::fs::read_dir(skills_root)?.filter_map(Result::ok) {
            let bundle_dir = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            let metadata_path = bundle_dir.join(".bob-work-plugin.json");
            let skill_path = bundle_dir.join("SKILL.md");
            if !metadata_path.is_file() || !skill_path.is_file() {
                continue;
            }
            // Built-in / packaged / Office deployments also write SKILL.md + plugin JSON
            // under ~/.bob/skills. Skip them so they are not re-imported as agentic-*.
            if let Ok(owned_by) = std::fs::read_to_string(bundle_dir.join(".bob-work-plugin-id")) {
                let owned_by = owned_by.trim();
                if owned_by.starts_with("builtin-")
                    || Self::is_packaged_work_plugin(owned_by)
                    || (!owned_by.is_empty() && !owned_by.starts_with("agentic-"))
                {
                    continue;
                }
            }
            if std::fs::read_to_string(&metadata_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                .is_some_and(|value| value.get("builtin") == Some(&serde_json::Value::Bool(true)))
            {
                continue;
            }
            match self.import_agentic_bundle(db, &bundle_dir, &metadata_path, &skill_path) {
                Ok(Some(plugin)) => {
                    if let Err(error) =
                        crate::services::db_prompt::provision_sidecar(db, &plugin.id, &bundle_dir)
                    {
                        warn!(
                            "Unable to import DB sidecar for plugin {}: {:?}",
                            plugin.id, error
                        );
                    }
                    imported.push(plugin);
                }
                Ok(None) => {
                    if let Ok(plugin_id) =
                        std::fs::read_to_string(bundle_dir.join(".bob-work-plugin-id"))
                    {
                        let plugin_id = plugin_id.trim();
                        if !plugin_id.is_empty() {
                            if let Err(error) = crate::services::db_prompt::provision_sidecar(
                                db,
                                plugin_id,
                                &bundle_dir,
                            ) {
                                warn!(
                                    "Unable to import DB sidecar for plugin {plugin_id}: {:?}",
                                    error
                                );
                            }
                        }
                    }
                }
                Err(error) => warn!(
                    "Ignored invalid agentic plugin bundle {:?}: {:?}",
                    bundle_dir, error
                ),
            }
        }
        Ok(imported)
    }

    fn import_agentic_bundle(
        &self,
        db: &Database,
        bundle_dir: &Path,
        metadata_path: &Path,
        skill_path: &Path,
    ) -> AppResult<Option<Plugin>> {
        let metadata = std::fs::symlink_metadata(metadata_path)?;
        let skill_metadata = std::fs::symlink_metadata(skill_path)?;
        if metadata.file_type().is_symlink() || skill_metadata.file_type().is_symlink() {
            return Err(AppError::Plugin(
                "Plugin bundle files cannot be symlinks".into(),
            ));
        }
        if metadata.len() > 256 * 1024 || skill_metadata.len() > 1024 * 1024 {
            return Err(AppError::Plugin(
                "Plugin bundle metadata is too large".into(),
            ));
        }

        let mut manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(metadata_path)?)?;
        let object = manifest
            .as_object_mut()
            .ok_or_else(|| AppError::Plugin("Plugin manifest must be a JSON object".into()))?;
        let directory_slug = bundle_dir
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| AppError::Plugin("Invalid plugin bundle directory".into()))?;
        let slug = object
            .get("slug")
            .and_then(|value| value.as_str())
            .unwrap_or(directory_slug)
            .to_string();
        if slug != directory_slug || !Self::valid_bundle_slug(&slug) {
            return Err(AppError::Plugin(
                "Plugin slug must match its bundle directory".into(),
            ));
        }

        if let Some(entrypoints) = object.get("entrypoints").and_then(|value| value.as_array()) {
            for entrypoint in entrypoints {
                let relative = entrypoint
                    .get("path")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| {
                        AppError::Plugin("Every plugin entrypoint needs a path".into())
                    })?;
                let runtime = entrypoint
                    .get("runtime")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if !matches!(
                    runtime,
                    "python3" | "bash" | "sh" | "zsh" | "node" | "binary"
                ) {
                    return Err(AppError::Plugin(format!(
                        "Unsupported plugin runtime: {}",
                        runtime
                    )));
                }
                crate::services::plugin_bundle_layout::validate_entrypoint_path(runtime, relative)?;
                let relative_path = Path::new(relative);
                let entrypoint_path = bundle_dir.join(relative_path);
                let entrypoint_metadata = std::fs::symlink_metadata(&entrypoint_path)?;
                let max_bytes = if runtime == "binary" {
                    80 * 1024 * 1024
                } else {
                    2 * 1024 * 1024
                };
                if !entrypoint_metadata.is_file()
                    || entrypoint_metadata.file_type().is_symlink()
                    || entrypoint_metadata.len() > max_bytes
                {
                    return Err(AppError::Plugin("Invalid plugin entrypoint file".into()));
                }
                let bundle_root = bundle_dir.canonicalize().map_err(|error| {
                    AppError::Plugin(format!("Invalid plugin bundle directory: {}", error))
                })?;
                crate::security::path_validation::validate_symlink(
                    &entrypoint_path,
                    &[bundle_root.clone()],
                )
                .map_err(|error| AppError::Plugin(error.to_string()))?;
                crate::security::path_validation::validate_path(&entrypoint_path, &[bundle_root])
                    .map_err(|error| AppError::Plugin(error.to_string()))?;
            }
        }

        let skill_markdown = std::fs::read_to_string(skill_path)?;
        let instructions = Self::skill_body(&skill_markdown);
        object.insert("slug".into(), serde_json::Value::String(slug.clone()));
        object.insert("agentic".into(), serde_json::Value::Bool(true));
        object.insert(
            "managedBy".into(),
            serde_json::Value::String("bob-agent".into()),
        );
        object.insert(
            "instructions".into(),
            serde_json::Value::String(instructions),
        );
        object.insert(
            "bundlePath".into(),
            serde_json::Value::String(bundle_dir.to_string_lossy().to_string()),
        );
        object.insert(
            "sourceBundlePath".into(),
            serde_json::Value::String(bundle_dir.to_string_lossy().to_string()),
        );

        let name = object
            .get("name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| AppError::Plugin("Plugin bundle needs a name".into()))?
            .trim()
            .to_string();
        let version = object
            .get("version")
            .and_then(|value| value.as_str())
            .unwrap_or("1.0.0")
            .to_string();
        let parsed_version = Self::parse_version(&version)?;
        let description = object
            .get("description")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let category = object
            .get("category")
            .and_then(|value| value.as_str())
            .unwrap_or("executable")
            .to_string();
        let id = format!("agentic-{}", slug);
        if self.slug_owned_by_canonical_plugin(db, &slug)? {
            warn!(
                "Skipping agentic bundle {:?}: slug {} is owned by a packaged/built-in plugin",
                bundle_dir, slug
            );
            return Ok(None);
        }
        ensure_manifest_icon(&mut manifest, &name, Some(description.as_str()));
        PluginMcpService::new().validate_bundle(&id, &manifest, bundle_dir)?;
        PluginExtensionService::new().prepare_hooks(&manifest)?;
        let validation = self.validate(&manifest);
        if !validation.valid
            || !matches!(category.as_str(), "recipe" | "integration" | "executable")
        {
            return Err(AppError::Plugin(validation.errors.join("; ")));
        }

        if let Some(existing) = self.get_by_id(db, &id)? {
            if existing.version == version && existing.manifest.get("sourceBundlePath").is_none() {
                self.upgrade_legacy_agentic_version(db, &existing, &manifest, bundle_dir)?;
                std::fs::write(bundle_dir.join(".bob-work-plugin-id"), &id)?;
                return self.get_by_id(db, &id);
            }
            if existing.name == name
                && existing.version == version
                && existing.description.as_deref() == Some(description.as_str())
                && existing.category == category
                && Self::normalized_manifest(&existing.manifest)
                    == Self::normalized_manifest(&manifest)
            {
                let _ = std::fs::write(bundle_dir.join(".bob-work-plugin-id"), &id);
                return Ok(None);
            }
            let current_version = Self::parse_version(&existing.version)?;
            if parsed_version < current_version {
                let _ = std::fs::write(bundle_dir.join(".bob-work-plugin-id"), &id);
                return Ok(None);
            }
            if parsed_version == current_version {
                return Err(AppError::ValidationFailed(format!(
                    "Le contenu de {} a changé sans nouvelle version. Incrémentez la version {} avant de le republier.",
                    name, version
                )));
            }
            if let Some(available) = existing.available_version.as_deref() {
                let available_version = Self::parse_version(available)?;
                if available_version > parsed_version {
                    let _ = std::fs::write(bundle_dir.join(".bob-work-plugin-id"), &id);
                    return Ok(None);
                }
            }

            let now = Utc::now().to_rfc3339();
            let candidate = Plugin {
                id: id.clone(),
                name: name.clone(),
                version: version.clone(),
                author: Some("Bob Agent".into()),
                description: Some(description.clone()),
                scope: existing.scope.clone(),
                category: category.clone(),
                manifest: manifest.clone(),
                install_state: existing.install_state.clone(),
                validation_state: if validation.warnings.is_empty() {
                    "valid".into()
                } else {
                    "warning".into()
                },
                signature: existing.signature.clone(),
                created_at: existing.created_at.clone(),
                updated_at: now.clone(),
                last_executed_at: existing.last_executed_at.clone(),
                available_version: Some(version.clone()),
            };
            if self.version_exists(db, &id, &version)? {
                let immutable = self.version_manifest(db, &id, &version)?;
                if Self::normalized_manifest(&immutable) != Self::normalized_manifest(&manifest) {
                    return Err(AppError::ValidationFailed(format!(
                        "La version {} existe déjà et son contenu ne peut pas être remplacé. Publiez une version supérieure.",
                        version
                    )));
                }
            } else {
                self.persist_version(db, &candidate, Some(bundle_dir), false)?;
            }
            {
                let conn = db.conn.lock().unwrap();
                conn.execute(
                    "UPDATE plugins SET available_version=?1, updated_at=?2 WHERE id=?3",
                    params![version, now, id],
                )?;
            }
            std::fs::write(bundle_dir.join(".bob-work-plugin-id"), &id)?;
            info!(
                "Detected agentic plugin update {} {} from {:?}",
                id, candidate.version, bundle_dir
            );
            return self.get_by_id(db, &id);
        }

        let now = Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at)
                 VALUES (?1,?2,?3,'Bob Agent',?4,'personal',?5,?6,'installed',?7,?8,?8)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,
                 author=excluded.author,description=excluded.description,category=excluded.category,
                 manifest=excluded.manifest,validation_state=excluded.validation_state,updated_at=excluded.updated_at",
                params![
                    id,
                    name,
                    version,
                    description,
                    category,
                    manifest.to_string(),
                    if validation.warnings.is_empty() { "valid" } else { "warning" },
                    now,
                ],
            )?;
        }
        std::fs::write(bundle_dir.join(".bob-work-plugin-id"), &id)?;
        info!("Imported agentic Bob plugin {} from {:?}", id, bundle_dir);
        let plugin = self
            .get_by_id(db, &id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", id)))?;
        self.persist_version(db, &plugin, Some(bundle_dir), true)?;
        Ok(Some(plugin))
    }

    fn valid_bundle_slug(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 64
            && value.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
            })
            && !value.starts_with('-')
            && !value.ends_with('-')
    }

    fn skill_body(markdown: &str) -> String {
        if let Some(rest) = markdown.strip_prefix("---") {
            if let Some((_, body)) = rest.split_once("---") {
                return body.trim().to_string();
            }
        }
        markdown.trim().to_string()
    }

    fn parse_version(value: &str) -> AppResult<Version> {
        Version::parse(value.trim()).map_err(|_| {
            AppError::ValidationFailed(
                "La version du plugin doit respecter le format MAJEURE.MINEURE.CORRECTIF (par exemple 1.2.0)."
                    .into(),
            )
        })
    }

    fn packaged_builtin_version(plugin_id: &str) -> Option<&'static str> {
        builtin_document_plugins()
            .into_iter()
            .find(|builtin| builtin.id == plugin_id)
            .map(|builtin| builtin.version)
    }

    /// True when Bob Work can rebuild the plugin from the app bundle.
    /// Those rows are never archived under `.bob-work-versions/` — requiring a
    /// snapshot made "Mettre à jour" fail with "Plugin version bundle missing".
    fn uses_embedded_packaged_bundle(plugin_id: &str, manifest: &serde_json::Value) -> bool {
        if Self::packaged_builtin_version(plugin_id).is_some()
            || Self::is_packaged_work_plugin(plugin_id)
        {
            return true;
        }
        if manifest.get("builtin").and_then(|value| value.as_bool()) == Some(true) {
            return true;
        }
        let slug = manifest.get("slug").and_then(|value| value.as_str());
        let Some(slug) = slug.filter(|value| !value.is_empty()) else {
            return false;
        };
        builtin_document_plugins()
            .into_iter()
            .chain(packaged_work_plugins())
            .any(|plugin| {
                plugin.id == plugin_id
                    || plugin.manifest.get("slug").and_then(|value| value.as_str()) == Some(slug)
            })
    }

    fn requires_agentic_version_snapshot(plugin_id: &str, manifest: &serde_json::Value) -> bool {
        manifest
            .get("agentic")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
            && !Self::uses_embedded_packaged_bundle(plugin_id, manifest)
    }

    fn validate_input_version(input: &CreatePluginInput) -> AppResult<Version> {
        let version = Self::parse_version(&input.version)?;
        let manifest_version = input
            .manifest
            .get("version")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if manifest_version != input.version {
            return Err(AppError::ValidationFailed(
                "La version du manifeste doit être identique à celle du plugin.".into(),
            ));
        }
        Ok(version)
    }

    fn normalized_manifest(manifest: &serde_json::Value) -> serde_json::Value {
        let mut normalized = manifest.clone();
        if let Some(object) = normalized.as_object_mut() {
            object.remove("bundlePath");
        }
        normalized
    }

    fn release_notes(manifest: &serde_json::Value) -> Option<String> {
        manifest
            .get("releaseNotes")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn snapshot_bundle(plugin_id: &str, version: &str, bundle_dir: &Path) -> AppResult<PathBuf> {
        let versions_root = bundle_dir
            .parent()
            .ok_or_else(|| AppError::Plugin("Invalid plugin bundle directory".into()))?
            .join(".bob-work-versions")
            .join(plugin_id);
        let target = versions_root.join(version);
        if target.is_dir() {
            return Ok(target);
        }
        std::fs::create_dir_all(&target)?;
        let mut files = 0usize;
        let mut bytes = 0u64;
        if let Err(error) = Self::copy_bundle_tree(bundle_dir, &target, &mut files, &mut bytes) {
            let _ = std::fs::remove_dir_all(&target);
            return Err(error);
        }
        Ok(target)
    }

    fn copy_bundle_tree(
        source: &Path,
        target: &Path,
        files: &mut usize,
        bytes: &mut u64,
    ) -> AppResult<()> {
        for entry in std::fs::read_dir(source)?.filter_map(Result::ok) {
            let metadata = std::fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() {
                return Err(AppError::Plugin(
                    "Les liens symboliques ne peuvent pas être archivés dans une version de plugin."
                        .into(),
                ));
            }
            let destination = target.join(entry.file_name());
            if metadata.is_dir() {
                std::fs::create_dir_all(&destination)?;
                Self::copy_bundle_tree(&entry.path(), &destination, files, bytes)?;
            } else if metadata.is_file() {
                *files += 1;
                *bytes += metadata.len();
                if *files > 5_000 || *bytes > 100 * 1024 * 1024 {
                    return Err(AppError::Plugin(
                        "Le bundle du plugin dépasse la limite d’archivage (5 000 fichiers ou 100 Mo)."
                            .into(),
                    ));
                }
                std::fs::copy(entry.path(), destination)?;
            }
        }
        Ok(())
    }

    fn activate_agentic_bundle(
        snapshot: &Path,
        canonical: &Path,
        plugin_id: &str,
    ) -> AppResult<()> {
        if snapshot == canonical {
            return Ok(());
        }
        let snapshot_root = snapshot
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .ok_or_else(|| AppError::Plugin("Invalid plugin version snapshot".into()))?;
        if canonical.parent() != Some(snapshot_root) || !snapshot.is_dir() {
            return Err(AppError::Security(
                "La version archivée ne correspond pas au dossier local du plugin.".into(),
            ));
        }
        let backup = snapshot_root.join(format!(
            ".bob-work-activation-backup-{}-{}",
            plugin_id,
            Uuid::new_v4()
        ));
        if canonical.exists() {
            std::fs::rename(canonical, &backup)?;
        }
        std::fs::create_dir_all(canonical)?;
        let mut files = 0usize;
        let mut bytes = 0u64;
        if let Err(error) = Self::copy_bundle_tree(snapshot, canonical, &mut files, &mut bytes) {
            let _ = std::fs::remove_dir_all(canonical);
            if backup.exists() {
                let _ = std::fs::rename(&backup, canonical);
            }
            return Err(error);
        }
        if backup.exists() {
            std::fs::remove_dir_all(backup)?;
        }
        Ok(())
    }

    fn refresh_builtin_version(&self, db: &Database, plugin: &Plugin) -> AppResult<()> {
        let release_notes = Self::release_notes(&plugin.manifest);
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE plugin_versions SET name=?1, author=?2, description=?3, scope=?4,
             category=?5, manifest=?6, validation_state=?7, release_notes=?8
             WHERE plugin_id=?9 AND version=?10",
            params![
                plugin.name,
                plugin.author,
                plugin.description,
                plugin.scope,
                plugin.category,
                plugin.manifest.to_string(),
                plugin.validation_state,
                release_notes,
                plugin.id,
                plugin.version,
            ],
        )?;
        Ok(())
    }

    fn persist_version(
        &self,
        db: &Database,
        plugin: &Plugin,
        bundle_dir: Option<&Path>,
        installed: bool,
    ) -> AppResult<()> {
        let mut stored_manifest = plugin.manifest.clone();
        let snapshot_path = if let Some(bundle_dir) = bundle_dir {
            let path = Self::snapshot_bundle(&plugin.id, &plugin.version, bundle_dir)?;
            if let Some(object) = stored_manifest.as_object_mut() {
                object.insert(
                    "bundlePath".into(),
                    serde_json::Value::String(path.to_string_lossy().to_string()),
                );
            }
            Some(path.to_string_lossy().to_string())
        } else {
            None
        };
        let release_notes = Self::release_notes(&plugin.manifest);
        let installed_at = installed.then(|| Utc::now().to_rfc3339());
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO plugin_versions
             (plugin_id,version,name,author,description,scope,category,manifest,
              validation_state,signature,release_notes,bundle_snapshot_path,created_at,installed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                plugin.id,
                plugin.version,
                plugin.name,
                plugin.author,
                plugin.description,
                plugin.scope,
                plugin.category,
                stored_manifest.to_string(),
                plugin.validation_state,
                plugin.signature,
                release_notes,
                snapshot_path,
                plugin.updated_at,
                installed_at,
            ],
        )?;
        Ok(())
    }

    fn upgrade_legacy_agentic_version(
        &self,
        db: &Database,
        plugin: &Plugin,
        manifest: &serde_json::Value,
        bundle_dir: &Path,
    ) -> AppResult<()> {
        let snapshot = Self::snapshot_bundle(&plugin.id, &plugin.version, bundle_dir)?;
        let mut stored_manifest = manifest.clone();
        if let Some(object) = stored_manifest.as_object_mut() {
            object.insert(
                "bundlePath".into(),
                serde_json::Value::String(snapshot.to_string_lossy().to_string()),
            );
        }
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE plugins SET manifest=?1,updated_at=?2 WHERE id=?3",
            params![manifest.to_string(), now, plugin.id],
        )?;
        conn.execute(
            "UPDATE plugin_versions SET manifest=?1,bundle_snapshot_path=?2,release_notes=?3
             WHERE plugin_id=?4 AND version=?5",
            params![
                stored_manifest.to_string(),
                snapshot.to_string_lossy().to_string(),
                Self::release_notes(manifest),
                plugin.id,
                plugin.version,
            ],
        )?;
        Ok(())
    }

    fn version_exists(&self, db: &Database, plugin_id: &str, version: &str) -> AppResult<bool> {
        let conn = db.conn.lock().unwrap();
        let count = conn.query_row(
            "SELECT COUNT(*) FROM plugin_versions WHERE plugin_id=?1 AND version=?2",
            params![plugin_id, version],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(count > 0)
    }

    pub fn list_versions(&self, db: &Database, plugin_id: &str) -> AppResult<Vec<PluginVersion>> {
        let plugin = self
            .get_by_id(db, plugin_id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT plugin_id,version,release_notes,created_at,installed_at
             FROM plugin_versions WHERE plugin_id=?1",
        )?;
        let mut versions = stmt
            .query_map(params![plugin_id], |row| {
                let version: String = row.get(1)?;
                let state = if version == plugin.version {
                    "current"
                } else if plugin.available_version.as_deref() == Some(version.as_str()) {
                    "available"
                } else {
                    "previous"
                };
                Ok(PluginVersion {
                    plugin_id: row.get(0)?,
                    version,
                    release_notes: row.get(2)?,
                    created_at: row.get(3)?,
                    installed_at: row.get(4)?,
                    state: state.into(),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        versions.sort_by(|left, right| {
            let left = Version::parse(&left.version).ok();
            let right = Version::parse(&right.version).ok();
            right.cmp(&left)
        });
        Ok(versions)
    }

    fn version_manifest(
        &self,
        db: &Database,
        plugin_id: &str,
        version: &str,
    ) -> AppResult<serde_json::Value> {
        let conn = db.conn.lock().unwrap();
        let manifest: String = conn
            .query_row(
                "SELECT manifest FROM plugin_versions WHERE plugin_id=?1 AND version=?2",
                params![plugin_id, version],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!(
                    "Version {} du plugin {} introuvable",
                    version, plugin_id
                )),
                other => AppError::Database(other.to_string()),
            })?;
        serde_json::from_str(&manifest).map_err(AppError::from)
    }

    pub fn compare_version(
        &self,
        db: &Database,
        plugin_id: &str,
        to_version: &str,
    ) -> AppResult<PluginVersionDiff> {
        let plugin = self
            .get_by_id(db, plugin_id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
        let target = self.version_manifest(db, plugin_id, to_version)?;
        let mut changes = vec![];
        let mut warnings = vec![];
        let current_permissions = Self::array_values(&plugin.manifest, "permissions", "type");
        let target_permissions = Self::array_values(&target, "permissions", "type");
        let added_permissions = target_permissions
            .difference(&current_permissions)
            .cloned()
            .collect::<Vec<_>>();
        let removed_permissions = current_permissions
            .difference(&target_permissions)
            .cloned()
            .collect::<Vec<_>>();
        if !added_permissions.is_empty() {
            warnings.push(format!(
                "Nouvelles autorisations demandées : {}",
                added_permissions.join(", ")
            ));
        }
        if !removed_permissions.is_empty() {
            changes.push(format!(
                "Autorisations retirées : {}",
                removed_permissions.join(", ")
            ));
        }
        Self::describe_set_change(
            &mut changes,
            "Fonctions",
            Self::string_array(&plugin.manifest, "capabilities"),
            Self::string_array(&target, "capabilities"),
        );
        Self::describe_set_change(
            &mut changes,
            "Outils MCP",
            Self::object_keys(&plugin.manifest, "mcpServers"),
            Self::object_keys(&target, "mcpServers"),
        );
        Self::describe_set_change(
            &mut changes,
            "Connexions",
            Self::array_values(&plugin.manifest, "integrations", "provider"),
            Self::array_values(&target, "integrations", "provider"),
        );
        Self::describe_set_change(
            &mut changes,
            "Actions automatiques",
            Self::array_values(&plugin.manifest, "hooks", "id"),
            Self::array_values(&target, "hooks", "id"),
        );
        if let Some(notes) = Self::release_notes(&target) {
            changes.insert(0, notes);
        }
        if changes.is_empty() && warnings.is_empty() {
            changes.push("Aucun changement fonctionnel déclaré.".into());
        }
        Ok(PluginVersionDiff {
            from_version: plugin.version,
            to_version: to_version.into(),
            changes,
            warnings,
            permissions_changed: current_permissions != target_permissions,
        })
    }

    pub fn activate_version(
        &self,
        db: &Database,
        plugin_id: &str,
        version: &str,
    ) -> AppResult<Plugin> {
        Self::parse_version(version)?;
        let current = self
            .get_by_id(db, plugin_id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
        if current.version == version {
            return Ok(current);
        }
        // Built-ins are re-applied to the packaged version on every plugin list.
        // Allowing an explicit downgrade would only flash a success toast then
        // snap back — refuse it with a clear message instead.
        if let Some(packaged) = Self::packaged_builtin_version(plugin_id) {
            let packaged_version = Self::parse_version(packaged)?;
            let target_version = Self::parse_version(version)?;
            if target_version < packaged_version {
                return Err(AppError::ValidationFailed(format!(
                    "« {} » est un plugin intégré : la version livrée {} ne peut pas être rétrogradée.",
                    current.name, packaged
                )));
            }
        }
        let (name, author, description, scope, category, manifest, validation_state, signature) = {
            let conn = db.conn.lock().unwrap();
            conn.query_row(
                "SELECT name,author,description,scope,category,manifest,validation_state,signature
                 FROM plugin_versions WHERE plugin_id=?1 AND version=?2",
                params![plugin_id, version],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, Option<String>>(7)?,
                    ))
                },
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!(
                    "Version {} du plugin {} introuvable",
                    version, plugin_id
                )),
                other => AppError::Database(other.to_string()),
            })?
        };
        let mut manifest: serde_json::Value = serde_json::from_str(&manifest)?;
        let validation = self.validate(&manifest);
        if !validation.valid {
            return Err(AppError::Plugin(validation.errors.join("; ")));
        }
        if Self::requires_agentic_version_snapshot(plugin_id, &manifest) {
            let snapshot = manifest
                .get("bundlePath")
                .and_then(|value| value.as_str())
                .map(PathBuf::from)
                .ok_or_else(|| {
                    AppError::Plugin(
                        "Le bundle archivé de cette version est introuvable. Republiez le plugin depuis son dossier local.".into(),
                    )
                })?;
            let canonical = manifest
                .get("sourceBundlePath")
                .and_then(|value| value.as_str())
                .map(PathBuf::from)
                .ok_or_else(|| {
                    AppError::Plugin(
                        "Le dossier source de ce plugin agentique est introuvable.".into(),
                    )
                })?;
            Self::activate_agentic_bundle(&snapshot, &canonical, plugin_id)?;
            if let Some(object) = manifest.as_object_mut() {
                object.insert(
                    "bundlePath".into(),
                    serde_json::Value::String(canonical.to_string_lossy().to_string()),
                );
            }
        }
        if current.install_state == "installed" {
            if let Err(error) = PluginDeployService::new().deploy(plugin_id, &manifest) {
                // Keep the version switch even if skill files cannot be rewritten —
                // otherwise "Mettre à jour" appears broken while the DB stays old.
                warn!(
                    "Plugin {} deploy failed during version switch to {} (non-fatal): {}",
                    plugin_id, version, error
                );
            }
        }
        let target_semver = Self::parse_version(version)?;
        let mut available_after = current
            .available_version
            .as_deref()
            .and_then(|value| Self::parse_version(value).ok())
            .filter(|candidate| candidate > &target_semver)
            .map(|candidate| candidate.to_string());
        let current_semver = Self::parse_version(&current.version)?;
        if current_semver > target_semver
            && available_after
                .as_deref()
                .and_then(|value| Self::parse_version(value).ok())
                .is_none_or(|candidate| current_semver > candidate)
        {
            available_after = Some(current.version.clone());
        }
        let now = Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE plugins SET name=?1,version=?2,author=?3,description=?4,scope=?5,
                 category=?6,manifest=?7,validation_state=?8,signature=?9,
                 available_version=?10,updated_at=?11 WHERE id=?12",
                params![
                    name,
                    version,
                    author,
                    description,
                    scope,
                    category,
                    manifest.to_string(),
                    validation_state,
                    signature,
                    available_after,
                    now,
                    plugin_id,
                ],
            )?;
            conn.execute(
                "UPDATE plugin_versions SET installed_at=?1 WHERE plugin_id=?2 AND version=?3",
                params![now, plugin_id, version],
            )?;
        }
        self.get_by_id(db, plugin_id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))
    }

    fn string_array(manifest: &serde_json::Value, key: &str) -> BTreeSet<String> {
        manifest
            .get(key)
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str().map(str::to_string))
            .collect()
    }

    fn array_values(manifest: &serde_json::Value, key: &str, field: &str) -> BTreeSet<String> {
        manifest
            .get(key)
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|value| value.get(field).and_then(|value| value.as_str()))
            .map(str::to_string)
            .collect()
    }

    fn object_keys(manifest: &serde_json::Value, key: &str) -> BTreeSet<String> {
        manifest
            .get(key)
            .and_then(|value| value.as_object())
            .map(|value| value.keys().cloned().collect())
            .unwrap_or_default()
    }

    fn describe_set_change(
        changes: &mut Vec<String>,
        label: &str,
        before: BTreeSet<String>,
        after: BTreeSet<String>,
    ) {
        let added = after.difference(&before).cloned().collect::<Vec<_>>();
        let removed = before.difference(&after).cloned().collect::<Vec<_>>();
        if !added.is_empty() {
            changes.push(format!("{} ajoutés : {}", label, added.join(", ")));
        }
        if !removed.is_empty() {
            changes.push(format!("{} retirés : {}", label, removed.join(", ")));
        }
    }

    pub fn create(&self, db: &Database, input: CreatePluginInput) -> AppResult<Plugin> {
        if input.name.trim().is_empty() || input.version.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "Plugin name and version are required".into(),
            ));
        }
        if !matches!(
            input.category.as_str(),
            "recipe" | "integration" | "executable"
        ) {
            return Err(AppError::ValidationFailed("Invalid plugin category".into()));
        }
        Self::validate_input_version(&input)?;
        let mut manifest = input.manifest;
        ensure_manifest_icon(&mut manifest, &input.name, input.description.as_deref());
        let validation = self.validate(&manifest);
        if !validation.valid {
            return Err(AppError::Plugin(validation.errors.join("; ")));
        }
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let scope = input.scope.unwrap_or_else(|| "personal".to_string());

        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO plugins (id, name, version, author, description, scope, category,
             manifest, install_state, validation_state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'installed', ?9, ?10, ?11)",
            params![
                id,
                input.name,
                input.version,
                input.author,
                input.description,
                scope,
                input.category,
                manifest.to_string(),
                if validation.warnings.is_empty() {
                    "valid"
                } else {
                    "warning"
                },
                now,
                now,
            ],
        )?;

        if let Err(error) = PluginDeployService::new().deploy(&id, &manifest) {
            let _ = conn.execute("DELETE FROM plugins WHERE id=?1", params![id]);
            return Err(error);
        }
        drop(conn);

        info!("Created plugin: {}", id);

        let plugin = Plugin {
            id,
            name: input.name,
            version: input.version,
            author: input.author,
            description: input.description,
            scope,
            category: input.category,
            manifest,
            install_state: "installed".to_string(),
            validation_state: if validation.warnings.is_empty() {
                "valid".into()
            } else {
                "warning".into()
            },
            signature: None,
            created_at: now.clone(),
            updated_at: now,
            last_executed_at: None,
            available_version: None,
        };
        if let Err(error) = self.persist_version(db, &plugin, None, true) {
            let conn = db.conn.lock().unwrap();
            let _ = conn.execute("DELETE FROM plugins WHERE id=?1", params![plugin.id]);
            let _ = PluginDeployService::new().undeploy(&plugin.id);
            return Err(error);
        }
        Ok(plugin)
    }

    pub fn update(
        &self,
        db: &Database,
        plugin_id: &str,
        input: CreatePluginInput,
    ) -> AppResult<Plugin> {
        let previous = self
            .get_by_id(db, plugin_id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
        if previous
            .manifest
            .get("builtin")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            return Err(AppError::ValidationFailed(
                "Un plugin intégré peut être désactivé, mais pas modifié.".into(),
            ));
        }
        let next_version = Self::validate_input_version(&input)?;
        let current_version = Self::parse_version(&previous.version)?;
        if next_version <= current_version {
            return Err(AppError::ValidationFailed(format!(
                "La nouvelle version doit être supérieure à {}.",
                previous.version
            )));
        }
        if self.version_exists(db, plugin_id, &input.version)? {
            return Err(AppError::ValidationFailed(format!(
                "La version {} existe déjà et ne peut pas être écrasée.",
                input.version
            )));
        }
        let mut manifest = input.manifest;
        // Keep a previous icon when the editor omitted it; otherwise infer one.
        if !manifest
            .get("icon")
            .and_then(|value| value.as_str())
            .is_some_and(|value| !value.trim().is_empty())
        {
            if let Some(previous_icon) = previous
                .manifest
                .get("icon")
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
            {
                if let Some(object) = manifest.as_object_mut() {
                    object.insert(
                        "icon".into(),
                        serde_json::Value::String(previous_icon.to_string()),
                    );
                }
            } else {
                ensure_manifest_icon(&mut manifest, &input.name, input.description.as_deref());
            }
        }
        let validation = self.validate(&manifest);
        if !validation.valid {
            return Err(AppError::Plugin(validation.errors.join("; ")));
        }
        let now = Utc::now().to_rfc3339();
        let scope = input
            .scope
            .clone()
            .unwrap_or_else(|| "personal".to_string());
        // Prefer preserving Office/CTO Python when this update is ahead of the
        // version currently shipped inside the app binary.
        let packaged = Self::packaged_builtin_version(plugin_id).or_else(|| {
            packaged_work_plugins()
                .into_iter()
                .find(|plugin| plugin.id == plugin_id)
                .map(|plugin| plugin.version)
        });
        let deployer = PluginDeployService::new();
        if packaged == Some(input.version.as_str()) {
            deployer.deploy(plugin_id, &manifest)?;
        } else {
            deployer.deploy_preserving_embedded(plugin_id, &manifest)?;
        }
        {
            let conn = db.conn.lock().unwrap();
            let changed = conn.execute(
                "UPDATE plugins SET name=?1, version=?2, author=?3, description=?4,
                 scope=?5, category=?6, manifest=?7, validation_state=?8, updated_at=?9 WHERE id=?10",
                params![
                    input.name, input.version, input.author, input.description, scope, input.category,
                    manifest.to_string(),
                    if validation.warnings.is_empty() { "valid" } else { "warning" },
                    now, plugin_id,
                ],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!(
                    "Plugin {} not found",
                    plugin_id
                )));
            }
        }
        let plugin = self
            .get_by_id(db, plugin_id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
        let bundle_dir = plugin
            .manifest
            .get("bundlePath")
            .and_then(|value| value.as_str())
            .map(PathBuf::from);
        self.persist_version(db, &plugin, bundle_dir.as_deref(), true)?;
        Ok(plugin)
    }

    /// Validate a plugin manifest for security and compatibility
    pub fn validate(&self, manifest: &serde_json::Value) -> PluginValidationResult {
        let mut warnings = vec![];
        let mut errors = vec![];
        let mut dangerous_patterns = vec![];
        let mut risk_level = "low".to_string();

        // Check required fields
        if manifest.get("name").is_none() {
            errors.push("Missing required field: name".to_string());
        }
        if manifest.get("version").is_none() {
            errors.push("Missing required field: version".to_string());
        }
        if manifest.get("description").is_none() {
            warnings.push("Missing description".to_string());
        }

        // Check permissions
        if let Some(permissions) = manifest.get("permissions").and_then(|p| p.as_array()) {
            for perm in permissions {
                let perm_type = perm.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match perm_type {
                    "file.delete" | "command.execute" | "hook.execute" | "browser.control" => {
                        risk_level = "high".to_string();
                        dangerous_patterns.push(format!("Permission: {}", perm_type));
                    }
                    "network.request" => {
                        if risk_level == "low" {
                            risk_level = "medium".to_string();
                        }
                    }
                    "mcp.connect" => {
                        if risk_level == "low" {
                            risk_level = "medium".to_string();
                        }
                    }
                    _ => {}
                }
            }
        }

        errors.extend(PluginMcpService::validate_schema(manifest));
        errors.extend(PluginExtensionService::validate_schema(manifest));
        errors.extend(
            crate::services::runtime_manager::validate_plugin_runtime_requirements(manifest),
        );

        // Check for executable category extra scrutiny
        if manifest.get("category").and_then(|c| c.as_str()) == Some("executable") {
            warnings.push("Executable plugins run code locally. Review carefully.".to_string());
            if risk_level == "low" {
                risk_level = "medium".to_string();
            }
        }

        PluginValidationResult {
            valid: errors.is_empty(),
            warnings,
            errors,
            risk_level,
            dangerous_patterns,
        }
    }

    pub fn install(&self, db: &Database, plugin_id: &str) -> AppResult<()> {
        // Load the plugin manifest from DB first
        let manifest = {
            let conn = db.conn.lock().unwrap();
            let manifest_str: String = conn
                .query_row(
                    "SELECT manifest FROM plugins WHERE id = ?1",
                    params![plugin_id],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            serde_json::from_str::<serde_json::Value>(&manifest_str).unwrap_or_default()
        };

        // Deploy the plugin YAML to ~/.bob/skills/
        match PluginDeployService::new().deploy(plugin_id, &manifest) {
            Ok(path) => {
                info!("Plugin {} deployed to {:?}", plugin_id, path);
            }
            Err(e) => {
                warn!("Plugin deploy to ~/.bob/skills/ failed (non-fatal): {}", e);
                // Continue — DB state still updated so user knows it's "installed"
            }
        }

        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE plugins SET install_state = 'installed', updated_at = ?1 WHERE id = ?2",
            params![now, plugin_id],
        )?;
        Ok(())
    }

    pub fn uninstall(&self, db: &Database, plugin_id: &str) -> AppResult<()> {
        let plugin = self
            .get_by_id(db, plugin_id)?
            .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
        if Self::is_protected_builtin(plugin_id) {
            return Err(AppError::ValidationFailed(
                "Un plugin intégré peut être désactivé, mais pas supprimé.".into(),
            ));
        }
        // Remove from ~/.bob/skills/ first (non-fatal if it fails)
        if let Err(e) = PluginDeployService::new().undeploy(plugin_id) {
            warn!(
                "Plugin undeploy from ~/.bob/skills/ failed (non-fatal): {}",
                e
            );
        }
        if plugin
            .manifest
            .get("agentic")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            PluginDeployService::new().retire_agentic_bundle(plugin_id)?;
        }
        if Self::is_packaged_work_plugin(plugin_id) {
            self.dismiss_packaged_work_plugin(db, plugin_id)?;
        }
        let conn = db.conn.lock().unwrap();
        conn.execute("DELETE FROM plugins WHERE id = ?1", params![plugin_id])?;
        Ok(())
    }

    pub fn toggle(&self, db: &Database, plugin_id: &str, enabled: bool) -> AppResult<()> {
        if enabled {
            let plugin = self
                .get_by_id(db, plugin_id)?
                .ok_or_else(|| AppError::NotFound(format!("Plugin {} not found", plugin_id)))?;
            PluginDeployService::new().deploy(plugin_id, &plugin.manifest)?;
        } else {
            PluginDeployService::new().undeploy(plugin_id)?;
        }
        let now = Utc::now().to_rfc3339();
        let state = if enabled { "installed" } else { "disabled" };
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE plugins SET install_state = ?1, updated_at = ?2 WHERE id = ?3",
            params![state, now, plugin_id],
        )?;
        Ok(())
    }
}

fn catalog_slug_keys(slug: &str) -> BTreeSet<String> {
    let normalized = slug.trim().to_ascii_lowercase();
    let mut keys = BTreeSet::new();
    if normalized.is_empty() {
        return keys;
    }
    keys.insert(normalized.clone());
    let mut rest = normalized.as_str();
    loop {
        let stripped = rest
            .strip_prefix("bob-work-")
            .or_else(|| rest.strip_prefix("ibm-"))
            .or_else(|| rest.strip_prefix("builtin-"))
            .or_else(|| rest.strip_prefix("agentic-"));
        match stripped {
            Some(next) if !next.is_empty() && next != rest => {
                keys.insert(next.to_string());
                rest = next;
            }
            _ => break,
        }
    }
    keys
}

struct BuiltinPlugin {
    id: &'static str,
    name: &'static str,
    version: &'static str,
    description: &'static str,
    category: &'static str,
    manifest: serde_json::Value,
}

fn office_specialized_mode(
    label: &str,
    input_extensions: &[&str],
    output_formats: &[&str],
    allowed_tools: &[&str],
    preferred_libraries: &[&str],
    workflow: &str,
) -> serde_json::Value {
    serde_json::json!({
        "label": label,
        "description": "Mode spécialisé local : consignes, format attendu et outils autorisés (équivalent ChatGPT Work, sans upload serveur).",
        "inputExtensions": input_extensions,
        "outputFormats": output_formats,
        "allowedTools": allowed_tools,
        "preferredLibraries": preferred_libraries,
        "workflow": workflow,
        "sandbox": "python-local"
    })
}

fn office_mcp_server(
    display_name: &str,
    description: &str,
    office_kind: &str,
    tools: &[&str],
) -> serde_json::Value {
    serde_json::json!({
        "displayName": display_name,
        "description": description,
        "required": false,
        "command": "python3",
        "args": ["mcp/server.py"],
        "cwd": ".",
        "env": {"BOB_OFFICE_KIND": office_kind},
        "tools": tools
    })
}

fn office_permissions() -> serde_json::Value {
    serde_json::json!([
        {"type":"file.read"},
        {"type":"file.write"},
        {"type":"mcp.connect"},
        {"type":"command.execute"}
    ])
}

/// Assign `manifest.icon` when missing: prefer a known brand key, else a public favicon URL.
fn ensure_manifest_icon(manifest: &mut serde_json::Value, name: &str, description: Option<&str>) {
    let current = manifest
        .get("icon")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("");
    let placeholder = current.is_empty() || current == "plugin" || current == "agentic";
    if !placeholder {
        return;
    }
    let slug = manifest
        .get("slug")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let icon = infer_plugin_icon(slug, name, description.unwrap_or(""));
    if icon == current {
        return;
    }
    if let Some(object) = manifest.as_object_mut() {
        object.insert("icon".into(), serde_json::Value::String(icon));
    }
}

fn infer_plugin_icon(slug: &str, name: &str, description: &str) -> String {
    let text = format!("{slug} {name} {description}").to_lowercase();
    // Prefer precise product tokens over generic words (mail/document/browser).
    const LOCAL: &[(&[&str], &str)] = &[
        (
            &["powerpoint", "pptx", "microsoft-powerpoint"],
            "powerpoint",
        ),
        (&["excel", "xlsx", "microsoft-excel"], "excel"),
        (&["onenote", "microsoft-onenote"], "onenote"),
        (
            &["microsoft-word", "docx", " bob-work-microsoft-word"],
            "word",
        ),
        (&["bob-work-documents", "builtin-documents"], "document"),
        (
            &["docling", "bob-work-docling", "builtin-docling"],
            "docling",
        ),
        (
            &["cto-invest", "cto investissements", "bob-work-cto"],
            "invest",
        ),
        (
            &["computer-use", "computer use", "bob-work-computer"],
            "computer",
        ),
        (
            &[
                "chrome-control",
                "contrôle chrome",
                "controle chrome",
                "bob-work-chrome",
            ],
            "chrome",
        ),
        (
            &["ibm-agentic-designer", "builtin-ibm-agentic-designer"],
            "designer",
        ),
        (
            &["ibm-agentic-consultant", "builtin-ibm-agentic-consultant"],
            "consultant",
        ),
        (&["ibm-agentic-rfp", "builtin-ibm-agentic-rfp"], "rfp"),
        (
            &[
                "ibm-agentic-product-manager",
                "builtin-ibm-agentic-product-manager",
            ],
            "product",
        ),
        (
            &[
                "ibm-agentic-delivery-manager",
                "builtin-ibm-agentic-delivery-manager",
            ],
            "delivery",
        ),
        (
            &[
                "ibm-agentic-change-manager",
                "builtin-ibm-agentic-change-manager",
            ],
            "change",
        ),
        (
            &[
                "ibm-agentic-solution-architect",
                "builtin-ibm-agentic-solution-architect",
            ],
            "architecture",
        ),
        (&["github"], "github"),
        (&["slack"], "slack"),
        (&["monday"], "monday"),
        (&["outlook"], "outlook"),
        (&["teams", "microsoft teams"], "teams"),
        (&["outlook-calendar", "calendrier outlook"], "calendar"),
        (&["onedrive", "one drive"], "onedrive"),
    ];
    for (keys, icon) in LOCAL {
        if keys.iter().any(|key| text.contains(key.trim())) {
            return (*icon).into();
        }
    }
    // "word" alone is ambiguous; only match as a product token.
    if text.contains("microsoft word") || slug.contains("microsoft-word") || slug.ends_with("-word")
    {
        return "word".into();
    }
    if let Some(url) = suggest_favicon_url(&text) {
        return url;
    }
    "plugin".into()
}

fn suggest_favicon_url(text: &str) -> Option<String> {
    const DOMAINS: &[(&[&str], &str)] = &[
        (&["notion"], "notion.so"),
        (&["trello"], "trello.com"),
        (&["jira", "atlassian"], "atlassian.com"),
        (&["discord"], "discord.com"),
        (&["linear"], "linear.app"),
        (&["figma"], "figma.com"),
        (&["stripe"], "stripe.com"),
        (&["shopify"], "shopify.com"),
        (&["hubspot"], "hubspot.com"),
        (&["salesforce"], "salesforce.com"),
        (&["dropbox"], "dropbox.com"),
        (&["asana"], "asana.com"),
        (&["zoom"], "zoom.us"),
        (&["telegram"], "telegram.org"),
        (&["whatsapp"], "whatsapp.com"),
        (&["spotify"], "spotify.com"),
        (&["youtube"], "youtube.com"),
        (&["linkedin"], "linkedin.com"),
        (&["reddit"], "reddit.com"),
        (&["aws", "amazon web"], "aws.amazon.com"),
        (&["azure"], "azure.microsoft.com"),
        (&["gmail", "google mail"], "gmail.com"),
        (&["google drive", "gdrive"], "drive.google.com"),
        (&["tmdb", "themoviedb"], "themoviedb.org"),
        (&["openai", "chatgpt"], "openai.com"),
        (&["anthropic", "claude"], "anthropic.com"),
    ];
    for (keys, domain) in DOMAINS {
        if keys.iter().any(|key| text.contains(key)) {
            return Some(format!(
                "https://www.google.com/s2/favicons?domain={domain}&sz=128"
            ));
        }
    }
    None
}

fn packaged_work_plugins() -> Vec<BuiltinPlugin> {
    vec![BuiltinPlugin {
        id: "bob-work-cto-invest",
        name: "CTO Investissements",
        version: "1.2.3",
        description: "Propose des idées d’actions chiffrées pour un Compte-Titres Ordinaire (CTO) français : cotations, screening et brief informatif — pas un conseil personnalisé.",
        category: "executable",
        manifest: serde_json::json!({
            "name": "CTO Investissements",
            "slug": "bob-work-cto-invest",
            "version": "1.2.3",
            "description": "Propose des idées d’actions chiffrées pour un Compte-Titres Ordinaire (CTO) français : cotations, screening et brief informatif — pas un conseil personnalisé.",
            "category": "executable",
            "builtin": false,
            "icon": "invest",
            "capabilities": ["market.read", "cto.screen", "invest.brief", "cli.execute", "connector.status", "llm.synthesize"],
            "permissions": [
                {"type": "network.request"},
                {"type": "mcp.connect"},
                {"type": "command.execute"}
            ],
            "runtime": {"python": ">=3.9", "cli": true, "mcp": true},
            "entrypoints": [
                {"name": "screen", "runtime": "python3", "path": "scripts/screen_cto.py"},
                {"name": "mcp", "runtime": "python3", "path": "mcp/server.py"}
            ],
            "resources": [
                {"kind": "stdio-cli", "label": "CLI screen_cto.py", "optional": false, "notes": "Entrypoint local"},
                {"kind": "mcp", "label": "Marché CTO (local)", "optional": false, "provider": "cto-market", "mcpServer": "cto-market", "notes": "Cotations Stooq + Finnhub si clé présente"},
                {"kind": "api-public", "label": "Stooq", "optional": false, "notes": "Cotations publiques sans clé — source par défaut"},
                {"kind": "api-key", "label": "Finnhub", "optional": true, "provider": "finnhub", "env": "FINNHUB_API_KEY", "notes": "Fallback US optionnel via FINNHUB_API_KEY (pas un outil MCP séparé)"},
                {"kind": "mcp", "label": "MCP distant marché", "optional": true, "env": "CTO_REMOTE_MCP_URL", "notes": "URL https optionnelle / Intégrations → MCP"},
                {"kind": "bob-llm", "label": "LLM Bob", "optional": false, "notes": "Synthèse du brief CTO"},
                {"kind": "web-search", "label": "Recherche web Bob", "optional": true, "notes": "Actualités si Accès web actif"}
            ],
            "connectorStrategy": {
                "targetLevel": "chatgpt-work",
                "explored": ["api-public", "api-key", "local-mcp", "remote-mcp", "bob-llm", "web-search", "oauth-catalog"],
                "tiers": [
                    {"id": "T1", "kind": "open-api", "provider": "stooq", "required": true, "auth": "none"},
                    {"id": "T2", "kind": "open-api", "provider": "finnhub", "required": false, "auth": "token", "env": "FINNHUB_API_KEY"},
                    {"id": "T3", "kind": "local-mcp-cli", "provider": "bundled-python", "required": true},
                    {"id": "T4", "kind": "remote-mcp", "provider": "user-or-prompt", "required": false, "env": "CTO_REMOTE_MCP_URL", "activation": "Integrations MCP tab or prompt URL + use_mcp_tool"}
                ],
                "fallback": "T3 fixtures (e2e) → T1 Stooq → T2 Finnhub if key → enrich via T4 if user MCP present",
                "designNotes": "Pas d’OAuth broker inventé : les données marché publiques n’exigent pas de compte. Un MCP distant n’est jamais hardcodé (URL fournie par l’utilisateur). Disclaimer CTO toujours renvoyé par les tools."
            },
            "releaseNotes": "1.2.3 — Description fonctionnelle (bénéfice utilisateur) au lieu d’un résumé technique des connecteurs.",
            "integrations": [],
            "specializedMode": {
                "label": "Mode CTO Investissements",
                "description": "Aide à repérer des idées d’actions pour un CTO français, avec chiffres et risques, à partir de données de marché locales.",
                "inputExtensions": [],
                "outputFormats": ["md", "json"],
                "allowedTools": ["cto_connector_status", "cto_market_snapshot", "cto_screen_ideas", "use_mcp_tool", "execute_command"],
                "preferredLibraries": [],
                "workflow": "1) cto_connector_status pour savoir quelles sources sont actives. 2) cto_market_snapshot / cto_screen_ideas (MCP local). 3) Si l’utilisateur a fourni un MCP marché (URL / Intégrations), enrichir via use_mcp_tool sans inventer de connexion. 4) Synthèse 2–4 idées + disclaimer CTO.",
                "sandbox": "market-data"
            },
            "mcpServers": {
                "cto-market": {
                    "displayName": "Marché CTO (local)",
                    "description": "MCP Python local : cotations Stooq, fallback Finnhub, screening informatif.",
                    "required": true,
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "env": {
                        "BOB_CTO_INVEST": "1",
                        "FINNHUB_API_KEY": "${FINNHUB_API_KEY}",
                        "CTO_REMOTE_MCP_URL": "${CTO_REMOTE_MCP_URL}"
                    },
                    "tools": ["cto_connector_status", "cto_market_snapshot", "cto_screen_ideas"]
                }
            },
            "instructions": "Mode CTO Investissements Bob Work — plugin niveau ChatGPT Work (pas un skill seul).\n\nBundle : cto_market.py, scripts/screen_cto.py, mcp/server.py.\nConnecteurs : T1 Stooq (défaut, sans clé) ; T2 Finnhub si FINNHUB_API_KEY ; T3 MCP/CLI local ; T4 MCP distant seulement si l’utilisateur fournit une URL https ou l’ajoute dans Intégrations → MCP (ne jamais inventer ni simuler « connecté »).\nWorkflow : cto_connector_status → snapshot/screen locaux → éventuel use_mcp_tool sur MCP utilisateur → brief.\nRappels : pas un conseil personnalisé ; citer le disclaimer outil ; fiscalité CTO, frais, change US, risque de perte. Structure : sources actives → idées chiffrées → risques → prochaines vérifications."
        }),
    }, BuiltinPlugin {
        id: "bob-work-ibm-pursuit",
        name: "Brief Mission IBM",
        version: "1.0.0",
        description: "Prépare un brief d’atelier CIO à partir de sources publiques : snapshot client, 3–4 plays IBM et questions — pas une offre commerciale.",
        category: "executable",
        manifest: serde_json::json!({
            "name": "Brief Mission IBM",
            "slug": "bob-work-ibm-pursuit",
            "version": "1.0.0",
            "description": "Prépare un brief d’atelier CIO à partir de sources publiques : snapshot client, 3–4 plays IBM et questions — pas une offre commerciale.",
            "category": "executable",
            "builtin": true,
            "icon": "plugin",
            "capabilities": ["client.snapshot", "ibm.plays", "consulting.brief", "cli.execute", "connector.status", "llm.synthesize"],
            "permissions": [
                {"type": "network.request"},
                {"type": "mcp.connect"},
                {"type": "command.execute"}
            ],
            "runtime": {"python": ">=3.9", "cli": true, "mcp": true},
            "entrypoints": [
                {"name": "brief", "runtime": "python3", "path": "scripts/brief_pursuit.py"},
                {"name": "mcp", "runtime": "python3", "path": "mcp/server.py"}
            ],
            "resources": [
                {"kind": "stdio-cli", "label": "CLI brief_pursuit.py", "optional": false, "notes": "Entrypoint local"},
                {"kind": "mcp", "label": "Brief Mission IBM (local)", "optional": false, "provider": "ibm-pursuit", "mcpServer": "ibm-pursuit", "notes": "Snapshot public + screening de plays IBM"},
                {"kind": "api-public", "label": "Wikipedia / Wikidata", "optional": false, "notes": "Fiche entreprise sans clé"},
                {"kind": "api-public", "label": "DuckDuckGo Instant Answer", "optional": false, "notes": "Résumé public sans clé"},
                {"kind": "api-public", "label": "Google News RSS", "optional": false, "notes": "Signaux d’actualité publics sans clé"},
                {"kind": "api-key", "label": "NewsAPI", "optional": true, "provider": "newsapi", "env": "NEWSAPI_KEY", "notes": "Actus optionnelles via NEWSAPI_KEY — pas Slack, pas Microsoft"},
                {"kind": "bob-llm", "label": "LLM Bob", "optional": false, "notes": "Synthèse du brief atelier"},
                {"kind": "web-search", "label": "Recherche web Bob", "optional": true, "notes": "Complément si Accès web actif"}
            ],
            "connectorStrategy": {
                "targetLevel": "chatgpt-work",
                "explored": ["api-public", "api-key", "local-mcp", "remote-mcp", "bob-llm", "web-search", "oauth-catalog"],
                "tiers": [
                    {"id": "T1", "kind": "open-api", "provider": "wikipedia-wikidata-duckduckgo-news-rss", "required": true, "auth": "none"},
                    {"id": "T2", "kind": "open-api", "provider": "newsapi", "required": false, "auth": "token", "env": "NEWSAPI_KEY"},
                    {"id": "T3", "kind": "local-mcp-cli", "provider": "bundled-python", "required": true},
                    {"id": "T4", "kind": "remote-mcp", "provider": "user-https-non-microsoft", "required": false, "env": "IBM_PURSUIT_REMOTE_MCP_URL", "activation": "URL https optionnelle hors Slack/Microsoft — laisser vide par défaut"}
                ],
                "fallback": "T3 fixtures (e2e) → T1 APIs ouvertes → T2 NewsAPI si clé. T4 ignoré si Slack/Microsoft.",
                "designNotes": "Pas d’OAuth Slack/Microsoft/Graph/SharePoint/Teams/Outlook. Un MCP distant n’est jamais hardcodé. Disclaimer consultant toujours renvoyé par les tools."
            },
            "releaseNotes": "1.0.0 — Brief mission consultant IBM, APIs ouvertes uniquement.",
            "integrations": [],
            "specializedMode": {
                "label": "Mode Brief Mission IBM",
                "description": "Aide un consultant IBM à préparer un atelier CIO avec faits publics, plays et questions — sans offre commerciale.",
                "inputExtensions": [],
                "outputFormats": ["md", "json"],
                "allowedTools": ["ibm_connector_status", "ibm_client_snapshot", "ibm_screen_plays", "execute_command"],
                "preferredLibraries": [],
                "workflow": "1) ibm_connector_status. 2) ibm_client_snapshot. 3) ibm_screen_plays. 4) Synthèse Markdown (sources, snapshot, plays, risques, script d’atelier, disclaimer). Ne jamais utiliser Slack, Teams, Outlook, SharePoint ni Graph.",
                "sandbox": "open-web-research"
            },
            "mcpServers": {
                "ibm-pursuit": {
                    "displayName": "Brief Mission IBM (local)",
                    "description": "MCP Python local : APIs ouvertes, snapshot client, screening de plays IBM.",
                    "required": true,
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "env": {
                        "BOB_IBM_PURSUIT": "1",
                        "NEWSAPI_KEY": "${NEWSAPI_KEY}",
                        "IBM_PURSUIT_REMOTE_MCP_URL": "${IBM_PURSUIT_REMOTE_MCP_URL}"
                    },
                    "tools": ["ibm_connector_status", "ibm_client_snapshot", "ibm_screen_plays"]
                }
            },
            "instructions": "Mode Brief Mission IBM — plugin niveau ChatGPT Work (pas un skill seul).\n\nBundle : ibm_pursuit.py, scripts/brief_pursuit.py, mcp/server.py.\nConnecteurs : T1 Wikipedia/Wikidata/DuckDuckGo/Google News RSS (sans clé) ; T2 NewsAPI si NEWSAPI_KEY ; T3 MCP/CLI local. Pas Slack, pas Microsoft (Graph, Teams, SharePoint, Outlook).\nWorkflow : ibm_connector_status → ibm_client_snapshot → ibm_screen_plays → brief Markdown.\nRappels : pas une offre commerciale ; pas de prix inventés ; citer le disclaimer outil. Structure : sources actives → 5 faits + 3 signaux → 3–4 plays (preuve, offre, risque, question) → risques / non-objectifs → script d’atelier → disclaimer."
        }),
    }]
}

fn apply_ibm_catalog_fields(manifest: &mut serde_json::Value) {
    let family = manifest
        .get("slug")
        .and_then(|value| value.as_str())
        .map(|slug| {
            if slug.starts_with("ibm-agentic-") {
                "IBM Agentic"
            } else if slug.contains("docling") {
                "IBM AI"
            } else {
                "IBM"
            }
        })
        .unwrap_or("IBM");
    let Some(object) = manifest.as_object_mut() else {
        return;
    };
    object
        .entry("vendor")
        .or_insert(serde_json::Value::String("IBM".into()));
    object
        .entry("publisher")
        .or_insert(serde_json::Value::String("IBM".into()));
    object
        .entry("productFamily")
        .or_insert(serde_json::Value::String(family.into()));
}

fn load_ibm_profession(raw: &str) -> serde_json::Value {
    let mut manifest: serde_json::Value =
        serde_json::from_str(raw).expect("valid IBM profession manifest");
    apply_ibm_catalog_fields(&mut manifest);
    manifest
}

fn ibm_product_manifest(
    name: &str,
    slug: &str,
    description: &str,
    icon: &str,
    capabilities: &[&str],
    workflow: &str,
    instructions: &str,
    references: &[(&str, &str)],
) -> serde_json::Value {
    let resources = references
        .iter()
        .map(|(label, url)| {
            serde_json::json!({
                "kind": "web-reference",
                "label": label,
                "url": url,
                "optional": false
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "schemaVersion": 1,
        "builtin": true,
        "agentic": true,
        "vendor": "IBM",
        "publisher": "IBM",
        "productFamily": "IBM AI",
        "name": name,
        "slug": slug,
        "version": "1.0.0",
        "author": "Bob Work",
        "description": description,
        "category": "recipe",
        "icon": icon,
        "permissions": [
            {"type": "file.read"},
            {"type": "file.write"},
            {"type": "network.request"},
            {"type": "command.execute"}
        ],
        "capabilities": capabilities,
        "resources": resources,
        "distribution": {
            "bundledRuntime": false,
            "state": "pending-size-review",
            "notes": "Le plugin agentique et ses références sont intégrés. Le framework, service, conteneur ou modèle IBM n'est pas embarqué tant que sa taille et son mode de distribution n'ont pas été validés."
        },
        "specializedMode": {
            "label": name,
            "description": description,
            "allowedTools": ["read_file", "write_file", "execute_command", "web_fetch", "web_search"],
            "outputFormats": ["md", "json", "yaml", "py", "ts"],
            "workflow": workflow,
            "sandbox": "bob-local"
        },
        "instructions": instructions
    })
}

#[allow(clippy::too_many_arguments)]
fn cli_product_manifest(
    name: &str,
    slug: &str,
    description: &str,
    icon: &str,
    vendor: &str,
    publisher: &str,
    product_family: &str,
    command: &str,
    package: &str,
    install_hint: &str,
    capabilities: &[&str],
    workflow: &str,
    instructions: &str,
    references: &[(&str, &str)],
) -> serde_json::Value {
    let runtime_managed = command.starts_with("runtime://");
    let mut resources = vec![if runtime_managed {
        serde_json::json!({
            "kind": "external-runtime",
            "label": package,
            "runtimeId": command.trim_start_matches("runtime://").trim_end_matches("/python"),
            "installHint": install_hint,
            "optional": false,
            "notes": "Runtime optionnel installé, validé et résolu exclusivement par le Runtime Manager ; aucun PATH global."
        })
    } else {
        serde_json::json!({
            "kind": "stdio-cli",
            "label": format!("CLI {name}"),
            "command": command,
            "package": package,
            "installHint": install_hint,
            "optional": false,
            "notes": format!("Composant externe requis ; le Runtime Manager résout et vérifie explicitement la CLI `{command}` sans modifier le PATH global.")
        })
    }];
    resources.extend(references.iter().map(|(label, url)| {
        serde_json::json!({
            "kind": "web-reference",
            "label": label,
            "url": url,
            "optional": false
        })
    }));

    serde_json::json!({
        "schemaVersion": 1,
        "builtin": true,
        "agentic": true,
        "vendor": vendor,
        "publisher": publisher,
        "productFamily": product_family,
        "name": name,
        "slug": slug,
        "version": "1.0.0",
        "author": "Bob Work",
        "description": description,
        "category": "executable",
        "icon": icon,
        "permissions": [
            {"type": "file.read"},
            {"type": "file.write"},
            {"type": "network.request"},
            {"type": "command.execute"}
        ],
        "capabilities": capabilities,
        "runtime": if runtime_managed {
            serde_json::json!({"managed": true})
        } else {
            serde_json::json!({"cli": true})
        },
        "privateDependencies": if runtime_managed {
            serde_json::json!([])
        } else {
            serde_json::json!([{
                "id": command,
                "name": format!("CLI {name}"),
                "kind": "cli",
                "version": "host-managed",
                "entrypoint": command,
                "purpose": format!("CLI officielle requise par {name}"),
                "source": {"kind": "known-existing-executable", "location": command}
            }])
        },
        "resources": resources,
        "distribution": {
            "bundledRuntime": false,
            "state": if runtime_managed { "external-runtime-managed" } else { "external-cli-required" },
            "notes": if runtime_managed {
                "Le plugin est intégré à Bob Work. Son runtime optionnel est géré hors du paquet principal par le Runtime Manager.".to_string()
            } else {
                format!("Le plugin est intégré à Bob Work. La CLI `{command}` reste un composant externe et doit être installée séparément.")
            }
        },
        "specializedMode": {
            "label": name,
            "description": description,
            "allowedTools": ["read_file", "write_file", "execute_command", "web_fetch", "web_search"],
            "outputFormats": ["md", "json", "yaml", "sh"],
            "workflow": workflow,
            "sandbox": "bob-local"
        },
        "instructions": if runtime_managed {
            format!("{instructions}\n\nPrérequis impératif : demande le handle déclaré au Runtime Manager. Si le runtime n'est pas installé, présente les informations d'installation approuvées et attends le consentement de l'utilisateur. N'invente jamais de chemin, de paquet ou de commande d'installation. Ne simule jamais une sortie et ne prétends jamais qu'une opération a réussi sans résultat réel.")
        } else {
            format!("{instructions}\n\nPrérequis impératif : vérifie d'abord la présence de `{command}`. S'il est absent, arrête l'exécution et indique clairement à l'utilisateur qu'il doit installer {name}. Instruction d'installation : {install_hint}. Ne simule jamais une sortie de la CLI et ne prétends jamais qu'une commande a réussi sans résultat réel. Commence par les commandes de lecture, de validation ou de planification ; demande une confirmation explicite avant toute création, modification, suppression, déploiement ou opération potentiellement disruptive. Ne place jamais de secret dans les commandes, fichiers générés ou comptes rendus.")
        }
    })
}

fn with_runtime_requirements(
    mut manifest: serde_json::Value,
    version: &str,
    shared_capabilities: &[&str],
    external_runtimes: serde_json::Value,
) -> serde_json::Value {
    let Some(object) = manifest.as_object_mut() else {
        return manifest;
    };
    object.insert("version".into(), serde_json::Value::String(version.into()));
    object.insert(
        "sharedCapabilities".into(),
        serde_json::Value::Array(
            shared_capabilities
                .iter()
                .map(|value| serde_json::Value::String((*value).into()))
                .collect(),
        ),
    );
    object.insert("externalRuntimes".into(), external_runtimes);
    object
        .entry("privateDependencies")
        .or_insert_with(|| serde_json::json!([]));
    manifest
}

fn builtin_document_plugins() -> Vec<BuiltinPlugin> {
    vec![
        BuiltinPlugin {
            id: "builtin-ibm-cloud",
            name: "IBM Cloud",
            version: "1.0.0",
            description: "Administre IBM Cloud avec la CLI officielle : comptes et cibles, groupes de ressources, IAM, services, Kubernetes, Code Engine et diagnostic, avec contrôles avant toute modification.",
            category: "executable",
            manifest: cli_product_manifest(
                "IBM Cloud",
                "ibm-cloud",
                "Administre IBM Cloud avec la CLI officielle : comptes et cibles, groupes de ressources, IAM, services, Kubernetes, Code Engine et diagnostic, avec contrôles avant toute modification.",
                "ibm-cloud",
                "IBM",
                "IBM",
                "IBM Cloud",
                "ibmcloud",
                "IBM Cloud CLI",
                "Installez IBM Cloud CLI depuis la documentation officielle IBM (installeur macOS), puis vérifiez avec `ibmcloud version` et authentifiez-vous avec `ibmcloud login`.",
                &["cloud.target.inspect", "cloud.resource.list", "cloud.iam.review", "cloud.service.manage", "cloud.kubernetes.manage", "cloud.code-engine.manage", "cloud.diagnose"],
                "Vérification de la CLI et de l'authentification → lecture du compte, de la région et du groupe de ressources ciblés → inventaire/diagnostic → proposition des commandes → validation utilisateur → exécution contrôlée → vérification du résultat.",
                "Mode IBM Cloud. Utilise la CLI `ibmcloud` pour inspecter et administrer les ressources IBM Cloud. Confirme toujours le compte, la région et le groupe de ressources actifs avant une action. Privilégie `--output json` quand il est disponible afin de produire un diagnostic vérifiable. N'effectue jamais de suppression, de changement IAM, de déploiement ou de rotation de secret sans accord explicite.",
                &[("Installation officielle IBM Cloud CLI", "https://cloud.ibm.com/docs/cli?topic=cli-install-ibmcloud-cli"), ("Référence IBM Cloud CLI", "https://cloud.ibm.com/docs/cli?topic=cli-ibmcloud_cli")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-ibm-watsonx-ai",
            name: "IBM watsonx",
            version: "1.1.0",
            description: "Conçoit, exploite et gouverne la plateforme IBM watsonx : modèles et IA générative avec watsonx.ai, données hybrides et lakehouse avec watsonx.data, puis évaluations, Factsheets, risques et conformité avec watsonx.governance.",
            category: "executable",
            manifest: serde_json::json!({
                "schemaVersion": 1,
                "builtin": true,
                "agentic": true,
                "vendor": "IBM",
                "publisher": "IBM",
                "productFamily": "IBM watsonx",
                "name": "IBM watsonx",
                "slug": "ibm-watsonx",
                "aliases": ["IBM watsonx.ai", "IBM watsonx.data", "IBM watsonx.governance"],
                "version": "1.1.0",
                "author": "Bob Work",
                "description": "Conçoit, exploite et gouverne la plateforme IBM watsonx : modèles et IA générative avec watsonx.ai, données hybrides et lakehouse avec watsonx.data, puis évaluations, Factsheets, risques et conformité avec watsonx.governance.",
                "category": "executable",
                "icon": "watsonx",
                "permissions": [
                    {"type": "file.read"},
                    {"type": "file.write"},
                    {"type": "network.request"},
                    {"type": "command.execute"}
                ],
                "capabilities": [
                    "project.inspect",
                    "space.inspect",
                    "model.list",
                    "inference.run",
                    "prompt.manage",
                    "embedding.run",
                    "deployment.inspect",
                    "deployment.invoke",
                    "evaluation.run",
                    "lakehouse.inspect",
                    "engine.inspect",
                    "catalog.inspect",
                    "connection.inspect",
                    "query.plan",
                    "query.run",
                    "data-access.review",
                    "governance.inventory.inspect",
                    "governance.factsheet.inspect",
                    "governance.evaluation.run",
                    "governance.monitoring.inspect",
                    "governance.risk.review",
                    "governance.compliance.review"
                ],
                "requiresPlugins": [{
                    "id": "builtin-ibm-cloud",
                    "name": "IBM Cloud",
                    "reason": "Fournit l’identité IAM, le compte, la région et le groupe de ressources utilisés par les services watsonx."
                }],
                "runtime": {"cli": true},
                "privateDependencies": [{
                    "id": "ibmcloud",
                    "name": "IBM Cloud CLI",
                    "kind": "cli",
                    "version": "host-managed",
                    "entrypoint": "ibmcloud",
                    "purpose": "Authentification IAM et vérification du contexte IBM Cloud pour la plateforme watsonx",
                    "source": {"kind": "known-existing-executable", "location": "ibmcloud"}
                }],
                "resources": [
                    {
                        "kind": "stdio-cli",
                        "label": "IBM Cloud CLI (identité et contexte)",
                        "command": "ibmcloud",
                        "package": "IBM Cloud CLI",
                        "installHint": "Installez IBM Cloud CLI depuis la documentation officielle IBM, vérifiez avec `ibmcloud version`, puis authentifiez-vous avec `ibmcloud login` ou `ibmcloud login --sso`.",
                        "optional": false,
                        "notes": "Prérequis partagé avec le plugin intégré IBM Cloud. Les jetons IAM restent secrets et ne doivent jamais apparaître dans la conversation."
                    },
                    {
                        "kind": "api-key",
                        "label": "Clé API IBM Cloud",
                        "env": "IBM_CLOUD_API_KEY",
                        "optional": true,
                        "notes": "IBM_CLOUD_API_KEY est une alternative pour les environnements automatisés ; une session IBM Cloud SSO existante peut être utilisée à la place."
                    },
                    {"kind": "web-reference", "label": "Présentation officielle d’IBM watsonx.ai", "url": "https://www.ibm.com/products/watsonx-ai", "optional": false},
                    {"kind": "web-reference", "label": "API officielle watsonx.ai as a Service", "url": "https://cloud.ibm.com/docs/apis/watsonx-ai", "optional": false},
                    {"kind": "web-reference", "label": "SDK Python officiel IBM watsonx.ai", "url": "https://ibm.github.io/watsonx-ai-python-sdk/", "optional": true},
                    {"kind": "web-reference", "label": "Présentation officielle d’IBM watsonx.data", "url": "https://www.ibm.com/products/watsonx-data", "optional": false},
                    {"kind": "web-reference", "label": "API v3 officielle watsonx.data", "url": "https://cloud.ibm.com/apidocs/watsonxdata-v3", "optional": false},
                    {"kind": "web-reference", "label": "Présentation officielle d’IBM watsonx.governance", "url": "https://www.ibm.com/products/watsonx-governance", "optional": false},
                    {"kind": "web-reference", "label": "API v2 officielle watsonx.governance", "url": "https://cloud.ibm.com/apidocs/ai-openscale", "optional": false}
                ],
                "distribution": {
                    "bundledRuntime": false,
                    "state": "external-cli-required",
                    "notes": "Le plugin est intégré à Bob Work. Il s’appuie sur la CLI IBM Cloud installée sur le Mac et sur les API officielles de watsonx.ai, watsonx.data et watsonx.governance ; aucun SDK, moteur de données ou modèle n’est embarqué."
                },
                "specializedMode": {
                    "label": "IBM watsonx",
                    "description": "Conçoit et exploite des solutions complètes reliant IA générative, données hybrides et gouvernance sur IBM watsonx, tout en séparant clairement le contexte et les contrôles propres à chaque produit.",
                    "allowedTools": ["read_file", "write_file", "execute_command", "web_fetch", "web_search"],
                    "outputFormats": ["md", "json", "yaml", "py", "sh"],
                    "workflow": "Vérifier IBM Cloud CLI et l’authentification → identifier le produit watsonx concerné → confirmer compte, région, instance et projet/espace/catalogue → inventorier en lecture seule → préparer la requête, l’évaluation ou le changement minimal → évaluer coût, accès, données et conformité → demander confirmation avant toute consommation ou mutation → exécuter → restituer identifiants, métriques, preuves et erreurs réels.",
                    "sandbox": "bob-local"
                },
                "instructions": "Mode IBM watsonx. Route chaque demande vers le bon domaine. Pour watsonx.ai : projets et espaces, modèles de fondation, inférence texte/chat, embeddings, actifs de prompt, déploiements et évaluations. Pour watsonx.data : instances lakehouse, moteurs, catalogues, stockages, connexions, intégrations et requêtes ; commence par métadonnées, plans et requêtes bornées en lecture seule. Pour watsonx.governance : inventaires et cas d’usage IA, Factsheets, évaluations, qualité, biais, dérive, explicabilité, monitoring, alertes, risques et conformité ; distingue toujours constat technique, seuil configuré, contrôle organisationnel et conclusion réglementaire. L’administration générale IBM Cloud reste dans le plugin IBM Cloud, qui fournit l’identité IAM, le compte, la région, le groupe de ressources et le diagnostic d’infrastructure. Vérifie d’abord la présence de `ibmcloud`, l’authentification réelle, la région, l’instance et les identifiants de périmètre requis ; n’invente jamais d’endpoint, d’identifiant, de résultat, de métrique, de quota, de règle ou de statut de conformité. Utilise uniquement les endpoints et versions d’API documentés par IBM. Ne révèle, n’affiche, ne journalise et n’écris jamais une clé API, un jeton IAM, des identifiants de source de données ou des données sensibles ; un jeton obtenu par la CLI ne doit être transmis qu’à l’appel HTTPS ciblé. Commence par les opérations de lecture. Demande une confirmation explicite avant toute inférence ou évaluation consommant du quota, exécution SQL, création ou modification d’actif, de catalogue, de connexion, de stockage, de moteur, de règle, de seuil ou de workflow, ainsi qu’avant tout déploiement, tuning, batch, upload ou suppression. Pour une requête de données, affiche le plan et la cible, limite le volume et refuse les écritures implicites. Pour la gouvernance, conserve la provenance des preuves et signale les limites de couverture avant toute affirmation de conformité. Après l’appel, rapporte le produit, l’instance, la région, le périmètre, l’identifiant de requête et les erreurs réelles sans exposer de secret. Si `ibmcloud` est absent, arrête l'exécution et indique l’installation officielle. Ne simule jamais une sortie ni un succès."
            }),
        },
        BuiltinPlugin {
            id: "builtin-aws",
            name: "Amazon Web Services (AWS)",
            version: "1.0.0",
            description: "Inspecte, diagnostique et administre AWS avec la CLI officielle : identité et comptes, régions, IAM, EC2, S3, Lambda, EKS, CloudFormation, coûts, journaux et conformité, avec validation explicite avant toute mutation.",
            category: "executable",
            manifest: cli_product_manifest(
                "Amazon Web Services (AWS)",
                "amazon-web-services",
                "Inspecte, diagnostique et administre AWS avec la CLI officielle : identité et comptes, régions, IAM, EC2, S3, Lambda, EKS, CloudFormation, coûts, journaux et conformité, avec validation explicite avant toute mutation.",
                "aws",
                "Amazon Web Services",
                "Amazon Web Services",
                "Cloud Providers",
                "aws",
                "AWS CLI v2",
                "Installez AWS CLI v2 depuis la documentation officielle AWS (installeur macOS), puis vérifiez avec `aws --version` et configurez un profil avec `aws configure` ou AWS IAM Identity Center.",
                &["aws.identity.inspect", "aws.resource.list", "aws.iam.review", "aws.compute.manage", "aws.storage.manage", "aws.serverless.manage", "aws.kubernetes.manage", "aws.cloudformation.manage", "aws.cost.inspect", "aws.diagnose"],
                "Vérification de la CLI et des identifiants → `sts get-caller-identity` → confirmation du profil, du compte et de la région → inventaire/diagnostic non destructif → proposition des commandes → validation utilisateur → exécution contrôlée → vérification du résultat et consignation.",
                "Mode Amazon Web Services. Utilise la CLI `aws` et commence toujours par identifier le profil, le compte, le rôle et la région actifs. Privilégie les commandes `describe`, `list`, `get` et les sorties JSON. Pour CloudFormation, inspecte et résume le change set avant exécution. Ne lance jamais de création, déploiement, changement IAM, écriture S3, modification réseau, arrêt d'instance ou suppression sans accord explicite et rappel de la cible.",
                &[("Installation officielle AWS CLI v2", "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"), ("Référence AWS CLI", "https://docs.aws.amazon.com/cli/latest/reference/")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-azure",
            name: "Microsoft Azure",
            version: "1.0.0",
            description: "Inspecte, diagnostique et administre Microsoft Azure avec Azure CLI : tenants, abonnements, groupes de ressources, identités, machines virtuelles, stockage, AKS, App Service, Functions, réseau, coûts et déploiements ARM/Bicep.",
            category: "executable",
            manifest: cli_product_manifest(
                "Microsoft Azure",
                "microsoft-azure",
                "Inspecte, diagnostique et administre Microsoft Azure avec Azure CLI : tenants, abonnements, groupes de ressources, identités, machines virtuelles, stockage, AKS, App Service, Functions, réseau, coûts et déploiements ARM/Bicep.",
                "azure",
                "Microsoft",
                "Microsoft",
                "Cloud Providers",
                "az",
                "Azure CLI",
                "Installez Azure CLI avec `brew update && brew install azure-cli` sur macOS, puis vérifiez avec `az version` et authentifiez-vous avec `az login` ou une identité de workload adaptée.",
                &["azure.account.inspect", "azure.resource.list", "azure.identity.review", "azure.compute.manage", "azure.storage.manage", "azure.aks.manage", "azure.app-service.manage", "azure.network.manage", "azure.deployment.manage", "azure.cost.inspect", "azure.diagnose"],
                "Vérification de `az` et de l'authentification → confirmation du tenant, de l'abonnement, du groupe de ressources et de la région → inventaire/diagnostic non destructif → validation des modèles ARM/Bicep et aperçu `what-if` → validation utilisateur → exécution contrôlée → contrôle du résultat.",
                "Mode Microsoft Azure. Utilise `az` et confirme toujours le tenant, l'abonnement et le groupe de ressources actifs avant une intervention. Utilise les sorties JSON ou JMESPath pour produire des résultats vérifiables. Pour ARM/Bicep, effectue une validation et un `what-if` avant déploiement. Les changements RBAC, réseau, Key Vault, compute, stockage, AKS, déploiements et suppressions exigent un accord explicite.",
                &[("Installation officielle Azure CLI", "https://learn.microsoft.com/cli/azure/install-azure-cli-macos"), ("Référence Azure CLI", "https://learn.microsoft.com/cli/azure/")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-gcp",
            name: "Google Cloud (GCP)",
            version: "1.0.0",
            description: "Inspecte, diagnostique et administre Google Cloud avec Google Cloud CLI : comptes, projets, régions, IAM, Compute Engine, Cloud Storage, GKE, Cloud Run, Functions, BigQuery, réseau, journalisation, coûts et déploiements.",
            category: "executable",
            manifest: cli_product_manifest(
                "Google Cloud (GCP)",
                "google-cloud-platform",
                "Inspecte, diagnostique et administre Google Cloud avec Google Cloud CLI : comptes, projets, régions, IAM, Compute Engine, Cloud Storage, GKE, Cloud Run, Functions, BigQuery, réseau, journalisation, coûts et déploiements.",
                "gcp",
                "Google Cloud",
                "Google Cloud",
                "Cloud Providers",
                "gcloud",
                "Google Cloud CLI",
                "Installez Google Cloud CLI avec `brew install --cask google-cloud-sdk` sur macOS ou l'installeur officiel, puis vérifiez avec `gcloud version` et initialisez la session avec `gcloud init` ou `gcloud auth login`.",
                &["gcp.account.inspect", "gcp.project.inspect", "gcp.resource.list", "gcp.iam.review", "gcp.compute.manage", "gcp.storage.manage", "gcp.gke.manage", "gcp.serverless.manage", "gcp.bigquery.inspect", "gcp.network.manage", "gcp.cost.inspect", "gcp.diagnose"],
                "Vérification de `gcloud` et de l'authentification → confirmation du compte, du projet, de la région et de la zone → inventaire/diagnostic non destructif → proposition des commandes et éventuel plan de déploiement → validation utilisateur → exécution contrôlée → vérification du résultat.",
                "Mode Google Cloud. Utilise `gcloud` et confirme toujours le compte, le projet, la région et la zone actifs. Privilégie `list`, `describe` et `--format=json`. Vérifie les APIs activées et les quotas sans les modifier automatiquement. Les changements IAM, réseau, compute, stockage, GKE, Cloud Run, Functions, déploiements, activation de services facturables et suppressions exigent une confirmation explicite.",
                &[("Installation officielle Google Cloud CLI", "https://cloud.google.com/sdk/docs/install"), ("Référence gcloud CLI", "https://cloud.google.com/sdk/gcloud/reference")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-openshift",
            name: "Red Hat OpenShift",
            version: "1.0.0",
            description: "Inspecte, diagnostique et administre les clusters OpenShift avec `oc` : projets, workloads, routes, opérateurs, événements, logs et déploiements sécurisés.",
            category: "executable",
            manifest: cli_product_manifest(
                "Red Hat OpenShift",
                "red-hat-openshift",
                "Inspecte, diagnostique et administre les clusters OpenShift avec `oc` : projets, workloads, routes, opérateurs, événements, logs et déploiements sécurisés.",
                "openshift",
                "IBM",
                "Red Hat",
                "IBM Hybrid Cloud",
                "oc",
                "OpenShift CLI (oc)",
                "Installez OpenShift CLI avec `brew install openshift-cli` sur macOS ou téléchargez `oc` depuis la console/documentation Red Hat, puis vérifiez avec `oc version --client`.",
                &["openshift.context.inspect", "openshift.resource.list", "openshift.logs.read", "openshift.diagnose", "openshift.manifest.validate", "openshift.deploy"],
                "Vérification de `oc` → contrôle du serveur, de l'utilisateur, du contexte et du projet actifs → collecte non destructive (`get`, `describe`, événements, logs) → diagnostic → proposition d'un manifeste ou correctif → validation → application → contrôle du rollout.",
                "Mode Red Hat OpenShift. Utilise `oc` et confirme le cluster, l'identité et le projet actifs avant chaque intervention. Pour un incident, collecte d'abord les événements, états, descriptions et logs sans mutation. Valide les manifestes côté client/serveur avant application. Les commandes `apply`, `patch`, `scale`, `rollout`, `delete`, changements de rôles et opérations d'opérateurs nécessitent un accord explicite.",
                &[("Installation officielle OpenShift CLI", "https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/cli_tools/openshift-cli-oc")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-terraform",
            name: "HashiCorp Terraform",
            version: "1.0.0",
            description: "Conçoit, formate, valide et planifie des infrastructures Terraform ; analyse modules, providers et état sans appliquer ni détruire de ressources sans confirmation.",
            category: "executable",
            manifest: cli_product_manifest(
                "HashiCorp Terraform",
                "hashicorp-terraform",
                "Conçoit, formate, valide et planifie des infrastructures Terraform ; analyse modules, providers et état sans appliquer ni détruire de ressources sans confirmation.",
                "terraform",
                "IBM",
                "HashiCorp",
                "IBM Automation",
                "terraform",
                "Terraform CLI",
                "Installez Terraform depuis le dépôt officiel HashiCorp avec `brew tap hashicorp/tap` puis `brew install hashicorp/tap/terraform`, ou utilisez le binaire officiel ; vérifiez avec `terraform version`.",
                &["terraform.code.design", "terraform.format", "terraform.validate", "terraform.plan", "terraform.state.inspect", "terraform.module.review", "terraform.apply"],
                "Vérification de Terraform et du répertoire racine → lecture des fichiers et versions → `fmt -check` et `validate` → initialisation contrôlée si nécessaire → plan enregistré et résumé → validation utilisateur → application éventuelle du plan exact → contrôle des sorties.",
                "Mode HashiCorp Terraform. Travaille dans le bon répertoire racine et identifie backend, workspace, providers et variables avant toute commande. Commence par `fmt -check`, `validate` et un plan. N'expose jamais les valeurs sensibles d'un plan ou de l'état. Ne lance jamais `apply`, `destroy`, `import`, une mutation d'état ou un changement de workspace sans confirmation explicite et sans rappeler la cible.",
                &[("Installation officielle Terraform", "https://developer.hashicorp.com/terraform/install"), ("Documentation Terraform CLI", "https://developer.hashicorp.com/terraform/cli")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-ansible",
            name: "Red Hat Ansible",
            version: "1.0.0",
            description: "Crée, révise et exécute prudemment inventaires, playbooks et rôles Ansible, avec syntax-check, mode check/diff, limitation des hôtes et validation des changements.",
            category: "executable",
            manifest: cli_product_manifest(
                "Red Hat Ansible",
                "red-hat-ansible",
                "Crée, révise et exécute prudemment inventaires, playbooks et rôles Ansible, avec syntax-check, mode check/diff, limitation des hôtes et validation des changements.",
                "ansible",
                "IBM",
                "Red Hat",
                "IBM Automation",
                "ansible-playbook",
                "Ansible",
                "Installez Ansible avec `pipx install --include-deps ansible` (méthode recommandée par la documentation Ansible) ou `brew install ansible`, puis vérifiez avec `ansible-playbook --version`.",
                &["ansible.inventory.inspect", "ansible.playbook.design", "ansible.syntax.check", "ansible.check", "ansible.diff", "ansible.execute", "ansible.troubleshoot"],
                "Vérification d'Ansible → identification de l'inventaire, de la configuration et des collections → revue du playbook → syntax-check → exécution `--check --diff` sur un groupe limité → résumé des changements → validation → exécution réelle limitée → contrôle d'idempotence.",
                "Mode Red Hat Ansible. Détermine explicitement l'inventaire, le groupe et les limites d'hôtes avant une exécution. Vérifie les collections et variables attendues sans afficher les secrets Vault. Commence par `--syntax-check`, puis `--check --diff` lorsque les modules le permettent. Une exécution réelle, un élargissement de `--limit`, une escalade de privilèges ou une opération destructive exige une confirmation explicite.",
                &[("Installation officielle Ansible", "https://docs.ansible.com/projects/ansible/latest/installation_guide/intro_installation.html"), ("Documentation ansible-playbook", "https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-ibm-db2",
            name: "IBM Db2",
            version: "1.0.0",
            description: "Interroge et diagnostique IBM Db2 avec le processeur de ligne de commande : catalogues, schémas, SQL, plans, configuration et administration contrôlée.",
            category: "executable",
            manifest: cli_product_manifest(
                "IBM Db2",
                "ibm-db2",
                "Interroge et diagnostique IBM Db2 avec le processeur de ligne de commande : catalogues, schémas, SQL, plans, configuration et administration contrôlée.",
                "ibm-db2",
                "IBM",
                "IBM",
                "IBM Data & AI",
                "db2",
                "IBM Db2 CLP / IBM Data Server Client",
                "Installez IBM Data Server Client ou Runtime Client pour obtenir le CLP `db2`. Sur macOS, installez IBM Data Server Driver Package avec `installDSDriver`, chargez son `db2profile`, puis vérifiez que la commande `db2` est disponible.",
                &["db2.catalog.inspect", "db2.schema.inspect", "db2.sql.query", "db2.explain", "db2.configuration.review", "db2.diagnose", "db2.admin"],
                "Vérification du client Db2 et de son profil → confirmation de l'instance/base cible → test de connexion → inventaire catalogue/schéma en lecture seule → diagnostic ou préparation SQL → validation des coûts et impacts → exécution autorisée → contrôle SQLCODE/SQLSTATE.",
                "Mode IBM Db2. Utilise le CLP `db2` uniquement après avoir confirmé l'instance et la base ciblées. Commence par les catalogues, métadonnées, requêtes bornées et EXPLAIN. Ne journalise jamais mot de passe, jeton ou chaîne de connexion complète. Les DDL, DML, RUNSTATS, REORG, bind, modifications de configuration et opérations d'instance nécessitent un accord explicite, une stratégie de retour arrière et la restitution des SQLCODE/SQLSTATE réels.",
                &[("Installation IBM Data Server Driver Package sur macOS", "https://www.ibm.com/docs/en/db2/12.1.x?topic=dsd-installing-data-server-driver-package-software-mac-os-x"), ("Référence du CLP Db2", "https://www.ibm.com/docs/en/db2/12.1.x?topic=clp-db2-invocation")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-ibm-z",
            name: "IBM Z",
            version: "1.0.0",
            description: "Accède aux environnements IBM Z via Zowe CLI pour travailler avec z/OSMF, jobs, datasets, USS et services mainframe, avec profils et actions sensibles contrôlés.",
            category: "executable",
            manifest: cli_product_manifest(
                "IBM Z",
                "ibm-z",
                "Accède aux environnements IBM Z via Zowe CLI pour travailler avec z/OSMF, jobs, datasets, USS et services mainframe, avec profils et actions sensibles contrôlés.",
                "ibm-z",
                "IBM",
                "IBM / Open Mainframe Project",
                "IBM Z",
                "zowe",
                "Zowe CLI",
                "Installez d'abord une version LTS de Node.js, puis Zowe CLI avec `npm install -g @zowe/cli@zowe-v2-lts`. Vérifiez avec `zowe --help` et configurez un profil z/OSMF ou un team configuration profile.",
                &["ibm-z.profile.inspect", "ibm-z.jobs.read", "ibm-z.datasets.read", "ibm-z.uss.read", "ibm-z.zosmf.call", "ibm-z.jobs.submit", "ibm-z.operations"],
                "Vérification de Zowe CLI → inventaire des profils sans révéler les secrets → confirmation du système, du compte et des services z/OSMF → lectures jobs/datasets/USS → diagnostic ou préparation d'action → validation utilisateur → exécution limitée → contrôle du retour mainframe.",
                "Mode IBM Z via Zowe CLI. Confirme toujours le profil, le système z/OS, le compte et le service ciblés ; n'affiche jamais les mots de passe, jetons ou certificats privés des profils. Commence par les commandes de lecture sur jobs, datasets et USS. Soumission ou purge de job, écriture/suppression de dataset, commande console, modification USS ou opération CICS/Db2/IMS/MQ nécessite une confirmation explicite et un contrôle du code retour réel.",
                &[("Installation officielle Zowe CLI", "https://docs.zowe.org/v2.18.x/user-guide/cli-installcli/"), ("Prise en main Zowe CLI", "https://docs.zowe.org/v2.18.x/getting-started/cli-getting-started/")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-map-tools",
            name: "Cartes & itinéraires",
            version: "1.0.0",
            description: "Géocode des lieux, recherche des points d’intérêt et calcule des itinéraires conduite, marche, vélo ou transports, avec une carte interactive directement dans la conversation.",
            category: "integration",
            manifest: serde_json::json!({
                "schemaVersion": 1,
                "builtin": true,
                "agentic": true,
                "name": "Cartes & itinéraires",
                "slug": "map-tools",
                "version": "1.0.0",
                "author": "Bob Work",
                "description": "Outils natifs de géocodage, recherche de POI et itinéraires multimodaux avec résultats structurés et carte interactive persistante dans le chat.",
                "category": "integration",
                "icon": "map",
                "permissions": [
                    {"type":"network.request","description":"Interroger Photon et Valhalla pour la demande cartographique explicite"},
                    {"type":"mcp.connect","description":"Exposer les outils structurés de carte à Bob"},
                    {"type":"command.execute","description":"Exécuter le serveur MCP local fourni avec Bob Work"}
                ],
                "capabilities": ["map.geocode", "map.reverse-geocode", "map.poi-search", "map.routing", "map.visualization"],
                "sharedCapabilities": [],
                "externalRuntimes": [],
                "privateDependencies": [],
                "specializedMode": {
                    "label":"Cartes",
                    "description":"Recherche géographique et itinéraires rendus directement dans la conversation.",
                    "allowedTools":["map_geocode", "map_reverse_geocode", "map_search_poi", "map_current_location", "map_route"],
                    "outputFormats":["md", "json", "bob-map"],
                    "workflow":"Identifier le besoin géographique → demander seulement les précisions indispensables → appeler l’outil le plus ciblé → résumer le résultat structuré ; Bob Work affiche automatiquement la carte.",
                    "sandbox":"network-read-only"
                },
                "instructions":"N’utilise ces outils que lorsqu’une carte, des positions, des points d’intérêt ou un itinéraire apportent une valeur réelle à la demande. Pour une simple question factuelle sans dimension géographique, réponds sans appeler le plugin afin d’éviter consommation réseau et tokens. Pour plusieurs points d’intérêt, conserve tous les résultats structurés afin que la carte affiche plusieurs pins. Utilise la position actuelle comme origine seulement si elle est autorisée dans les réglages et pertinente pour la demande. Choisis explicitement driving, walking, cycling ou transit. N’envoie une adresse privée ou une position à un fournisseur distant que si elle est nécessaire à la demande de l’utilisateur. Les résultats structurés kind=bob-map sont affichés automatiquement : ne génère pas un second HTML de carte. Photon et Valhalla sont des services configurables et sans garantie de disponibilité ; signale une estimation ou une indisponibilité au lieu d’inventer un trajet."
            }),
        },
        BuiltinPlugin {
            id: "builtin-codegraph",
            name: "CodeGraph",
            version: "1.0.0",
            description: "Indexe localement les bases Python, JavaScript, TypeScript, Go, Java et Rust pour rechercher le code, naviguer entre symboles et dépendances, trouver callers/callees et mesurer l’impact d’un changement.",
            category: "executable",
            manifest: serde_json::json!({
                "schemaVersion": 1,
                "builtin": true,
                "agentic": true,
                "name": "CodeGraph",
                "slug": "codegraph",
                "version": "1.0.0",
                "author": "Bob Work",
                "description": "Indexation sémantique locale et graphe de code persistant pour Python, JavaScript, TypeScript, Go, Java et Rust.",
                "category": "executable",
                "icon": "codegraph",
                "permissions": [
                    {"type":"file.read","description":"Lire les sources du workspace sélectionné"},
                    {"type":"file.write","description":"Écrire uniquement l’index dérivé sous ~/.bob/codegraph"},
                    {"type":"command.execute","description":"Exécuter le moteur local CodeGraph géré par Bob Work"}
                ],
                "capabilities": [
                    "code.index", "code.semantic-search", "code.symbol.search",
                    "code.callers", "code.callees", "code.impact-analysis"
                ],
                "sharedCapabilities": [],
                "externalRuntimes": [{
                    "id":"external.codegraph",
                    "version":"tree-sitter-language-pack-1.16.1",
                    "pythonMode":"shared",
                    "optional":true,
                    "installWhenUseful":true
                }],
                "privateDependencies": [],
                "specializedMode": {
                    "label":"CodeGraph",
                    "description":"Recherche et analyse transverse d’une base de code avec index local persistant.",
                    "allowedTools":[
                        "codegraph_status", "codegraph_index", "codegraph_search",
                        "codegraph_symbol", "codegraph_callers", "codegraph_callees",
                        "codegraph_impact", "codegraph_delete_index", "read_file"
                    ],
                    "outputFormats":["md", "json"],
                    "workflow":"Vérifier le statut → indexation incrémentale si nécessaire → requête ciblée → lecture des seuls extraits pertinents → réponse avec chemins et lignes.",
                    "sandbox":"bob-runtime-managed"
                },
                "instructions":"Utilise CodeGraph uniquement lorsqu’une tâche nécessite une compréhension transverse du dépôt : recherche conceptuelle, symboles, usages, callers/callees, dépendances ou analyse d’impact. Pour une lecture simple d’un ou deux fichiers, utilise directement les outils fichiers afin d’éviter une indexation et des tokens inutiles. Commence par codegraph_status. Si le runtime manque, demande une interaction structurée à l’utilisateur et attends son choix ; ne lance jamais pip toi-même. Après installation, appelle codegraph_index sur la racine exacte du projet, puis l’outil le plus précis. Cite toujours les chemins et lignes retournés. L’index est dérivé, local et supprimable ; codegraph_delete_index ne doit jamais toucher aux sources."
            }),
        },
        BuiltinPlugin {
            id: "builtin-data-analytics",
            name: "Data Analytics",
            version: "2.1.0",
            description: "Assistant d’analyse de données reproductible : exploration, qualité, nettoyage, statistiques, KPI, tendances, diagnostics et tableaux de bord, avec Python partagé, Visualize et artefacts sans dépendances dupliquées.",
            category: "recipe",
            manifest: serde_json::json!({
                "schemaVersion": 1,
                "builtin": true,
                "agentic": true,
                "name": "Data Analytics",
                "slug": "data-analytics",
                "version": "2.1.0",
                "author": "Bob Work",
                "description": "Analyse des données reproductible, de l’exploration à l’export, alimentée par les runtimes partagés Bob Work.",
                "category": "recipe",
                "icon": "analytics",
                "permissions": [{"type":"file.read"},{"type":"file.write"},{"type":"command.execute"}],
                "capabilities": ["data-analysis", "spreadsheets", "statistics", "business-analysis", "visualization", "dashboards", "artifacts"],
                "requires": ["python", "dataframe", "spreadsheet", "statistics", "visualization", "artifact"],
                "optionalCapabilities": ["scipy", "duckdb", "polars", "pyarrow", "scikit-learn"],
                "platforms": ["desktop", "mobile"],
                "sharedCapabilities": ["python", "dataframe", "spreadsheet", "statistics", "visualization", "artifact"],
                "externalRuntimes": [],
                "privateDependencies": [],
                "skills": [
                    "explore-dataset", "analyze-data-quality", "validate-data", "gather-business-context",
                    "create-data-context", "clean-data", "transform-data", "statistical-analysis", "design-kpis",
                    "metric-diagnostics", "root-cause-analysis", "kpi-reporting", "product-business-analysis",
                    "market-sizing", "trend-analysis", "correlation-analysis", "anomaly-detection", "forecast",
                    "visualize-data", "build-dashboard", "build-report", "export-analysis", "export-dataset",
                    "reproducible-analysis", "dataset-summary", "publish-artifact"
                ],
                "specializedMode": {
                    "label": "Data Analytics",
                    "description": "Analyse conversationnelle reproductible, exécution locale sur Desktop et exécution déléguée au Mac depuis Mobile.",
                    "allowedTools": ["read_file", "write_file", "execute_data_analysis"],
                    "outputFormats": ["md", "json", "csv", "xlsx", "html", "png", "svg", "pdf"],
                    "workflow": "Identifier les jeux de données → échantillonner et profiler → contrôler qualité et contexte métier → planifier/calculer dans le sandbox partagé → valider les résultats → produire une VisualSpec et un artefact final seulement si utile.",
                    "sandbox": "bob-runtime-managed",
                    "executors": {"desktop":"shared-python-sandbox", "mobile":"remote-desktop-sandbox"}
                },
                "instructions": "Utilise les capacités Runtime Manager, jamais des chemins Python ni pip. Commence par un profil léger du fichier puis maintiens un DatasetContext (colonnes, types, volume, valeurs manquantes, doublons, mesures, dimensions, dates et transformations). Le code analytique s’exécute uniquement dans le sandbox et ne reçoit que les fichiers du workspace. Récupère les erreurs d’encodage/délimiteur/types avant d’abandonner. Ne présente jamais une cause comme certaine sans comparaison calculée. Préfère pandas/NumPy partagés ; DuckDB, SciPy, Polars, PyArrow et scikit-learn sont facultatifs et doivent être détectés, jamais installés à la volée. Pour une visualisation, produis une VisualSpec et délègue à Visualize/au runtime commun : ECharts pour KPI/dashboards, Plotly pour statistiques. Ne génère pas de JavaScript arbitraire, ne duplique aucun moteur de rendu et ne rends persistants que les exports explicitement utiles. Sur Mobile, préserve la même expérience conversationnelle ; les calculs lourds sont exécutés par le Mac connecté et les résultats/artefacts sont synchronisés."
            }),
        },
        BuiltinPlugin {
            id: "builtin-visualize",
            name: "Visualize",
            version: "2.4.0",
            description: "Crée des visualisations interactives avec les runtimes partagés Apache ECharts (graphiques et tableaux de bord), Plotly (statistiques et données scientifiques) et Three.js (scènes 3D). Utilise D2, Mermaid et Graphviz pour les diagrammes. Disponible avec toutes les intégrations et sources de données, sans liaison exclusive à une base.",
            category: "recipe",
            manifest: serde_json::json!({
                "schemaVersion": 1,
                "builtin": true,
                "agentic": true,
                "name": "Visualize",
                "slug": "visualize",
                "version": "2.4.0",
                "author": "Bob Work",
                "description": "Visualisations interactives avec Apache ECharts, Plotly et Three.js ; diagrammes avec D2, Mermaid et Graphviz. Utilisable avec toutes les intégrations et sources de données, sans liaison exclusive à une base.",
                "category": "visualization",
                "icon": "chart",
                "permissions": [{"type":"file.read"},{"type":"file.write"}],
                "sharedCapabilities": ["visualization", "diagram", "artifact"],
                "externalRuntimes": [],
                "privateDependencies": [],
                "specializedMode": {
                    "label": "Visualize",
                    "description": "Transforme VisualSpec, DiagramSpec et SceneSpec en artefacts interactifs desktop/mobile avec Apache ECharts, Plotly, Three.js, D2, Mermaid et Graphviz, quelle que soit l’intégration source.",
                    "allowedTools": ["read_file", "write_file"],
                    "outputFormats": ["json", "svg", "png", "pdf", "html"],
                    "workflow": "Comprendre l’intention et les références source → produire VisualSpec, DiagramSpec ou SceneSpec → valider → router sans LLM additionnel → rendre localement → persister provenance, état d’interaction et présentation responsive.",
                    "sandbox": "bob-runtime-managed"
                },
                "instructions": "Ne produis jamais de JavaScript exécutable comme représentation canonique. Produis une spécification sémantique validable et des références d’artefacts, jamais de gros jeux de données dans le prompt. Le Shared Rendering API et ses adaptateurs de confiance déterminent le moteur local. Utilise ECharts pour les graphiques métier, Plotly pour les statistiques et données scientifiques, Three.js uniquement pour les scènes 3D réelles, D2 pour cloud/C4/ERD, Mermaid pour flow/sequence/state et Graphviz pour les graphes dirigés. Préserve les filtres, sélections, zoom/caméra et visibilité lorsqu’un même artefact est modifié. La cible par défaut est d’abord le rendu intégré à la conversation, pas une page Web plein écran : optimise d’abord l’état initial pour le viewport réellement courant d’environ 600 × 420 px, puis pour 720 × 480 px, sans scroll horizontal ni scroll de page vertical. Dans 600 × 420 px, réserve au minimum 240 px à la visualisation principale : en-tête inférieur ou égal à 36 px, bande de navigation inférieure ou égale à 34 px et quatre KPI sur une seule ligne compacte inférieure ou égale à 76 px. Ne passe pas les quatre KPI en grille 2 × 2 avant 480 px ; sous cette largeur, montre deux KPI prioritaires et place les autres dans un onglet ou menu si deux lignes comprimeraient le graphique. Montre uniquement la synthèse indispensable (au plus quatre KPI compacts et une visualisation principale) ; place les vues secondaires, détails, longues légendes, tableaux et journaux derrière des onglets, segments, accordéons, menus ou tiroirs accessibles. Chaque onglet doit lui aussi tenir dans le viewport conversation : présente quatre notes ou cartes courtes en grille 2 × 2 plutôt qu’en pile verticale et condense les libellés ; un tableau ou un journal peut avoir son propre scroll interne. N’utilise jamais overflow:hidden pour masquer du contenu essentiel et n’empile pas verticalement toutes les sections. Utilise des grilles fluides avec minmax(0, 1fr), clamp(), dimensions relatives et ResizeObserver/chart.resize ; évite 100vh, les hauteurs/min-width fixes et les textes qui deviennent inférieurs à 12 px après ajustement. Utilise height:100% seulement dans un conteneur dont Bob Work fournit la hauteur et min-height:0 sur les enfants flex/grid. Déclare toujours une présentation responsive distincte pour conversation, desktop, tablette et mobile : contrôles compacts, légende repliable et focus d’entité ; aucune information essentielle ne doit dépendre du survol. Avant livraison, ouvre et vérifie tous les onglets aux tailles 600 × 420, 720 × 480, 520 × 600 et 390 × 700 : scrollWidth ne doit pas dépasser clientWidth, la zone graphique ne doit pas être écrasée et aucun contenu essentiel ne doit être coupé ; si la densité ne le permet pas sans nuire à la lisibilité, conserve seulement la synthèse dans la conversation et réserve la vue complète au panneau d’aperçu."
            }),
        },
        BuiltinPlugin {
            id: "builtin-ibm-qiskit",
            name: "Qiskit",
            version: "2.0.0",
            description: "Espace de travail quantique agentique : circuits structurés, analyse, transpilation, simulation Aer, résultats et visualisation. Les opérations IBM Quantum distantes restent explicitement confirmées.",
            // The persisted plugin schema uses the executable category for
            // capabilities backed by a managed external runtime. Quantum is a
            // product domain, not a database category.
            category: "executable",
            manifest: with_runtime_requirements(cli_product_manifest(
                "Qiskit",
                "ibm-qiskit",
                "Espace de travail quantique agentique : circuits structurés, analyse, transpilation, simulation Aer, résultats et visualisation. Les opérations IBM Quantum distantes restent explicitement confirmées.",
                "qiskit",
                "IBM",
                "IBM",
                "IBM Quantum",
                "runtime://external.qiskit/python",
                "Qiskit Runtime géré par Bob Work",
                "Dans Réglages > Stockage et runtimes, examinez la taille, la source et les versions proposées puis confirmez l’installation du runtime Qiskit. Bob Work l’installe hors du paquet principal et ne modifie pas le PATH global.",
                &["qiskit.circuit.create", "qiskit.circuit.validate", "qiskit.circuit.analyze", "qiskit.transpile", "qiskit.local.simulate", "qiskit.result.analyze", "qiskit.visualize", "qiskit.ibm-runtime.inspect", "qiskit.ibm-runtime.execute"],
                "Résolution de la capacité `external.qiskit` par le Runtime Manager et vérification des versions → définition du circuit et de l'objectif → transpilation et simulation locale → analyse des résultats → sélection et contrôle du backend IBM Quantum éventuel → confirmation explicite → soumission distante → récupération et vérification du job.",
                "Mode Qiskit. Utilise exclusivement les opérations structurées du Built-in : création/import de circuit, validation, analyse, transpilation et simulation locale. Demande `external.qiskit` au Runtime Manager et arrête-toi avec l’information d’installation approuvée s’il est absent. N’invente jamais de métrique, résultat, topologie, disponibilité ou état de job. Distingue strictement simulation locale, simulation distante et QPU IBM. Ne soumets, n’annule ni ne consomme de quota IBM Quantum sans confirmation explicite. Les jetons IBM Quantum restent dans le coffre de secrets et ne sont jamais injectés dans la conversation, les artefacts ou Visualize. Passe à Visualize uniquement des données quantiques réelles et des SceneSpec/VisualSpec validés.",
                &[("Installation officielle de Qiskit", "https://quantum.cloud.ibm.com/docs/en/guides/install-qiskit"), ("Installation du client IBM Quantum Compute", "https://quantum.cloud.ibm.com/docs/en/guides/install-qiskit-runtime"), ("Dépôt officiel Qiskit", "https://github.com/Qiskit/qiskit")],
            ), "2.0.0", &["python", "visualization", "artifact"], serde_json::json!([
                {"id":"external.qiskit","version":"qiskit-2.5.2+runtime-0.49.0+aer-0.17.2","pythonMode":"shared","isolatedFallback":true}
            ])),
        },
        BuiltinPlugin {
            id: "builtin-beeai-code-interpreter",
            name: "BeeAI Code Interpreter",
            version: "1.0.0",
            description: "Conçoit, configure et diagnostique le service BeeAI Code Interpreter pour exécuter du Python dans un environnement isolé destiné aux agents, avec contrats HTTP, gestion des fichiers, limites de ressources et contrôle explicite des risques.",
            category: "recipe",
            manifest: ibm_product_manifest(
                "BeeAI Code Interpreter",
                "ibm-beeai-code-interpreter",
                "Conçoit, configure et diagnostique le service BeeAI Code Interpreter pour exécuter du Python dans un environnement isolé destiné aux agents, avec contrats HTTP, gestion des fichiers, limites de ressources et contrôle explicite des risques.",
                "https://avatars.githubusercontent.com/u/178592583?v=4",
                &["code.sandbox.design", "python.execute", "artifact.create", "runtime.diagnose", "security.review"],
                "Besoin d'exécution → contrôle du runtime disponible → préparation du contrat d'appel → exécution isolée si le service est réellement configuré → collecte stdout/stderr/fichiers → vérification et compte rendu.",
                "Mode BeeAI Code Interpreter. Utilise les spécifications officielles du projet pour préparer une intégration, un déploiement ou un diagnostic du service HTTP d'exécution Python. Vérifie toujours qu'un service BeeAI Code Interpreter réel est installé et joignable avant de parler d'exécution BeeAI. Le runtime n'est pas embarqué dans Bob Work à ce stade : ne simule jamais un appel, ne confonds pas une commande Python locale avec le sandbox BeeAI, et indique clairement les prérequis manquants. Pour toute exécution réelle, impose limites de temps/mémoire, répertoire de travail isolé, liste de fichiers autorisés et restitution explicite de stdout, stderr, code de sortie et artefacts.",
                &[("Dépôt officiel BeeAI Code Interpreter", "https://github.com/i-am-bee/beeai-code-interpreter")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-beeai-framework",
            name: "BeeAI Framework",
            version: "1.0.0",
            description: "Conçoit et développe des agents de production en Python ou TypeScript avec workflows dynamiques et déclaratifs, contraintes déterministes, mémoire, outils, MCP/A2A et observabilité OpenTelemetry.",
            category: "recipe",
            manifest: ibm_product_manifest(
                "BeeAI Framework",
                "ibm-beeai-framework",
                "Conçoit et développe des agents de production en Python ou TypeScript avec workflows dynamiques et déclaratifs, contraintes déterministes, mémoire, outils, MCP/A2A et observabilité OpenTelemetry.",
                "https://avatars.githubusercontent.com/u/178592583?v=4",
                &["agent.design", "agent.implement", "workflow.orchestration", "mcp.integrate", "a2a.integrate", "observability.configure", "agent.test"],
                "Cadrage de l'agent → choix Python/TypeScript et fournisseur de modèle → conception des contraintes, outils et mémoire → implémentation BeeAI → tests des trajectoires et erreurs → instrumentation OpenTelemetry → documentation d'exécution.",
                "Mode BeeAI Framework. Aide à concevoir, générer, expliquer, tester et revoir des agents BeeAI en suivant l'API et les exemples officiels actuels. Couvre agents, workflows dynamiques ou YAML, outils, mémoire, backends LLM, MCP, A2A, erreurs, retries et observabilité OpenTelemetry. Le package BeeAI Framework n'est pas embarqué : détecte d'abord le projet et ses dépendances ; si le framework manque, produis les fichiers et commandes d'installation sans prétendre les avoir exécutés. Préserve les secrets hors du code et ajoute des tests reproductibles pour les contraintes, outils et chemins d'échec.",
                &[("Dépôt officiel BeeAI Framework", "https://github.com/i-am-bee/beeai-framework"), ("Documentation BeeAI", "https://framework.beeai.dev/")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-beeai-agent-stack",
            name: "BeeAI Agent Stack",
            version: "1.0.0",
            description: "Prépare l'exécution et le déploiement d'agents comme services A2A avec CLI et UI, routage multi-fournisseurs, stockage, RAG, authentification, fichiers, intégrations MCP et déploiement Kubernetes.",
            category: "recipe",
            manifest: ibm_product_manifest(
                "BeeAI Agent Stack",
                "ibm-beeai-agent-stack",
                "Prépare l'exécution et le déploiement d'agents comme services A2A avec CLI et UI, routage multi-fournisseurs, stockage, RAG, authentification, fichiers, intégrations MCP et déploiement Kubernetes.",
                "https://avatars.githubusercontent.com/u/178592583?v=4",
                &["agent.package", "agent.serve", "a2a.expose", "provider.route", "rag.configure", "mcp.integrate", "kubernetes.deploy", "deployment.review"],
                "Inventaire de l'agent → vérification des prérequis Agent Stack → définition du service A2A et des fournisseurs → configuration stockage/auth/RAG/MCP → test local → plan de déploiement → contrôles sécurité, santé et réversibilité.",
                "Mode BeeAI Agent Stack. Conçois les fichiers, commandes et contrôles nécessaires pour transformer un agent existant en service A2A et l'exploiter via Agent Stack. Couvre CLI/UI, routage LLM, embeddings et recherche vectorielle, stockage S3, authentification et secrets, fichiers, MCP, SDK, Helm et Kubernetes. Agent Stack n'est pas embarqué dans Bob Work : vérifie sa présence avant toute commande, n'installe ni conteneur ni chart sans demande explicite et ne prétends jamais qu'un service est actif sans test de santé réel.",
                &[("Dépôt officiel Agent Stack", "https://github.com/i-am-bee/agentstack"), ("Documentation Agent Stack", "https://agentstack.beeai.dev/")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-granite-guardian",
            name: "Granite Guardian",
            version: "1.0.0",
            description: "Conçoit et exécute, lorsqu'un modèle est configuré, des contrôles de risques sur prompts et réponses : harm, jailbreak, hallucination RAG ou appels d'outils, groundedness et critères personnalisés BYOC.",
            category: "recipe",
            manifest: ibm_product_manifest(
                "Granite Guardian",
                "ibm-granite-guardian",
                "Conçoit et exécute, lorsqu'un modèle est configuré, des contrôles de risques sur prompts et réponses : harm, jailbreak, hallucination RAG ou appels d'outils, groundedness et critères personnalisés BYOC.",
                "https://avatars.githubusercontent.com/u/167822367?v=4",
                &["prompt.risk.assess", "output.risk.assess", "rag.groundedness", "tool.hallucination.detect", "byoc.evaluate", "safety.report"],
                "Définition du risque ou critère → sélection du modèle/mode Guardian → formatage strict du prompt de scoring → inférence réelle si le modèle est disponible → parsing du score → justification, seuil et décision traçables.",
                "Mode Granite Guardian. Prépare et, uniquement si un endpoint ou modèle local est réellement configuré, exécute les évaluations Granite Guardian selon le format de scoring officiel. Couvre risques de prompt et de réponse, harm, jailbreak, groundedness RAG, hallucinations d'appels d'outils et critères personnalisés BYOC. Aucun poids de modèle n'est embarqué dans Bob Work : sans runtime vérifié, fournis seulement la configuration ou une revue heuristique explicitement étiquetée, jamais un score présenté comme issu de Granite Guardian. Conserve le modèle, le mode, le critère, le seuil, le résultat brut et la décision pour audit.",
                &[("Dépôt officiel Granite Guardian", "https://github.com/ibm-granite/granite-guardian"), ("Documentation IBM Granite Guardian", "https://www.ibm.com/granite/docs/models/guardian")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-data-prep-kit",
            name: "Data Prep Kit",
            version: "1.0.0",
            description: "Conçoit des pipelines de préparation de données pour l'IA générative : ingestion et transformation de documents ou de code, qualité, filtrage, déduplication et exécution locale, Ray, Spark ou Kubernetes.",
            category: "recipe",
            manifest: ibm_product_manifest(
                "Data Prep Kit",
                "ibm-data-prep-kit",
                "Conçoit des pipelines de préparation de données pour l'IA générative : ingestion et transformation de documents ou de code, qualité, filtrage, déduplication et exécution locale, Ray, Spark ou Kubernetes.",
                "https://avatars.githubusercontent.com/u/202559084?v=4",
                &["data.profile", "data.transform", "data.filter", "data.deduplicate", "pipeline.design", "pipeline.execute", "quality.report"],
                "Inventaire des sources et licences → profilage/qualité → choix et ordre des transforms → exécution sur échantillon → validation avant/après → dimensionnement local/Ray/Spark/Kubernetes → manifeste reproductible et rapport de traçabilité.",
                "Mode Data Prep Kit. Conçois, génère, explique et révise des recettes DPK reproductibles pour préparer des corpus documentaires ou de code destinés au RAG, au fine-tuning ou à l'évaluation. Décris chaque transform, paramètres, schéma d'entrée/sortie, métriques avant/après, gestion des rejets, licences et données sensibles. Data Prep Kit et ses images ne sont pas embarqués : détecte les dépendances disponibles et n'exécute une recette que dans un environnement DPK réel et autorisé. Commence par un échantillon, conserve les données sources et rends toute transformation réversible ou traçable.",
                &[("Dépôt officiel Data Prep Kit", "https://github.com/data-prep-kit/data-prep-kit"), ("Documentation Data Prep Kit", "https://data-prep-kit.github.io/data-prep-kit/")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-ai-reviewer",
            name: "AI Reviewer",
            version: "1.0.0",
            description: "Effectue une revue structurée des prompts, réponses et trajectoires d'agents : respect des instructions, exactitude et groundedness, sécurité, qualité des appels d'outils, critères métier et décision de passage.",
            category: "recipe",
            manifest: ibm_product_manifest(
                "AI Reviewer",
                "ibm-ai-reviewer",
                "Effectue une revue structurée des prompts, réponses et trajectoires d'agents : respect des instructions, exactitude et groundedness, sécurité, qualité des appels d'outils, critères métier et décision de passage.",
                "https://avatars.githubusercontent.com/u/167822367?v=4",
                &["prompt.review", "output.review", "trajectory.review", "instruction.adherence", "groundedness.review", "safety.review", "quality.gate"],
                "Définition de la grille et des preuves → revue du prompt → revue de la réponse et des sources → revue des appels d'outils → scoring par critère → red flags → décision PASS/REVISE/BLOCK et recommandations testables.",
                "Mode AI Reviewer. Réalise une QA indépendante et traçable des prompts, sorties et trajectoires d'agents. Évalue instruction-following, complétude, exactitude, sources, groundedness, sécurité, confidentialité, appels d'outils, robustesse et critères métier ; sépare faits, inférences et inconnues. Si Granite Guardian est réellement configuré, utilise-le pour les critères compatibles et conserve son résultat brut. Sinon, étiquette la revue comme heuristique Bob — ne l'attribue jamais à Granite Guardian. Termine par les preuves, notes par critère, défauts classés, décision PASS/REVISE/BLOCK et tests de correction.",
                &[("Granite Guardian officiel", "https://github.com/ibm-granite/granite-guardian"), ("IBM AI Risk Atlas", "https://www.ibm.com/docs/en/watsonx/saas?topic=ai-risk-atlas")],
            ),
        },
        BuiltinPlugin {
            id: "builtin-cloud-architect",
            name: "Cloud Architect",
            version: "2.8.0",
            description: "Conçoit, documente et révise des architectures AWS, Azure, GCP, IBM Cloud, Kubernetes, hybrides et multi-cloud en consommant le Diagram Runtime partagé ; conserve uniquement l’intelligence de domaine et son catalogue d’icônes.",
            category: "executable",
            manifest: serde_json::from_str(include_str!(
                "../../resources/cloud-architect/manifest.json"
            ))
            .expect("valid built-in Cloud Architect manifest"),
        },
        BuiltinPlugin {
            id: "builtin-ibm-agentic-designer",
            name: "Designer",
            version: "1.0.1",
            description: "Transforme un besoin en expérience validée, accessible et prête pour le développement, selon une démarche compatible IBM Enterprise Design Thinking et Carbon.",
            category: "recipe",
            manifest: load_ibm_profession(include_str!(
                "../../resources/ibm-agentic-professions/plugins/ibm-agentic-designer/manifest.json"
            )),
        },
        BuiltinPlugin {
            id: "builtin-ibm-agentic-consultant",
            name: "Consultant",
            version: "1.0.1",
            description: "Structure un problème métier, analyse les options et produit une recommandation exécutable soumise à une Red Team Review.",
            category: "recipe",
            manifest: load_ibm_profession(include_str!(
                "../../resources/ibm-agentic-professions/plugins/ibm-agentic-consultant/manifest.json"
            )),
        },
        BuiltinPlugin {
            id: "builtin-ibm-agentic-rfp",
            name: "RFP / RFQ / RFT",
            version: "1.0.1",
            description: "Analyse les appels d’offres, sécurise la conformité et orchestre une proposition convaincante sans inventer de réponse.",
            category: "recipe",
            manifest: load_ibm_profession(include_str!(
                "../../resources/ibm-agentic-professions/plugins/ibm-agentic-rfp/manifest.json"
            )),
        },
        BuiltinPlugin {
            id: "builtin-ibm-agentic-product-manager",
            name: "Product Manager",
            version: "1.0.1",
            description: "Pilote la discovery, la stratégie, la priorisation et la mesure d’un produit à partir de résultats utilisateurs et métier.",
            category: "recipe",
            manifest: load_ibm_profession(include_str!(
                "../../resources/ibm-agentic-professions/plugins/ibm-agentic-product-manager/manifest.json"
            )),
        },
        BuiltinPlugin {
            id: "builtin-ibm-agentic-delivery-manager",
            name: "Scrum & Delivery Manager",
            version: "1.0.1",
            description: "Sécurise le flux de delivery, les engagements de sprint, les dépendances, les risques et les releases sans masquer l’incertitude.",
            category: "recipe",
            manifest: load_ibm_profession(include_str!(
                "../../resources/ibm-agentic-professions/plugins/ibm-agentic-delivery-manager/manifest.json"
            )),
        },
        BuiltinPlugin {
            id: "builtin-ibm-agentic-change-manager",
            name: "Change Manager",
            version: "1.0.1",
            description: "Planifie les impacts humains d’une transformation, traite les résistances et mesure l’adoption durable.",
            category: "recipe",
            manifest: load_ibm_profession(include_str!(
                "../../resources/ibm-agentic-professions/plugins/ibm-agentic-change-manager/manifest.json"
            )),
        },
        BuiltinPlugin {
            id: "builtin-ibm-agentic-solution-architect",
            name: "Solution Architect",
            version: "1.0.1",
            description: "Conçoit une architecture cible traçable depuis les exigences, avec arbitrages sécurité, intégration, résilience, cloud et coût.",
            category: "recipe",
            manifest: load_ibm_profession(include_str!(
                "../../resources/ibm-agentic-professions/plugins/ibm-agentic-solution-architect/manifest.json"
            )),
        },
        BuiltinPlugin {
            id: "builtin-documents",
            name: "Documents",
            version: "1.1.0",
            description: "Créer, lire, transformer et contrôler des documents locaux avec aperçu dans Bob Work.",
            category: "recipe",
            manifest: serde_json::json!({
                "name": "Documents", "slug": "bob-work-documents", "version": "1.1.0",
                "description": "Create, read, transform and review local documents.", "category": "recipe",
                "builtin": true, "icon": "document",
                "fileExtensions": [".txt", ".md", ".markdown", ".pdf", ".rtf", ".docx", ".odt"],
                "outputFormats": ["md", "txt", "pdf", "docx"],
                "capabilities": ["document.read", "document.create", "document.convert", "preview"],
                "permissions": office_permissions(),
                "runtime": {"python": ">=3.9", "mcp": true},
                "specializedMode": office_specialized_mode(
                    "Mode Documents",
                    &[".txt", ".md", ".markdown", ".pdf", ".rtf", ".docx", ".odt"],
                    &["md", "txt", "pdf", "docx"],
                    &["inspect_document", "extract_document_text", "read_file", "write_file", "execute_command", "use_mcp_tool"],
                    &["pypdf", "python-docx"],
                    "1) Inspecter le fichier joint localement. 2) Extraire le texte via le MCP Documents ou une commande Python locale. 3) Produire une version modifiée dans le dossier projet avec extension explicite. 4) Valider l’existence du fichier et renvoyer le chemin absolu pour l’aperçu Bob Work."
                ),
                "mcpServers": {
                    "office-tools": office_mcp_server(
                        "Outils Documents locaux",
                        "Inspection et extraction de texte locale (sans upload cloud).",
                        "documents",
                        &["inspect_document", "extract_document_text"]
                    )
                },
                "instructions": "Mode Documents Bob Work (local). Les pièces jointes restent sur la machine : ne les uploade pas. Commence par inspect_document ou extract_document_text via le MCP office-tools, puis travaille dans une sandbox Python locale si nécessaire. Préserve titres, liens, citations et tableaux. Crée les sorties dans le dossier projet avec une extension explicite. Ne remplace jamais un fichier source sans confirmation ; préfère une nouvelle version. Après écriture, vérifie que le fichier existe et renvoie son chemin absolu pour l’aperçu Quick Look."
            }),
        },
        BuiltinPlugin {
            id: "builtin-docling",
            name: "Docling",
            version: "1.0.0",
            description: "Convertit PDF, Office, images et audio en Markdown ou JSON structurés, avec OCR, tableaux, formules et graphiques, en local via la CLI Docling.",
            category: "executable",
            manifest: serde_json::json!({
                "schemaVersion": 1,
                "name": "Docling",
                "slug": "bob-work-docling",
                "version": "1.0.0",
                "description": "Convertit PDF, Office, images et audio en Markdown ou JSON structurés, avec OCR, tableaux, formules et graphiques, en local via la CLI Docling.",
                "category": "executable",
                "builtin": true,
                "vendor": "IBM",
                "publisher": "IBM",
                "productFamily": "IBM AI",
                "icon": "docling",
                "fileExtensions": [".pdf", ".docx", ".pptx", ".xlsx", ".html", ".md", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".webp", ".bmp", ".wav", ".mp3", ".m4a"],
                "outputFormats": ["md", "json", "html", "text", "doctags", "yaml", "vtt"],
                "capabilities": ["document.convert", "ocr", "tables.extract", "formula.extract", "chart.extract", "audio.transcribe"],
                "permissions": [
                    {"type": "file.read"},
                    {"type": "file.write"},
                    {"type": "mcp.connect"},
                    {"type": "command.execute"},
                    {"type": "network.request"}
                ],
                "runtime": {"python": ">=3.10", "cli": true, "mcp": true},
                "entrypoints": [
                    {"name": "docling", "path": "scripts/docling_cli.py", "runtime": "python3"},
                    {"name": "mcp", "path": "mcp/server.py", "runtime": "python3"}
                ],
                "resources": [
                    {"kind": "stdio-cli", "label": "CLI Docling 2.123.0", "command": "docling", "package": "docling", "installHint": "Python ≥ 3.10, puis pip install 'docling==2.123.0' ou l’outil MCP docling_ensure_runtime (venv ~/.bob/runtimes/docling/2.123.0)", "notes": "venv ~/.bob/runtimes/docling/2.123.0 ; PATH = fallback optionnel", "optional": false},
                    {"kind": "stdio-cli", "label": "docling convert", "command": "docling", "package": "docling", "notes": "PDF, DOCX, PPTX, XLSX, HTML, images, audio → md/json/html", "optional": false},
                    {"kind": "file", "label": "Documents et images joints", "notes": "Overlay plugin ou pièces jointes du chat", "optional": true},
                    {"kind": "bob-llm", "label": "LLM Bob", "notes": "Synthèse après conversion", "optional": false}
                ],
                "connectorStrategy": {
                    "targetLevel": "chatgpt-work",
                    "designNotes": "La CLI Docling (MIT, IBM / LF AI) est trop volumineuse pour un binaire embarqué (PyTorch + modèles). Bob Work l’installe dans un venv épinglé au premier usage, avec PATH en fallback.",
                    "explored": ["docling-cli-2.123.0", "docling-mcp-official", "docling-serve-remote", "bundled-python-venv", "bob-llm"],
                    "tiers": [
                        {"id": "T1", "kind": "local-cli", "provider": "docling-2.123.0", "required": true, "activation": "Premier appel : installation du venv ~/.bob/runtimes/docling/2.123.0"},
                        {"id": "T2", "kind": "local-mcp", "provider": "bob-work-docling", "required": true},
                        {"id": "T3", "kind": "bob-llm", "provider": "bob", "required": true},
                        {"id": "T4", "kind": "path-fallback", "provider": "docling", "required": false}
                    ],
                    "fallback": "Si l’installation pip/uv échoue, indiquer d’installer Python 3.10+ et de réessayer docling_ensure_runtime. Ne pas prétendre qu’une conversion a réussi."
                },
                "specializedMode": {
                    "label": "Mode Docling",
                    "description": "Conversion documentaire locale via la CLI Docling : layout, OCR, tableaux, formules, code, images et graphiques.",
                    "inputExtensions": [".pdf", ".docx", ".pptx", ".xlsx", ".html", ".md", ".png", ".jpg", ".jpeg", ".tiff", ".webp", ".wav", ".mp3"],
                    "outputFormats": ["md", "json", "html", "text", "doctags"],
                    "allowedTools": [
                        "docling_status", "docling_ensure_runtime", "docling_convert", "docling_ocr",
                        "docling_extract_tables", "docling_enrich", "docling_transcribe", "docling_models_download",
                        "use_mcp_tool", "execute_command", "read_file"
                    ],
                    "preferredLibraries": ["Docling 2.123.0 CLI"],
                    "workflow": "1) docling_status. 2) docling_ensure_runtime si la CLI manque. 3) Choisir convert / ocr / extract_tables / enrich / transcribe selon la demande. 4) Lire les fichiers générés. 5) Synthétiser et renvoyer les chemins absolus.",
                    "sandbox": "docling-cli"
                },
                "mcpServers": {
                    "docling": {
                        "displayName": "Docling CLI",
                        "description": "Conversion locale PDF/Office/images/audio via la CLI Docling (OCR, tableaux, enrichissements).",
                        "required": true,
                        "command": "python3",
                        "args": ["mcp/server.py"],
                        "cwd": ".",
                        "env": {"BOB_DOCLING": "1"},
                        "tools": [
                            "docling_status", "docling_ensure_runtime", "docling_convert", "docling_ocr",
                            "docling_extract_tables", "docling_enrich", "docling_transcribe", "docling_models_download"
                        ]
                    }
                },
                "instructions": "Mode Docling Bob Work. Convertis les documents **en local** avec la CLI Docling (pas d’upload cloud).\n\nOutils MCP : docling_status, docling_ensure_runtime, docling_convert, docling_ocr, docling_extract_tables, docling_enrich, docling_transcribe, docling_models_download. CLI : `python3 scripts/docling_cli.py convert <fichier> --to md` ou `docling convert` (shim bin/).\n\nWorkflow : 1) docling_status. 2) Si la CLI manque, docling_ensure_runtime (venv ~/.bob/runtimes/docling/2.123.0, Python ≥ 3.10). 3) Convertis le fichier joint — PDF/DOCX/PPTX/XLSX/HTML/image/audio. 4) OCR scanné → docling_ocr. Tableaux → docling_extract_tables. Code/formules/graphiques → docling_enrich. Audio → docling_transcribe. 5) Lis le Markdown/JSON produit et renvoie les chemins absolus pour l’aperçu.\n\nNe recopie pas de mot de passe PDF dans le chat. Ne simule jamais une conversion. Premier run : modèles téléchargés dans ~/.bob/runtimes/docling/models."
            }),
        },
        BuiltinPlugin {
            id: "builtin-word",
            name: "Microsoft Word",
            version: "1.1.0",
            description: "Créer et modifier des fichiers Word DOCX en conservant autant que possible styles et structure.",
            category: "recipe",
            manifest: serde_json::json!({
                "name": "Microsoft Word", "slug": "bob-work-microsoft-word", "version": "1.1.0",
                "description": "Create and edit Microsoft Word DOCX files.", "category": "recipe",
                "builtin": true, "icon": "word",
                "fileExtensions": [".doc", ".docx"],
                "outputFormats": ["docx"],
                "capabilities": ["docx.read", "docx.create", "docx.edit", "preview"],
                "permissions": office_permissions(),
                "runtime": {"python": ">=3.9", "mcp": true},
                "specializedMode": office_specialized_mode(
                    "Mode Microsoft Word",
                    &[".doc", ".docx"],
                    &["docx"],
                    &["inspect_docx", "extract_docx_text", "validate_docx", "read_file", "write_file", "execute_command", "use_mcp_tool"],
                    &["python-docx"],
                    "1) Si un DOCX est joint, appeler inspect_docx puis extract_docx_text via le MCP Word. 2) Modifier dans une sandbox Python locale (python-docx) en préservant styles et structure. 3) Écrire une copie ou nouvelle version .docx. 4) validate_docx puis renvoyer le chemin absolu pour l’aperçu Bob Work."
                ),
                "mcpServers": {
                    "office-tools": office_mcp_server(
                        "Outils Word locaux",
                        "Inspection et extraction DOCX via sandbox Python locale (python-docx ou OOXML).",
                        "word",
                        &["inspect_docx", "extract_docx_text", "validate_docx"]
                    )
                },
                "instructions": "Mode Microsoft Word Bob Work (local, sans upload OpenAI). Quand un .docx est joint au chat, traite-le comme dans ChatGPT Work : active ce mode spécialisé, inspecte le package avec inspect_docx, extrais le contenu avec extract_docx_text, puis modifie via python-docx dans une commande Python locale. Préserve ordre des sections, titres, listes, tableaux, liens, en-têtes/pieds et styles existants. Travaille sur une copie sauf autorisation explicite d’écrasement. Ne crée jamais un faux .docx (fichier texte renommé). Après écriture, validate_docx et renvoie le chemin absolu pour Quick Look."
            }),
        },
        BuiltinPlugin {
            id: "builtin-powerpoint",
            name: "Microsoft PowerPoint",
            version: "1.1.0",
            description: "Créer, modifier et vérifier des présentations PowerPoint PPTX avec respect du modèle fourni.",
            category: "recipe",
            manifest: serde_json::json!({
                "name": "Microsoft PowerPoint", "slug": "bob-work-microsoft-powerpoint", "version": "1.1.0",
                "description": "Create, edit and review Microsoft PowerPoint presentations.", "category": "recipe",
                "builtin": true, "icon": "powerpoint",
                "fileExtensions": [".ppt", ".pptx"],
                "outputFormats": ["pptx"],
                "capabilities": ["pptx.read", "pptx.create", "pptx.edit", "preview"],
                "permissions": office_permissions(),
                "runtime": {"python": ">=3.9", "mcp": true},
                "specializedMode": office_specialized_mode(
                    "Mode Microsoft PowerPoint",
                    &[".ppt", ".pptx"],
                    &["pptx"],
                    &["inspect_pptx", "list_pptx_slides", "validate_pptx", "read_file", "write_file", "execute_command", "use_mcp_tool"],
                    &["python-pptx"],
                    "1) inspect_pptx / list_pptx_slides sur le PPTX joint. 2) Modifier via python-pptx en conservant masters et layouts. 3) validate_pptx. 4) Chemin absolu pour aperçu."
                ),
                "mcpServers": {
                    "office-tools": office_mcp_server(
                        "Outils PowerPoint locaux",
                        "Inspection de présentations PPTX via sandbox Python locale.",
                        "ppt",
                        &["inspect_pptx", "list_pptx_slides", "validate_pptx"]
                    )
                },
                "instructions": "Mode Microsoft PowerPoint Bob Work (local). Si un modèle PPTX est joint, réutilise masters, layouts, polices, couleurs et dimensions. Une idée claire par slide, pas de débordement de texte, notes sources si pertinent. Utilise inspect_pptx et list_pptx_slides avant modification, python-pptx pour éditer, validate_pptx après sauvegarde. Renvoie le chemin absolu PPTX pour Quick Look."
            }),
        },
        BuiltinPlugin {
            id: "builtin-excel",
            name: "Microsoft Excel",
            version: "1.1.0",
            description: "Créer, analyser et modifier des classeurs Excel XLSX en préservant formules et formats.",
            category: "recipe",
            manifest: serde_json::json!({
                "name": "Microsoft Excel", "slug": "bob-work-microsoft-excel", "version": "1.1.0",
                "description": "Create, analyze and edit Microsoft Excel workbooks.", "category": "recipe",
                "builtin": true, "icon": "excel",
                "fileExtensions": [".xls", ".xlsx", ".xlsm", ".csv", ".tsv"],
                "outputFormats": ["xlsx", "csv"],
                "capabilities": ["xlsx.read", "xlsx.create", "xlsx.edit", "formula.verify", "preview"],
                "permissions": office_permissions(),
                "runtime": {"python": ">=3.9", "mcp": true},
                "specializedMode": office_specialized_mode(
                    "Mode Microsoft Excel",
                    &[".xls", ".xlsx", ".xlsm", ".csv", ".tsv"],
                    &["xlsx", "csv"],
                    &["inspect_xlsx", "read_xlsx_sheet", "validate_xlsx", "read_file", "write_file", "execute_command", "use_mcp_tool"],
                    &["openpyxl", "pandas"],
                    "1) inspect_xlsx sur le classeur joint. 2) read_xlsx_sheet pour les plages utiles. 3) Modifier via openpyxl en préservant formules et formats. 4) validate_xlsx et chemin absolu."
                ),
                "mcpServers": {
                    "office-tools": office_mcp_server(
                        "Outils Excel locaux",
                        "Inspection et lecture XLSX via sandbox Python locale (openpyxl ou OOXML).",
                        "excel",
                        &["inspect_xlsx", "read_xlsx_sheet", "validate_xlsx"]
                    )
                },
                "instructions": "Mode Microsoft Excel Bob Work (local). Quand un .xlsx/.csv est joint, inspect_xlsx puis read_xlsx_sheet via le MCP office-tools. Préserve formules, formats numériques, cellules fusionnées, plages nommées, validations et graphiques. Ne remplace jamais une formule par sa valeur affichée. Pour un nouveau classeur : en-têtes explicites, types adaptés, largeurs lisibles. Utilise openpyxl en sandbox Python. Après sauvegarde, validate_xlsx et renvoie le chemin absolu."
            }),
        },
        BuiltinPlugin {
            id: "builtin-onenote",
            name: "Microsoft OneNote",
            version: "1.1.0",
            description: "Préparer et organiser des pages OneNote via un connecteur Microsoft Graph ou MCP configuré.",
            category: "integration",
            manifest: serde_json::json!({
                "name": "Microsoft OneNote", "slug": "bob-work-microsoft-onenote", "version": "1.1.0",
                "description": "Read and organize Microsoft OneNote through an authorized connector.", "category": "integration",
                "builtin": true, "icon": "onenote",
                "fileExtensions": [".one", ".onetoc2", ".md"],
                "requiresIntegration": "onenote",
                "capabilities": ["onenote.read", "onenote.prepare", "onenote.write"],
                "permissions": [{"type":"network.request"}, {"type":"file.read"}, {"type":"file.write"}],
                "integrations": [{
                    "provider": "onenote",
                    "displayName": "Microsoft OneNote",
                    "authType": "oauth",
                    "scopes": ["Notes.Read", "Notes.ReadWrite"],
                    "optional": true
                }],
                "specializedMode": office_specialized_mode(
                    "Mode Microsoft OneNote",
                    &[".one", ".onetoc2", ".md"],
                    &["md", "docx"],
                    &["read_file", "write_file", "execute_command", "use_mcp_tool"],
                    &[],
                    "Avec Graph connecté : résoudre carnet/section/page avant action. Sinon : brouillon Markdown ou DOCX local en attendant publication."
                ),
                "instructions": "Mode OneNote Bob Work. Utilise ce skill uniquement si Microsoft Graph ou un MCP compatible est configuré. Résous les identités carnet/section/page avant d’agir. Lecture selon le scope du connecteur. Demande une approbation explicite avant création, déplacement, renommage ou suppression. Sans connecteur, prépare un brouillon Markdown ou DOCX local et explique que la publication OneNote reste en attente ; ne simule jamais un upload réussi."
            }),
        },
        BuiltinPlugin {
            id: "builtin-computer-use",
            name: "Computer Use",
            version: "1.0.5",
            description: "Contrôle n’importe quelle app Mac en arrière-plan : ouvrir, lire l’UI, cliquer, saisir via Accessibilité (style ChatGPT Work).",
            category: "executable",
            manifest: serde_json::json!({
                "name": "Computer Use",
                "slug": "bob-work-computer-use",
                "version": "1.0.5",
                "description": "Contrôle n’importe quelle app Mac en arrière-plan : ouvrir, lire l’UI, cliquer, saisir via Accessibilité (style ChatGPT Work).",
                "category": "executable",
                "builtin": true,
                "icon": "computer",
                "capabilities": ["desktop.control", "app.open", "ui.read", "ui.input"],
                "permissions": [
                    {"type": "browser.control"},
                    {"type": "mcp.connect"},
                    {"type": "command.execute"}
                ],
                "runtime": {"python": ">=3.9", "mcp": true},
                "connectorStrategy": {
                    "targetLevel": "chatgpt-work",
                    "tiers": [
                        {"id": "T3", "kind": "local-mcp", "provider": "bob-work-computer-use", "required": true, "activation": "Réglages → Contrôle de l’ordinateur"}
                    ],
                    "designNotes": "MCP global bob-work-computer-use pour tout le bureau macOS (pas une app précise). Background-first : ui_click / ui_set_value / app_command sans voler le focus. Accessibilité requise ; open_app via /usr/bin/open -g."
                },
                "browserExtensions": [{
                    "id": "desktop",
                    "displayName": "Contrôle bureau macOS",
                    "capability": "computer_use",
                    "mcpServer": "bob-work-computer-use",
                    "required": true
                }],
                "specializedMode": {
                    "label": "Mode Computer Use",
                    "description": "Contrôle local de n’importe quelle application Mac via le MCP bob-work-computer-use, sans forcer le premier plan.",
                    "inputExtensions": [],
                    "outputFormats": ["md"],
                    "allowedTools": [
                        "accessibility_status", "list_apps", "open_app", "focus_app",
                        "get_app_state", "ui_click", "ui_set_value", "app_command",
                        "capture_screen", "desktop_click", "desktop_type", "press_key", "use_mcp_tool"
                    ],
                    "preferredLibraries": [],
                    "workflow": "1) accessibility_status. 2) open_app sans activate (toute app Mac). 3) get_app_state. 4) ui_click / ui_set_value / app_command en arrière-plan. 5) focus_app seulement en dernier recours. 6) Vérifier le résultat.",
                    "sandbox": "macos-accessibility"
                },
                "instructions": "Mode Computer Use Bob Work (style ChatGPT Work). MCP `bob-work-computer-use` requis. Tu contrôles n’importe quelle app macOS (Messages, Finder, Slack, Spotify, Notes, Terminal, etc.) — pas seulement une app précise.\n\nOutils : accessibility_status, list_apps, open_app, focus_app, get_app_state, ui_click, ui_set_value, app_command, capture_screen, desktop_click, desktop_type, press_key.\n\nReste dans Bob Work : ne vole pas le focus. open_app sans activate. Préfère ui_click / ui_set_value / app_command. focus_app et bring_to_front=true seulement si indispensable. Ne exige pas frontmost=true. Si l’arbre AX est pauvre, une capture sans focus (max 3). Pas de clic dans Bob Work/ChatGPT. Pas d’aperçu Chrome pour une app Mac. Pas d’osascript/python3/Terminal. Autorisations Accessibilité + Enregistrement d’écran pour Bob Work."
            }),
        },
        BuiltinPlugin {
            id: "builtin-chrome-control",
            name: "Contrôle Chrome",
            version: "1.0.3",
            description: "Pilote Google Chrome : ouvrir des onglets, naviguer et exécuter du JavaScript dans la page.",
            category: "executable",
            manifest: serde_json::json!({
                "name": "Contrôle Chrome",
                "slug": "bob-work-chrome-control",
                "version": "1.0.3",
                "description": "Pilote Google Chrome : ouvrir des onglets, naviguer et exécuter du JavaScript dans la page.",
                "category": "executable",
                "builtin": true,
                "icon": "chrome",
                "capabilities": ["browser.control", "chrome.tabs", "chrome.navigate", "chrome.js"],
                "permissions": [
                    {"type": "browser.control"},
                    {"type": "mcp.connect"},
                    {"type": "command.execute"}
                ],
                "runtime": {"python": ">=3.9", "mcp": true},
                "connectorStrategy": {
                    "targetLevel": "chatgpt-work",
                    "tiers": [
                        {"id": "T3", "kind": "local-mcp", "provider": "bob-work-chrome-control", "required": true, "activation": "Réglages → Contrôle de Chrome"}
                    ],
                    "designNotes": "Le MCP global bob-work-chrome-control est installé quand le réglage est activé. Automatisation macOS (Bob Work → Google Chrome) est requise pour lire/contrôler les onglets."
                },
                "browserExtensions": [{
                    "id": "chrome",
                    "displayName": "Contrôle Google Chrome",
                    "capability": "chrome",
                    "mcpServer": "bob-work-chrome-control",
                    "required": true
                }],
                "specializedMode": {
                    "label": "Mode Contrôle Chrome",
                    "description": "Pilotage local de Google Chrome via le MCP bob-work-chrome-control.",
                    "inputExtensions": [],
                    "outputFormats": ["md"],
                    "allowedTools": [
                        "chrome_open_url", "chrome_read_front_tab", "chrome_list_tabs",
                        "chrome_activate_tab", "chrome_navigate", "chrome_execute_js",
                        "web_fetch", "browser_snapshot", "use_mcp_tool"
                    ],
                    "preferredLibraries": [],
                    "workflow": "1) Recherche/API/documentation : web_fetch en arrière-plan. 2) Seulement si l’utilisateur demande explicitement Chrome : vérifier l’Automatisation, puis chrome_open_url ou chrome_list_tabs. 3) chrome_navigate / chrome_execute_js selon besoin. 4) Renvoyer titre+URL confirmés. Ne simule jamais un onglet si l’outil échoue.",
                    "sandbox": "macos-chrome-automation"
                },
                "instructions": "Mode Contrôle Chrome Bob Work. Le serveur MCP `bob-work-chrome-control` doit être actif. Pour les recherches, API et documentations, utilise `web_fetch` ou `browser_snapshot` : ils travaillent en arrière-plan et ne doivent ouvrir aucune fenêtre. Les outils `chrome_*` sont réservés à une demande explicite d’ouverture, navigation ou interaction dans Chrome. N’utilise jamais osascript/python3. Si Automatisation est refusée après une demande explicite, explique d’autoriser **Bob Work → Google Chrome** dans Réglages Système → Confidentialité et sécurité → Automatisation. Reste local ; pas d’upload cloud."
            }),
        },
    ]
}

#[cfg(test)]
mod builtin_tests {
    use super::*;

    fn test_database() -> Database {
        let db = Database::new_in_memory().expect("in-memory database");
        db.run_migrations().expect("migrations");
        db
    }

    #[test]
    fn get_all_lists_newest_user_plugins_before_builtins() {
        let db = test_database();
        let service = PluginService::new();
        service.ensure_builtin_plugins(&db).expect("seed builtins");
        let older = service
            .create(
                &db,
                CreatePluginInput {
                    name: "Older custom".into(),
                    version: "1.0.0".into(),
                    author: None,
                    description: Some("old".into()),
                    scope: Some("personal".into()),
                    category: "recipe".into(),
                    manifest: serde_json::json!({
                        "name": "Older custom",
                        "slug": "older-custom",
                        "version": "1.0.0",
                        "description": "old",
                        "category": "recipe",
                        "permissions": []
                    }),
                },
            )
            .expect("create older");
        let newer = service
            .create(
                &db,
                CreatePluginInput {
                    name: "Newer custom".into(),
                    version: "1.0.0".into(),
                    author: None,
                    description: Some("new".into()),
                    scope: Some("personal".into()),
                    category: "recipe".into(),
                    manifest: serde_json::json!({
                        "name": "Newer custom",
                        "slug": "newer-custom",
                        "version": "1.0.0",
                        "description": "new",
                        "category": "recipe",
                        "permissions": []
                    }),
                },
            )
            .expect("create newer");
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE plugins SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
                rusqlite::params!["2026-08-01T10:00:00+00:00", older.id],
            )
            .expect("stamp older");
            conn.execute(
                "UPDATE plugins SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
                rusqlite::params!["2026-08-10T10:00:00+00:00", newer.id],
            )
            .expect("stamp newer");
        }

        let listed = service.get_all(&db).expect("list");
        let names: Vec<_> = listed.iter().map(|plugin| plugin.name.as_str()).collect();
        let newer = names
            .iter()
            .position(|name| *name == "Newer custom")
            .unwrap();
        let older = names
            .iter()
            .position(|name| *name == "Older custom")
            .unwrap();
        let first_builtin = listed
            .iter()
            .position(|plugin| PluginService::is_protected_builtin(&plugin.id))
            .unwrap();
        assert!(
            newer < older,
            "newest custom plugin should come first: {names:?}"
        );
        assert!(
            older < first_builtin,
            "builtins should follow custom plugins: {names:?}"
        );
        assert!(listed[first_builtin..]
            .iter()
            .all(|plugin| PluginService::is_protected_builtin(&plugin.id)));
    }

    #[test]
    fn ensure_builtin_plugins_activates_the_latest_qiskit_without_a_duplicate_entry() {
        let db = test_database();
        let service = PluginService::new();
        service.ensure_builtin_plugins(&db).expect("seed built-ins");

        let now = Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().expect("database lock");
            conn.execute(
                "UPDATE plugins SET name=?1,version=?2,manifest=?3,available_version=?4,updated_at=?5 WHERE id=?6",
                params![
                    "IBM Qiskit",
                    "1.0.0",
                    serde_json::json!({"name":"IBM Qiskit","version":"1.0.0","slug":"ibm-qiskit"}).to_string(),
                    "2.0.0",
                    now,
                    "builtin-ibm-qiskit",
                ],
            )
            .expect("stage legacy Qiskit");
        }

        service
            .ensure_builtin_plugins(&db)
            .expect("activate packaged Qiskit");
        let active = service
            .get_by_id(&db, "builtin-ibm-qiskit")
            .expect("read active Qiskit")
            .expect("Qiskit remains installed");
        assert_eq!(active.version, "2.0.0");
        assert_eq!(active.name, "Qiskit");
        assert!(active.available_version.is_none());
        assert_eq!(
            active
                .manifest
                .get("version")
                .and_then(|value| value.as_str()),
            Some("2.0.0")
        );

        let conn = db.conn.lock().expect("database lock");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM plugins WHERE id='builtin-ibm-qiskit'",
                [],
                |row| row.get(0),
            )
            .expect("count Qiskit entries");
        assert_eq!(count, 1);
    }

    #[test]
    fn document_plugin_catalog_is_complete_and_native() {
        let plugins = builtin_document_plugins();
        assert_eq!(plugins.len(), 37);
        let names = plugins.iter().map(|plugin| plugin.name).collect::<Vec<_>>();
        assert!(names.contains(&"IBM Cloud"));
        assert!(names.contains(&"IBM watsonx"));
        assert!(names.contains(&"Amazon Web Services (AWS)"));
        assert!(names.contains(&"Microsoft Azure"));
        assert!(names.contains(&"Google Cloud (GCP)"));
        assert!(names.contains(&"Red Hat OpenShift"));
        assert!(names.contains(&"HashiCorp Terraform"));
        assert!(names.contains(&"Red Hat Ansible"));
        assert!(names.contains(&"IBM Db2"));
        assert!(names.contains(&"IBM Z"));
        assert!(names.contains(&"Qiskit"));
        assert!(names.contains(&"Data Analytics"));
        assert!(names.contains(&"Visualize"));
        assert!(names.contains(&"BeeAI Code Interpreter"));
        assert!(names.contains(&"BeeAI Framework"));
        assert!(names.contains(&"BeeAI Agent Stack"));
        assert!(names.contains(&"Granite Guardian"));
        assert!(names.contains(&"Data Prep Kit"));
        assert!(names.contains(&"AI Reviewer"));
        assert!(names.contains(&"Cloud Architect"));
        assert!(names.contains(&"Designer"));
        assert!(names.contains(&"Consultant"));
        assert!(names.contains(&"RFP / RFQ / RFT"));
        assert!(names.contains(&"Product Manager"));
        assert!(names.contains(&"Scrum & Delivery Manager"));
        assert!(names.contains(&"Change Manager"));
        assert!(names.contains(&"Solution Architect"));
        assert!(names.contains(&"Documents"));
        assert!(names.contains(&"Docling"));
        assert!(names.contains(&"Microsoft Word"));
        assert!(names.contains(&"Microsoft PowerPoint"));
        assert!(names.contains(&"Microsoft Excel"));
        assert!(names.contains(&"Microsoft OneNote"));
        assert!(names.contains(&"Computer Use"));
        assert!(names.contains(&"Contrôle Chrome"));
        assert!(names.contains(&"CodeGraph"));
        assert!(!names.contains(&"CTO Investissements"));
        let visualize = plugins
            .iter()
            .find(|plugin| plugin.id == "builtin-visualize")
            .expect("Visualize built-in");
        assert_eq!(visualize.version, "2.4.0");
        let visualize_instructions = visualize
            .manifest
            .get("instructions")
            .and_then(|value| value.as_str())
            .expect("Visualize instructions");
        assert!(visualize_instructions.contains("600 × 420"));
        assert!(visualize_instructions.contains("720 × 480"));
        assert!(visualize_instructions.contains("au minimum 240 px à la visualisation principale"));
        assert!(visualize_instructions.contains("avant 480 px"));
        assert!(visualize_instructions.contains("Chaque onglet doit lui aussi tenir"));
        assert!(visualize_instructions.contains("grille 2 × 2"));
        assert!(visualize_instructions.contains("overflow:hidden"));
        assert!(
            visualize_instructions.contains("sans scroll horizontal ni scroll de page vertical")
        );
        assert!(visualize_instructions.contains("onglets, segments, accordéons, menus ou tiroirs"));
        assert!(plugins
            .iter()
            .all(|plugin| plugin.manifest.get("builtin") == Some(&serde_json::Value::Bool(true))));
        assert!(plugins
            .iter()
            .all(|plugin| plugin.manifest.get("slug").is_some()));
        let ibm_products = plugins
            .iter()
            .filter(|plugin| {
                plugin
                    .manifest
                    .get("vendor")
                    .and_then(|value| value.as_str())
                    == Some("IBM")
            })
            .collect::<Vec<_>>();
        assert_eq!(ibm_products.len(), 22);
        assert!(ibm_products
            .iter()
            .any(|plugin| plugin.id == "builtin-docling"));
        assert!(ibm_products
            .iter()
            .any(|plugin| plugin.id == "builtin-ibm-agentic-designer"));
        let watsonx = ibm_products
            .iter()
            .find(|plugin| plugin.id == "builtin-ibm-watsonx-ai")
            .expect("watsonx.ai built-in");
        assert_eq!(
            watsonx
                .manifest
                .get("requiresPlugins")
                .and_then(|value| value.as_array())
                .and_then(|plugins| plugins.first())
                .and_then(|plugin| plugin.get("id"))
                .and_then(|value| value.as_str()),
            Some("builtin-ibm-cloud")
        );
        let watsonx_resources = watsonx
            .manifest
            .get("resources")
            .and_then(|value| value.as_array())
            .expect("watsonx resources");
        for api_url in [
            "https://cloud.ibm.com/docs/apis/watsonx-ai",
            "https://cloud.ibm.com/apidocs/watsonxdata-v3",
            "https://cloud.ibm.com/apidocs/ai-openscale",
        ] {
            assert!(watsonx_resources.iter().any(|resource| {
                resource.get("url").and_then(|value| value.as_str()) == Some(api_url)
            }));
        }
        let watsonx_capabilities = watsonx
            .manifest
            .get("capabilities")
            .and_then(|value| value.as_array())
            .expect("watsonx capabilities");
        for capability in [
            "inference.run",
            "lakehouse.inspect",
            "governance.factsheet.inspect",
            "governance.compliance.review",
        ] {
            assert!(watsonx_capabilities
                .iter()
                .any(|value| value.as_str() == Some(capability)));
        }
        assert!(PluginService::new().validate(&watsonx.manifest).valid);
        let pending_runtime = ibm_products
            .iter()
            .filter(|plugin| {
                plugin
                    .manifest
                    .get("distribution")
                    .and_then(|value| value.get("bundledRuntime"))
                    .and_then(|value| value.as_bool())
                    == Some(false)
            })
            .count();
        assert_eq!(pending_runtime, 14);
        let profession_plugins = plugins
            .iter()
            .filter(|plugin| plugin.id.starts_with("builtin-ibm-agentic-"))
            .collect::<Vec<_>>();
        assert_eq!(profession_plugins.len(), 7);
        let profession_icons: Vec<_> = profession_plugins
            .iter()
            .map(|plugin| plugin.manifest.get("icon").and_then(|value| value.as_str()))
            .collect();
        assert_eq!(
            profession_icons,
            vec![
                Some("designer"),
                Some("consultant"),
                Some("rfp"),
                Some("product"),
                Some("delivery"),
                Some("change"),
                Some("architecture"),
            ]
        );
        let unique = profession_icons
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), 7);
        assert!(profession_plugins.iter().all(|plugin| {
            plugin
                .manifest
                .get("skills")
                .and_then(|value| value.as_array())
                .is_some_and(|skills| !skills.is_empty())
        }));
        let work = packaged_work_plugins();
        assert_eq!(work.len(), 2);
        assert_eq!(work[0].id, "bob-work-cto-invest");
        assert_eq!(work[1].id, "bob-work-ibm-pursuit");
        assert_eq!(
            work[0].manifest.get("builtin"),
            Some(&serde_json::Value::Bool(false))
        );
        assert_eq!(
            work[1].manifest.get("builtin"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    #[test]
    fn ibm_platform_plugins_declare_icons_and_actionable_cli_requirements() {
        let plugins = builtin_document_plugins();
        let expected = [
            ("builtin-ibm-cloud", "ibm-cloud", "ibmcloud"),
            ("builtin-ibm-watsonx-ai", "watsonx", "ibmcloud"),
            ("builtin-openshift", "openshift", "oc"),
            ("builtin-terraform", "terraform", "terraform"),
            ("builtin-ansible", "ansible", "ansible-playbook"),
            ("builtin-ibm-db2", "ibm-db2", "db2"),
            ("builtin-ibm-z", "ibm-z", "zowe"),
            ("builtin-ibm-qiskit", "qiskit", "qiskit-bob"),
        ];

        for (id, icon, command) in expected {
            let plugin = plugins
                .iter()
                .find(|plugin| plugin.id == id)
                .unwrap_or_else(|| panic!("missing built-in plugin {id}"));
            assert_eq!(plugin.category, "executable");
            assert_eq!(
                plugin.manifest.get("builtin").and_then(|v| v.as_bool()),
                Some(true)
            );
            assert_eq!(
                plugin.manifest.get("icon").and_then(|v| v.as_str()),
                Some(icon)
            );
            assert!(
                plugin.description.len() > 80,
                "description too short for {id}"
            );

            if id == "builtin-ibm-qiskit" {
                let runtime = plugin
                    .manifest
                    .get("resources")
                    .and_then(|value| value.as_array())
                    .and_then(|resources| {
                        resources.iter().find(|resource| {
                            resource.get("kind").and_then(|value| value.as_str())
                                == Some("external-runtime")
                        })
                    })
                    .expect("missing Qiskit external runtime resource");
                assert_eq!(
                    runtime.get("runtimeId").and_then(|value| value.as_str()),
                    Some("external.qiskit")
                );
                continue;
            }
            let cli = plugin
                .manifest
                .get("resources")
                .and_then(|value| value.as_array())
                .and_then(|resources| {
                    resources.iter().find(|resource| {
                        resource.get("kind").and_then(|value| value.as_str()) == Some("stdio-cli")
                    })
                })
                .unwrap_or_else(|| panic!("missing CLI resource for {id}"));
            assert_eq!(cli.get("command").and_then(|v| v.as_str()), Some(command));
            assert_eq!(cli.get("optional").and_then(|v| v.as_bool()), Some(false));
            assert!(cli
                .get("installHint")
                .and_then(|v| v.as_str())
                .is_some_and(|hint| hint.len() > 50));

            let instructions = plugin
                .manifest
                .get("instructions")
                .and_then(|value| value.as_str())
                .expect("platform instructions");
            assert!(instructions.contains(command));
            assert!(instructions.contains("arrête l'exécution"));
            assert!(instructions.contains("Ne simule jamais"));

            let missing =
                crate::services::plugin_local_runtime::missing_tools(plugin.name, &plugin.manifest);
            let reported_missing = missing
                .iter()
                .any(|tool| tool.command.as_deref() == Some(command));
            assert_eq!(
                reported_missing,
                which::which(command).is_err(),
                "host CLI detection mismatch for {id}"
            );
            if reported_missing {
                let prompt = crate::services::plugin_local_runtime::prompt_block(&missing)
                    .expect("missing CLI prompt");
                assert!(prompt.contains(command));
                assert!(prompt.contains("doit être installé"));
                assert!(prompt.contains("Ne simule pas"));
            }
        }
    }

    #[test]
    fn cloud_provider_plugins_declare_branding_and_actionable_cli_requirements() {
        let plugins = builtin_document_plugins();
        let expected = [
            ("builtin-aws", "aws", "aws", "Amazon Web Services"),
            ("builtin-azure", "azure", "az", "Microsoft"),
            ("builtin-gcp", "gcp", "gcloud", "Google Cloud"),
        ];

        for (id, icon, command, vendor) in expected {
            let plugin = plugins
                .iter()
                .find(|plugin| plugin.id == id)
                .unwrap_or_else(|| panic!("missing built-in plugin {id}"));
            assert_eq!(plugin.category, "executable");
            assert_eq!(
                plugin
                    .manifest
                    .get("vendor")
                    .and_then(|value| value.as_str()),
                Some(vendor)
            );
            assert_eq!(
                plugin
                    .manifest
                    .get("productFamily")
                    .and_then(|value| value.as_str()),
                Some("Cloud Providers")
            );
            assert_eq!(
                plugin.manifest.get("icon").and_then(|value| value.as_str()),
                Some(icon)
            );
            assert!(
                plugin.description.len() > 120,
                "description too short for {id}"
            );

            let cli = plugin
                .manifest
                .get("resources")
                .and_then(|value| value.as_array())
                .and_then(|resources| {
                    resources.iter().find(|resource| {
                        resource.get("kind").and_then(|value| value.as_str()) == Some("stdio-cli")
                    })
                })
                .unwrap_or_else(|| panic!("missing CLI resource for {id}"));
            assert_eq!(
                cli.get("command").and_then(|value| value.as_str()),
                Some(command)
            );
            assert_eq!(
                cli.get("optional").and_then(|value| value.as_bool()),
                Some(false)
            );
            assert!(cli
                .get("installHint")
                .and_then(|value| value.as_str())
                .is_some_and(|hint| hint.len() > 80));
        }
    }

    #[test]
    fn packaged_agentic_builtins_use_embedded_bundle_instead_of_version_snapshot() {
        let packaged = builtin_document_plugins()
            .into_iter()
            .find(|plugin| plugin.id == "builtin-ibm-agentic-solution-architect")
            .expect("packaged agentic builtin");
        assert_eq!(
            packaged.manifest.get("agentic"),
            Some(&serde_json::Value::Bool(true))
        );
        assert!(!PluginService::requires_agentic_version_snapshot(
            packaged.id,
            &packaged.manifest,
        ));

        let personal = serde_json::json!({"agentic": true});
        assert!(PluginService::requires_agentic_version_snapshot(
            "agentic-personal-solution-architect",
            &personal,
        ));

        let shadow = serde_json::json!({
            "agentic": true,
            "builtin": true,
            "slug": "ibm-agentic-solution-architect"
        });
        assert!(!PluginService::requires_agentic_version_snapshot(
            "agentic-ibm-agentic-solution-architect",
            &shadow,
        ));
    }

    #[test]
    fn ensure_builtin_plugins_auto_activates_ibm_agentic_profession_update() {
        let db = test_database();
        let service = PluginService::new();
        let now = Utc::now().to_rfc3339();
        let old_manifest = serde_json::json!({
            "name": "Agentic Designer",
            "slug": "ibm-agentic-designer",
            "version": "1.0.0",
            "description": "old",
            "category": "recipe",
            "builtin": true,
            "agentic": true,
            "permissions": [{"type":"file.read"}]
        });
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at,available_version)
                 VALUES ('builtin-ibm-agentic-designer','Agentic Designer','1.0.0','Bob Work','old','personal','recipe',?1,'installed','valid',?2,?2,'1.0.1')",
                params![old_manifest.to_string(), now],
            )
            .expect("seed old profession");
        }
        let seeded = service
            .get_by_id(&db, "builtin-ibm-agentic-designer")
            .expect("lookup")
            .expect("plugin");
        service
            .persist_version(&db, &seeded, None, true)
            .expect("persist old version");

        service
            .ensure_builtin_plugins(&db)
            .expect("ensure builtins");
        let upgraded = service
            .get_by_id(&db, "builtin-ibm-agentic-designer")
            .expect("lookup")
            .expect("plugin");
        assert_eq!(upgraded.version, "1.0.1");
        assert!(upgraded.available_version.is_none());
        assert_eq!(upgraded.name, "Designer");
    }

    #[test]
    fn ensure_builtin_plugins_refreshes_ibm_vendor_without_version_bump() {
        let db = test_database();
        let service = PluginService::new();
        let now = Utc::now().to_rfc3339();
        let old_manifest = serde_json::json!({
            "name": "Designer",
            "slug": "ibm-agentic-designer",
            "version": "1.0.1",
            "description": "old",
            "category": "recipe",
            "builtin": true,
            "agentic": true,
            "icon": "designer",
            "permissions": [{"type":"file.read"}]
        });
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at)
                 VALUES ('builtin-ibm-agentic-designer','Designer','1.0.1','Bob Work','old','personal','recipe',?1,'installed','valid',?2,?2)",
                params![old_manifest.to_string(), now],
            )
            .expect("seed profession without vendor");
        }
        let seeded = service
            .get_by_id(&db, "builtin-ibm-agentic-designer")
            .expect("lookup")
            .expect("plugin");
        service
            .persist_version(&db, &seeded, None, true)
            .expect("persist current version");

        service
            .ensure_builtin_plugins(&db)
            .expect("ensure builtins");
        let refreshed = service
            .get_by_id(&db, "builtin-ibm-agentic-designer")
            .expect("lookup")
            .expect("plugin");
        assert_eq!(refreshed.version, "1.0.1");
        assert_eq!(
            refreshed
                .manifest
                .get("vendor")
                .and_then(|value| value.as_str()),
            Some("IBM")
        );
        assert_eq!(
            refreshed
                .manifest
                .get("productFamily")
                .and_then(|value| value.as_str()),
            Some("IBM Agentic")
        );
    }

    #[test]
    fn promote_legacy_ibm_agentic_id_then_activates_packaged_version() {
        let db = test_database();
        let service = PluginService::new();
        let now = Utc::now().to_rfc3339();
        let old_manifest = serde_json::json!({
            "name": "Agentic Solution Architect",
            "slug": "ibm-agentic-solution-architect",
            "version": "1.0.0",
            "description": "old",
            "category": "recipe",
            "builtin": true,
            "agentic": true,
            "permissions": [{"type":"file.read"}]
        });
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at,available_version)
                 VALUES ('agentic-ibm-agentic-solution-architect','Agentic Solution Architect','1.0.0','Bob Agent','old','personal','recipe',?1,'installed','valid',?2,?2,'1.0.1')",
                params![old_manifest.to_string(), now],
            )
            .expect("seed shadow profession");
        }
        let seeded = service
            .get_by_id(&db, "agentic-ibm-agentic-solution-architect")
            .expect("lookup")
            .expect("plugin");
        service
            .persist_version(&db, &seeded, None, true)
            .expect("persist old version");

        service
            .ensure_builtin_plugins(&db)
            .expect("ensure builtins");
        assert!(service
            .get_by_id(&db, "agentic-ibm-agentic-solution-architect")
            .expect("lookup")
            .is_none());
        let upgraded = service
            .get_by_id(&db, "builtin-ibm-agentic-solution-architect")
            .expect("lookup")
            .expect("plugin");
        assert_eq!(upgraded.version, "1.0.1");
        assert!(upgraded.available_version.is_none());
        assert_eq!(upgraded.name, "Solution Architect");
    }

    #[test]
    fn infer_plugin_icon_maps_office_and_remote_brands() {
        assert_eq!(
            infer_plugin_icon("bob-work-docling", "Docling", "CLI IBM Docling"),
            "docling"
        );
        assert_eq!(
            infer_plugin_icon("bob-work-microsoft-word", "Microsoft Word", ""),
            "word"
        );
        assert_eq!(
            infer_plugin_icon("bob-work-microsoft-excel", "Microsoft Excel", ""),
            "excel"
        );
        assert!(infer_plugin_icon("my-notion-brief", "Notion Brief", "").contains("notion.so"));
        let mut manifest = serde_json::json!({
            "name": "Notion Brief",
            "slug": "my-notion-brief",
            "version": "1.0.0"
        });
        ensure_manifest_icon(&mut manifest, "Notion Brief", Some("Sync Notion pages"));
        assert!(manifest
            .get("icon")
            .and_then(|value| value.as_str())
            .is_some_and(|icon| icon.contains("notion.so")));
    }

    #[test]
    fn ensure_manifest_icon_replaces_placeholder_profession_icons() {
        let mut manifest = serde_json::json!({
            "name": "Designer",
            "slug": "ibm-agentic-designer",
            "version": "1.0.0",
            "icon": "plugin",
            "agentic": true
        });
        ensure_manifest_icon(&mut manifest, "Designer", Some("IBM Design Thinking"));
        assert_eq!(
            manifest.get("icon").and_then(|value| value.as_str()),
            Some("designer")
        );
    }

    #[test]
    fn prune_removes_agentic_shadows_of_builtins() {
        let db = test_database();
        let service = PluginService::new();
        service.ensure_builtin_plugins(&db).expect("seed builtins");
        let now = chrono::Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at)
                 VALUES (?1,?2,'1.0.0','Bob Agent',?3,'personal','recipe',?4,'installed','valid',?5,?5)",
                rusqlite::params![
                    "agentic-bob-work-microsoft-word",
                    "Microsoft Word",
                    "Shadow without icon",
                    serde_json::json!({
                        "name": "Microsoft Word",
                        "slug": "bob-work-microsoft-word",
                        "version": "1.0.0",
                        "builtin": true,
                        "agentic": true
                    })
                    .to_string(),
                    now,
                ],
            )
            .expect("insert shadow");
        }
        let removed = service.prune_shadow_agentic_plugins(&db).expect("prune");
        assert_eq!(removed, 1);
        assert!(service
            .get_by_id(&db, "agentic-bob-work-microsoft-word")
            .expect("lookup")
            .is_none());
        assert!(service
            .get_by_id(&db, "builtin-word")
            .expect("lookup")
            .is_some());
    }

    #[test]
    fn prune_removes_agentic_docling_alias_shadow() {
        let db = test_database();
        let service = PluginService::new();
        service.ensure_builtin_plugins(&db).expect("seed builtins");
        let now = chrono::Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at)
                 VALUES (?1,?2,'1.0.0','Bob Agent',?3,'personal','executable',?4,'installed','valid',?5,?5)",
                rusqlite::params![
                    "agentic-docling",
                    "Docling",
                    "Shadow alias",
                    serde_json::json!({
                        "name": "Docling",
                        "slug": "docling",
                        "version": "1.0.0",
                        "agentic": true
                    })
                    .to_string(),
                    now,
                ],
            )
            .expect("insert docling shadow");
        }
        let removed = service.prune_shadow_agentic_plugins(&db).expect("prune");
        assert_eq!(removed, 1);
        assert!(service
            .get_by_id(&db, "agentic-docling")
            .expect("lookup")
            .is_none());
        assert!(service
            .get_by_id(&db, "builtin-docling")
            .expect("lookup")
            .is_some());
    }

    #[test]
    fn prune_removes_agentic_shadow_of_packaged_cto() {
        let db = test_database();
        let service = PluginService::new();
        service
            .ensure_builtin_plugins(&db)
            .expect("seed packaged CTO");
        let now = chrono::Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at)
                 VALUES (?1,?2,'1.2.0','Bob Agent',?3,'personal','executable',?4,'installed','valid',?5,?5)",
                rusqlite::params![
                    "agentic-bob-work-cto-invest",
                    "CTO Investissements",
                    "Shadow duplicate",
                    serde_json::json!({
                        "name": "CTO Investissements",
                        "slug": "bob-work-cto-invest",
                        "version": "1.2.0",
                        "builtin": false,
                        "agentic": true
                    })
                    .to_string(),
                    now,
                ],
            )
            .expect("insert shadow");
        }
        let removed = service.prune_shadow_agentic_plugins(&db).expect("prune");
        assert_eq!(removed, 1);
        assert!(service
            .get_by_id(&db, "agentic-bob-work-cto-invest")
            .expect("lookup")
            .is_none());
        assert!(service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .is_some());
    }

    #[test]
    fn create_assigns_inferred_icon_when_missing() {
        let db = test_database();
        let service = PluginService::new();
        let plugin = service
            .create(
                &db,
                CreatePluginInput {
                    name: "Microsoft Excel Helper".into(),
                    version: "1.0.0".into(),
                    author: None,
                    description: Some("Analyse des classeurs xlsx".into()),
                    scope: Some("personal".into()),
                    category: "recipe".into(),
                    manifest: serde_json::json!({
                        "name": "Microsoft Excel Helper",
                        "slug": "excel-helper",
                        "version": "1.0.0",
                        "description": "Analyse des classeurs xlsx",
                        "category": "recipe",
                        "permissions": []
                    }),
                },
            )
            .expect("create");
        assert_eq!(
            plugin.manifest.get("icon").and_then(|value| value.as_str()),
            Some("excel")
        );
    }

    #[test]
    fn cto_invest_plugin_is_created_deployed_and_usable_in_prompt_context() {
        let db = test_database();
        let service = PluginService::new();
        service
            .ensure_builtin_plugins(&db)
            .expect("seed packaged CTO invest");

        let plugin = service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .expect("CTO plugin installed");
        assert_eq!(plugin.version, "1.2.3");
        assert_eq!(plugin.install_state, "installed");
        assert_eq!(plugin.category, "executable");
        assert_eq!(
            plugin.manifest.get("slug").and_then(|value| value.as_str()),
            Some("bob-work-cto-invest")
        );
        assert_eq!(
            plugin.manifest.get("builtin"),
            Some(&serde_json::Value::Bool(false)),
            "CTO must not be a protected builtin"
        );
        assert!(
            plugin.manifest.get("specializedMode").is_some(),
            "CTO plugin needs specializedMode for prompt injection"
        );
        assert!(
            plugin.manifest.get("connectorStrategy").is_some(),
            "Work-level CTO plugin must declare connectorStrategy"
        );
        assert!(
            plugin
                .manifest
                .get("resources")
                .and_then(|value| value.as_array())
                .is_some_and(|items| items.len() >= 3),
            "CTO plugin must list resources in manifest"
        );
        assert!(
            plugin
                .manifest
                .get("integrations")
                .and_then(|value| value.as_array())
                .is_some_and(|items| items.is_empty()),
            "CTO must not fake Finnhub as a catalogue Connexion"
        );
        assert!(
            plugin
                .manifest
                .get("entrypoints")
                .and_then(|value| value.as_array())
                .is_some_and(|items| items.len() >= 2),
            "CTO Python plugin must declare CLI + MCP entrypoints"
        );
        assert!(PluginMcpService::has_servers(&plugin.manifest));

        let skill_dir = dirs::home_dir()
            .expect("home")
            .join(".bob/skills/bob-work-cto-invest");
        let mcp_script = skill_dir.join("mcp/server.py");
        assert!(
            skill_dir.join("SKILL.md").is_file(),
            "CTO skill frontmatter must be deployed"
        );
        assert!(
            skill_dir.join("cto_market.py").is_file(),
            "CTO shared Python lib must be deployed"
        );
        assert!(
            skill_dir.join("scripts/screen_cto.py").is_file(),
            "CTO CLI entrypoint must be deployed"
        );
        assert!(mcp_script.is_file(), "CTO MCP server must be deployed");
        assert_eq!(
            std::fs::read_to_string(skill_dir.join(".bob-work-plugin-id")).expect("plugin id"),
            "bob-work-cto-invest"
        );
        let script = std::fs::read_to_string(&mcp_script).expect("read MCP");
        assert!(script.contains("cto_market_snapshot") || script.contains("import cto_market"));
        assert!(script.contains("cto_screen_ideas") || script.contains("import cto_market"));
        let market = std::fs::read_to_string(skill_dir.join("cto_market.py")).expect("market lib");
        assert!(market.contains("pas un conseil en investissement"));
    }

    #[test]
    fn ensure_builtin_plugins_auto_activates_packaged_update() {
        let db = test_database();
        let service = PluginService::new();
        let now = Utc::now().to_rfc3339();
        let old_manifest = serde_json::json!({
            "name": "Documents", "slug": "bob-work-documents", "version": "1.0.0",
            "description": "old", "category": "recipe", "builtin": true,
            "permissions": [{"type":"file.read"},{"type":"file.write"},{"type":"mcp.connect"},{"type":"command.execute"}],
            "mcpServers": {
                "office-tools": {
                    "displayName": "Outils",
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "tools": ["inspect_document"]
                }
            }
        });
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at,available_version)
                 VALUES ('builtin-documents','Documents','1.0.0','Bob Work','old','personal','recipe',?1,'installed','valid',?2,?2,'1.1.0')",
                params![old_manifest.to_string(), now],
            )
            .expect("seed old plugin");
        }
        let seeded = service
            .get_by_id(&db, "builtin-documents")
            .expect("lookup")
            .expect("plugin");
        service
            .persist_version(&db, &seeded, None, true)
            .expect("persist old version");

        service
            .ensure_builtin_plugins(&db)
            .expect("ensure builtins");
        let upgraded = service
            .get_by_id(&db, "builtin-documents")
            .expect("lookup")
            .expect("plugin");
        assert_eq!(upgraded.version, "1.1.0");
        assert!(upgraded.available_version.is_none());
    }

    #[test]
    fn demotes_legacy_builtin_cto_and_allows_restore() {
        let db = test_database();
        let service = PluginService::new();
        let now = Utc::now().to_rfc3339();
        let legacy_manifest = serde_json::json!({
            "name": "CTO Investissements",
            "slug": "bob-work-cto-invest",
            "version": "1.2.0",
            "description": "legacy builtin",
            "category": "executable",
            "builtin": true,
            "icon": "invest",
            "permissions": [{"type":"network.request"},{"type":"mcp.connect"},{"type":"command.execute"}],
            "mcpServers": {
                "cto-market": {
                    "displayName": "Marché CTO (local)",
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "env": {"BOB_CTO_INVEST": "1"},
                    "tools": ["cto_connector_status", "cto_market_snapshot", "cto_screen_ideas"]
                }
            }
        });
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at)
                 VALUES ('builtin-cto-invest','CTO Investissements','1.2.0','Bob Work','legacy','personal','executable',?1,'installed','valid',?2,?2)",
                params![legacy_manifest.to_string(), now],
            )
            .expect("seed legacy");
        }
        let seeded = service
            .get_by_id(&db, "builtin-cto-invest")
            .expect("lookup")
            .expect("plugin");
        service
            .persist_version(&db, &seeded, None, true)
            .expect("persist current");
        let older = Plugin {
            version: "1.1.0".into(),
            available_version: None,
            updated_at: now.clone(),
            ..seeded.clone()
        };
        service
            .persist_version(&db, &older, None, false)
            .expect("persist older");

        service
            .ensure_builtin_plugins(&db)
            .expect("demote + ensure");
        assert!(service
            .get_by_id(&db, "builtin-cto-invest")
            .expect("lookup")
            .is_none());
        let demoted = service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .expect("demoted plugin");
        assert_eq!(
            demoted.manifest.get("builtin"),
            Some(&serde_json::Value::Bool(false))
        );

        let restored = service
            .activate_version(&db, "bob-work-cto-invest", "1.1.0")
            .expect("restore must succeed for non-builtin CTO");
        assert_eq!(restored.version, "1.1.0");
    }

    #[test]
    fn ensure_preserves_newer_cto_version_and_custom_python() {
        let db = test_database();
        let service = PluginService::new();
        service
            .ensure_builtin_plugins(&db)
            .expect("seed packaged CTO");

        let packaged = service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .expect("CTO");
        let packaged_version = packaged.version.clone();
        let newer = format!(
            "{}.{}.{}",
            9,
            9,
            9 // deliberately ahead of any packaged CTO semver
        );
        let mut newer_manifest = packaged.manifest.clone();
        if let Some(object) = newer_manifest.as_object_mut() {
            object.insert("version".into(), serde_json::Value::String(newer.clone()));
            object.insert(
                "releaseNotes".into(),
                serde_json::Value::String("custom newer release".into()),
            );
        }
        let now = Utc::now().to_rfc3339();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE plugins SET version=?1, manifest=?2, available_version=NULL, updated_at=?3 WHERE id=?4",
                params![newer, newer_manifest.to_string(), now, "bob-work-cto-invest"],
            )
            .expect("bump active version ahead of packaged");
        }
        let bumped = service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .expect("CTO");
        service
            .persist_version(&db, &bumped, None, true)
            .expect("persist newer history row");

        let skill_dir = dirs::home_dir()
            .expect("home")
            .join(".bob/skills/bob-work-cto-invest");
        std::fs::create_dir_all(skill_dir.join("mcp")).expect("mcp dir");
        std::fs::create_dir_all(skill_dir.join("scripts")).expect("scripts dir");
        let custom_marker = "# bob-work-custom-cto-bundle\nprint('keep-me')\n";
        std::fs::write(skill_dir.join("cto_market.py"), custom_marker).expect("custom python");
        std::fs::write(skill_dir.join(".bob-work-plugin-id"), "bob-work-cto-invest")
            .expect("owner marker");
        // No deploy marker → ensure refreshes SKILL once, but must preserve Python.
        let _ = std::fs::remove_file(skill_dir.join(".bob-work-deployed-version"));

        service
            .ensure_builtin_plugins(&db)
            .expect("ensure must not downgrade");
        let after = service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .expect("CTO");
        assert_eq!(after.version, newer, "active version must survive relaunch");
        assert_ne!(after.version, packaged_version);
        let python = std::fs::read_to_string(skill_dir.join("cto_market.py")).expect("python");
        assert!(
            python.contains("bob-work-custom-cto-bundle"),
            "custom CTO Python must not be overwritten by packaged ensure refresh"
        );

        // Second ensure is a no-op refresh (marker matches) and still keeps the bundle.
        service.ensure_builtin_plugins(&db).expect("second ensure");
        let python_again =
            std::fs::read_to_string(skill_dir.join("cto_market.py")).expect("python");
        assert!(python_again.contains("bob-work-custom-cto-bundle"));
        assert_eq!(
            service
                .get_by_id(&db, "bob-work-cto-invest")
                .expect("lookup")
                .expect("CTO")
                .version,
            newer
        );
    }

    #[test]
    fn packaged_work_plugin_stays_deleted_after_uninstall() {
        let db = test_database();
        let service = PluginService::new();
        service.ensure_builtin_plugins(&db).expect("seed CTO");
        assert!(service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .is_some());

        service
            .uninstall(&db, "bob-work-cto-invest")
            .expect("delete packaged CTO");
        assert!(service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .is_none());

        service
            .ensure_builtin_plugins(&db)
            .expect("ensure must not reseed dismissed CTO");
        assert!(service
            .get_by_id(&db, "bob-work-cto-invest")
            .expect("lookup")
            .is_none());

        let error = service
            .uninstall(&db, "builtin-documents")
            .expect_err("builtin must stay protected");
        assert!(error.to_string().contains("intégré"));
    }

    #[test]
    fn ensure_builtin_plugins_repairs_invalid_staged_onenote_update() {
        let db = test_database();
        let service = PluginService::new();
        let now = Utc::now().to_rfc3339();
        let old_manifest = serde_json::json!({
            "name": "Microsoft OneNote", "slug": "bob-work-microsoft-onenote", "version": "1.0.0",
            "description": "old", "category": "integration", "builtin": true,
            "permissions": [{"type":"network.request"}],
            "requiresIntegration": "microsoft-graph"
        });
        // Previously shipped 1.1.0 used an unknown OAuth provider without MCP —
        // validation rejected activation and left "Prête à être installée".
        let bad_staged = serde_json::json!({
            "name": "Microsoft OneNote", "slug": "bob-work-microsoft-onenote", "version": "1.1.0",
            "description": "bad", "category": "integration", "builtin": true,
            "permissions": [{"type":"network.request"}],
            "integrations": [{
                "provider": "microsoft-graph",
                "authType": "oauth",
                "scopes": ["Notes.Read"]
            }]
        });
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO plugins
                 (id,name,version,author,description,scope,category,manifest,install_state,validation_state,created_at,updated_at,available_version)
                 VALUES ('builtin-onenote','Microsoft OneNote','1.0.0','Bob Work','old','personal','integration',?1,'installed','valid',?2,?2,'1.1.0')",
                params![old_manifest.to_string(), now],
            )
            .expect("seed old onenote");
            conn.execute(
                "INSERT INTO plugin_versions
                 (plugin_id,version,name,author,description,scope,category,manifest,validation_state,created_at)
                 VALUES ('builtin-onenote','1.1.0','Microsoft OneNote','Bob Work','bad','personal','integration',?1,'valid',?2)",
                params![bad_staged.to_string(), now],
            )
            .expect("seed bad staged version");
        }
        let seeded = service
            .get_by_id(&db, "builtin-onenote")
            .expect("lookup")
            .expect("plugin");
        service
            .persist_version(&db, &seeded, None, true)
            .expect("persist old version");

        assert!(!service.validate(&bad_staged).valid);

        service
            .ensure_builtin_plugins(&db)
            .expect("ensure builtins");
        let upgraded = service
            .get_by_id(&db, "builtin-onenote")
            .expect("lookup")
            .expect("plugin");
        assert_eq!(upgraded.version, "1.1.0");
        assert!(upgraded.available_version.is_none());
        assert_eq!(
            upgraded
                .manifest
                .get("integrations")
                .and_then(|value| value.as_array())
                .and_then(|items| items.first())
                .and_then(|item| item.get("provider"))
                .and_then(|value| value.as_str()),
            Some("onenote")
        );
    }

    #[test]
    fn office_plugins_expose_specialized_mode_and_local_mcp() {
        let plugins = builtin_document_plugins();
        for plugin_id in [
            "builtin-documents",
            "builtin-word",
            "builtin-excel",
            "builtin-powerpoint",
        ] {
            let plugin = plugins
                .iter()
                .find(|plugin| plugin.id == plugin_id)
                .expect("plugin");
            assert!(
                plugin.manifest.get("specializedMode").is_some(),
                "{} missing specializedMode",
                plugin_id
            );
            assert!(
                PluginMcpService::has_servers(&plugin.manifest),
                "{} missing mcpServers",
                plugin_id
            );
            assert_eq!(plugin.version, "1.1.0");
        }
        let docling = plugins
            .iter()
            .find(|plugin| plugin.id == "builtin-docling")
            .expect("docling");
        assert!(docling.manifest.get("specializedMode").is_some());
        assert!(PluginMcpService::has_servers(&docling.manifest));
        assert_eq!(docling.version, "1.0.0");
        assert_eq!(
            docling
                .manifest
                .get("icon")
                .and_then(|value| value.as_str()),
            Some("docling")
        );
    }

    #[test]
    fn imports_a_valid_agentic_python_cli_and_mcp_bundle_once() {
        let db = test_database();
        let root = std::env::temp_dir().join(format!("bob-work-plugin-test-{}", Uuid::new_v4()));
        let bundle = root.join("cloud-architect-agent");
        std::fs::create_dir_all(bundle.join("scripts")).expect("bundle directories");
        std::fs::create_dir_all(bundle.join("mcp")).expect("mcp directory");
        std::fs::write(
            bundle.join("SKILL.md"),
            "---\nname: cloud-architect-agent\ndescription: test\nuser-invocable: true\n---\n\nRun the local architecture CLI.",
        )
        .expect("skill");
        std::fs::write(
            bundle.join("scripts/assessment.py"),
            "import argparse\nprint('ok')\n",
        )
        .expect("python entrypoint");
        std::fs::write(
            bundle.join("mcp/server.py"),
            "import sys\nfor line in sys.stdin: print(line)\n",
        )
        .expect("mcp entrypoint");
        std::fs::write(
            bundle.join(".bob-work-plugin.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "name": "Cloud Architect Agent",
                "slug": "cloud-architect-agent",
                "version": "1.0.0",
                "description": "Architecture assessment",
                "category": "executable",
                "permissions": [{"type":"mcp.connect"}, {"type":"command.execute"}],
                "runtime": {"python": ">=3.9", "cli": true, "mcp": true},
                "entrypoints": [
                    {"name":"assess", "runtime":"python3", "path":"scripts/assessment.py"},
                    {"name":"mcp", "runtime":"python3", "path":"mcp/server.py"}
                ],
                "mcpServers": {
                    "architecture": {
                        "displayName": "Architecture tools",
                        "command": "python3",
                        "args": ["mcp/server.py"],
                        "cwd": ".",
                        "tools": [{"name": "assess_architecture"}]
                    }
                }
            })
            .to_string(),
        )
        .expect("manifest");

        let service = PluginService::new();
        let first = service
            .sync_agentic_bundles_from(&db, &root)
            .expect("first import");
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id, "agentic-cloud-architect-agent");
        assert_eq!(
            first[0].manifest.get("agentic"),
            Some(&serde_json::Value::Bool(true))
        );
        assert!(bundle.join(".bob-work-plugin-id").is_file());
        assert!(first[0]
            .manifest
            .get("mcpServers")
            .and_then(|value| value.get("architecture"))
            .is_some());
        assert!(service
            .sync_agentic_bundles_from(&db, &root)
            .expect("idempotent import")
            .is_empty());

        std::fs::write(
            bundle.join("SKILL.md"),
            "---\nname: cloud-architect-agent\ndescription: test\nuser-invocable: true\n---\n\nRun the improved local architecture CLI.",
        )
        .expect("updated skill");
        std::fs::write(
            bundle.join("scripts/assessment.py"),
            "import argparse\nprint('version 1.1')\n",
        )
        .expect("updated python entrypoint");
        let mut updated_manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(bundle.join(".bob-work-plugin.json")).expect("read manifest"),
        )
        .expect("parse manifest");
        updated_manifest["version"] = serde_json::Value::String("1.1.0".into());
        updated_manifest["releaseNotes"] =
            serde_json::Value::String("Ajout de recommandations de résilience.".into());
        updated_manifest["capabilities"] =
            serde_json::json!(["architecture.review", "resilience.review"]);
        std::fs::write(
            bundle.join(".bob-work-plugin.json"),
            updated_manifest.to_string(),
        )
        .expect("write updated manifest");

        let detected = service
            .sync_agentic_bundles_from(&db, &root)
            .expect("detect update");
        assert_eq!(detected.len(), 1);
        let still_installed = service
            .get_by_id(&db, "agentic-cloud-architect-agent")
            .expect("lookup")
            .expect("plugin");
        assert_eq!(still_installed.version, "1.0.0");
        assert_eq!(still_installed.available_version.as_deref(), Some("1.1.0"));

        let history = service
            .list_versions(&db, &still_installed.id)
            .expect("version history");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].state, "available");
        assert_eq!(history[1].state, "current");
        let diff = service
            .compare_version(&db, &still_installed.id, "1.1.0")
            .expect("version diff");
        assert!(diff
            .changes
            .iter()
            .any(|change| change.contains("résilience")));

        // A staged version is immutable even if the source bundle changes later.
        std::fs::write(
            bundle.join("scripts/assessment.py"),
            "print('unreleased source mutation')\n",
        )
        .expect("mutate source after snapshot");
        let upgraded = service
            .activate_version(&db, &still_installed.id, "1.1.0")
            .expect("install update");
        assert_eq!(upgraded.version, "1.1.0");
        assert!(upgraded.available_version.is_none());
        let upgraded_bundle = PathBuf::from(
            upgraded
                .manifest
                .get("bundlePath")
                .and_then(|value| value.as_str())
                .expect("snapshot bundle path"),
        );
        assert!(
            std::fs::read_to_string(upgraded_bundle.join("scripts/assessment.py"))
                .expect("read snapshot")
                .contains("version 1.1")
        );

        let restored = service
            .activate_version(&db, &still_installed.id, "1.0.0")
            .expect("rollback");
        assert_eq!(restored.version, "1.0.0");
        assert_eq!(restored.available_version.as_deref(), Some("1.1.0"));
        let restored_bundle = PathBuf::from(
            restored
                .manifest
                .get("bundlePath")
                .and_then(|value| value.as_str())
                .expect("restored bundle path"),
        );
        assert!(
            std::fs::read_to_string(restored_bundle.join("scripts/assessment.py"))
                .expect("read restored snapshot")
                .contains("print('ok')")
        );

        std::fs::remove_dir_all(&root).expect("cleanup test bundle");
    }

    #[test]
    fn skips_builtin_marked_bundles_during_agentic_sync() {
        let db = test_database();
        let root = std::env::temp_dir().join(format!("bob-work-plugin-test-{}", Uuid::new_v4()));
        let bundle = root.join("bob-work-microsoft-word");
        std::fs::create_dir_all(bundle.join("scripts")).expect("dirs");
        std::fs::write(
            bundle.join("SKILL.md"),
            "---\nname: bob-work-microsoft-word\n---\nWord",
        )
        .unwrap();
        std::fs::write(
            bundle.join(".bob-work-plugin.json"),
            serde_json::json!({
                "name": "Microsoft Word",
                "slug": "bob-work-microsoft-word",
                "version": "1.1.0",
                "category": "recipe",
                "builtin": true,
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(bundle.join("scripts/noop.py"), "print('ok')\n").unwrap();
        std::fs::write(bundle.join(".bob-work-plugin-id"), "builtin-word").unwrap();

        let imported = PluginService::new()
            .sync_agentic_bundles_from(&db, &root)
            .expect("sync");
        assert!(imported.is_empty());
        assert!(PluginService::new()
            .get_by_id(&db, "agentic-bob-work-microsoft-word")
            .expect("lookup")
            .is_none());

        std::fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn imports_a_handyman_plugin_with_shell_node_and_bundled_binary() {
        let db = test_database();
        let root = std::env::temp_dir().join(format!("bob-work-plugin-test-{}", Uuid::new_v4()));
        let bundle = root.join("diagram-kit");
        std::fs::create_dir_all(bundle.join("scripts")).expect("scripts");
        std::fs::create_dir_all(bundle.join("bin")).expect("bin");
        std::fs::write(
            bundle.join("SKILL.md"),
            "---\nname: diagram-kit\ndescription: Rend un diagramme en local.\nicon: cloud\nuser-invocable: true\n---\n\nUtilise le CLI et le binaire du bundle.",
        )
        .expect("skill");
        std::fs::write(bundle.join("scripts/pack.sh"), "#!/bin/bash\necho packed\n")
            .expect("shell");
        std::fs::write(bundle.join("scripts/render.js"), "console.log('ok');\n").expect("node");
        std::fs::write(bundle.join("bin/echo-tool"), "#!/bin/sh\necho \"$@\"\n")
            .expect("bundled binary");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                bundle.join("bin/echo-tool"),
                std::fs::Permissions::from_mode(0o755),
            )
            .expect("chmod");
        }
        std::fs::write(
            bundle.join(".bob-work-plugin.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "name": "Diagram kit",
                "slug": "diagram-kit",
                "version": "1.0.0",
                "description": "Convertit un diagramme avec un CLI et un binaire local.",
                "category": "executable",
                "icon": "cloud",
                "permissions": [{"type":"command.execute"}, {"type":"hook.execute"}],
                "runtime": {"cli": true},
                "entrypoints": [
                    {"name":"pack", "runtime":"bash", "path":"scripts/pack.sh"},
                    {"name":"render", "runtime":"node", "path":"scripts/render.js"},
                    {"name":"echo", "runtime":"binary", "path":"bin/echo-tool"}
                ],
                "hooks": [
                    {"id":"before-pack", "displayName":"Pack", "event":"before_task", "entrypoint":"pack", "required": false}
                ],
                "resources": [
                    {"kind":"shell", "label":"pack.sh", "optional": false},
                    {"kind":"node-cli", "label":"render.js", "optional": false},
                    {"kind":"bundled-bin", "label":"echo-tool", "optional": false}
                ]
            })
            .to_string(),
        )
        .expect("manifest");

        let imported = PluginService::new()
            .sync_agentic_bundles_from(&db, &root)
            .expect("import");
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].id, "agentic-diagram-kit");
        let runtimes: Vec<_> = imported[0]
            .manifest
            .get("entrypoints")
            .and_then(|value| value.as_array())
            .unwrap()
            .iter()
            .map(|entry| {
                entry
                    .get("runtime")
                    .and_then(|value| value.as_str())
                    .unwrap()
            })
            .collect();
        assert_eq!(runtimes, vec!["bash", "node", "binary"]);

        let output = std::process::Command::new(bundle.join("bin/echo-tool"))
            .arg("handyman")
            .output()
            .expect("run bundled binary");
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "handyman");

        let bob_root = std::env::temp_dir().join(format!("bob-work-bob-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&bob_root).expect("bob root");
        let bob = crate::services::bob::BobService::new(&bob_root);
        let statuses = crate::services::plugin_extensions::PluginExtensionService::new()
            .resource_status(&imported[0].id, &imported[0].manifest, &db, &bob)
            .expect("resource status");
        assert!(statuses
            .iter()
            .any(|item| item.kind == "shell" && item.state == "ready"));
        assert!(statuses
            .iter()
            .any(|item| item.kind == "node-cli" && item.state == "ready"));
        assert!(statuses
            .iter()
            .any(|item| item.kind == "bundled-bin" && item.state == "ready"));

        let mut hook_manifest = imported[0].manifest.clone();
        hook_manifest["bundlePath"] = serde_json::Value::String(
            imported[0]
                .manifest
                .get("bundlePath")
                .and_then(|value| value.as_str())
                .unwrap_or(bundle.to_str().unwrap())
                .to_string(),
        );
        let hooks = crate::services::plugin_extensions::PluginExtensionService::new()
            .prepare_hooks(&hook_manifest)
            .expect("prepare hooks");
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0].runtime, "bash");

        std::fs::remove_dir_all(&root).expect("cleanup");
        let _ = std::fs::remove_dir_all(&bob_root);
    }

    #[test]
    fn rejects_an_unsupported_entrypoint_runtime() {
        let db = test_database();
        let root = std::env::temp_dir().join(format!("bob-work-plugin-test-{}", Uuid::new_v4()));
        let bundle = root.join("unsafe-runtime");
        std::fs::create_dir_all(bundle.join("scripts")).expect("scripts");
        std::fs::write(
            bundle.join("SKILL.md"),
            "---\nname: unsafe-runtime\ndescription: test\n---\n\nNope.",
        )
        .expect("skill");
        std::fs::write(bundle.join("scripts/run.rb"), "puts 'nope'\n").expect("script");
        std::fs::write(
            bundle.join(".bob-work-plugin.json"),
            serde_json::json!({
                "name": "Unsafe runtime", "slug": "unsafe-runtime", "version": "1.0.0",
                "description": "Must be rejected", "category": "executable",
                "entrypoints": [{"runtime":"ruby", "path":"scripts/run.rb"}]
            })
            .to_string(),
        )
        .expect("manifest");

        let imported = PluginService::new()
            .sync_agentic_bundles_from(&db, &root)
            .expect("scan continues past invalid bundle");
        assert!(imported.is_empty());
        std::fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn rejects_an_agentic_entrypoint_outside_its_bundle() {
        let db = test_database();
        let root = std::env::temp_dir().join(format!("bob-work-plugin-test-{}", Uuid::new_v4()));
        let bundle = root.join("unsafe-plugin");
        std::fs::create_dir_all(&bundle).expect("bundle directory");
        std::fs::write(
            bundle.join("SKILL.md"),
            "---\nname: unsafe-plugin\n---\nUnsafe",
        )
        .expect("skill");
        std::fs::write(
            bundle.join(".bob-work-plugin.json"),
            serde_json::json!({
                "name": "Unsafe plugin", "slug": "unsafe-plugin", "version": "1.0.0",
                "description": "Must be rejected", "category": "executable",
                "entrypoints": [{"runtime":"python3", "path":"../outside.py"}]
            })
            .to_string(),
        )
        .expect("manifest");

        let imported = PluginService::new()
            .sync_agentic_bundles_from(&db, &root)
            .expect("scan continues past invalid bundle");
        assert!(imported.is_empty());
        assert!(PluginService::new()
            .get_by_id(&db, "agentic-unsafe-plugin")
            .expect("lookup")
            .is_none());

        std::fs::remove_dir_all(&root).expect("cleanup test bundle");
    }
}
