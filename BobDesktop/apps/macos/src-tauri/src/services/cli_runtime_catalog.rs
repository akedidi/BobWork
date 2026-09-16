//! Catalog of Bob-managed external CLI runtimes.
//!
//! Each entry installs under `~/.bob/runtimes/external/{slug}/{version}/` and never
//! modifies the global macOS PATH unless the user already installed the tool elsewhere.

use crate::error::{AppError, AppResult};
use crate::models::runtime::{
    PythonMode, RuntimeClass, RuntimeDependency, RuntimeManifest, RuntimePackage, RuntimeSource,
};
use crate::services::runtime_manager::RuntimeManager;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tokio::process::Command;

const SHARED_PYTHON_ID: &str = "shared.python";

#[derive(Debug, Clone, Copy)]
pub struct CliCatalogEntry {
    pub runtime_id: &'static str,
    pub command: &'static str,
    pub name: &'static str,
    pub version: &'static str,
    pub purpose: &'static str,
    pub estimated_size_bytes: u64,
}

pub fn catalog_entries() -> &'static [CliCatalogEntry] {
    &[
        CliCatalogEntry {
            runtime_id: "external.ibmcloud-cli",
            command: "ibmcloud",
            name: "IBM Cloud CLI",
            version: "2.33.1",
            purpose: "CLI officielle IBM Cloud pour l’authentification IAM, les comptes, régions et ressources.",
            estimated_size_bytes: 120 * 1024 * 1024,
        },
        CliCatalogEntry {
            runtime_id: "external.aws-cli",
            command: "aws",
            name: "AWS CLI v2",
            version: "2.27.25",
            purpose: "CLI officielle AWS pour l’identité, les ressources et le diagnostic multi-services.",
            estimated_size_bytes: 130 * 1024 * 1024,
        },
        CliCatalogEntry {
            runtime_id: "external.azure-cli",
            command: "az",
            name: "Azure CLI",
            version: "2.74.0",
            purpose: "CLI officielle Microsoft Azure installée dans un environnement Python isolé géré par Bob Work.",
            estimated_size_bytes: 250 * 1024 * 1024,
        },
        CliCatalogEntry {
            runtime_id: "external.gcloud-cli",
            command: "gcloud",
            name: "Google Cloud CLI",
            version: "531.0.0",
            purpose: "SDK Google Cloud pour projets, IAM, compute, GKE et services serverless.",
            estimated_size_bytes: 180 * 1024 * 1024,
        },
        CliCatalogEntry {
            runtime_id: "external.openshift-cli",
            command: "oc",
            name: "OpenShift CLI (oc)",
            version: "4.18.4",
            purpose: "Client OpenShift pour projets, workloads, routes et diagnostics de cluster.",
            estimated_size_bytes: 90 * 1024 * 1024,
        },
        CliCatalogEntry {
            runtime_id: "external.terraform-cli",
            command: "terraform",
            name: "Terraform CLI",
            version: "1.12.2",
            purpose: "CLI HashiCorp Terraform pour formater, valider et planifier des infrastructures.",
            estimated_size_bytes: 90 * 1024 * 1024,
        },
        CliCatalogEntry {
            runtime_id: "external.ansible-cli",
            command: "ansible-playbook",
            name: "Ansible",
            version: "11.7.0",
            purpose: "Ansible installé dans un venv isolé pour inventaires, syntax-check et exécution contrôlée.",
            estimated_size_bytes: 120 * 1024 * 1024,
        },
        CliCatalogEntry {
            runtime_id: "external.zowe-cli",
            command: "zowe",
            name: "Zowe CLI",
            version: "8.16.0",
            purpose: "Zowe CLI pour z/OSMF, jobs, datasets et opérations mainframe.",
            estimated_size_bytes: 160 * 1024 * 1024,
        },
        CliCatalogEntry {
            runtime_id: "external.docling-cli",
            command: "docling",
            name: "Docling CLI",
            version: "2.123.0",
            purpose: "CLI Docling pour convertir PDF, Office, images et audio en Markdown ou JSON structurés, avec OCR, tableaux, formules et graphiques.",
            estimated_size_bytes: 1500 * 1024 * 1024,
        },
    ]
}

pub fn uses_isolated_python(runtime_id: &str) -> bool {
    matches!(
        runtime_id,
        "external.azure-cli" | "external.ansible-cli" | "external.docling-cli"
    )
}

pub fn manifests() -> Vec<RuntimeManifest> {
    catalog_entries()
        .iter()
        .filter_map(|entry| manifest_for(entry).ok())
        .collect()
}

pub fn bob_cli_search_paths(command: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let Some(entry) = catalog_entries()
        .iter()
        .find(|item| item.command == command)
    else {
        return paths;
    };
    let slug = entry.runtime_id.strip_prefix("external.").unwrap_or(entry.runtime_id);
    collect_cli_binaries(
        &bob_runtimes_root().join("external").join(slug),
        command,
        &mut paths,
    );
    if command == "docling" {
        collect_cli_binaries(&bob_runtimes_root().join("docling"), command, &mut paths);
    }
    paths
}

/// Bob-managed copy of a catalog CLI, including a legacy Docling venv.
pub fn discover_managed_cli(command: &str) -> Option<(PathBuf, String)> {
    for path in bob_cli_search_paths(command) {
        if !path.is_file() {
            continue;
        }
        let version = detect_cli_version(&path, command).unwrap_or_else(|| "unknown".into());
        return Some((path, version));
    }
    None
}

fn bob_runtimes_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".bob")
        .join("runtimes")
}

fn collect_cli_binaries(parent: &Path, command: &str, paths: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return;
    };
    for version_dir in entries.flatten() {
        let base = version_dir.path();
        for candidate in [
            base.join("bin").join(command),
            base.join("venv").join("bin").join(command),
            base.join("google-cloud-sdk").join("bin").join(command),
        ] {
            if candidate.is_file() {
                paths.push(candidate);
            }
        }
        if let Some(found) = find_named_binary(&base, command) {
            paths.push(found);
        }
    }
}

fn manifest_for(entry: &CliCatalogEntry) -> AppResult<RuntimeManifest> {
    let (source, packages, python_mode, dependencies) = match entry.runtime_id {
        "external.ibmcloud-cli" => (
            RuntimeSource {
                kind: "trusted-cli-archive".into(),
                location: format!(
                    "https://download.clis.cloud.ibm.com/ibm-cloud-cli/{}/macOS_arm64.tar.gz",
                    entry.version
                ),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "ibmcloud".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("ibmcloud-tar".into()),
            }],
            PythonMode::None,
            vec![],
        ),
        "external.aws-cli" => (
            RuntimeSource {
                kind: "trusted-cli-archive".into(),
                location: "https://awscli.amazonaws.com/AWSCLIV2.zip".into(),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "awscli".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("aws-installer".into()),
            }],
            PythonMode::None,
            vec![],
        ),
        "external.azure-cli" => (
            RuntimeSource {
                kind: "trusted-python-index".into(),
                location: "https://pypi.org/simple".into(),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "azure-cli".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("PyPI".into()),
            }],
            PythonMode::Isolated,
            vec![RuntimeDependency {
                id: SHARED_PYTHON_ID.into(),
                version: Some(">=3.10".into()),
                optional: false,
            }],
        ),
        "external.gcloud-cli" => (
            RuntimeSource {
                kind: "trusted-cli-archive".into(),
                location: "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz".into(),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "google-cloud-cli".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("gcloud-tar".into()),
            }],
            PythonMode::None,
            vec![],
        ),
        "external.openshift-cli" => (
            RuntimeSource {
                kind: "trusted-cli-archive".into(),
                location: "https://mirror.openshift.com/pub/openshift-v4/arm64/clients/ocp/stable/openshift-client-mac-arm64.tar.gz".into(),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "openshift-client".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("oc-tar".into()),
            }],
            PythonMode::None,
            vec![],
        ),
        "external.terraform-cli" => (
            RuntimeSource {
                kind: "trusted-cli-archive".into(),
                location: format!(
                    "https://releases.hashicorp.com/terraform/{}/terraform_{}_darwin_arm64.zip",
                    entry.version, entry.version
                ),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "terraform".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("terraform-zip".into()),
            }],
            PythonMode::None,
            vec![],
        ),
        "external.ansible-cli" => (
            RuntimeSource {
                kind: "trusted-python-index".into(),
                location: "https://pypi.org/simple".into(),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "ansible".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("PyPI".into()),
            }],
            PythonMode::Isolated,
            vec![RuntimeDependency {
                id: SHARED_PYTHON_ID.into(),
                version: Some(">=3.10".into()),
                optional: false,
            }],
        ),
        "external.zowe-cli" => (
            RuntimeSource {
                kind: "trusted-npm-registry".into(),
                location: format!("@zowe/cli@{}", entry.version),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "@zowe/cli".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("npm".into()),
            }],
            PythonMode::None,
            vec![],
        ),
        "external.docling-cli" => (
            RuntimeSource {
                kind: "trusted-python-index".into(),
                location: "https://pypi.org/simple".into(),
                sha256: None,
            },
            vec![RuntimePackage {
                name: "docling".into(),
                version: entry.version.into(),
                import_name: Some(entry.command.into()),
                source: Some("PyPI".into()),
            }],
            PythonMode::Isolated,
            vec![RuntimeDependency {
                id: SHARED_PYTHON_ID.into(),
                version: Some(">=3.10".into()),
                optional: false,
            }],
        ),
        _ => {
            return Err(AppError::ValidationFailed(format!(
                "Unknown managed CLI runtime {}",
                entry.runtime_id
            )))
        }
    };

    Ok(RuntimeManifest {
        id: entry.runtime_id.into(),
        name: entry.name.into(),
        version: entry.version.into(),
        purpose: entry.purpose.into(),
        runtime_type: RuntimeClass::ExternalManaged,
        capabilities: vec![format!("cli.{}", entry.command)],
        platforms: vec![RuntimeManager::platform_id()],
        dependencies,
        python_mode: Some(python_mode),
        python_compatibility: if uses_isolated_python(entry.runtime_id) {
            Some(">=3.10".into())
        } else {
            None
        },
        packages,
        source: Some(source),
        estimated_size_bytes: Some(entry.estimated_size_bytes),
        removable: true,
    })
}

pub async fn install_managed_cli(
    manifest: &RuntimeManifest,
    shared_python: &Path,
    candidate: &Path,
) -> AppResult<PathBuf> {
    let source = manifest
        .source
        .as_ref()
        .ok_or_else(|| AppError::Security("Managed CLI source missing".into()))?;
    match source.kind.as_str() {
        "trusted-python-index" => install_pip_cli(manifest, shared_python, candidate).await,
        "trusted-npm-registry" => install_npm_cli(manifest, candidate).await,
        "trusted-cli-archive" => install_archive_cli(manifest, candidate).await,
        other => Err(AppError::ValidationFailed(format!(
            "Unsupported managed CLI source kind: {other}"
        ))),
    }
}

async fn install_pip_cli(
    manifest: &RuntimeManifest,
    _shared_python: &Path,
    candidate: &Path,
) -> AppResult<PathBuf> {
    let command = cli_command_name(manifest)?;
    let packages = manifest
        .packages
        .iter()
        .map(|package| pip_package_spec(manifest, package))
        .collect::<Vec<_>>();
    let environment = candidate.join("venv");
    let compatible = crate::services::runtime_manager::resolve_compatible_python(
        manifest.python_compatibility.as_deref(),
    )?;
    run_command(
        &compatible,
        &[
            "-m".into(),
            "venv".into(),
            environment.to_string_lossy().into_owned(),
        ],
        candidate,
    )
    .await?;
    let python = environment.join("bin").join("python3");
    let mut args = vec![
        "-m".into(),
        "pip".into(),
        "install".into(),
        "--disable-pip-version-check".into(),
        "--no-input".into(),
        "--index-url=https://pypi.org/simple".into(),
    ];
    args.extend(packages);
    run_command(&python, &args, candidate).await?;
    let installed = environment.join("bin").join(&command);
    if !installed.is_file() {
        return Err(AppError::ValidationFailed(format!(
            "Managed CLI `{command}` was not installed into the Bob Work environment"
        )));
    }
    let bin_dir = candidate.join("bin");
    std::fs::create_dir_all(&bin_dir)?;
    link_or_copy(&installed, &bin_dir.join(&command))?;
    Ok(bin_dir.join(&command))
}

async fn install_npm_cli(manifest: &RuntimeManifest, candidate: &Path) -> AppResult<PathBuf> {
    let command = cli_command_name(manifest)?;
    let package = manifest
        .source
        .as_ref()
        .map(|source| source.location.clone())
        .ok_or_else(|| AppError::Security("npm package spec missing".into()))?;
    let prefix = candidate.join("npm");
    std::fs::create_dir_all(&prefix)?;
    let npm = which::which("npm").map_err(|_| {
        AppError::NotFound(
            "Node.js/npm is required to install Zowe CLI automatically. Install Node.js first."
                .into(),
        )
    })?;
    run_command(
        &npm,
        &[
            "install".into(),
            "--prefix".into(),
            prefix.to_string_lossy().into_owned(),
            "--no-fund".into(),
            "--no-audit".into(),
            package,
        ],
        candidate,
    )
    .await?;
    let installed = prefix.join("bin").join(&command);
    if !installed.is_file() {
        return Err(AppError::ValidationFailed(format!(
            "Managed CLI `{command}` was not installed into the Bob Work environment"
        )));
    }
    let bin_dir = candidate.join("bin");
    std::fs::create_dir_all(&bin_dir)?;
    link_or_copy(&installed, &bin_dir.join(&command))?;
    Ok(bin_dir.join(&command))
}

async fn install_archive_cli(manifest: &RuntimeManifest, candidate: &Path) -> AppResult<PathBuf> {
    let command = cli_command_name(manifest)?;
    let source = manifest.source.as_ref().unwrap();
    validate_archive_source(source)?;
    let archive_path = candidate.join("download.archive");
    download_file(&source.location, &archive_path).await?;
    if let Some(expected) = source.sha256.as_deref() {
        verify_sha256(&archive_path, expected)?;
    }
    let layout = manifest
        .packages
        .first()
        .and_then(|package| package.source.as_deref())
        .unwrap_or("generic");
    match layout {
        "ibmcloud-tar" => extract_tar_gz(&archive_path, candidate)?,
        "aws-installer" => {
            extract_zip(&archive_path, candidate)?;
            let install_dir = candidate.join("install");
            let bin_dir = candidate.join("bin");
            std::fs::create_dir_all(&bin_dir)?;
            let installer = candidate.join("aws").join("install");
            run_command(
                &installer,
                &[
                    "-i".into(),
                    install_dir.to_string_lossy().into_owned(),
                    "-b".into(),
                    bin_dir.to_string_lossy().into_owned(),
                ],
                candidate,
            )
            .await?;
        }
        "gcloud-tar" => {
            extract_tar_gz(&archive_path, candidate)?;
            let sdk = candidate.join("google-cloud-sdk");
            if !sdk.is_dir() {
                return Err(AppError::ValidationFailed(
                    "Google Cloud SDK archive did not unpack as expected".into(),
                ));
            }
            run_command(
                &sdk.join("install.sh"),
                &[
                    "--quiet".into(),
                    "--usage-reporting=false".into(),
                    "--path-update=false".into(),
                    "--command-completion=false".into(),
                ],
                candidate,
            )
            .await?;
            let bin_dir = candidate.join("bin");
            std::fs::create_dir_all(&bin_dir)?;
            link_or_copy(
                &sdk.join("bin").join(&command),
                &bin_dir.join(&command),
            )?;
        }
        "oc-tar" | "terraform-zip" => {
            if layout == "terraform-zip" {
                extract_zip(&archive_path, candidate)?;
            } else {
                extract_tar_gz(&archive_path, candidate)?;
            }
            let bin_dir = candidate.join("bin");
            std::fs::create_dir_all(&bin_dir)?;
            let found = find_named_binary(candidate, &command).ok_or_else(|| {
                AppError::ValidationFailed(format!("Could not locate `{command}` in archive"))
            })?;
            link_or_copy(&found, &bin_dir.join(&command))?;
        }
        other => {
            return Err(AppError::ValidationFailed(format!(
                "Unsupported CLI archive layout: {other}"
            )))
        }
    }
    let bin_dir = candidate.join("bin");
    std::fs::create_dir_all(&bin_dir)?;
    if layout == "ibmcloud-tar" {
        let found = find_named_binary(candidate, &command).ok_or_else(|| {
            AppError::ValidationFailed("Could not locate ibmcloud in archive".into())
        })?;
        link_or_copy(&found, &bin_dir.join(&command))?;
    }
    let executable = bin_dir.join(&command);
    if !executable.is_file() {
        if let Some(found) = find_named_binary(candidate, &command) {
            link_or_copy(&found, &executable)?;
        }
    }
    if !executable.is_file() {
        return Err(AppError::ValidationFailed(format!(
            "Managed CLI `{command}` was not installed into the Bob Work environment"
        )));
    }
    Ok(executable)
}

fn pip_package_spec(manifest: &RuntimeManifest, package: &RuntimePackage) -> String {
    if manifest.id == "external.docling-cli"
        && cfg!(all(target_os = "macos", target_arch = "x86_64"))
    {
        return format!("{}[mac_intel]=={}", package.name, package.version);
    }
    format!("{}=={}", package.name, package.version)
}

fn cli_command_name(manifest: &RuntimeManifest) -> AppResult<String> {
    manifest
        .packages
        .first()
        .and_then(|package| package.import_name.clone())
        .ok_or_else(|| AppError::ValidationFailed("Managed CLI command missing".into()))
}

fn validate_archive_source(source: &RuntimeSource) -> AppResult<()> {
    let url = url::Url::parse(&source.location).map_err(|error| {
        AppError::Security(format!("Managed CLI archive URL is invalid: {error}"))
    })?;
    let host = url.host_str().unwrap_or_default();
    const ALLOWED: &[&str] = &[
        "download.clis.cloud.ibm.com",
        "awscli.amazonaws.com",
        "dl.google.com",
        "mirror.openshift.com",
        "releases.hashicorp.com",
    ];
    if !ALLOWED.contains(&host) {
        return Err(AppError::Security(format!(
            "Managed CLI archive host `{host}` is not approved"
        )));
    }
    Ok(())
}

async fn download_file(url: &str, destination: &Path) -> AppResult<()> {
    let response = reqwest::get(url).await.map_err(|error| {
        AppError::ValidationFailed(format!("Failed to download managed CLI archive: {error}"))
    })?;
    if !response.status().is_success() {
        return Err(AppError::ValidationFailed(format!(
            "Failed to download managed CLI archive ({})",
            response.status()
        )));
    }
    let bytes = response.bytes().await.map_err(|error| {
        AppError::ValidationFailed(format!("Failed to read managed CLI archive: {error}"))
    })?;
    let mut file = std::fs::File::create(destination)?;
    file.write_all(&bytes)?;
    Ok(())
}

fn verify_sha256(path: &Path, expected: &str) -> AppResult<()> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        return Err(AppError::Security(
            "Managed CLI archive checksum mismatch".into(),
        ));
    }
    Ok(())
}

fn extract_tar_gz(archive: &Path, destination: &Path) -> AppResult<()> {
    run_command_sync("tar", &["-xzf", &archive.to_string_lossy(), "-C", &destination.to_string_lossy()])
}

fn extract_zip(archive: &Path, destination: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| {
        AppError::ValidationFailed(format!("Could not read managed CLI zip: {error}"))
    })?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            AppError::ValidationFailed(format!("Could not read managed CLI zip entry: {error}"))
        })?;
        let Some(name) = entry.enclosed_name().map(|path| path.to_owned()) else {
            continue;
        };
        let target = destination.join(name);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut output = std::fs::File::create(&target)?;
        std::io::copy(&mut entry, &mut output)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if entry.unix_mode().unwrap_or(0) & 0o111 != 0 {
                let mut perms = output.metadata()?.permissions();
                perms.set_mode(entry.unix_mode().unwrap_or(0o755));
                std::fs::set_permissions(&target, perms)?;
            }
        }
    }
    Ok(())
}

fn link_or_copy(source: &Path, destination: &Path) -> AppResult<()> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if destination.exists() {
        std::fs::remove_file(destination).ok();
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, destination)?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        std::fs::copy(source, destination)?;
        Ok(())
    }
}

/// Prefer the version install directory for Bob-managed CLI binaries so resolve
/// can locate `bin/` or `venv/bin/`. System PATH binaries stay as the file path.
pub fn preferred_registry_install_path(binary: &Path) -> PathBuf {
    if !is_bob_managed_binary(binary) {
        return binary.to_path_buf();
    }
    let Some(parent) = binary.parent() else {
        return binary.to_path_buf();
    };
    if parent.file_name().and_then(|name| name.to_str()) != Some("bin") {
        return binary.to_path_buf();
    }
    let Some(grand) = parent.parent() else {
        return binary.to_path_buf();
    };
    if grand.file_name().and_then(|name| name.to_str()) == Some("venv") {
        return grand
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| grand.to_path_buf());
    }
    grand.to_path_buf()
}

pub fn find_named_binary_public(dir: &Path, command: &str) -> Option<PathBuf> {
    find_named_binary(dir, command)
}

/// Detects a CLI already installed on the Mac (Homebrew, vendor installer, etc.).
/// Bob-managed copies under `~/.bob/runtimes/external/` are ignored here.
pub fn discover_system_cli(command: &str) -> Option<(PathBuf, String)> {
    let binary = which::which(command).ok()?;
    if is_bob_managed_binary(&binary) {
        return None;
    }
    let version = detect_cli_version(&binary, command).unwrap_or_else(|| "unknown".into());
    Some((binary, version))
}

pub fn is_bob_managed_binary(path: &Path) -> bool {
    let value = path.to_string_lossy();
    value.contains("/.bob/runtimes/external/") || value.contains("/.bob/runtimes/docling/")
}

fn detect_cli_version(binary: &Path, command: &str) -> Option<String> {
    let args: &[&str] = if command == "ibmcloud" {
        &["version"]
    } else {
        &["--version"]
    };
    let output = std::process::Command::new(binary)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_cli_version_line(&stdout)
}

fn parse_cli_version_line(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(version) = trimmed
            .split_whitespace()
            .find(|token| token.chars().next().is_some_and(|ch| ch.is_ascii_digit()))
        {
            let version = version.trim_end_matches(|ch: char| !ch.is_ascii_digit() && ch != '.');
            if !version.is_empty() {
                return Some(version.to_string());
            }
        }
    }
    None
}

fn find_named_binary(dir: &Path, command: &str) -> Option<PathBuf> {
    let direct = dir.join(command);
    if direct.is_file() {
        return Some(direct);
    }
    let nested = dir.join("bin").join(command);
    if nested.is_file() {
        return Some(nested);
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_named_binary(&path, command) {
                return Some(found);
            }
        }
    }
    None
}

async fn run_command(executable: &Path, args: &[String], working_dir: &Path) -> AppResult<()> {
    let output = Command::new(executable)
        .args(args)
        .current_dir(working_dir)
        .output()
        .await?;
    if output.status.success() {
        return Ok(());
    }
    Err(AppError::ValidationFailed(format!(
        "Managed CLI install command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    )))
}

fn run_command_sync(executable: &str, args: &[&str]) -> AppResult<()> {
    let output = std::process::Command::new(executable)
        .args(args)
        .output()
        .map_err(AppError::from)?;
    if output.status.success() {
        return Ok(());
    }
    Err(AppError::ValidationFailed(format!(
        "Managed CLI archive extraction failed: {}",
        String::from_utf8_lossy(&output.stderr)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferred_registry_install_path_promotes_bob_managed_version_root() {
        let managed = PathBuf::from("/Users/me/.bob/runtimes/docling/2.123.0/bin/docling");
        assert_eq!(
            preferred_registry_install_path(&managed),
            PathBuf::from("/Users/me/.bob/runtimes/docling/2.123.0")
        );
        let venv = PathBuf::from(
            "/Users/me/.bob/runtimes/external/docling-cli/2.123.0/venv/bin/docling",
        );
        assert_eq!(
            preferred_registry_install_path(&venv),
            PathBuf::from("/Users/me/.bob/runtimes/external/docling-cli/2.123.0")
        );
        let system = PathBuf::from("/Users/me/Library/Python/3.9/bin/docling");
        assert_eq!(preferred_registry_install_path(&system), system);
    }

    #[test]
    fn parse_cli_version_line_extracts_semver() {
        assert_eq!(
            parse_cli_version_line("Google Cloud SDK 555.0.0\n"),
            Some("555.0.0".into())
        );
        assert_eq!(
            parse_cli_version_line("ibmcloud 2.33.1 (424a5a4-2025-04-08T17:48:33+00:00)\n"),
            Some("2.33.1".into())
        );
    }

    #[test]
    fn discover_system_cli_skips_bob_managed_binaries() {
        let bob_path = PathBuf::from("/Users/me/.bob/runtimes/external/gcloud-cli/531.0.0/bin/gcloud");
        assert!(is_bob_managed_binary(&bob_path));
        let docling_path =
            PathBuf::from("/Users/me/.bob/runtimes/docling/2.123.0/bin/docling");
        assert!(is_bob_managed_binary(&docling_path));
        let brew_path = PathBuf::from("/opt/homebrew/bin/gcloud");
        assert!(!is_bob_managed_binary(&brew_path));
    }

    #[test]
    fn catalog_includes_docling_as_isolated_pip_cli() {
        let entry = catalog_entries()
            .iter()
            .find(|item| item.runtime_id == "external.docling-cli")
            .expect("docling catalog entry");
        assert_eq!(entry.command, "docling");
        assert_eq!(entry.version, "2.123.0");
        assert!(uses_isolated_python(entry.runtime_id));
        let manifest = manifest_for(entry).expect("docling manifest");
        assert_eq!(
            manifest.python_mode,
            Some(crate::models::runtime::PythonMode::Isolated)
        );
        assert_eq!(
            manifest
                .source
                .as_ref()
                .map(|source| source.kind.as_str()),
            Some("trusted-python-index")
        );
    }

    #[test]
    fn discover_system_cli_finds_gcloud_when_present() {
        if which::which("gcloud").is_err() {
            return;
        }
        let (path, version) = discover_system_cli("gcloud").expect("gcloud");
        assert!(path.is_file());
        assert!(!version.is_empty());
    }
}
