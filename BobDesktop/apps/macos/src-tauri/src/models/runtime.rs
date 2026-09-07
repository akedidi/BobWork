use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeClass {
    Shared,
    ExternalManaged,
    PluginPrivate,
}

impl RuntimeClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::ExternalManaged => "external_managed",
            Self::PluginPrivate => "plugin_private",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStatus {
    NotInstalled,
    Installing,
    Installed,
    Updating,
    Broken,
    Removing,
}

impl RuntimeStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotInstalled => "not_installed",
            Self::Installing => "installing",
            Self::Installed => "installed",
            Self::Updating => "updating",
            Self::Broken => "broken",
            Self::Removing => "removing",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PythonMode {
    None,
    Shared,
    Isolated,
}

impl PythonMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Shared => "shared",
            Self::Isolated => "isolated",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePackage {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub import_name: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependency {
    pub id: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSource {
    pub kind: String,
    pub location: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub purpose: String,
    pub runtime_type: RuntimeClass,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<RuntimeDependency>,
    #[serde(default)]
    pub python_mode: Option<PythonMode>,
    #[serde(default)]
    pub python_compatibility: Option<String>,
    #[serde(default)]
    pub packages: Vec<RuntimePackage>,
    #[serde(default)]
    pub source: Option<RuntimeSource>,
    #[serde(default)]
    pub estimated_size_bytes: Option<u64>,
    #[serde(default)]
    pub removable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRecord {
    /// Lifecycle support is independent of runtime ownership/classification.
    pub management: String,
    pub runtime_id: String,
    pub runtime_type: RuntimeClass,
    pub name: String,
    pub version: String,
    pub installed_version: Option<String>,
    pub source: Option<String>,
    pub install_path: Option<String>,
    pub platform: String,
    pub architecture: String,
    pub size_bytes: u64,
    pub status: RuntimeStatus,
    pub installed_at: Option<String>,
    pub updated_at: String,
    pub last_used_at: Option<String>,
    pub integrity: Option<String>,
    pub dependencies: Vec<RuntimeDependency>,
    pub python_mode: PythonMode,
    pub capabilities: Vec<String>,
    pub consumers: Vec<String>,
    pub removable: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHandle {
    pub runtime_id: String,
    pub runtime_type: RuntimeClass,
    pub version: String,
    pub capability: Option<String>,
    pub executable: Option<String>,
    pub working_root: Option<String>,
    pub python_mode: PythonMode,
    pub environment: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStorageReport {
    pub core_bytes: u64,
    pub shared_bytes: u64,
    pub external_bytes: u64,
    pub private_bytes: u64,
    pub artifact_bytes: u64,
    pub cache_bytes: u64,
    pub runtimes: Vec<RuntimeRecord>,
    pub active_processes: Vec<RuntimeProcessDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProcessDiagnostic {
    pub process_id: String,
    pub runtime_id: String,
    pub plugin_id: String,
    pub executable_name: String,
    pub started_at: String,
    pub timeout_seconds: u64,
}

/// User-visible information shown before an optional managed runtime is
/// downloaded. Installation is rejected unless the caller explicitly accepts
/// this plan.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstallationPlan {
    pub runtime_id: String,
    pub name: String,
    pub version: String,
    pub purpose: String,
    pub source: String,
    pub estimated_size_bytes: Option<u64>,
    pub python_mode: PythonMode,
    pub packages: Vec<RuntimePackage>,
    pub already_installed: bool,
}
