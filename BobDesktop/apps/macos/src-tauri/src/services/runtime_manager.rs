//! Runtime Architecture V2.
//!
//! This module is the only authority allowed to map plugin capabilities to
//! physical runtimes. It deliberately reuses the existing plugin manifests,
//! SQLite database and permission vocabulary.

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::runtime::{
    PythonMode, RuntimeClass, RuntimeDependency, RuntimeHandle, RuntimeInstallationPlan,
    RuntimeManifest, RuntimePackage, RuntimeProcessDiagnostic, RuntimeRecord, RuntimeSource,
    RuntimeStatus, RuntimeStorageReport,
};
use chrono::Utc;
use rusqlite::params;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::process::Command;
use uuid::Uuid;

const SHARED_PYTHON_ID: &str = "shared.python";
const SHARED_VISUALIZATION_ID: &str = "shared.visualization";
const SHARED_DIAGRAM_ID: &str = "shared.diagram";
const SHARED_ARTIFACT_ID: &str = "shared.artifact";
const SHARED_DIAGRAM_VERSION: &str = "2.0.0";
const SHARED_DIAGRAM_BUNDLE: &[u8] =
    include_bytes!("../../resources/shared-runtimes/diagram/diagram-runtime.zip");
const BOB_RUNTIME_OWNER: &str = "bob-work";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExternalInstallStrategy {
    PythonIndex,
}

/// One policy controls the lifecycle of every external runtime. A runtime is
/// automatic only when Bob Work has a supported, catalog-declared installer;
/// detecting an executable on the host never transfers ownership to Bob Work.
fn external_install_strategy(source: Option<&RuntimeSource>) -> Option<ExternalInstallStrategy> {
    match source {
        Some(RuntimeSource { kind, location, .. })
            if kind == "trusted-python-index" && location == "https://pypi.org/simple" =>
        {
            Some(ExternalInstallStrategy::PythonIndex)
        }
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeManager {
    runtime_root: PathBuf,
    cache_root: PathBuf,
    artifact_root: PathBuf,
    core_path: Option<PathBuf>,
    active_processes: Arc<Mutex<HashMap<String, RuntimeProcessDiagnostic>>>,
    process_cancellations: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
}

#[derive(Debug, Clone)]
pub struct ControlledProcessRequest {
    pub plugin_id: String,
    pub runtime_id: String,
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub working_directory: PathBuf,
    pub environment: Vec<(String, String)>,
    pub timeout: Duration,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlledProcessOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
}

impl RuntimeManager {
    pub fn new(app_data_dir: &Path) -> Self {
        let bob_root = dirs::home_dir()
            .unwrap_or_else(|| app_data_dir.to_path_buf())
            .join(".bob");
        Self {
            runtime_root: bob_root.join("runtimes"),
            cache_root: app_data_dir.join("runtime-cache"),
            artifact_root: app_data_dir.join("artifacts"),
            core_path: bob_work_core_path(),
            active_processes: Arc::new(Mutex::new(HashMap::new())),
            process_cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[cfg(test)]
    pub fn with_roots(runtime_root: PathBuf, cache_root: PathBuf, artifact_root: PathBuf) -> Self {
        Self {
            runtime_root,
            cache_root,
            artifact_root,
            core_path: None,
            active_processes: Arc::new(Mutex::new(HashMap::new())),
            process_cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn runtime_root(&self) -> &Path {
        &self.runtime_root
    }

    pub fn platform_id() -> String {
        let os = match std::env::consts::OS {
            "macos" => "darwin",
            value => value,
        };
        let arch = match std::env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            value => value,
        };
        format!("{os}-{arch}")
    }

    pub fn architecture() -> String {
        match std::env::consts::ARCH {
            "aarch64" => "arm64".into(),
            "x86_64" => "x64".into(),
            value => value.into(),
        }
    }

    pub fn seed_registry(&self, db: &Database) -> AppResult<()> {
        std::fs::create_dir_all(&self.runtime_root)?;
        std::fs::create_dir_all(&self.cache_root)?;
        self.recover_incomplete_operations(db)?;

        let python = resolve_host_python();
        let shared_python_packages = python
            .as_deref()
            .map(detect_shared_python_packages)
            .transpose()?
            .unwrap_or_default();
        let shared = [
            RuntimeManifest {
                id: SHARED_PYTHON_ID.into(),
                name: "Bob Work Shared Python".into(),
                version: python
                    .as_ref()
                    .and_then(|path| python_version(path).ok())
                    .unwrap_or_else(|| "unavailable".into()),
                purpose: "Generic local Python execution shared by compatible plugins".into(),
                runtime_type: RuntimeClass::Shared,
                capabilities: vec![
                    "python".into(),
                    "dataframe".into(),
                    "spreadsheet".into(),
                    "statistics".into(),
                ],
                platforms: vec![Self::platform_id()],
                dependencies: Vec::new(),
                python_mode: Some(PythonMode::Shared),
                python_compatibility: Some(">=3.9".into()),
                packages: shared_python_packages,
                source: None,
                estimated_size_bytes: None,
                removable: false,
            },
            visualization_runtime_manifest(),
            diagram_runtime_manifest(),
            logical_shared_manifest(
                SHARED_ARTIFACT_ID,
                "Bob Work Artifact Runtime",
                &["artifact"],
            ),
        ];

        for manifest in shared {
            let (status, install_path) = if manifest.id == SHARED_PYTHON_ID {
                (
                    if python.is_some() {
                        RuntimeStatus::Installed
                    } else {
                        RuntimeStatus::Broken
                    },
                    python
                        .as_ref()
                        .map(|path| path.to_string_lossy().into_owned()),
                )
            } else if manifest.id == SHARED_ARTIFACT_ID || manifest.id == SHARED_VISUALIZATION_ID {
                (
                    RuntimeStatus::Installed,
                    if manifest.id == SHARED_ARTIFACT_ID {
                        Some(self.artifact_root.to_string_lossy().into_owned())
                    } else {
                        None
                    },
                )
            } else {
                (RuntimeStatus::NotInstalled, None)
            };
            self.upsert_manifest(db, &manifest, status, install_path.as_deref(), None)?;
        }

        self.upsert_manifest(
            db,
            &qiskit_runtime_manifest(),
            RuntimeStatus::NotInstalled,
            None,
            None,
        )?;
        self.upsert_manifest(
            db,
            &codegraph_runtime_manifest(),
            RuntimeStatus::NotInstalled,
            None,
            None,
        )?;
        self.migrate_external_ownership_markers(db)?;
        Ok(())
    }

    fn migrate_external_ownership_markers(&self, db: &Database) -> AppResult<()> {
        for runtime in self.list(db)?.into_iter().filter(|runtime| {
            runtime.runtime_type == RuntimeClass::ExternalManaged
                && runtime.management == "automatic"
                && runtime.status == RuntimeStatus::Installed
        }) {
            let Some(path) = runtime.install_path.as_deref().map(PathBuf::from) else {
                continue;
            };
            let Some(version) = runtime.installed_version.as_deref() else {
                continue;
            };
            let expected = self
                .runtime_root
                .join("external")
                .join(runtime.runtime_id.trim_start_matches("external."))
                .join(safe_version_segment(version));
            let (Ok(path), Ok(expected)) = (path.canonicalize(), expected.canonicalize()) else {
                continue;
            };
            if path != expected {
                continue;
            }
            let marker_path = expected.join("runtime.json");
            let Ok(bytes) = std::fs::read(&marker_path) else {
                continue;
            };
            let Ok(mut marker) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            if marker.get("runtimeId").and_then(Value::as_str) != Some(runtime.runtime_id.as_str())
                || marker.get("version").and_then(Value::as_str) != Some(version)
            {
                continue;
            }
            if marker.get("managedBy").and_then(Value::as_str) == Some(BOB_RUNTIME_OWNER) {
                continue;
            }
            let Some(object) = marker.as_object_mut() else {
                continue;
            };
            object.insert("managedBy".into(), Value::String(BOB_RUNTIME_OWNER.into()));
            let candidate = expected.join(format!(".runtime-marker-{}", Uuid::new_v4()));
            std::fs::write(&candidate, serde_json::to_vec_pretty(&marker)?)?;
            std::fs::rename(candidate, marker_path)?;
        }
        Ok(())
    }

    pub fn upsert_manifest(
        &self,
        db: &Database,
        manifest: &RuntimeManifest,
        requested_status: RuntimeStatus,
        install_path: Option<&str>,
        error: Option<&str>,
    ) -> AppResult<()> {
        validate_runtime_manifest(manifest)?;
        let platform = Self::platform_id();
        if !manifest.platforms.is_empty()
            && !manifest.platforms.iter().any(|item| item == &platform)
        {
            return Err(AppError::ValidationFailed(format!(
                "Runtime {} does not support {platform}",
                manifest.id
            )));
        }
        let now = Utc::now().to_rfc3339();
        let manifest_json = serde_json::to_string(manifest)?;
        let dependencies = serde_json::to_string(&manifest.dependencies)?;
        let capabilities = serde_json::to_string(&manifest.capabilities)?;
        let source = manifest
            .source
            .as_ref()
            .map(|value| serde_json::to_string(value))
            .transpose()?;
        let integrity = manifest
            .source
            .as_ref()
            .and_then(|source| source.sha256.clone());
        let python_mode = manifest.python_mode.unwrap_or(PythonMode::None);
        let size_bytes = install_path
            .map(Path::new)
            .map(directory_size)
            .transpose()?
            .unwrap_or_else(|| manifest.estimated_size_bytes.unwrap_or(0));
        let conn = db.connection();
        conn.execute(
            "INSERT INTO runtime_registry (
                runtime_id,runtime_type,name,version,manifest,source,install_path,platform,
                architecture,size_bytes,status,installed_at,updated_at,last_used_at,integrity,
                dependencies,python_mode,capabilities,removable,error,installed_version
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,
                CASE WHEN ?11='installed' THEN ?12 ELSE NULL END,?12,NULL,?13,?14,?15,?16,?17,?18,
                CASE WHEN ?11='installed' THEN ?4 ELSE NULL END)
             ON CONFLICT(runtime_id) DO UPDATE SET
                runtime_type=excluded.runtime_type,name=excluded.name,version=excluded.version,
                manifest=excluded.manifest,source=excluded.source,
                install_path=COALESCE(runtime_registry.install_path,excluded.install_path),
                platform=excluded.platform,architecture=excluded.architecture,
                size_bytes=CASE
                    WHEN runtime_registry.status='installed' AND runtime_registry.install_path IS NOT NULL
                    THEN runtime_registry.size_bytes ELSE excluded.size_bytes END,
                status=CASE
                    WHEN runtime_registry.status='installed' AND excluded.status='not_installed'
                    THEN runtime_registry.status ELSE excluded.status END,
                installed_at=COALESCE(runtime_registry.installed_at,excluded.installed_at),
                updated_at=excluded.updated_at,integrity=excluded.integrity,
                dependencies=excluded.dependencies,python_mode=excluded.python_mode,
                capabilities=excluded.capabilities,removable=excluded.removable,error=excluded.error,
                installed_version=CASE
                    WHEN excluded.runtime_type='shared' AND excluded.status='installed'
                    THEN excluded.version
                    ELSE COALESCE(runtime_registry.installed_version,excluded.installed_version)
                END",
            params![
                manifest.id,
                manifest.runtime_type.as_str(),
                manifest.name,
                manifest.version,
                manifest_json,
                source,
                install_path,
                platform,
                Self::architecture(),
                size_bytes as i64,
                requested_status.as_str(),
                now,
                integrity,
                dependencies,
                python_mode.as_str(),
                capabilities,
                manifest.removable as i64,
                error,
            ],
        )?;
        Ok(())
    }

    pub fn list(&self, db: &Database) -> AppResult<Vec<RuntimeRecord>> {
        let conn = db.connection();
        let mut statement = conn.prepare(
            "SELECT runtime_id,runtime_type,name,version,installed_version,source,install_path,platform,architecture,
                    size_bytes,status,installed_at,updated_at,last_used_at,integrity,dependencies,
                    python_mode,capabilities,removable,error
             FROM runtime_registry ORDER BY runtime_type,name",
        )?;
        let rows = statement.query_map([], |row| {
            let runtime_id: String = row.get(0)?;
            Ok(RuntimeRecord {
                management: {
                    let class = parse_runtime_class(&row.get::<_, String>(1)?);
                    let source: Option<String> = row.get(5)?;
                    let source = source
                        .as_deref()
                        .and_then(|value| serde_json::from_str::<RuntimeSource>(value).ok());
                    let automatic = external_install_strategy(source.as_ref()).is_some();
                    match class {
                        RuntimeClass::Shared => "shared",
                        RuntimeClass::PluginPrivate => "plugin",
                        RuntimeClass::ExternalManaged if automatic => "automatic",
                        RuntimeClass::ExternalManaged => "manual",
                    }
                    .into()
                },
                runtime_id,
                runtime_type: parse_runtime_class(&row.get::<_, String>(1)?),
                name: row.get(2)?,
                version: row.get(3)?,
                installed_version: row.get(4)?,
                source: row.get(5)?,
                install_path: row.get(6)?,
                platform: row.get(7)?,
                architecture: row.get(8)?,
                size_bytes: row.get::<_, i64>(9)?.max(0) as u64,
                status: parse_runtime_status(&row.get::<_, String>(10)?),
                installed_at: row.get(11)?,
                updated_at: row.get(12)?,
                last_used_at: row.get(13)?,
                integrity: row.get(14)?,
                dependencies: json_or_default(&row.get::<_, String>(15)?),
                python_mode: parse_python_mode(&row.get::<_, String>(16)?),
                capabilities: json_or_default(&row.get::<_, String>(17)?),
                consumers: Vec::new(),
                removable: row.get::<_, i64>(18)? != 0,
                error: row.get(19)?,
            })
        })?;
        let mut runtimes = rows.collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for runtime in &mut runtimes {
            runtime.consumers = runtime_consumers(&conn, &runtime.runtime_id)?;
        }
        Ok(runtimes)
    }

    pub fn get(&self, db: &Database, runtime_id: &str) -> AppResult<Option<RuntimeRecord>> {
        Ok(self
            .list(db)?
            .into_iter()
            .find(|runtime| runtime.runtime_id == runtime_id))
    }

    pub fn installation_plan(
        &self,
        db: &Database,
        runtime_id: &str,
    ) -> AppResult<RuntimeInstallationPlan> {
        let record = self
            .get(db, runtime_id)?
            .ok_or_else(|| AppError::NotFound(format!("Runtime {runtime_id}")))?;
        if record.runtime_type != RuntimeClass::ExternalManaged {
            return Err(AppError::ValidationFailed(
                "Only External Managed Runtimes have an installation plan".into(),
            ));
        }
        let manifest = self.manifest(db, runtime_id)?;
        let source = manifest
            .source
            .as_ref()
            .ok_or_else(|| AppError::Security("Managed runtime source is missing".into()))?;
        let already_installed = record.status == RuntimeStatus::Installed
            && record.installed_version.as_deref() == Some(manifest.version.as_str());
        Ok(RuntimeInstallationPlan {
            runtime_id: runtime_id.into(),
            name: manifest.name,
            version: manifest.version,
            purpose: manifest.purpose,
            source: source.location.clone(),
            estimated_size_bytes: manifest.estimated_size_bytes,
            python_mode: manifest.python_mode.unwrap_or(PythonMode::None),
            packages: manifest.packages,
            already_installed,
        })
    }

    /// Install a catalog-declared External Managed Runtime transactionally.
    /// Top-level package versions and the package index are controlled by the
    /// Runtime Manager; callers cannot provide URLs, package names or paths.
    pub async fn install_external_runtime(
        &self,
        db: &Database,
        runtime_id: &str,
        accepted: bool,
    ) -> AppResult<RuntimeRecord> {
        if !accepted {
            return Err(AppError::PermissionDenied(
                "External runtime installation requires explicit user acceptance".into(),
            ));
        }
        let manifest = self.manifest(db, runtime_id)?;
        let current = self
            .get(db, runtime_id)?
            .ok_or_else(|| AppError::NotFound(format!("Runtime {runtime_id}")))?;
        if current.runtime_type != RuntimeClass::ExternalManaged {
            return Err(AppError::ValidationFailed(
                "Requested runtime is not externally managed".into(),
            ));
        }
        let strategy = external_install_strategy(manifest.source.as_ref()).ok_or_else(|| {
            AppError::ValidationFailed(format!(
                "{} requires its official installer and is not installable automatically by Bob Work",
                manifest.name
            ))
        })?;
        match strategy {
            ExternalInstallStrategy::PythonIndex => validate_managed_python_source(&manifest)?,
        }
        if current.status == RuntimeStatus::Installed
            && current.installed_version.as_deref() == Some(manifest.version.as_str())
        {
            return Ok(current);
        }

        let shared_python = self.shared_python(db)?;
        let shared_compatible =
            python_satisfies(&shared_python, manifest.python_compatibility.as_deref())?;
        let python_mode = if shared_compatible {
            PythonMode::Shared
        } else {
            PythonMode::Isolated
        };
        let runtime_parent = self
            .runtime_root
            .join("external")
            .join(runtime_id.trim_start_matches("external."));
        std::fs::create_dir_all(&runtime_parent)?;
        let candidate = runtime_parent.join(format!(".candidate-{}", Uuid::new_v4()));
        let final_path = runtime_parent.join(safe_version_segment(&manifest.version));
        let obsolete_install = current
            .install_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path != &final_path && path.starts_with(&runtime_parent));
        std::fs::create_dir_all(&candidate)?;
        let operation_id = self.start_operation(
            db,
            runtime_id,
            if current.install_path.is_some() {
                "update"
            } else {
                "install"
            },
            Some(&candidate),
            current.install_path.as_deref().map(Path::new),
        )?;
        self.set_status(
            db,
            runtime_id,
            if current.install_path.is_some() {
                RuntimeStatus::Updating
            } else {
                RuntimeStatus::Installing
            },
            None,
        )?;

        let result = match strategy {
            ExternalInstallStrategy::PythonIndex => {
                self.install_python_packages(&manifest, &shared_python, python_mode, &candidate)
                    .await
            }
        };
        if let Err(error) = result {
            let _ = std::fs::remove_dir_all(&candidate);
            let message = error.to_string();
            self.set_status(
                db,
                runtime_id,
                if current.install_path.is_some() {
                    RuntimeStatus::Installed
                } else {
                    RuntimeStatus::Broken
                },
                Some(&message),
            )?;
            self.finish_operation(db, &operation_id, "failed", Some(&message))?;
            return Err(error);
        }

        let previous = if final_path.exists() {
            let backup = runtime_parent.join(format!(".previous-{}", Uuid::new_v4()));
            std::fs::rename(&final_path, &backup)?;
            db.connection().execute(
                "UPDATE runtime_operations SET previous_path=?1 WHERE id=?2",
                params![backup.to_string_lossy(), operation_id],
            )?;
            Some(backup)
        } else {
            None
        };
        if let Err(error) = std::fs::rename(&candidate, &final_path) {
            if let Some(previous) = previous.as_ref() {
                let _ = std::fs::rename(previous, &final_path);
            }
            self.set_status(
                db,
                runtime_id,
                if current.install_path.is_some() {
                    RuntimeStatus::Installed
                } else {
                    RuntimeStatus::Broken
                },
                Some(&error.to_string()),
            )?;
            self.finish_operation(db, &operation_id, "failed", Some(&error.to_string()))?;
            return Err(error.into());
        }

        let activated_python = if python_mode == PythonMode::Shared {
            shared_python.clone()
        } else {
            isolated_python(&final_path.join("venv"))
        };
        let activated_package_root = if python_mode == PythonMode::Shared {
            final_path.join("python")
        } else {
            final_path.join("venv")
        };
        let activation = (|| -> AppResult<()> {
            std::fs::write(
                final_path.join("runtime.json"),
                serde_json::to_vec_pretty(&serde_json::json!({
                    "runtimeId": manifest.id,
                    "version": manifest.version,
                    "managedBy": BOB_RUNTIME_OWNER,
                    "source": manifest.source,
                    "pythonMode": python_mode,
                    "python": activated_python,
                    "packageRoot": activated_package_root,
                    "packages": manifest.packages,
                    "installedAt": Utc::now().to_rfc3339(),
                    "platform": Self::platform_id()
                }))?,
            )?;

            let size = directory_size(&final_path)?;
            let now = Utc::now().to_rfc3339();
            db.connection().execute(
                "UPDATE runtime_registry SET status='installed',install_path=?1,size_bytes=?2,
                        installed_at=COALESCE(installed_at,?3),updated_at=?3,error=NULL,python_mode=?4,
                        installed_version=?5
                 WHERE runtime_id=?6",
                params![
                    final_path.to_string_lossy(),
                    size as i64,
                    now,
                    python_mode.as_str(),
                    manifest.version,
                    runtime_id
                ],
            )?;
            Ok(())
        })();
        if let Err(error) = activation {
            let _ = std::fs::remove_dir_all(&final_path);
            if let Some(previous) = previous.as_ref() {
                let _ = std::fs::rename(previous, &final_path);
            }
            let message = error.to_string();
            self.set_status(
                db,
                runtime_id,
                if current.install_path.is_some() {
                    RuntimeStatus::Installed
                } else {
                    RuntimeStatus::Broken
                },
                Some(&message),
            )?;
            self.finish_operation(db, &operation_id, "failed", Some(&message))?;
            return Err(error);
        }
        if let Some(previous) = previous {
            let _ = std::fs::remove_dir_all(previous);
        }
        if let Some(obsolete) = obsolete_install {
            let _ = std::fs::remove_dir_all(obsolete);
        }
        self.finish_operation(db, &operation_id, "completed", None)?;
        self.get(db, runtime_id)?
            .ok_or_else(|| AppError::NotFound(format!("Runtime {runtime_id}")))
    }

    pub fn register_plugin_requirements(
        &self,
        db: &Database,
        plugin_id: &str,
        manifest: &Value,
    ) -> AppResult<()> {
        let validation_errors = validate_plugin_runtime_requirements(manifest);
        if !validation_errors.is_empty() {
            return Err(AppError::ValidationFailed(validation_errors.join("; ")));
        }
        if !valid_runtime_identifier(plugin_id) {
            return Err(AppError::ValidationFailed("Invalid plugin id".into()));
        }
        let mut requirements: HashMap<String, Value> = HashMap::new();
        for capability in shared_capabilities(manifest) {
            if let Some(runtime_id) = shared_runtime_for_capability(&capability) {
                requirements.insert(
                    runtime_id.into(),
                    serde_json::json!({"kind":"sharedCapability","capability":capability}),
                );
            }
        }
        for requirement in external_runtime_requirements(manifest) {
            if let Some(id) = requirement.get("id").and_then(Value::as_str) {
                requirements.insert(id.into(), requirement);
            }
        }
        let bundle_root = plugin_bundle_root(manifest);
        let mut private_manifests = Vec::new();
        for dependency in private_dependencies(manifest) {
            let dependency_id = dependency
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    AppError::ValidationFailed("Private dependency id missing".into())
                })?;
            let runtime_id = format!("plugin.{plugin_id}.{dependency_id}");
            let (mut private_manifest, status, install_path) =
                private_runtime_manifest(&runtime_id, &dependency, bundle_root.as_deref())?;
            // Legacy built-in manifests used privateDependencies for external CLIs.
            // Ownership is defined by the plugin, not by that legacy field name.
            if manifest.get("builtin").and_then(Value::as_bool) == Some(true) {
                private_manifest.runtime_type = RuntimeClass::ExternalManaged;
                let hints = manifest
                    .get("resources")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|resource| resource.get("installHint").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n");
                if !hints.is_empty() {
                    private_manifest.purpose = hints;
                }
            }
            requirements.insert(runtime_id.clone(), dependency.clone());
            private_manifests.push((runtime_id, private_manifest, status, install_path));
        }
        let now = Utc::now().to_rfc3339();
        {
            let conn = db.connection();
            conn.execute(
                "DELETE FROM runtime_consumers WHERE plugin_id=?1",
                params![plugin_id],
            )?;
            let prefix = format!("plugin.{plugin_id}.");
            let mut statement = conn.prepare(
                "SELECT runtime_id FROM runtime_registry WHERE runtime_type IN ('plugin_private','external_managed')",
            )?;
            let stale = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .filter(|runtime_id| runtime_id.starts_with(&prefix))
                .collect::<Vec<_>>();
            drop(statement);
            for runtime_id in stale {
                conn.execute(
                    "DELETE FROM runtime_registry WHERE runtime_id=?1",
                    params![runtime_id],
                )?;
            }
        }
        for (_, private_manifest, status, install_path) in &private_manifests {
            self.upsert_manifest(
                db,
                private_manifest,
                *status,
                install_path.as_deref().and_then(Path::to_str),
                None,
            )?;
        }
        let conn = db.connection();
        for (runtime_id, requirement) in requirements {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM runtime_registry WHERE runtime_id=?1)",
                    params![runtime_id],
                    |row| row.get(0),
                )
                .unwrap_or(false);
            if !exists {
                return Err(AppError::ValidationFailed(format!(
                    "Plugin {plugin_id} requests unknown runtime {runtime_id}"
                )));
            }
            conn.execute(
                "INSERT INTO runtime_consumers(runtime_id,plugin_id,requirement,created_at,last_used_at)
                 VALUES (?1,?2,?3,?4,NULL)",
                params![runtime_id, plugin_id, requirement.to_string(), now],
            )?;
        }
        Ok(())
    }

    pub fn resolve_capability(
        &self,
        db: &Database,
        plugin_id: &str,
        manifest: &Value,
        capability: &str,
    ) -> AppResult<RuntimeHandle> {
        if !shared_capabilities(manifest)
            .iter()
            .any(|item| item == capability)
        {
            return Err(AppError::PermissionDenied(format!(
                "Plugin {plugin_id} did not declare shared capability {capability}"
            )));
        }
        self.resolve_platform_capability(db, plugin_id, capability)
    }

    /// Resolve a Shared Runtime for trusted Bob Work platform code. Plugins
    /// must use `resolve_capability`, which additionally verifies their
    /// manifest declaration.
    pub fn resolve_platform_capability(
        &self,
        db: &Database,
        consumer_id: &str,
        capability: &str,
    ) -> AppResult<RuntimeHandle> {
        let runtime_id = shared_runtime_for_capability(capability).ok_or_else(|| {
            AppError::NotFound(format!("No shared runtime provides {capability}"))
        })?;
        let mut runtime = self
            .get(db, runtime_id)?
            .ok_or_else(|| AppError::NotFound(format!("Runtime {runtime_id}")))?;
        if runtime.status == RuntimeStatus::NotInstalled && runtime_id == SHARED_DIAGRAM_ID {
            self.materialize_shared_diagram(db)?;
            runtime = self
                .get(db, runtime_id)?
                .ok_or_else(|| AppError::NotFound(format!("Runtime {runtime_id}")))?;
        }
        if runtime.status != RuntimeStatus::Installed {
            return Err(AppError::NotFound(format!(
                "Runtime {} is not installed",
                runtime.name
            )));
        }
        self.mark_used(db, runtime_id, consumer_id)?;
        let executable = if runtime_id == SHARED_PYTHON_ID {
            runtime.install_path.clone()
        } else {
            None
        };
        Ok(RuntimeHandle {
            runtime_id: runtime.runtime_id,
            runtime_type: runtime.runtime_type,
            version: runtime.version,
            capability: Some(capability.into()),
            executable,
            working_root: runtime.install_path,
            python_mode: runtime.python_mode,
            environment: Vec::new(),
        })
    }

    pub fn resolve_external_runtime(
        &self,
        db: &Database,
        plugin_id: &str,
        manifest: &Value,
        runtime_id: &str,
    ) -> AppResult<RuntimeHandle> {
        let declared = external_runtime_requirements(manifest)
            .into_iter()
            .any(|requirement| requirement.get("id").and_then(Value::as_str) == Some(runtime_id));
        if !declared {
            return Err(AppError::PermissionDenied(format!(
                "Plugin {plugin_id} did not declare External Runtime {runtime_id}"
            )));
        }
        let runtime = self
            .get(db, runtime_id)?
            .ok_or_else(|| AppError::NotFound(format!("Runtime {runtime_id}")))?;
        if runtime.runtime_type != RuntimeClass::ExternalManaged {
            return Err(AppError::ValidationFailed(format!(
                "Runtime {runtime_id} is not externally managed"
            )));
        }
        if runtime.status != RuntimeStatus::Installed {
            return Err(AppError::NotFound(format!(
                "External Runtime {} is not installed; installation requires user acceptance",
                runtime.name
            )));
        }
        let root = runtime
            .install_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
            .ok_or_else(|| AppError::NotFound(format!("Runtime {} files", runtime.name)))?;
        let (executable, environment) = match runtime.python_mode {
            PythonMode::Shared => (
                Some(self.shared_python(db)?.to_string_lossy().into_owned()),
                vec![(
                    "PYTHONPATH".into(),
                    root.join("python").to_string_lossy().into_owned(),
                )],
            ),
            PythonMode::Isolated => {
                let python = isolated_python(&root.join("venv"));
                if !python.is_file() {
                    return Err(AppError::NotFound(format!(
                        "Isolated Python for {}",
                        runtime.name
                    )));
                }
                (Some(python.to_string_lossy().into_owned()), Vec::new())
            }
            PythonMode::None => (None, Vec::new()),
        };
        self.mark_used(db, runtime_id, plugin_id)?;
        Ok(RuntimeHandle {
            runtime_id: runtime.runtime_id,
            runtime_type: runtime.runtime_type,
            version: runtime.version,
            capability: runtime.capabilities.first().cloned(),
            executable,
            working_root: Some(root.to_string_lossy().into_owned()),
            python_mode: runtime.python_mode,
            environment,
        })
    }

    pub fn resolve_private_executable(
        &self,
        plugin_id: &str,
        manifest: &Value,
        bundle_root: Option<&Path>,
        dependency_id: &str,
    ) -> AppResult<RuntimeHandle> {
        if !manifest_has_permission(manifest, "command.execute") {
            return Err(AppError::PermissionDenied(format!(
                "Plugin {plugin_id} requires command.execute"
            )));
        }
        let dependency = private_dependencies(manifest)
            .into_iter()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(dependency_id))
            .or_else(|| legacy_private_entrypoint(manifest, dependency_id))
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "Plugin {plugin_id} does not own dependency {dependency_id}"
                ))
            })?;
        let relative = dependency
            .get("entrypoint")
            .or_else(|| dependency.get("path"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::ValidationFailed("Private runtime entrypoint missing".into())
            })?;
        let source_kind = dependency
            .get("source")
            .and_then(|source| source.get("kind"))
            .and_then(Value::as_str);
        let executable = if source_kind == Some("known-existing-executable") {
            let command = dependency
                .get("source")
                .and_then(|source| source.get("location"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if dependency.get("kind").and_then(Value::as_str) != Some("cli")
                || command != relative
                || !valid_host_command(command)
            {
                return Err(AppError::Security(
                    "Known executable source must match the declared CLI entrypoint".into(),
                ));
            }
            which::which(command).map_err(|_| {
                AppError::NotFound(format!("Required host CLI is not installed: {command}"))
            })?
        } else {
            let root = bundle_root.ok_or_else(|| {
                AppError::ValidationFailed(
                    "A packaged private dependency requires a plugin bundle root".into(),
                )
            })?;
            owned_path(root, relative)?
        };
        if !executable.is_file() {
            return Err(AppError::NotFound(format!(
                "Private executable is not installed: {}",
                executable.display()
            )));
        }
        validate_declared_platform(&dependency)?;
        validate_integrity(
            &executable,
            dependency.get("sha256").and_then(Value::as_str),
        )?;
        Ok(RuntimeHandle {
            runtime_id: format!("plugin.{plugin_id}.{dependency_id}"),
            runtime_type: if manifest.get("builtin").and_then(Value::as_bool) == Some(true) {
                RuntimeClass::ExternalManaged
            } else {
                RuntimeClass::PluginPrivate
            },
            version: dependency
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("unversioned")
                .into(),
            capability: None,
            executable: Some(executable.to_string_lossy().into_owned()),
            working_root: bundle_root
                .map(|root| root.to_string_lossy().into_owned())
                .or_else(|| {
                    executable
                        .parent()
                        .map(|path| path.to_string_lossy().into_owned())
                }),
            python_mode: parse_python_mode(
                dependency
                    .get("pythonMode")
                    .and_then(Value::as_str)
                    .unwrap_or("none"),
            ),
            environment: Vec::new(),
        })
    }

    pub async fn execute_controlled(
        &self,
        manifest: &Value,
        request: ControlledProcessRequest,
    ) -> AppResult<ControlledProcessOutput> {
        if !manifest_has_permission(manifest, "command.execute") {
            return Err(AppError::PermissionDenied(format!(
                "Plugin {} requires command.execute",
                request.plugin_id
            )));
        }
        if !request.executable.is_absolute() || !request.executable.is_file() {
            return Err(AppError::Security(
                "Runtime execution requires a resolved absolute executable".into(),
            ));
        }
        if !request.working_directory.is_dir() {
            return Err(AppError::ValidationFailed(
                "Runtime working directory does not exist".into(),
            ));
        }
        if request.runtime_id == SHARED_PYTHON_ID && mutates_python_environment(&request.args) {
            return Err(AppError::PermissionDenied(
                "Plugins cannot mutate the Shared Python Runtime".into(),
            ));
        }
        let mut process_args = request.args;
        if request.runtime_id == SHARED_PYTHON_ID
            && !process_args
                .iter()
                .any(|argument| matches!(argument.as_str(), "-s" | "-I"))
        {
            process_args.insert(0, "-s".into());
        }
        let mut command = Command::new(&request.executable);
        let process_id = Uuid::new_v4().to_string();
        let diagnostic = RuntimeProcessDiagnostic {
            process_id: process_id.clone(),
            runtime_id: request.runtime_id.clone(),
            plugin_id: request.plugin_id.clone(),
            executable_name: request
                .executable
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("runtime-process")
                .into(),
            started_at: Utc::now().to_rfc3339(),
            timeout_seconds: request.timeout.as_secs(),
        };
        command
            .args(&process_args)
            .current_dir(&request.working_directory)
            .kill_on_drop(true)
            .env_clear()
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .env("HOME", dirs::home_dir().unwrap_or_default());
        if request.runtime_id == SHARED_PYTHON_ID {
            command
                .env("PYTHONNOUSERSITE", "1")
                .env("PYTHONDONTWRITEBYTECODE", "1")
                .env("PIP_REQUIRE_VIRTUALENV", "1");
        }
        for (key, value) in request.environment {
            if !valid_environment_key(&key) || reserved_environment_key(&key, &request.runtime_id) {
                return Err(AppError::Security(format!(
                    "Invalid runtime environment key: {key}"
                )));
            }
            command.env(key, value);
        }
        self.active_processes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(process_id.clone(), diagnostic);
        let (cancel, mut cancelled) = tokio::sync::oneshot::channel();
        self.process_cancellations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(process_id.clone(), cancel);
        let result = tokio::select! {
            result = tokio::time::timeout(request.timeout, command.output()) => Some(result),
            _ = &mut cancelled => None,
        };
        self.active_processes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&process_id);
        self.process_cancellations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&process_id);
        let Some(result) = result else {
            return Ok(ControlledProcessOutput {
                stdout: String::new(),
                stderr: "Runtime process cancelled".into(),
                exit_code: None,
                timed_out: false,
                cancelled: true,
            });
        };
        let output = match result {
            Ok(result) => result.map_err(|error| AppError::Io(error.to_string()))?,
            Err(_) => {
                return Ok(ControlledProcessOutput {
                    stdout: String::new(),
                    stderr: "Runtime process timed out".into(),
                    exit_code: None,
                    timed_out: true,
                    cancelled: false,
                })
            }
        };
        Ok(ControlledProcessOutput {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            exit_code: output.status.code(),
            timed_out: false,
            cancelled: false,
        })
    }

    pub fn cancel_process(&self, process_id: &str) -> bool {
        self.process_cancellations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(process_id)
            .is_some_and(|cancel| cancel.send(()).is_ok())
    }

    pub fn remove_runtime(&self, db: &Database, runtime_id: &str) -> AppResult<()> {
        if self
            .active_processes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .any(|process| process.runtime_id == runtime_id)
        {
            return Err(AppError::PermissionDenied(format!(
                "Runtime {runtime_id} has active processes; cancel them before removal"
            )));
        }
        let runtime = self
            .get(db, runtime_id)?
            .ok_or_else(|| AppError::NotFound(runtime_id.into()))?;
        if runtime.runtime_type != RuntimeClass::ExternalManaged {
            return Err(AppError::PermissionDenied(format!(
                "Only external runtimes managed by Bob Work can be removed; {} is embedded",
                runtime.name
            )));
        }
        let manifest = self.manifest(db, runtime_id)?;
        if external_install_strategy(manifest.source.as_ref()).is_none() || !runtime.removable {
            return Err(AppError::PermissionDenied(format!(
                "{} is installed outside Bob Work and must be removed with its official installer",
                runtime.name
            )));
        }
        let operation_id = self.start_operation(db, runtime_id, "remove", None, None)?;
        self.set_status(db, runtime_id, RuntimeStatus::Removing, None)?;
        if let Some(path) = runtime.install_path.as_deref() {
            let path = Path::new(path);
            if path.exists() {
                let canonical = path.canonicalize()?;
                if let Err(error) =
                    self.validate_external_ownership(&runtime, &manifest, &canonical)
                {
                    self.set_status(
                        db,
                        runtime_id,
                        RuntimeStatus::Installed,
                        Some(&error.to_string()),
                    )?;
                    self.finish_operation(db, &operation_id, "failed", Some(&error.to_string()))?;
                    return Err(error);
                }
                std::fs::remove_dir_all(canonical)?;
            }
        }
        let conn = db.connection();
        conn.execute(
            "UPDATE runtime_registry SET status='not_installed',install_path=NULL,size_bytes=0,
                    installed_at=NULL,installed_version=NULL,updated_at=?1,error=NULL WHERE runtime_id=?2",
            params![Utc::now().to_rfc3339(), runtime_id],
        )?;
        drop(conn);
        crate::services::artifact_runtime::ArtifactRuntime::new().detach_runtime(db, runtime_id)?;
        self.finish_operation(db, &operation_id, "completed", None)?;
        Ok(())
    }

    fn validate_external_ownership(
        &self,
        runtime: &RuntimeRecord,
        manifest: &RuntimeManifest,
        canonical_path: &Path,
    ) -> AppResult<()> {
        let expected = self
            .runtime_root
            .join("external")
            .join(runtime.runtime_id.trim_start_matches("external."))
            .join(safe_version_segment(
                runtime
                    .installed_version
                    .as_deref()
                    .unwrap_or(&manifest.version),
            ));
        let expected = expected
            .canonicalize()
            .map_err(|_| AppError::Security("Bob Work runtime ownership path is missing".into()))?;
        if canonical_path != expected {
            return Err(AppError::Security(
                "Refusing to remove a runtime outside its Bob Work-owned directory".into(),
            ));
        }
        let marker: Value = serde_json::from_slice(&std::fs::read(expected.join("runtime.json"))?)
            .map_err(|_| {
                AppError::Security("Bob Work runtime ownership marker is invalid".into())
            })?;
        let owned = marker.get("runtimeId").and_then(Value::as_str)
            == Some(runtime.runtime_id.as_str())
            && marker.get("version").and_then(Value::as_str)
                == Some(
                    runtime
                        .installed_version
                        .as_deref()
                        .unwrap_or(&manifest.version),
                )
            && marker.get("managedBy").and_then(Value::as_str) == Some(BOB_RUNTIME_OWNER);
        if !owned {
            return Err(AppError::Security(
                "Refusing to remove a runtime without a valid Bob Work ownership marker".into(),
            ));
        }
        Ok(())
    }

    fn materialize_shared_diagram(&self, db: &Database) -> AppResult<PathBuf> {
        let target = self
            .runtime_root
            .join("shared")
            .join("diagram")
            .join(SHARED_DIAGRAM_VERSION);
        let marker = target.join("runtime.json");
        if marker.is_file() {
            self.mark_shared_installed(db, SHARED_DIAGRAM_ID, &target)?;
            return Ok(target);
        }
        let parent = target
            .parent()
            .ok_or_else(|| AppError::Io("Invalid shared diagram runtime path".into()))?;
        std::fs::create_dir_all(parent)?;
        let candidate = parent.join(format!(".candidate-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&candidate)?;
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(SHARED_DIAGRAM_BUNDLE))
            .map_err(|error| {
                AppError::ValidationFailed(format!("Invalid Diagram Runtime bundle: {error}"))
            })?;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| AppError::ValidationFailed(error.to_string()))?;
            let relative = entry.enclosed_name().ok_or_else(|| {
                AppError::Security("Diagram Runtime bundle contains an unsafe path".into())
            })?;
            let output = candidate.join(relative);
            if entry.is_dir() {
                std::fs::create_dir_all(&output)?;
                continue;
            }
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut file = std::fs::File::create(&output)?;
            std::io::copy(&mut entry, &mut file)?;
            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&output, std::fs::Permissions::from_mode(mode))?;
            }
        }
        validate_shared_diagram_payload(&candidate)?;
        std::fs::write(
            candidate.join("runtime.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "runtimeId": SHARED_DIAGRAM_ID,
                "version": SHARED_DIAGRAM_VERSION,
                "platform": Self::platform_id(),
                "engines": [
                    {"id":"d2","version":"0.7.1"},
                    {"id":"mermaid","version":"11.17.1"},
                    {"id":"plantuml","version":"1.2026.4"},
                    {"id":"graphviz","mode":"host-resolved-optional"}
                ]
            }))?,
        )?;
        if target.exists() {
            std::fs::remove_dir_all(&target)?;
        }
        std::fs::rename(&candidate, &target)?;
        self.mark_shared_installed(db, SHARED_DIAGRAM_ID, &target)?;
        Ok(target)
    }

    fn mark_shared_installed(&self, db: &Database, runtime_id: &str, path: &Path) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        db.connection().execute(
            "UPDATE runtime_registry SET status='installed',install_path=?1,size_bytes=?2,
                    installed_at=COALESCE(installed_at,?3),updated_at=?3,error=NULL,
                    installed_version=version
             WHERE runtime_id=?4",
            params![
                path.to_string_lossy(),
                directory_size(path)? as i64,
                now,
                runtime_id
            ],
        )?;
        Ok(())
    }

    pub fn storage_report(&self, db: &Database) -> AppResult<RuntimeStorageReport> {
        let mut runtimes = self.list(db)?;
        for runtime in &mut runtimes {
            if let Some(path) = runtime.install_path.as_deref() {
                runtime.size_bytes = directory_size(Path::new(path))?;
            }
        }
        let shared_bytes = runtimes
            .iter()
            .filter(|runtime| runtime.runtime_type == RuntimeClass::Shared)
            .map(|runtime| runtime.size_bytes)
            .sum();
        let external_bytes = runtimes
            .iter()
            .filter(|runtime| runtime.runtime_type == RuntimeClass::ExternalManaged)
            .map(|runtime| runtime.size_bytes)
            .sum();
        let private_paths = runtimes
            .iter()
            .filter(|runtime| runtime.runtime_type == RuntimeClass::PluginPrivate)
            .filter(|runtime| runtime_is_bob_owned_private(runtime))
            .filter_map(|runtime| runtime.install_path.as_deref())
            .map(PathBuf::from)
            .collect::<BTreeSet<_>>();
        let private_bytes = private_paths
            .iter()
            .map(|path| directory_size(path).unwrap_or(0))
            .sum();
        let mut active_processes = self
            .active_processes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .cloned()
            .collect::<Vec<_>>();
        active_processes.sort_by(|left, right| left.started_at.cmp(&right.started_at));
        Ok(RuntimeStorageReport {
            core_bytes: self
                .core_path
                .as_deref()
                .map(directory_size)
                .transpose()?
                .unwrap_or(0),
            shared_bytes,
            external_bytes,
            private_bytes,
            artifact_bytes: directory_size(&self.artifact_root).unwrap_or(0),
            cache_bytes: directory_size(&self.cache_root).unwrap_or(0),
            runtimes,
            active_processes,
        })
    }

    fn mark_used(&self, db: &Database, runtime_id: &str, plugin_id: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let conn = db.connection();
        conn.execute(
            "UPDATE runtime_registry SET last_used_at=?1 WHERE runtime_id=?2",
            params![now, runtime_id],
        )?;
        conn.execute(
            "UPDATE runtime_consumers SET last_used_at=?1 WHERE runtime_id=?2 AND plugin_id=?3",
            params![now, runtime_id, plugin_id],
        )?;
        Ok(())
    }

    fn manifest(&self, db: &Database, runtime_id: &str) -> AppResult<RuntimeManifest> {
        let raw = db
            .connection()
            .query_row(
                "SELECT manifest FROM runtime_registry WHERE runtime_id=?1",
                params![runtime_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Runtime {runtime_id}"))
                }
                other => other.into(),
            })?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn shared_python(&self, db: &Database) -> AppResult<PathBuf> {
        let runtime = self
            .get(db, SHARED_PYTHON_ID)?
            .ok_or_else(|| AppError::NotFound("Shared Python Runtime".into()))?;
        let executable = runtime
            .install_path
            .map(PathBuf::from)
            .ok_or_else(|| AppError::NotFound("Shared Python Runtime executable".into()))?;
        if !executable.is_file() {
            return Err(AppError::NotFound(format!(
                "Shared Python is unavailable at {}",
                executable.display()
            )));
        }
        Ok(executable)
    }

    async fn install_python_packages(
        &self,
        manifest: &RuntimeManifest,
        shared_python: &Path,
        python_mode: PythonMode,
        candidate: &Path,
    ) -> AppResult<()> {
        let packages = manifest
            .packages
            .iter()
            .map(|package| format!("{}=={}", package.name, package.version))
            .collect::<Vec<_>>();
        if packages.is_empty() {
            return Err(AppError::ValidationFailed(
                "Managed Python runtime has no declared packages".into(),
            ));
        }

        let (python, package_root) = match python_mode {
            PythonMode::Shared => {
                let package_root = candidate.join("python");
                std::fs::create_dir_all(&package_root)?;
                let mut args = vec![
                    "-m".into(),
                    "pip".into(),
                    "install".into(),
                    "--disable-pip-version-check".into(),
                    "--no-input".into(),
                    "--only-binary=:all:".into(),
                    "--index-url=https://pypi.org/simple".into(),
                    format!("--target={}", package_root.to_string_lossy()),
                ];
                args.extend(packages.clone());
                run_runtime_command(shared_python, &args, candidate, &[]).await?;
                (shared_python.to_path_buf(), package_root)
            }
            PythonMode::Isolated => {
                let compatible =
                    resolve_compatible_python(manifest.python_compatibility.as_deref())?;
                let environment = candidate.join("venv");
                run_runtime_command(
                    &compatible,
                    &[
                        "-m".into(),
                        "venv".into(),
                        environment.to_string_lossy().into_owned(),
                    ],
                    candidate,
                    &[],
                )
                .await?;
                let python = isolated_python(&environment);
                let mut args = vec![
                    "-m".into(),
                    "pip".into(),
                    "install".into(),
                    "--disable-pip-version-check".into(),
                    "--no-input".into(),
                    "--only-binary=:all:".into(),
                    "--index-url=https://pypi.org/simple".into(),
                ];
                args.extend(packages.clone());
                run_runtime_command(&python, &args, candidate, &[]).await?;
                (python, environment)
            }
            PythonMode::None => {
                return Err(AppError::ValidationFailed(
                    "Managed Python runtime requires a Python mode".into(),
                ))
            }
        };

        let validation_packages = manifest
            .packages
            .iter()
            .map(|package| {
                serde_json::json!({
                    "distribution": package.name,
                    "module": package.import_name.clone().unwrap_or_else(|| package.name.replace('-', "_")),
                    "expected": package.version,
                })
            })
            .collect::<Vec<_>>();
        let validation_payload = serde_json::to_string(&validation_packages)?;
        let validation = r#"
import importlib
import importlib.metadata as metadata
import json
import sys

result = {}
for package in json.loads(sys.argv[1]):
    importlib.import_module(package["module"])
    actual = metadata.version(package["distribution"])
    if actual != package["expected"]:
        raise RuntimeError(
            f'{package["distribution"]}: expected {package["expected"]}, got {actual}'
        )
    result[package["distribution"]] = actual
print(json.dumps(result, sort_keys=True))
"#;
        let environment = if python_mode == PythonMode::Shared {
            vec![(
                "PYTHONPATH".into(),
                package_root.to_string_lossy().into_owned(),
            )]
        } else {
            Vec::new()
        };
        let isolation_flag = if python_mode == PythonMode::Shared {
            "-s"
        } else {
            "-I"
        };
        run_runtime_command(
            &python,
            &[
                isolation_flag.into(),
                "-c".into(),
                validation.into(),
                validation_payload,
            ],
            candidate,
            &environment,
        )
        .await?;
        std::fs::write(
            candidate.join("runtime.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "runtimeId": manifest.id,
                "version": manifest.version,
                "managedBy": BOB_RUNTIME_OWNER,
                "source": manifest.source,
                "pythonMode": python_mode,
                "python": python,
                "packageRoot": package_root,
                "packages": manifest.packages,
                "installedAt": Utc::now().to_rfc3339(),
                "platform": Self::platform_id()
            }))?,
        )?;
        Ok(())
    }

    fn set_status(
        &self,
        db: &Database,
        runtime_id: &str,
        status: RuntimeStatus,
        error: Option<&str>,
    ) -> AppResult<()> {
        db.connection().execute(
            "UPDATE runtime_registry SET status=?1,updated_at=?2,error=?3 WHERE runtime_id=?4",
            params![status.as_str(), Utc::now().to_rfc3339(), error, runtime_id],
        )?;
        Ok(())
    }

    fn start_operation(
        &self,
        db: &Database,
        runtime_id: &str,
        operation: &str,
        candidate: Option<&Path>,
        previous: Option<&Path>,
    ) -> AppResult<String> {
        let id = Uuid::new_v4().to_string();
        db.connection().execute(
            "INSERT INTO runtime_operations(id,runtime_id,operation,state,candidate_path,previous_path,details,started_at)
             VALUES (?1,?2,?3,'running',?4,?5,'{}',?6)",
            params![
                id,
                runtime_id,
                operation,
                candidate.map(|path| path.to_string_lossy().into_owned()),
                previous.map(|path| path.to_string_lossy().into_owned()),
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(id)
    }

    fn finish_operation(
        &self,
        db: &Database,
        operation_id: &str,
        state: &str,
        error: Option<&str>,
    ) -> AppResult<()> {
        db.connection().execute(
            "UPDATE runtime_operations SET state=?1,details=?2,completed_at=?3 WHERE id=?4",
            params![
                state,
                serde_json::json!({"error":error}).to_string(),
                Utc::now().to_rfc3339(),
                operation_id,
            ],
        )?;
        Ok(())
    }

    fn recover_incomplete_operations(&self, db: &Database) -> AppResult<()> {
        let operations = {
            let conn = db.connection();
            let mut statement = conn.prepare(
                "SELECT id,runtime_id,candidate_path,previous_path
                 FROM runtime_operations WHERE state='running' ORDER BY started_at",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        for (operation_id, runtime_id, candidate, previous) in operations {
            let current = self.get(db, &runtime_id)?;
            let active_is_valid = current.as_ref().is_some_and(|runtime| {
                runtime.status == RuntimeStatus::Installed
                    && runtime
                        .install_path
                        .as_deref()
                        .is_some_and(|path| Path::new(path).exists())
            });
            if let Some(candidate) = candidate.as_deref() {
                self.remove_runtime_temporary_path(Path::new(candidate))?;
            }
            if active_is_valid {
                if let Some(previous) = previous.as_deref() {
                    self.remove_runtime_temporary_path(Path::new(previous))?;
                }
                self.finish_operation(db, &operation_id, "completed", None)?;
                continue;
            }
            let mut restored = false;
            if let Some(previous) = previous.as_deref() {
                let backup = Path::new(previous);
                if backup
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.starts_with(".previous-"))
                    && backup.exists()
                {
                    let target = backup.parent().and_then(|parent| {
                        current
                            .as_ref()
                            .map(|runtime| parent.join(safe_version_segment(&runtime.version)))
                    });
                    if let Some(target) = target {
                        if target.exists() {
                            self.remove_runtime_temporary_path(&target)?;
                        }
                        std::fs::rename(backup, target)?;
                        restored = true;
                    }
                }
            }
            let has_previous_install = current
                .as_ref()
                .and_then(|runtime| runtime.install_path.as_deref())
                .is_some_and(|path| Path::new(path).exists());
            self.set_status(
                db,
                &runtime_id,
                if restored || has_previous_install {
                    RuntimeStatus::Installed
                } else {
                    RuntimeStatus::Broken
                },
                Some("Interrupted runtime operation recovered at startup"),
            )?;
            self.finish_operation(
                db,
                &operation_id,
                "interrupted",
                Some("Recovered at startup"),
            )?;
        }
        Ok(())
    }

    fn remove_runtime_temporary_path(&self, path: &Path) -> AppResult<()> {
        if !path.exists() {
            return Ok(());
        }
        let root = self
            .runtime_root
            .canonicalize()
            .unwrap_or_else(|_| self.runtime_root.clone());
        let canonical = path.canonicalize()?;
        if !canonical.starts_with(&root) || canonical == root {
            return Err(AppError::Security(
                "Refusing to clean a path outside Runtime Manager storage".into(),
            ));
        }
        if canonical.is_dir() {
            std::fs::remove_dir_all(canonical)?;
        } else {
            std::fs::remove_file(canonical)?;
        }
        Ok(())
    }
}

fn logical_shared_manifest(id: &str, name: &str, capabilities: &[&str]) -> RuntimeManifest {
    RuntimeManifest {
        id: id.into(),
        name: name.into(),
        version: "2.0.0".into(),
        purpose: format!("Shared Bob Work {} capability", capabilities.join(", ")),
        runtime_type: RuntimeClass::Shared,
        capabilities: capabilities.iter().map(|value| (*value).into()).collect(),
        platforms: vec![RuntimeManager::platform_id()],
        dependencies: Vec::new(),
        python_mode: Some(PythonMode::None),
        python_compatibility: None,
        packages: Vec::new(),
        source: None,
        estimated_size_bytes: None,
        removable: false,
    }
}

fn visualization_runtime_manifest() -> RuntimeManifest {
    RuntimeManifest {
        id: SHARED_VISUALIZATION_ID.into(),
        name: "Bob Work Visualization Runtime".into(),
        version: "2.0.0".into(),
        purpose: "Local, reusable chart, scientific visualization and real 3D rendering engines"
            .into(),
        runtime_type: RuntimeClass::Shared,
        capabilities: vec!["visualization".into()],
        platforms: vec![RuntimeManager::platform_id()],
        dependencies: Vec::new(),
        python_mode: Some(PythonMode::None),
        python_compatibility: None,
        packages: vec![
            RuntimePackage {
                name: "echarts".into(),
                version: "6.1.0".into(),
                import_name: None,
                source: Some("npm".into()),
            },
            RuntimePackage {
                name: "echarts-gl".into(),
                version: "2.1.0".into(),
                import_name: None,
                source: Some("npm".into()),
            },
            RuntimePackage {
                name: "plotly.js-dist-min".into(),
                version: "4.0.0".into(),
                import_name: None,
                source: Some("npm".into()),
            },
            RuntimePackage {
                name: "three".into(),
                version: "0.185.1".into(),
                import_name: None,
                source: Some("npm".into()),
            },
        ],
        source: Some(RuntimeSource {
            kind: "local-application-bundle".into(),
            location: "Bob Work frontend chunks".into(),
            sha256: None,
        }),
        // Actual minified local chunks measured by the production Vite build.
        estimated_size_bytes: Some(6_742_200),
        removable: false,
    }
}

fn diagram_runtime_manifest() -> RuntimeManifest {
    RuntimeManifest {
        id: SHARED_DIAGRAM_ID.into(),
        name: "Bob Work Diagram Runtime".into(),
        version: SHARED_DIAGRAM_VERSION.into(),
        purpose: "Local reusable architecture, flow, state, dependency and ER diagram rendering"
            .into(),
        runtime_type: RuntimeClass::Shared,
        capabilities: vec!["diagram".into()],
        platforms: vec![RuntimeManager::platform_id()],
        dependencies: Vec::new(),
        python_mode: Some(PythonMode::None),
        python_compatibility: None,
        packages: vec![
            RuntimePackage {
                name: "d2".into(),
                version: "0.7.1".into(),
                import_name: None,
                source: Some("local-application-bundle".into()),
            },
            RuntimePackage {
                name: "mermaid".into(),
                version: "11.17.1".into(),
                import_name: None,
                source: Some("local-application-bundle".into()),
            },
            RuntimePackage {
                name: "plantuml".into(),
                version: "1.2026.4".into(),
                import_name: None,
                source: Some("local-application-bundle".into()),
            },
            RuntimePackage {
                name: "graphviz".into(),
                version: "host-resolved-optional".into(),
                import_name: None,
                source: Some("host".into()),
            },
        ],
        source: Some(RuntimeSource {
            kind: "local-application-bundle".into(),
            location: "resources/shared-runtimes/diagram/diagram-runtime.zip".into(),
            sha256: Some(format!("{:x}", Sha256::digest(SHARED_DIAGRAM_BUNDLE))),
        }),
        estimated_size_bytes: Some(SHARED_DIAGRAM_BUNDLE.len() as u64),
        removable: false,
    }
}

fn plugin_bundle_root(manifest: &Value) -> Option<PathBuf> {
    manifest
        .get("bundlePath")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .or_else(|| {
            let slug = manifest.get("slug").and_then(Value::as_str)?;
            Some(dirs::home_dir()?.join(".bob").join("skills").join(slug))
        })
}

fn private_runtime_manifest(
    runtime_id: &str,
    dependency: &Value,
    bundle_root: Option<&Path>,
) -> AppResult<(RuntimeManifest, RuntimeStatus, Option<PathBuf>)> {
    let id = dependency
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::ValidationFailed("Private dependency id missing".into()))?;
    let kind = dependency
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("binary");
    let version = dependency
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("unversioned");
    let relative = dependency
        .get("entrypoint")
        .or_else(|| dependency.get("path"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::ValidationFailed("Private dependency entrypoint missing".into())
        })?;
    let mut source = dependency.get("source").and_then(|source| {
        if let Some(location) = source.as_str() {
            return Some(RuntimeSource {
                kind: "declared".into(),
                location: location.into(),
                sha256: dependency
                    .get("sha256")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            });
        }
        Some(RuntimeSource {
            kind: source.get("kind")?.as_str()?.into(),
            location: source.get("location")?.as_str()?.into(),
            sha256: dependency
                .get("sha256")
                .and_then(Value::as_str)
                .or_else(|| source.get("sha256").and_then(Value::as_str))
                .map(str::to_string),
        })
    });
    let install_path = if source
        .as_ref()
        .is_some_and(|source| source.kind == "known-existing-executable")
    {
        let command = source
            .as_ref()
            .map(|source| source.location.as_str())
            .unwrap_or_default();
        if !valid_host_command(command) || command != relative {
            return Err(AppError::Security(
                "Known executable source must match the declared CLI entrypoint".into(),
            ));
        }
        which::which(command).ok().filter(|path| path.is_file())
    } else {
        bundle_root
            .map(|root| private_dependency_storage_path(root, relative))
            .transpose()?
            .filter(|path| path.exists())
    };
    if let (Some(source), Some(path)) = (source.as_mut(), install_path.as_deref()) {
        if source.kind == "known-existing-executable" && source.sha256.is_none() {
            source.sha256 = Some(sha256_file(path)?);
        }
    }
    let status = if install_path.is_some() {
        RuntimeStatus::Installed
    } else {
        RuntimeStatus::NotInstalled
    };
    let capabilities = dependency
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    Ok((
        RuntimeManifest {
            id: runtime_id.into(),
            name: dependency
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .into(),
            version: version.into(),
            purpose: dependency
                .get("purpose")
                .and_then(Value::as_str)
                .unwrap_or("Plugin-private execution dependency")
                .into(),
            runtime_type: RuntimeClass::PluginPrivate,
            capabilities,
            platforms: dependency
                .get("platforms")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            dependencies: Vec::new(),
            python_mode: Some(parse_python_mode(
                dependency
                    .get("pythonMode")
                    .and_then(Value::as_str)
                    .unwrap_or(if kind == "python" { "isolated" } else { "none" }),
            )),
            python_compatibility: dependency
                .get("pythonCompatibility")
                .and_then(Value::as_str)
                .map(str::to_string),
            packages: vec![RuntimePackage {
                name: id.into(),
                version: version.into(),
                import_name: dependency
                    .get("importName")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                source: source.as_ref().map(|source| source.kind.clone()),
            }],
            source,
            estimated_size_bytes: dependency.get("estimatedSizeBytes").and_then(Value::as_u64),
            removable: false,
        },
        status,
        install_path,
    ))
}

fn private_dependency_storage_path(bundle_root: &Path, relative: &str) -> AppResult<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::Security(
            "Plugin private runtime paths must be safe and relative".into(),
        ));
    }
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value),
            _ => None,
        })
        .collect::<Vec<_>>();
    let owned = match components.as_slice() {
        [root, tool, version, ..] if *root == "vendor" => {
            bundle_root.join(root).join(tool).join(version)
        }
        [root, ..] if matches!(root.to_str(), Some("python" | "node" | "wasm" | "lib")) => {
            bundle_root.join(root)
        }
        _ => bundle_root.join(path),
    };
    Ok(owned)
}

fn qiskit_runtime_manifest() -> RuntimeManifest {
    RuntimeManifest {
        id: "external.qiskit".into(),
        name: "Qiskit Runtime".into(),
        version: "qiskit-2.5.2+runtime-0.49.0+aer-0.17.2".into(),
        purpose: "Optional quantum circuit design, local simulation, result analysis and IBM Quantum access for the IBM Qiskit plugin".into(),
        runtime_type: RuntimeClass::ExternalManaged,
        capabilities: vec!["quantum.qiskit".into(), "python.packages.qiskit".into()],
        platforms: vec![RuntimeManager::platform_id()],
        dependencies: vec![RuntimeDependency {
            id: SHARED_PYTHON_ID.into(),
            version: Some(">=3.10".into()),
            optional: false,
        }],
        python_mode: Some(PythonMode::Shared),
        python_compatibility: Some(">=3.10".into()),
        packages: vec![
            RuntimePackage { name: "qiskit".into(), version: "2.5.2".into(), import_name: Some("qiskit".into()), source: Some("PyPI".into()) },
            RuntimePackage { name: "qiskit-aer".into(), version: "0.17.2".into(), import_name: Some("qiskit_aer".into()), source: Some("PyPI".into()) },
            RuntimePackage { name: "qiskit-ibm-runtime".into(), version: "0.49.0".into(), import_name: Some("qiskit_ibm_runtime".into()), source: Some("PyPI".into()) },
        ],
        source: Some(RuntimeSource {
            kind: "trusted-python-index".into(),
            location: "https://pypi.org/simple".into(),
            sha256: None,
        }),
        estimated_size_bytes: Some(800 * 1024 * 1024),
        removable: true,
    }
}

fn codegraph_runtime_manifest() -> RuntimeManifest {
    RuntimeManifest {
        id: crate::services::codegraph_mcp::CODEGRAPH_RUNTIME_ID.into(),
        name: "CodeGraph Runtime".into(),
        version: crate::services::codegraph_mcp::CODEGRAPH_RUNTIME_VERSION.into(),
        purpose: "Indexation syntaxique locale Python, JavaScript, TypeScript, Go, Java et Rust pour la recherche hybride, la navigation callers/callees et l’analyse d’impact. Les index restent sur ce Mac.".into(),
        runtime_type: RuntimeClass::ExternalManaged,
        capabilities: vec![
            "code.index".into(),
            "code.semantic-search".into(),
            "code.call-graph".into(),
            "code.impact-analysis".into(),
        ],
        platforms: vec![RuntimeManager::platform_id()],
        dependencies: vec![RuntimeDependency {
            id: SHARED_PYTHON_ID.into(),
            version: Some(">=3.10".into()),
            optional: false,
        }],
        python_mode: Some(PythonMode::Shared),
        python_compatibility: Some(">=3.10".into()),
        packages: vec![RuntimePackage {
            name: "tree-sitter-language-pack".into(),
            version: "1.16.1".into(),
            import_name: Some("tree_sitter_language_pack".into()),
            source: Some("PyPI".into()),
        }],
        source: Some(RuntimeSource {
            kind: "trusted-python-index".into(),
            location: "https://pypi.org/simple".into(),
            sha256: None,
        }),
        estimated_size_bytes: Some(45 * 1024 * 1024),
        removable: true,
    }
}

fn detect_shared_python_packages(executable: &Path) -> AppResult<Vec<RuntimePackage>> {
    const CANDIDATES: &[&str] = &[
        "numpy",
        "pandas",
        "polars",
        "scipy",
        "duckdb",
        "pyarrow",
        "openpyxl",
        "python-pptx",
        "weasyprint",
    ];
    let script = r#"
import importlib.metadata as metadata
import json

names = ["numpy", "pandas", "polars", "scipy", "duckdb", "pyarrow", "openpyxl", "python-pptx", "weasyprint"]
found = []
for name in names:
    try:
        found.append({"name": name, "version": metadata.version(name), "source": "host"})
    except metadata.PackageNotFoundError:
        pass
print(json.dumps(found))
"#;
    let output = std::process::Command::new(executable)
        .args(["-s", "-c", script])
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME")
        .output()?;
    if !output.status.success() {
        return Err(AppError::ValidationFailed(format!(
            "Could not inventory Shared Python packages: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let packages: Vec<RuntimePackage> =
        serde_json::from_slice(&output.stdout).map_err(|error| {
            AppError::ValidationFailed(format!("Invalid Shared Python inventory: {error}"))
        })?;
    if packages
        .iter()
        .any(|package| !CANDIDATES.contains(&package.name.as_str()))
    {
        return Err(AppError::Security(
            "Shared Python inventory returned an undeclared package".into(),
        ));
    }
    Ok(packages)
}

pub fn shared_capabilities(manifest: &Value) -> Vec<String> {
    let mut values = manifest
        .get("sharedCapabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    if manifest
        .get("runtime")
        .and_then(|runtime| runtime.get("python"))
        .is_some()
    {
        values.insert("python".into());
    }
    values.into_iter().collect()
}

pub fn external_runtime_requirements(manifest: &Value) -> Vec<Value> {
    manifest
        .get("externalRuntimes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

pub fn private_dependencies(manifest: &Value) -> Vec<Value> {
    manifest
        .get("privateDependencies")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Schema-only validation used during plugin import. Physical resolution and
/// integrity are checked again at execution time by the Runtime Manager.
pub fn validate_plugin_runtime_requirements(manifest: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let known_capabilities = [
        "python",
        "dataframe",
        "spreadsheet",
        "statistics",
        "visualization",
        "diagram",
        "artifact",
    ];
    if let Some(value) = manifest.get("sharedCapabilities") {
        match value.as_array() {
            Some(items) => {
                let mut seen = BTreeSet::new();
                for item in items {
                    let Some(capability) = item.as_str() else {
                        errors.push("sharedCapabilities entries must be strings".into());
                        continue;
                    };
                    if !known_capabilities.contains(&capability) {
                        errors.push(format!("Unknown shared capability: {capability}"));
                    }
                    if !seen.insert(capability) {
                        errors.push(format!("Duplicate shared capability: {capability}"));
                    }
                }
            }
            None => errors.push("sharedCapabilities must be an array".into()),
        }
    }

    if let Some(value) = manifest.get("externalRuntimes") {
        match value.as_array() {
            Some(items) => {
                for item in items {
                    let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
                    if !id.starts_with("external.") || !valid_runtime_identifier(id) {
                        errors.push(format!("Invalid external runtime id: {id}"));
                    }
                    if item.get("version").is_some_and(|value| !value.is_string()) {
                        errors.push(format!("External runtime {id} has an invalid version"));
                    }
                }
            }
            None => errors.push("externalRuntimes must be an array".into()),
        }
    }

    if let Some(value) = manifest.get("privateDependencies") {
        match value.as_array() {
            Some(items) => {
                let has_execute = manifest_has_permission(manifest, "command.execute");
                let mut seen = BTreeSet::new();
                for item in items {
                    let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
                    if !valid_runtime_identifier(id) || !seen.insert(id) {
                        errors.push(format!("Invalid or duplicate private dependency id: {id}"));
                    }
                    let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
                    if !matches!(
                        kind,
                        "binary" | "cli" | "native" | "python" | "node" | "wasm"
                    ) {
                        errors.push(format!("Private dependency {id} has an invalid kind"));
                    }
                    let entrypoint = item
                        .get("entrypoint")
                        .or_else(|| item.get("path"))
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let entrypoint_runtime = if matches!(kind, "binary" | "cli" | "native") {
                        "binary"
                    } else {
                        kind
                    };
                    let host_cli_source = item
                        .get("source")
                        .and_then(|source| source.get("kind"))
                        .and_then(Value::as_str)
                        == Some("known-existing-executable");
                    if entrypoint.is_empty()
                        || (!host_cli_source
                            && crate::services::plugin_bundle_layout::validate_entrypoint_path(
                                entrypoint_runtime,
                                entrypoint,
                            )
                            .is_err())
                    {
                        errors.push(format!("Private dependency {id} has an unsafe entrypoint"));
                    }
                    if let Some(source) = item.get("source") {
                        let kind = source
                            .get("kind")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let location = source
                            .get("location")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if kind == "known-existing-executable"
                            && (item.get("kind").and_then(Value::as_str) != Some("cli")
                                || location != entrypoint
                                || !valid_host_command(location))
                        {
                            errors.push(format!(
                                "Private dependency {id} has an unsafe existing executable source"
                            ));
                        }
                    }
                    if !has_execute && kind != "wasm" {
                        errors.push(format!(
                            "Private dependency {id} requires command.execute permission"
                        ));
                    }
                    if matches!(kind, "binary" | "native" | "wasm")
                        && item.get("sha256").and_then(Value::as_str).is_none()
                    {
                        errors.push(format!("Private dependency {id} requires a SHA-256"));
                    }
                    if let Some(platforms) = item.get("platforms") {
                        let valid = platforms.as_array().is_some_and(|platforms| {
                            !platforms.is_empty()
                                && platforms.iter().all(|platform| {
                                    platform.as_str().is_some_and(|platform| {
                                        matches!(
                                            platform,
                                            "darwin-arm64"
                                                | "darwin-x64"
                                                | "linux-arm64"
                                                | "linux-x64"
                                                | "windows-x64"
                                                | "windows-arm64"
                                        )
                                    })
                                })
                        });
                        if !valid {
                            errors.push(format!(
                                "Private dependency {id} has invalid platform metadata"
                            ));
                        }
                    }
                }
            }
            None => errors.push("privateDependencies must be an array".into()),
        }
    }
    errors.sort();
    errors.dedup();
    errors
}

fn valid_runtime_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
}

fn valid_host_command(value: &str) -> bool {
    !value.is_empty()
        && !value.contains('/')
        && !value.contains('\\')
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
}

fn legacy_private_entrypoint(manifest: &Value, dependency_id: &str) -> Option<Value> {
    manifest
        .get("entrypoints")
        .and_then(Value::as_array)?
        .iter()
        .find(|entry| entry.get("name").and_then(Value::as_str) == Some(dependency_id))
        .map(|entry| {
            serde_json::json!({
                "id": dependency_id,
                "kind": entry.get("runtime").and_then(Value::as_str).unwrap_or("binary"),
                "entrypoint": entry.get("path").and_then(Value::as_str),
                "version": "legacy"
            })
        })
}

fn shared_runtime_for_capability(capability: &str) -> Option<&'static str> {
    match capability {
        "python" | "dataframe" | "spreadsheet" | "statistics" => Some(SHARED_PYTHON_ID),
        "visualization" => Some(SHARED_VISUALIZATION_ID),
        "diagram" => Some(SHARED_DIAGRAM_ID),
        "artifact" => Some(SHARED_ARTIFACT_ID),
        _ => None,
    }
}

fn validate_runtime_manifest(manifest: &RuntimeManifest) -> AppResult<()> {
    if manifest.id.trim().is_empty()
        || !manifest
            .id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_'))
    {
        return Err(AppError::ValidationFailed("Invalid runtime id".into()));
    }
    if manifest.name.trim().is_empty() || manifest.version.trim().is_empty() {
        return Err(AppError::ValidationFailed(
            "Runtime name and version are required".into(),
        ));
    }
    if manifest.runtime_type == RuntimeClass::ExternalManaged && manifest.source.is_none() {
        return Err(AppError::ValidationFailed(
            "External managed runtimes require a declared source".into(),
        ));
    }
    Ok(())
}

fn validate_managed_python_source(manifest: &RuntimeManifest) -> AppResult<()> {
    if manifest.runtime_type != RuntimeClass::ExternalManaged {
        return Err(AppError::ValidationFailed(
            "Runtime is not externally managed".into(),
        ));
    }
    let source = manifest
        .source
        .as_ref()
        .ok_or_else(|| AppError::Security("External runtime source missing".into()))?;
    if source.kind != "trusted-python-index" || source.location != "https://pypi.org/simple" {
        return Err(AppError::Security(format!(
            "Runtime {} is not backed by an approved package source",
            manifest.id
        )));
    }
    if manifest.packages.iter().any(|package| {
        package.name.trim().is_empty()
            || package.version.trim().is_empty()
            || package.version == "catalog-managed"
            || !package.name.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            })
            || package.import_name.as_ref().is_some_and(|name| {
                name.is_empty()
                    || name.split('.').any(|segment| {
                        segment.is_empty()
                            || !segment.chars().all(|character| {
                                character.is_ascii_alphanumeric() || character == '_'
                            })
                    })
            })
    }) {
        return Err(AppError::Security(
            "Managed runtime packages must have approved names and pinned versions".into(),
        ));
    }
    Ok(())
}

fn safe_version_segment(version: &str) -> String {
    version
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn python_satisfies(executable: &Path, compatibility: Option<&str>) -> AppResult<bool> {
    let version = semver::Version::parse(&python_version(executable)?)
        .map_err(|error| AppError::ValidationFailed(format!("Invalid Python version: {error}")))?;
    let Some(requirement) = compatibility else {
        return Ok(true);
    };
    let requirement = semver::VersionReq::parse(requirement).map_err(|error| {
        AppError::ValidationFailed(format!("Invalid Python requirement: {error}"))
    })?;
    Ok(requirement.matches(&version))
}

fn resolve_compatible_python(compatibility: Option<&str>) -> AppResult<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("BOB_SHARED_PYTHON") {
        candidates.push(PathBuf::from(configured));
    }
    for name in [
        "python3.14",
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
    ] {
        if let Ok(path) = which::which(name) {
            candidates.push(path);
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates
        .into_iter()
        .find(|candidate| {
            candidate.is_file() && python_satisfies(candidate, compatibility).unwrap_or(false)
        })
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "No compatible 64-bit CPython found for {}",
                compatibility.unwrap_or("the requested runtime")
            ))
        })
}

fn isolated_python(environment: &Path) -> PathBuf {
    if cfg!(windows) {
        environment.join("Scripts").join("python.exe")
    } else {
        environment.join("bin").join("python")
    }
}

async fn run_runtime_command(
    executable: &Path,
    args: &[String],
    working_directory: &Path,
    environment: &[(String, String)],
) -> AppResult<String> {
    if !executable.is_absolute() || !executable.is_file() {
        return Err(AppError::Security(
            "Managed runtime executable was not resolved to an absolute file".into(),
        ));
    }
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(working_directory)
        .kill_on_drop(true)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", dirs::home_dir().unwrap_or_default());
    for (key, value) in environment {
        command.env(key, value);
    }
    let output = tokio::time::timeout(Duration::from_secs(30 * 60), command.output())
        .await
        .map_err(|_| AppError::Unknown("Managed runtime installation timed out".into()))??;
    if !output.status.success() {
        return Err(AppError::Unknown(format!(
            "Managed runtime command failed (exit {:?}): {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn resolve_host_python() -> Option<PathBuf> {
    // A Bob Work-managed shared environment takes precedence over the host
    // interpreter. It remains one reusable runtime, outside the app bundle,
    // and is still immutable to plugins through execute_controlled.
    dirs::home_dir()
        .map(|home| home.join(".bob/runtimes/shared/python/venv/bin/python"))
        .filter(|path| path.is_file())
        .or_else(|| {
            std::env::var_os("BOB_SHARED_PYTHON")
                .map(PathBuf::from)
                .filter(|path| path.is_file())
        })
        .or_else(|| which::which("python3").ok())
        .or_else(|| which::which("python").ok())
}

fn python_version(executable: &Path) -> AppResult<String> {
    let output = std::process::Command::new(executable)
        .arg("--version")
        .output()?;
    if !output.status.success() {
        return Err(AppError::ValidationFailed(
            "Shared Python did not report a version".into(),
        ));
    }
    let value = if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    };
    let version = String::from_utf8_lossy(value);
    Ok(version
        .trim()
        .strip_prefix("Python ")
        .unwrap_or_else(|| version.trim())
        .to_string())
}

fn owned_path(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::Security(
            "Plugin private runtime paths must be safe and relative".into(),
        ));
    }
    let candidate = root.join(relative);
    let root = root.canonicalize()?;
    let candidate = candidate.canonicalize()?;
    if !candidate.starts_with(root) {
        return Err(AppError::Security(
            "Plugin private dependency escaped its owner root".into(),
        ));
    }
    Ok(candidate)
}

fn validate_integrity(path: &Path, expected: Option<&str>) -> AppResult<()> {
    let Some(expected) = expected.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(AppError::Security(format!(
            "Integrity check failed for {}",
            path.display()
        )))
    }
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn runtime_is_bob_owned_private(runtime: &RuntimeRecord) -> bool {
    runtime
        .source
        .as_deref()
        .and_then(|source| serde_json::from_str::<RuntimeSource>(source).ok())
        .is_none_or(|source| source.kind != "known-existing-executable")
}

fn validate_shared_diagram_payload(root: &Path) -> AppResult<()> {
    for (relative, sha256) in [
        (
            "vendor/d2/v0.7.1/bin/d2",
            "a18d231bf67a269a2873279eec7f50f56793d28b6e28ca7410260d61633cfbcc",
        ),
        (
            "vendor/mermaid/dist/mermaid.min.js",
            "b7a4cda9e88e187d4e1f279b8a14a3df651edd8dc704b9b56ed8e84659735570",
        ),
        (
            "vendor/plantuml/plantuml-1.2026.4.jar",
            "ebe66f9e67a12dc7aca4e10af67ab29b10ffa281bc72147dbfdc4c00d9de7664",
        ),
    ] {
        let path = root.join(relative);
        if !path.is_file() {
            return Err(AppError::ValidationFailed(format!(
                "Diagram Runtime is missing {relative}"
            )));
        }
        validate_integrity(&path, Some(sha256))?;
    }
    Ok(())
}

fn validate_declared_platform(dependency: &Value) -> AppResult<()> {
    let platforms = dependency
        .get("platforms")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    let current_platform = RuntimeManager::platform_id();
    if platforms.is_empty() || platforms.contains(&current_platform.as_str()) {
        Ok(())
    } else {
        Err(AppError::ValidationFailed(format!(
            "Private dependency is not compatible with {}",
            RuntimeManager::platform_id()
        )))
    }
}

fn manifest_has_permission(manifest: &Value, permission: &str) -> bool {
    manifest
        .get("permissions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|value| {
            value.as_str() == Some(permission)
                || value.get("type").and_then(Value::as_str) == Some(permission)
        })
}

fn valid_environment_key(value: &str) -> bool {
    !value.is_empty()
        && value.chars().enumerate().all(|(index, character)| {
            character == '_'
                || character.is_ascii_alphanumeric() && (index > 0 || !character.is_ascii_digit())
        })
}

fn reserved_environment_key(key: &str, runtime_id: &str) -> bool {
    let key = key.to_ascii_uppercase();
    matches!(
        key.as_str(),
        "PATH" | "HOME" | "SHELL" | "PYTHONHOME" | "LD_PRELOAD"
    ) || key.starts_with("DYLD_")
        || (runtime_id == SHARED_PYTHON_ID
            && matches!(
                key.as_str(),
                "PYTHONPATH"
                    | "PYTHONUSERBASE"
                    | "PYTHONNOUSERSITE"
                    | "PYTHONDONTWRITEBYTECODE"
                    | "PIP_CONFIG_FILE"
                    | "PIP_REQUIRE_VIRTUALENV"
            ))
}

fn mutates_python_environment(args: &[String]) -> bool {
    let normalized = args
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();
    normalized.windows(2).any(|pair| {
        pair[0] == "-m" && matches!(pair[1].as_str(), "pip" | "ensurepip" | "easy_install")
    }) || normalized.iter().any(|value| {
        (value.contains("pip") || value.contains("ensurepip") || value.contains("easy_install"))
            && (value.contains("install")
                || value.contains("uninstall")
                || value.contains("upgrade"))
    })
}

fn directory_size(path: &Path) -> AppResult<u64> {
    if !path.exists() {
        return Ok(0);
    }
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        return Ok(metadata.len());
    }
    let mut total = 0u64;
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        total = total.saturating_add(directory_size(&entry.path())?);
    }
    Ok(total)
}

fn bob_work_core_path() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    executable
        .ancestors()
        .find(|path| path.extension().and_then(|value| value.to_str()) == Some("app"))
        .map(Path::to_path_buf)
        .or(Some(executable))
}

fn runtime_consumers(conn: &rusqlite::Connection, runtime_id: &str) -> AppResult<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT plugin_id FROM runtime_consumers WHERE runtime_id=?1 ORDER BY plugin_id",
    )?;
    let values = statement
        .query_map(params![runtime_id], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(values)
}

fn json_or_default<T>(raw: &str) -> T
where
    T: serde::de::DeserializeOwned + Default,
{
    serde_json::from_str(raw).unwrap_or_default()
}

fn parse_runtime_class(value: &str) -> RuntimeClass {
    match value {
        "external_managed" => RuntimeClass::ExternalManaged,
        "plugin_private" => RuntimeClass::PluginPrivate,
        _ => RuntimeClass::Shared,
    }
}

fn parse_runtime_status(value: &str) -> RuntimeStatus {
    match value {
        "installing" => RuntimeStatus::Installing,
        "installed" => RuntimeStatus::Installed,
        "updating" => RuntimeStatus::Updating,
        "broken" => RuntimeStatus::Broken,
        "removing" => RuntimeStatus::Removing,
        _ => RuntimeStatus::NotInstalled,
    }
}

fn parse_python_mode(value: &str) -> PythonMode {
    match value {
        "shared" => PythonMode::Shared,
        "isolated" => PythonMode::Isolated,
        _ => PythonMode::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn database() -> Database {
        let db = Database::new_in_memory().expect("database");
        db.run_migrations().expect("migrations");
        db
    }

    #[test]
    fn platform_id_uses_supported_runtime_vocabulary() {
        let value = RuntimeManager::platform_id();
        assert!(
            value.starts_with("darwin-")
                || value.starts_with("linux-")
                || value.starts_with("windows-")
        );
        assert!(value.ends_with("arm64") || value.ends_with("x64"));
    }

    #[test]
    fn seeds_shared_and_external_runtime_registry() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        manager.seed_registry(&db).expect("registry");
        let runtimes = manager.list(&db).expect("runtimes");
        assert!(runtimes
            .iter()
            .any(|item| item.runtime_id == SHARED_PYTHON_ID));
        assert!(runtimes
            .iter()
            .any(|item| item.runtime_id == SHARED_VISUALIZATION_ID));
        assert!(runtimes
            .iter()
            .any(|item| item.runtime_id == SHARED_DIAGRAM_ID));
        assert!(runtimes
            .iter()
            .any(|item| item.runtime_id == SHARED_ARTIFACT_ID));
        let qiskit = runtimes
            .iter()
            .find(|item| item.runtime_id == "external.qiskit")
            .unwrap();
        assert_eq!(qiskit.runtime_type, RuntimeClass::ExternalManaged);
        assert_eq!(qiskit.management, "automatic");
        assert_eq!(qiskit.status, RuntimeStatus::NotInstalled);
        assert!(qiskit.removable);
        let codegraph = runtimes
            .iter()
            .find(|item| item.runtime_id == "external.codegraph")
            .unwrap();
        assert_eq!(codegraph.runtime_type, RuntimeClass::ExternalManaged);
        assert_eq!(codegraph.management, "automatic");
        assert_eq!(codegraph.status, RuntimeStatus::NotInstalled);
        assert!(codegraph.removable);
        assert!(codegraph.capabilities.contains(&"code.call-graph".into()));
    }

    #[test]
    fn shared_python_is_immutable_and_capability_based() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        db.connection().execute(
            "INSERT INTO plugins(id,name,version,manifest,created_at,updated_at) VALUES ('a','A','1','{}','now','now')",
            [],
        ).unwrap();
        manager.seed_registry(&db).unwrap();
        let manifest = serde_json::json!({"sharedCapabilities":["python"],"permissions":[{"type":"command.execute"}]});
        manager
            .register_plugin_requirements(&db, "a", &manifest)
            .unwrap();
        let handle = manager
            .resolve_capability(&db, "a", &manifest, "python")
            .unwrap();
        assert_eq!(handle.runtime_id, SHARED_PYTHON_ID);
        assert_eq!(handle.python_mode, PythonMode::Shared);
        assert!(manager.remove_runtime(&db, SHARED_PYTHON_ID).is_err());
    }

    #[tokio::test]
    async fn external_runtime_installation_requires_explicit_acceptance() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        manager.seed_registry(&db).unwrap();
        let error = manager
            .install_external_runtime(&db, "external.qiskit", false)
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::PermissionDenied(_)));
        assert_eq!(
            manager.get(&db, "external.qiskit").unwrap().unwrap().status,
            RuntimeStatus::NotInstalled
        );
    }

    #[tokio::test]
    async fn manual_external_runtime_cannot_enter_the_automatic_installer() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        let mut manifest = qiskit_runtime_manifest();
        manifest.id = "external.vendor-cli".into();
        manifest.name = "Vendor CLI".into();
        manifest.source = Some(RuntimeSource {
            kind: "known-existing-executable".into(),
            location: "vendor-cli".into(),
            sha256: None,
        });
        manifest.packages.clear();
        manifest.python_mode = Some(PythonMode::None);
        manifest.removable = false;
        manager
            .upsert_manifest(&db, &manifest, RuntimeStatus::NotInstalled, None, None)
            .unwrap();

        let runtime = manager.get(&db, &manifest.id).unwrap().unwrap();
        assert_eq!(runtime.management, "manual");
        let error = manager
            .install_external_runtime(&db, &manifest.id, true)
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::ValidationFailed(_)));
        assert_eq!(
            manager.get(&db, &manifest.id).unwrap().unwrap().status,
            RuntimeStatus::NotInstalled
        );
    }

    #[test]
    fn external_removal_requires_an_exact_bob_owned_path_and_marker() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        let manifest = qiskit_runtime_manifest();
        let installed = root
            .path()
            .join("runtimes/external/qiskit")
            .join(safe_version_segment(&manifest.version));
        fs::create_dir_all(&installed).unwrap();
        fs::write(
            installed.join("runtime.json"),
            serde_json::to_vec(&serde_json::json!({
                "runtimeId": manifest.id,
                "version": manifest.version,
                "managedBy": BOB_RUNTIME_OWNER
            }))
            .unwrap(),
        )
        .unwrap();
        manager
            .upsert_manifest(
                &db,
                &manifest,
                RuntimeStatus::Installed,
                installed.to_str(),
                None,
            )
            .unwrap();

        manager.remove_runtime(&db, &manifest.id).unwrap();
        assert!(!installed.exists());
        assert_eq!(
            manager.get(&db, &manifest.id).unwrap().unwrap().status,
            RuntimeStatus::NotInstalled
        );

        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("runtime.json"), b"{}").unwrap();
        manager
            .upsert_manifest(
                &db,
                &manifest,
                RuntimeStatus::Installed,
                installed.to_str(),
                None,
            )
            .unwrap();
        let error = manager.remove_runtime(&db, &manifest.id).unwrap_err();
        assert!(matches!(error, AppError::Security(_)));
        assert!(installed.exists());
        assert_eq!(
            manager.get(&db, &manifest.id).unwrap().unwrap().status,
            RuntimeStatus::Installed
        );
    }

    #[test]
    fn startup_migrates_only_matching_legacy_external_markers() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        let manifest = qiskit_runtime_manifest();
        let installed = root
            .path()
            .join("runtimes/external/qiskit")
            .join(safe_version_segment(&manifest.version));
        fs::create_dir_all(&installed).unwrap();
        fs::write(
            installed.join("runtime.json"),
            serde_json::to_vec(&serde_json::json!({
                "runtimeId": manifest.id,
                "version": manifest.version
            }))
            .unwrap(),
        )
        .unwrap();
        manager
            .upsert_manifest(
                &db,
                &manifest,
                RuntimeStatus::Installed,
                installed.to_str(),
                None,
            )
            .unwrap();

        manager.seed_registry(&db).unwrap();

        let marker: Value =
            serde_json::from_slice(&fs::read(installed.join("runtime.json")).unwrap()).unwrap();
        assert_eq!(
            marker.get("managedBy").and_then(Value::as_str),
            Some(BOB_RUNTIME_OWNER)
        );
        manager.remove_runtime(&db, &manifest.id).unwrap();
        assert!(!installed.exists());
    }

    #[test]
    fn catalog_update_preserves_the_active_external_runtime_version() {
        let root = tempfile::tempdir().expect("root");
        let installed = root.path().join("runtimes/external/example/1.0.0");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("runtime.json"), b"{}").unwrap();
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        let mut manifest = qiskit_runtime_manifest();
        manifest.id = "external.example".into();
        manifest.name = "Example Runtime".into();
        manifest.version = "1.0.0".into();
        manager
            .upsert_manifest(
                &db,
                &manifest,
                RuntimeStatus::Installed,
                installed.to_str(),
                None,
            )
            .unwrap();

        manifest.version = "2.0.0".into();
        manager
            .upsert_manifest(&db, &manifest, RuntimeStatus::NotInstalled, None, None)
            .unwrap();

        let runtime = manager.get(&db, &manifest.id).unwrap().unwrap();
        assert_eq!(runtime.status, RuntimeStatus::Installed);
        assert_eq!(runtime.version, "2.0.0");
        assert_eq!(runtime.installed_version.as_deref(), Some("1.0.0"));
        assert!(
            !manager
                .installation_plan(&db, &manifest.id)
                .unwrap()
                .already_installed
        );
    }

    #[test]
    fn startup_recovers_an_interrupted_transactional_update() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        manager.seed_registry(&db).unwrap();
        let manifest = qiskit_runtime_manifest();
        let runtime_parent = root.path().join("runtimes/external/qiskit");
        let final_path = runtime_parent.join(safe_version_segment(&manifest.version));
        fs::create_dir_all(&final_path).unwrap();
        fs::write(final_path.join("working"), b"previous").unwrap();
        manager
            .upsert_manifest(
                &db,
                &manifest,
                RuntimeStatus::Installed,
                final_path.to_str(),
                None,
            )
            .unwrap();
        let candidate = runtime_parent.join(".candidate-test");
        let backup = runtime_parent.join(".previous-test");
        fs::create_dir_all(&candidate).unwrap();
        let operation = manager
            .start_operation(&db, &manifest.id, "update", Some(&candidate), Some(&backup))
            .unwrap();
        manager
            .set_status(&db, &manifest.id, RuntimeStatus::Updating, None)
            .unwrap();
        fs::rename(&final_path, &backup).unwrap();

        manager.seed_registry(&db).unwrap();

        assert_eq!(fs::read(final_path.join("working")).unwrap(), b"previous");
        assert!(!candidate.exists());
        assert!(!backup.exists());
        assert_eq!(
            manager.get(&db, &manifest.id).unwrap().unwrap().status,
            RuntimeStatus::Installed
        );
        let state: String = db
            .connection()
            .query_row(
                "SELECT state FROM runtime_operations WHERE id=?1",
                params![operation],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "interrupted");
    }

    #[tokio::test]
    async fn controlled_service_rejects_shared_python_mutation() {
        let root = tempfile::tempdir().expect("root");
        let python = resolve_host_python().expect("python");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let manifest = serde_json::json!({"permissions":[{"type":"command.execute"}]});
        let error = manager
            .execute_controlled(
                &manifest,
                ControlledProcessRequest {
                    plugin_id: "plugin-a".into(),
                    runtime_id: SHARED_PYTHON_ID.into(),
                    executable: python.clone(),
                    args: vec![
                        "-m".into(),
                        "pip".into(),
                        "install".into(),
                        "anything".into(),
                    ],
                    working_directory: root.path().to_path_buf(),
                    environment: Vec::new(),
                    timeout: Duration::from_secs(1),
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::PermissionDenied(_)));
        let error = manager
            .execute_controlled(
                &manifest,
                ControlledProcessRequest {
                    plugin_id: "plugin-a".into(),
                    runtime_id: SHARED_PYTHON_ID.into(),
                    executable: python,
                    args: vec!["-c".into(), "print('unsafe env')".into()],
                    working_directory: root.path().to_path_buf(),
                    environment: vec![("PATH".into(), "/tmp/untrusted".into())],
                    timeout: Duration::from_secs(1),
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Security(_)));
    }

    #[tokio::test]
    async fn storage_diagnostics_and_cancellation_track_only_active_processes() {
        let root = tempfile::tempdir().expect("root");
        let python = resolve_host_python().expect("python");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        manager.seed_registry(&db).unwrap();
        let execution_manager = manager.clone();
        let working_directory = root.path().to_path_buf();
        let execution = tokio::spawn(async move {
            execution_manager
                .execute_controlled(
                    &serde_json::json!({"permissions":[{"type":"command.execute"}]}),
                    ControlledProcessRequest {
                        plugin_id: "plugin-a".into(),
                        runtime_id: SHARED_PYTHON_ID.into(),
                        executable: python,
                        args: vec![
                            "-c".into(),
                            "import time; time.sleep(0.25); print('done')".into(),
                        ],
                        working_directory,
                        environment: Vec::new(),
                        timeout: Duration::from_secs(2),
                    },
                )
                .await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let report = manager.storage_report(&db).unwrap();
        assert_eq!(report.active_processes.len(), 1);
        assert_eq!(report.active_processes[0].runtime_id, SHARED_PYTHON_ID);
        assert_eq!(report.active_processes[0].plugin_id, "plugin-a");
        let process_id = report.active_processes[0].process_id.clone();
        assert!(manager.cancel_process(&process_id));
        let output = execution.await.unwrap().unwrap();
        assert!(output.cancelled);
        assert!(!output.timed_out);
        assert!(manager
            .storage_report(&db)
            .unwrap()
            .active_processes
            .is_empty());
    }

    #[tokio::test]
    async fn external_runtime_handle_executes_through_controlled_service() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        manager.seed_registry(&db).unwrap();
        db.connection()
            .execute(
                "INSERT INTO plugins(id,name,version,manifest,created_at,updated_at)
                 VALUES ('qiskit-plugin','Qiskit','1','{}','now','now')",
                [],
            )
            .unwrap();
        let manifest = serde_json::json!({
            "permissions":[{"type":"command.execute"}],
            "externalRuntimes":[{"id":"external.qiskit"}]
        });
        manager
            .register_plugin_requirements(&db, "qiskit-plugin", &manifest)
            .unwrap();
        let installed = root.path().join("runtimes/external/qiskit/test");
        fs::create_dir_all(installed.join("python/qiskit")).unwrap();
        fs::write(
            installed.join("python/qiskit/__init__.py"),
            b"VALUE = 'runtime-manager'\n",
        )
        .unwrap();
        db.connection()
            .execute(
                "UPDATE runtime_registry SET status='installed',install_path=?1,python_mode='shared'
                 WHERE runtime_id='external.qiskit'",
                params![installed.to_string_lossy()],
            )
            .unwrap();
        let handle = manager
            .resolve_external_runtime(&db, "qiskit-plugin", &manifest, "external.qiskit")
            .unwrap();
        let output = manager
            .execute_controlled(
                &manifest,
                ControlledProcessRequest {
                    plugin_id: "qiskit-plugin".into(),
                    runtime_id: "external.qiskit".into(),
                    executable: PathBuf::from(handle.executable.unwrap()),
                    args: vec![
                        "-s".into(),
                        "-c".into(),
                        "import qiskit; print(qiskit.VALUE)".into(),
                    ],
                    working_directory: installed,
                    environment: handle.environment,
                    timeout: Duration::from_secs(5),
                },
            )
            .await
            .unwrap();
        assert_eq!(output.exit_code, Some(0));
        assert_eq!(output.stdout.trim(), "runtime-manager");
    }

    #[test]
    fn diagram_runtime_is_materialized_only_when_a_consumer_resolves_it() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        manager.seed_registry(&db).unwrap();
        assert_eq!(
            manager.get(&db, SHARED_DIAGRAM_ID).unwrap().unwrap().status,
            RuntimeStatus::NotInstalled
        );
        db.connection()
            .execute(
                "INSERT INTO plugins(id,name,version,manifest,created_at,updated_at)
                 VALUES ('visualize','Visualize','1','{}','now','now')",
                [],
            )
            .unwrap();
        let manifest = serde_json::json!({"sharedCapabilities":["diagram"]});
        manager
            .register_plugin_requirements(&db, "visualize", &manifest)
            .unwrap();
        let handle = manager
            .resolve_capability(&db, "visualize", &manifest, "diagram")
            .unwrap();
        let path = PathBuf::from(handle.working_root.unwrap());
        assert!(path.join("vendor/d2/v0.7.1/bin/d2").is_file());
        assert!(path.join("vendor/mermaid/dist/mermaid.min.js").is_file());
        assert_eq!(
            manager.get(&db, SHARED_DIAGRAM_ID).unwrap().unwrap().status,
            RuntimeStatus::Installed
        );
    }

    #[test]
    fn private_binary_cannot_escape_plugin_root_or_cross_owner() {
        let root = tempfile::tempdir().expect("root");
        let plugin = root.path().join("plugin-a");
        let other = root.path().join("plugin-b/bin");
        fs::create_dir_all(plugin.join("bin")).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(plugin.join("bin/own"), b"own").unwrap();
        fs::write(other.join("foreign"), b"foreign").unwrap();
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let manifest = serde_json::json!({
            "permissions":[{"type":"command.execute"}],
            "privateDependencies":[
                {"id":"own","kind":"binary","entrypoint":"bin/own"},
                {"id":"foreign","kind":"binary","entrypoint":"../plugin-b/bin/foreign"}
            ]
        });
        assert!(manager
            .resolve_private_executable("a", &manifest, Some(&plugin), "own")
            .is_ok());
        assert!(manager
            .resolve_private_executable("a", &manifest, Some(&plugin), "foreign")
            .is_err());
    }

    #[test]
    fn known_host_cli_is_verified_without_becoming_bob_owned_storage() {
        let root = tempfile::tempdir().expect("root");
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        manager.seed_registry(&db).unwrap();
        db.connection()
            .execute(
                "INSERT INTO plugins(id,name,version,manifest,created_at,updated_at)
                 VALUES ('host-cli','Host CLI','1.0.0','{}','now','now')",
                [],
            )
            .unwrap();
        let manifest = serde_json::json!({
            "permissions":[{"type":"command.execute"}],
            "privateDependencies":[{
                "id":"sh",
                "name":"System shell",
                "kind":"cli",
                "version":"host-managed",
                "entrypoint":"sh",
                "source":{"kind":"known-existing-executable","location":"sh"}
            }]
        });
        manager
            .register_plugin_requirements(&db, "host-cli", &manifest)
            .unwrap();
        let runtime = manager.get(&db, "plugin.host-cli.sh").unwrap().unwrap();
        assert_eq!(runtime.status, RuntimeStatus::Installed);
        assert!(runtime
            .source
            .as_deref()
            .is_some_and(|source| source.contains("sha256")));
        let handle = manager
            .resolve_private_executable("host-cli", &manifest, None, "sh")
            .unwrap();
        assert!(PathBuf::from(handle.executable.unwrap()).is_absolute());
        assert_eq!(manager.storage_report(&db).unwrap().private_bytes, 0);
        // Reclassify legacy built-in CLI dependencies without touching their files.
        let mut builtin = manifest.clone();
        builtin["builtin"] = serde_json::json!(true);
        builtin["resources"] = serde_json::json!([{"installHint":"Follow the vendor installer"}]);
        manager
            .register_plugin_requirements(&db, "host-cli", &builtin)
            .unwrap();
        let optional = manager.get(&db, "plugin.host-cli.sh").unwrap().unwrap();
        assert_eq!(optional.runtime_type, RuntimeClass::ExternalManaged);
        assert_eq!(optional.management, "manual");
        assert!(!optional.removable);
        assert!(manager.remove_runtime(&db, &optional.runtime_id).is_err());
        assert_eq!(
            manager
                .installation_plan(&db, &optional.runtime_id)
                .unwrap()
                .purpose,
            "Follow the vendor installer"
        );
        let handle = manager
            .resolve_private_executable("host-cli", &builtin, None, "sh")
            .unwrap();
        assert_eq!(handle.runtime_type, RuntimeClass::ExternalManaged);
        // Repeated refresh does not duplicate records.
        manager
            .register_plugin_requirements(&db, "host-cli", &builtin)
            .unwrap();
        assert_eq!(
            manager
                .list(&db)
                .unwrap()
                .iter()
                .filter(|r| r.runtime_id == optional.runtime_id)
                .count(),
            1
        );
    }

    #[test]
    fn registers_and_accounts_for_plugin_private_runtime_ownership() {
        let root = tempfile::tempdir().expect("root");
        let bundle = root.path().join("plugin-a");
        let private_root = bundle.join("vendor/tool/1.0.0");
        fs::create_dir_all(private_root.join("bin")).unwrap();
        fs::write(private_root.join("bin/tool"), b"private-runtime").unwrap();
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        let db = database();
        manager.seed_registry(&db).unwrap();
        db.connection()
            .execute(
                "INSERT INTO plugins(id,name,version,manifest,created_at,updated_at)
                 VALUES ('plugin-a','Plugin A','1.0.0','{}','now','now')",
                [],
            )
            .unwrap();
        let manifest = serde_json::json!({
            "slug":"plugin-a",
            "bundlePath":bundle,
            "permissions":[{"type":"command.execute"}],
            "privateDependencies":[{
                "id":"tool",
                "kind":"binary",
                "version":"1.0.0",
                "entrypoint":"vendor/tool/1.0.0/bin/tool",
                "sha256":"f6f99ed11e94dd6321a4ad63826360d3d26e45528302583fa89d2fcd938fce47",
                "platforms":[RuntimeManager::platform_id()]
            }]
        });
        manager
            .register_plugin_requirements(&db, "plugin-a", &manifest)
            .unwrap();
        let runtime = manager.get(&db, "plugin.plugin-a.tool").unwrap().unwrap();
        assert_eq!(runtime.runtime_type, RuntimeClass::PluginPrivate);
        assert_eq!(runtime.status, RuntimeStatus::Installed);
        assert_eq!(runtime.consumers, vec!["plugin-a"]);
        assert!(runtime.size_bytes >= b"private-runtime".len() as u64);
        assert_eq!(
            manager.storage_report(&db).unwrap().private_bytes,
            directory_size(&private_root).unwrap()
        );
        assert!(manager.remove_runtime(&db, &runtime.runtime_id).is_err());

        let without_private = serde_json::json!({
            "slug":"plugin-a",
            "bundlePath":bundle,
            "privateDependencies":[]
        });
        manager
            .register_plugin_requirements(&db, "plugin-a", &without_private)
            .unwrap();
        assert!(manager.get(&db, "plugin.plugin-a.tool").unwrap().is_none());

        manager
            .register_plugin_requirements(&db, "plugin-a", &manifest)
            .unwrap();
        db.connection()
            .execute("DELETE FROM plugins WHERE id='plugin-a'", [])
            .unwrap();
        assert!(manager.get(&db, "plugin.plugin-a.tool").unwrap().is_none());
    }

    #[test]
    fn legacy_python_manifest_normalizes_to_shared_python() {
        let manifest = serde_json::json!({"runtime":{"python":">=3.9"}});
        assert_eq!(shared_capabilities(&manifest), vec!["python"]);
    }

    #[test]
    fn validates_v2_plugin_runtime_declarations() {
        let valid = serde_json::json!({
            "permissions":[{"type":"command.execute"}],
            "sharedCapabilities":["python","artifact"],
            "externalRuntimes":[{"id":"external.qiskit","version":">=2"}],
            "privateDependencies":[{
                "id":"vendor-cli",
                "kind":"binary",
                "entrypoint":"vendor/tool/1.0.0/bin/tool",
                "sha256":"0123456789abcdef",
                "platforms":["darwin-arm64"]
            }]
        });
        assert!(validate_plugin_runtime_requirements(&valid).is_empty());

        let unsafe_manifest = serde_json::json!({
            "sharedCapabilities":["unknown"],
            "externalRuntimes":[{"id":"qiskit"}],
            "privateDependencies":[{
                "id":"escape",
                "kind":"binary",
                "entrypoint":"../foreign/tool"
            }]
        });
        let errors = validate_plugin_runtime_requirements(&unsafe_manifest);
        assert!(errors
            .iter()
            .any(|error| error.contains("Unknown shared capability")));
        assert!(errors
            .iter()
            .any(|error| error.contains("external runtime id")));
        assert!(errors
            .iter()
            .any(|error| error.contains("unsafe entrypoint")));
        assert!(errors.iter().any(|error| error.contains("SHA-256")));
    }
}
