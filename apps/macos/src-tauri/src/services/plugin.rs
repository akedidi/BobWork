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
use std::path::{Component, Path, PathBuf};
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
                    warn!(
                        "Built-in plugin {} changed without a version bump; keeping immutable version {}",
                        builtin.id, builtin.version
                    );
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
        self.ensure_packaged_work_plugins(db)?;
        if let Err(error) = self.prune_shadow_agentic_plugins(db) {
            warn!("Unable to prune shadow agentic plugins: {}", error);
        }
        Ok(())
    }

    /// Work-level packaged plugins that ship with Bob Work but are not protected builtins
    /// (editable, deletable, restorable). Distinct from `builtin-*` Office / Computer Use.
    fn ensure_packaged_work_plugins(&self, db: &Database) -> AppResult<()> {
        self.demote_legacy_cto_builtin(db)?;
        for packaged in packaged_work_plugins() {
            if self.is_packaged_work_dismissed(db, packaged.id)? {
                continue;
            }
            let now = Utc::now().to_rfc3339();
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
                    object.insert("builtin".into(), serde_json::Value::Bool(false));
                }
                if Self::normalized_manifest(&existing.manifest)
                    != Self::normalized_manifest(&manifest)
                    || existing.manifest.get("builtin") == Some(&serde_json::Value::Bool(true))
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
        let canonical_slugs: BTreeSet<String> = plugins
            .iter()
            .filter(|plugin| !plugin.id.starts_with("agentic-"))
            .filter_map(|plugin| {
                plugin
                    .manifest
                    .get("slug")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .collect();
        let mut removed = 0usize;
        for plugin in plugins {
            if !plugin.id.starts_with("agentic-") {
                continue;
            }
            let Some(slug) = plugin.manifest.get("slug").and_then(|value| value.as_str()) else {
                continue;
            };
            if !canonical_slugs.contains(slug) {
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
            info!("Pruned shadow agentic plugin {} (slug {})", plugin.id, slug);
            removed += 1;
        }
        Ok(removed)
    }

    fn slug_owned_by_canonical_plugin(&self, db: &Database, slug: &str) -> AppResult<bool> {
        Ok(self.get_all(db)?.iter().any(|plugin| {
            !plugin.id.starts_with("agentic-")
                && plugin.manifest.get("slug").and_then(|value| value.as_str()) == Some(slug)
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
                Ok(Some(plugin)) => imported.push(plugin),
                Ok(None) => {}
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
                if !matches!(runtime, "python3" | "bash" | "sh") {
                    return Err(AppError::Plugin(format!(
                        "Unsupported plugin runtime: {}",
                        runtime
                    )));
                }
                let relative_path = Path::new(relative);
                if relative_path.is_absolute()
                    || relative_path
                        .components()
                        .any(|component| !matches!(component, Component::Normal(_)))
                {
                    return Err(AppError::Plugin(
                        "Plugin entrypoints must use safe relative paths".into(),
                    ));
                }
                let entrypoint_path = bundle_dir.join(relative_path);
                let entrypoint_metadata = std::fs::symlink_metadata(&entrypoint_path)?;
                if !entrypoint_metadata.is_file()
                    || entrypoint_metadata.file_type().is_symlink()
                    || entrypoint_metadata.len() > 2 * 1024 * 1024
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
        if manifest
            .get("agentic")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            let snapshot = manifest
                .get("bundlePath")
                .and_then(|value| value.as_str())
                .map(PathBuf::from)
                .ok_or_else(|| AppError::Plugin("Plugin version bundle missing".into()))?;
            let canonical = manifest
                .get("sourceBundlePath")
                .and_then(|value| value.as_str())
                .map(PathBuf::from)
                .ok_or_else(|| AppError::Plugin("Plugin source bundle missing".into()))?;
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
    let has_icon = manifest
        .get("icon")
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.trim().is_empty());
    if has_icon {
        return;
    }
    let slug = manifest
        .get("slug")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let icon = infer_plugin_icon(slug, name, description.unwrap_or(""));
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
            "builtin": false,
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

fn builtin_document_plugins() -> Vec<BuiltinPlugin> {
    vec![
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
            version: "1.0.2",
            description: "Pilote Google Chrome : ouvrir des onglets, naviguer et exécuter du JavaScript dans la page.",
            category: "executable",
            manifest: serde_json::json!({
                "name": "Contrôle Chrome",
                "slug": "bob-work-chrome-control",
                "version": "1.0.2",
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
                        "browser_snapshot", "use_mcp_tool"
                    ],
                    "preferredLibraries": [],
                    "workflow": "1) Vérifier que Chrome est installé et Automatisation accordée. 2) chrome_open_url ou chrome_list_tabs. 3) chrome_navigate / chrome_execute_js selon besoin. 4) Renvoyer titre+URL confirmés. Ne simule jamais un onglet si l’outil échoue.",
                    "sandbox": "macos-chrome-automation"
                },
                "instructions": "Mode Contrôle Chrome Bob Work. Le serveur MCP `bob-work-chrome-control` doit être actif (Réglages → Accès et contrôle → Contrôle de Chrome). Outils : chrome_open_url, chrome_read_front_tab, chrome_list_tabs, chrome_activate_tab, chrome_navigate, chrome_execute_js, browser_snapshot.\n\nN’utilise jamais osascript/python3 pour contrôler Chrome. Si Automatisation est refusée, explique d’autoriser **Bob Work → Google Chrome** dans Réglages Système → Confidentialité et sécurité → Automatisation (ou Réglages Bob Work → Demander Automatisation). Reste local ; pas d’upload cloud."
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
    fn document_plugin_catalog_is_complete_and_native() {
        let plugins = builtin_document_plugins();
        assert_eq!(plugins.len(), 7);
        let names = plugins.iter().map(|plugin| plugin.name).collect::<Vec<_>>();
        assert!(names.contains(&"Documents"));
        assert!(names.contains(&"Microsoft Word"));
        assert!(names.contains(&"Microsoft PowerPoint"));
        assert!(names.contains(&"Microsoft Excel"));
        assert!(names.contains(&"Microsoft OneNote"));
        assert!(names.contains(&"Computer Use"));
        assert!(names.contains(&"Contrôle Chrome"));
        assert!(!names.contains(&"CTO Investissements"));
        assert!(plugins
            .iter()
            .all(|plugin| plugin.manifest.get("builtin") == Some(&serde_json::Value::Bool(true))));
        assert!(plugins
            .iter()
            .all(|plugin| plugin.manifest.get("slug").is_some()));
        let work = packaged_work_plugins();
        assert_eq!(work.len(), 2);
        assert_eq!(work[0].id, "bob-work-cto-invest");
        assert_eq!(work[1].id, "bob-work-ibm-pursuit");
        assert!(work.iter().all(|plugin| {
            plugin.manifest.get("builtin") == Some(&serde_json::Value::Bool(false))
        }));
    }

    #[test]
    fn infer_plugin_icon_maps_office_and_remote_brands() {
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
