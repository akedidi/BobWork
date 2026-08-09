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
    /// Bob Shell skills. A newer built-in is staged like any other plugin
    /// version instead of silently replacing the version selected by the user.
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
                }
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
            } else if packaged_version == current_version
                && Self::normalized_manifest(&existing.manifest)
                    != Self::normalized_manifest(&builtin.manifest)
            {
                warn!(
                    "Built-in plugin {} changed without a version bump; keeping immutable version {}",
                    builtin.id, builtin.version
                );
            }
            if existing.install_state == "installed" {
                PluginDeployService::new().deploy(builtin.id, &existing.manifest)?;
            }
            if !self.version_exists(db, builtin.id, &existing.version)? {
                self.persist_version(db, &existing, None, true)?;
            }
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

        Ok(plugins)
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
            PluginDeployService::new().deploy(plugin_id, &manifest)?;
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
        let validation = self.validate(&input.manifest);
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
                input.manifest.to_string(),
                if validation.warnings.is_empty() {
                    "valid"
                } else {
                    "warning"
                },
                now,
                now,
            ],
        )?;

        if let Err(error) = PluginDeployService::new().deploy(&id, &input.manifest) {
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
            manifest: input.manifest,
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
        let validation = self.validate(&input.manifest);
        if !validation.valid {
            return Err(AppError::Plugin(validation.errors.join("; ")));
        }
        let now = Utc::now().to_rfc3339();
        let scope = input
            .scope
            .clone()
            .unwrap_or_else(|| "personal".to_string());
        PluginDeployService::new().deploy(plugin_id, &input.manifest)?;
        {
            let conn = db.conn.lock().unwrap();
            let changed = conn.execute(
                "UPDATE plugins SET name=?1, version=?2, author=?3, description=?4,
                 scope=?5, category=?6, manifest=?7, validation_state=?8, updated_at=?9 WHERE id=?10",
                params![
                    input.name, input.version, input.author, input.description, scope, input.category,
                    input.manifest.to_string(),
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
        if plugin
            .manifest
            .get("builtin")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
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

fn builtin_document_plugins() -> Vec<BuiltinPlugin> {
    vec![
        BuiltinPlugin {
            id: "builtin-documents",
            name: "Documents",
            version: "1.0.0",
            description: "Créer, lire, transformer et contrôler des documents locaux avec aperçu dans Bob Work.",
            category: "recipe",
            manifest: serde_json::json!({
                "name": "Documents", "slug": "bob-work-documents", "version": "1.0.0",
                "description": "Create, read, transform and review local documents.", "category": "recipe",
                "builtin": true, "icon": "document", "capabilities": ["document.read", "document.create", "document.convert", "preview"],
                "permissions": [{"type":"file.read"},{"type":"file.write"}],
                "instructions": "Use this skill for local text, Markdown, PDF, RTF and general document work. Inspect the source before changing it. Preserve headings, links, citations and tables unless asked otherwise. Create outputs in the project folder with an explicit extension. Never overwrite an input without confirmation; prefer a new version. After writing, verify that the file exists and report its absolute path so Bob Work can open it in the right preview panel."
            }),
        },
        BuiltinPlugin {
            id: "builtin-word",
            name: "Microsoft Word",
            version: "1.0.0",
            description: "Créer et modifier des fichiers Word DOCX en conservant autant que possible styles et structure.",
            category: "recipe",
            manifest: serde_json::json!({
                "name": "Microsoft Word", "slug": "bob-work-microsoft-word", "version": "1.0.0",
                "description": "Create and edit Microsoft Word DOCX files.", "category": "recipe",
                "builtin": true, "icon": "word", "outputFormats": ["docx"], "capabilities": ["docx.read", "docx.create", "docx.edit", "preview"],
                "permissions": [{"type":"file.read"},{"type":"file.write"}],
                "instructions": "Use this skill for Microsoft Word .docx files. When editing, work on a copy unless overwrite was explicitly approved. Preserve section order, headings, lists, tables, hyperlinks, headers, footers and existing styles. Prefer a proven DOCX library available in the workspace; do not create a fake file with a .docx extension. Re-open or inspect the generated package after writing, then return its absolute path for Bob Work Quick Look preview."
            }),
        },
        BuiltinPlugin {
            id: "builtin-powerpoint",
            name: "Microsoft PowerPoint",
            version: "1.0.0",
            description: "Créer, modifier et vérifier des présentations PowerPoint PPTX avec respect du modèle fourni.",
            category: "recipe",
            manifest: serde_json::json!({
                "name": "Microsoft PowerPoint", "slug": "bob-work-microsoft-powerpoint", "version": "1.0.0",
                "description": "Create, edit and review Microsoft PowerPoint presentations.", "category": "recipe",
                "builtin": true, "icon": "powerpoint", "outputFormats": ["pptx"], "capabilities": ["pptx.read", "pptx.create", "pptx.edit", "preview"],
                "permissions": [{"type":"file.read"},{"type":"file.write"}],
                "instructions": "Use this skill for Microsoft PowerPoint .pptx deliverables. If a template exists, reuse its masters, layouts, fonts, colors and slide dimensions. Keep one clear message per slide, avoid text overflow, add source notes when appropriate and preserve editable shapes. Validate slide count, titles and package integrity after writing. Return the absolute PPTX path so Bob Work can show a Quick Look preview in the right panel."
            }),
        },
        BuiltinPlugin {
            id: "builtin-excel",
            name: "Microsoft Excel",
            version: "1.0.0",
            description: "Créer, analyser et modifier des classeurs Excel XLSX en préservant formules et formats.",
            category: "recipe",
            manifest: serde_json::json!({
                "name": "Microsoft Excel", "slug": "bob-work-microsoft-excel", "version": "1.0.0",
                "description": "Create, analyze and edit Microsoft Excel workbooks.", "category": "recipe",
                "builtin": true, "icon": "excel", "outputFormats": ["xlsx", "csv"], "capabilities": ["xlsx.read", "xlsx.create", "xlsx.edit", "formula.verify", "preview"],
                "permissions": [{"type":"file.read"},{"type":"file.write"}],
                "instructions": "Use this skill for Excel .xlsx, .xls and .csv work. Preserve formulas, number formats, merged cells, named ranges, data validation, charts and sheet order unless a change is requested. Never replace formulas with displayed values. For a new workbook, use explicit headers, appropriate types and readable widths. Re-open the workbook after saving and check formula references and sheet names. Return its absolute path for Bob Work preview."
            }),
        },
        BuiltinPlugin {
            id: "builtin-onenote",
            name: "Microsoft OneNote",
            version: "1.0.0",
            description: "Préparer et organiser des pages OneNote via un connecteur Microsoft Graph ou MCP configuré.",
            category: "integration",
            manifest: serde_json::json!({
                "name": "Microsoft OneNote", "slug": "bob-work-microsoft-onenote", "version": "1.0.0",
                "description": "Read and organize Microsoft OneNote through an authorized connector.", "category": "integration",
                "builtin": true, "icon": "onenote", "requiresIntegration": "microsoft-graph", "capabilities": ["onenote.read", "onenote.prepare", "onenote.write"],
                "permissions": [{"type":"network.request"}],
                "instructions": "Use this skill only when a Microsoft Graph or compatible MCP connector is configured and authorized. Resolve notebook, section and page identities before acting. Reading may follow the connector scope. Ask for explicit approval before creating, moving, renaming or deleting a page or section. If no connector exists, prepare a local Markdown or DOCX draft and explain that OneNote publishing remains pending; never simulate a successful upload."
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
    fn document_plugin_catalog_is_complete_and_native() {
        let plugins = builtin_document_plugins();
        assert_eq!(plugins.len(), 5);
        let names = plugins.iter().map(|plugin| plugin.name).collect::<Vec<_>>();
        assert!(names.contains(&"Documents"));
        assert!(names.contains(&"Microsoft Word"));
        assert!(names.contains(&"Microsoft PowerPoint"));
        assert!(names.contains(&"Microsoft Excel"));
        assert!(names.contains(&"Microsoft OneNote"));
        assert!(plugins
            .iter()
            .all(|plugin| plugin.manifest.get("builtin") == Some(&serde_json::Value::Bool(true))));
        assert!(plugins
            .iter()
            .all(|plugin| plugin.manifest.get("slug").is_some()));
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
