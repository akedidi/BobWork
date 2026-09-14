//! Shared Python libraries for local Office file formats (DOCX, PPTX, XLSX).
use crate::error::{AppError, AppResult};
use crate::models::runtime::{
    PythonMode, RuntimeClass, RuntimeManifest, RuntimePackage, RuntimeSource,
};
use chrono::Utc;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

static MATERIALIZE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy)]
struct OfficeRuntimeSpec {
    id: &'static str,
    name: &'static str,
    package_name: &'static str,
    package_version: &'static str,
    import_module: &'static str,
    capability: &'static str,
    extension: &'static str,
}

const RUNTIMES: &[OfficeRuntimeSpec] = &[
    OfficeRuntimeSpec {
        id: "shared.docx",
        name: "Word · python-docx",
        package_name: "python-docx",
        package_version: "1.1.2",
        import_module: "docx",
        capability: "docx",
        extension: ".docx",
    },
    OfficeRuntimeSpec {
        id: "shared.pptx",
        name: "PowerPoint · python-pptx",
        package_name: "python-pptx",
        package_version: "1.0.2",
        import_module: "pptx",
        capability: "pptx",
        extension: ".pptx",
    },
    OfficeRuntimeSpec {
        id: "shared.xlsx",
        name: "Excel · openpyxl",
        package_name: "openpyxl",
        package_version: "3.1.5",
        import_module: "openpyxl",
        capability: "xlsx",
        extension: ".xlsx",
    },
];

pub fn is_office_runtime(id: &str) -> bool {
    RUNTIMES.iter().any(|spec| spec.id == id)
}

pub fn office_capabilities() -> [&'static str; 3] {
    ["docx", "pptx", "xlsx"]
}

fn engine(id: &str) -> Option<&'static OfficeRuntimeSpec> {
    RUNTIMES.iter().find(|spec| spec.id == id)
}

pub fn capability_for_slug(slug: &str) -> Option<&'static str> {
    match slug {
        "bob-work-microsoft-word" => Some("docx"),
        "bob-work-microsoft-powerpoint" => Some("pptx"),
        "bob-work-microsoft-excel" => Some("xlsx"),
        "bob-work-documents" => Some("docx"),
        _ => None,
    }
}

pub fn capability_for_extension(extension: &str) -> Option<&'static str> {
    match extension.trim_start_matches('.').trim().to_ascii_lowercase().as_str() {
        "doc" | "docx" => Some("docx"),
        "ppt" | "pptx" => Some("pptx"),
        "xls" | "xlsx" | "xlsm" | "csv" | "tsv" => Some("xlsx"),
        _ => None,
    }
}

pub fn capabilities_for_paths(paths: &[String]) -> Vec<&'static str> {
    let mut capabilities = Vec::new();
    for path in paths {
        let Some(extension) = Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
        else {
            continue;
        };
        let Some(capability) = capability_for_extension(extension) else {
            continue;
        };
        push_capability(&mut capabilities, capability);
    }
    capabilities
}

fn push_capability(capabilities: &mut Vec<&'static str>, capability: &'static str) {
    if !capabilities.iter().any(|item| *item == capability) {
        capabilities.push(capability);
    }
}

fn message_contains_any(normalized: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| normalized.contains(term))
}

/// Infer Office capabilities (docx/pptx/xlsx) from the user message and mode.
pub fn capabilities_for_message(message: &str, mode: &str) -> Vec<&'static str> {
    let normalized = message.to_ascii_lowercase();
    let mut capabilities = Vec::new();

    match mode {
        "presentation" => push_capability(&mut capabilities, "pptx"),
        "spreadsheet" => push_capability(&mut capabilities, "xlsx"),
        "document" => push_capability(&mut capabilities, "docx"),
        _ => {}
    }

    if message_contains_any(
        &normalized,
        &[
            "docx",
            ".doc",
            "microsoft word",
            " ms word",
            " word document",
            "fichier word",
            "document word",
            "traitement de texte",
            "openxml word",
        ],
    ) {
        push_capability(&mut capabilities, "docx");
    }

    if message_contains_any(
        &normalized,
        &[
            "pptx",
            ".ppt",
            "powerpoint",
            "présentation",
            "presentation",
            "slides",
            " slide",
            "diapositive",
            "diapositives",
            "slide deck",
            "deck ppt",
        ],
    ) {
        push_capability(&mut capabilities, "pptx");
    }

    if message_contains_any(
        &normalized,
        &[
            "xlsx",
            ".xls",
            "excel",
            "spreadsheet",
            "tableur",
            "feuille de calcul",
            "workbook",
            "classeur",
            "csv",
            "tsv",
        ],
    ) {
        push_capability(&mut capabilities, "xlsx");
    }

    capabilities
}

/// Merge attachment extensions, message intent, and business mode hints.
pub fn capabilities_for_prompt(message: &str, mode: &str, paths: &[String]) -> Vec<&'static str> {
    let mut capabilities = capabilities_for_paths(paths);
    for capability in capabilities_for_message(message, mode) {
        push_capability(&mut capabilities, capability);
    }
    capabilities
}

pub fn plugin_id_for_capability(capability: &str) -> Option<&'static str> {
    match capability {
        "docx" => Some("builtin-word"),
        "pptx" => Some("builtin-powerpoint"),
        "xlsx" => Some("builtin-excel"),
        _ => None,
    }
}

pub fn runtime_label(capability: &str) -> Option<&'static str> {
    engine(match capability {
        "docx" => "shared.docx",
        "pptx" => "shared.pptx",
        "xlsx" => "shared.xlsx",
        _ => return None,
    })
    .map(|spec| spec.name)
}

/// True when the user explicitly asks for a non-default Office toolchain.
pub fn user_requests_alternative_office_tool(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    [
        "docling",
        "pandoc",
        "libreoffice",
        "unoconv",
        "soffice",
        "onlyoffice",
        "aspose",
        "mammoth",
        "textract",
        "antiword",
        "xlwings",
        "applescript",
        "microsoft office",
        "via office app",
        "ooxml seul",
        "zipfile seul",
        "sans python-docx",
        "sans openpyxl",
        "sans python-pptx",
        "without python-docx",
        "without openpyxl",
        "without python-pptx",
        "use docling",
        "avec docling",
        "use pandoc",
        "avec pandoc",
    ]
    .iter()
    .any(|term| normalized.contains(term))
}

pub fn default_runtime_policy_block(
    capabilities: &[&str],
    alternative_requested: bool,
) -> String {
    if capabilities.is_empty() {
        return String::new();
    }
    if alternative_requested {
        return "Outillage Office : l'utilisateur a explicitement demandé un outil alternatif dans son message — respecte ce choix et n'impose pas les runtimes partagés par défaut.".into();
    }
    let engines = capabilities
        .iter()
        .filter_map(|capability| runtime_label(capability))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Runtimes Office par défaut Bob Work (obligatoire sauf demande contraire explicite dans le prompt) :\n\
         - Utilise les runtimes Python partagés de la plateforme : {engines}.\n\
         - DOCX → runtime `shared.docx` (python-docx) ; PPTX → `shared.pptx` (python-pptx) ; XLSX/CSV → `shared.xlsx` (openpyxl).\n\
         - Workflow : outils MCP office-tools (`inspect_*`, `extract_*`, `read_*`, `validate_*`) puis `execute_command` Python avec le PYTHONPATH injecté par Bob Work.\n\
         - Ne fais jamais `pip install python-docx`, `pip install python-pptx` ni `pip install openpyxl` dans le workspace.\n\
         - N'utilise pas Docling, Pandoc, LibreOffice, unoconv ou une manipulation OOXML brute sauf si l'utilisateur le demande explicitement."
    )
}

pub fn manifests() -> Vec<RuntimeManifest> {
    RUNTIMES
        .iter()
        .map(|spec| RuntimeManifest {
            id: spec.id.into(),
            name: spec.name.into(),
            version: spec.package_version.into(),
            purpose: format!(
                "Bibliothèque Python partagée pour les fichiers {} ({})",
                spec.extension, spec.package_name
            ),
            runtime_type: RuntimeClass::Shared,
            capabilities: vec![spec.capability.into()],
            platforms: vec!["darwin-arm64".into(), "darwin-x64".into()],
            dependencies: vec![],
            python_mode: Some(PythonMode::Shared),
            python_compatibility: Some(">=3.9".into()),
            packages: vec![RuntimePackage {
                name: spec.package_name.into(),
                version: spec.package_version.into(),
                import_name: Some(spec.import_module.into()),
                source: Some("PyPI".into()),
            }],
            source: Some(RuntimeSource {
                kind: "trusted-python-index".into(),
                location: "https://pypi.org/simple".into(),
                sha256: None,
            }),
            estimated_size_bytes: Some(12 * 1024 * 1024),
            removable: false,
        })
        .collect()
}

pub fn pythonpath_for(root: &Path) -> PathBuf {
    root.join("python")
}

pub fn materialize(runtime_root: &Path, id: &str, host_python: &Path) -> AppResult<PathBuf> {
    let spec = engine(id).ok_or_else(|| AppError::NotFound(format!("Runtime {id}")))?;
    let _guard = MATERIALIZE_LOCK
        .lock()
        .map_err(|_| AppError::Io("Office runtime lock poisoned".into()))?;
    let target = runtime_root
        .join("shared")
        .join(id.trim_start_matches("shared."))
        .join(spec.package_version);
    let marker = target.join("runtime.json");
    let package_root = pythonpath_for(&target);
    if marker.is_file() && package_root.is_dir() {
        if validate_package(host_python, spec, &package_root).is_ok() {
            return Ok(target);
        }
        tracing::warn!(
            "Office runtime {} is incompatible with {} — reinstalling",
            spec.id,
            host_python.display()
        );
        std::fs::remove_dir_all(&target)?;
    }
    let parent = target
        .parent()
        .ok_or_else(|| AppError::Io("Invalid office runtime path".into()))?;
    std::fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".candidate-{}", uuid::Uuid::new_v4()));
    if staging.exists() {
        std::fs::remove_dir_all(&staging)?;
    }
    std::fs::create_dir_all(staging.join("python"))?;
    install_package(host_python, spec, &staging.join("python"))?;
    validate_package(host_python, spec, &staging.join("python"))?;
    std::fs::write(
        staging.join("runtime.json"),
        serde_json::to_vec_pretty(&json!({
            "runtimeId": spec.id,
            "version": spec.package_version,
            "managedBy": "bob-work",
            "package": spec.package_name,
            "pythonMode": "shared",
            "packageRoot": staging.join("python"),
            "hostPython": host_python.to_string_lossy(),
            "installedAt": Utc::now().to_rfc3339(),
        }))?,
    )?;
    if target.exists() {
        std::fs::remove_dir_all(&target)?;
    }
    std::fs::rename(&staging, &target)?;
    Ok(target)
}

fn install_package(host_python: &Path, spec: &OfficeRuntimeSpec, package_root: &Path) -> AppResult<()> {
    std::fs::create_dir_all(package_root)?;
    let output = Command::new(host_python)
        .args([
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
            "--index-url=https://pypi.org/simple",
            &format!("--target={}", package_root.display()),
            &format!("{}=={}", spec.package_name, spec.package_version),
        ])
        .output()
        .map_err(|error| AppError::Io(format!("pip install failed: {error}")))?;
    if !output.status.success() {
        return Err(AppError::ValidationFailed(format!(
            "Could not install {}: {}",
            spec.package_name,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

fn validate_package(host_python: &Path, spec: &OfficeRuntimeSpec, package_root: &Path) -> AppResult<()> {
    let script = format!(
        "import sys; sys.path.insert(0, {path}); import {module}",
        path = serde_json::to_string(&package_root.to_string_lossy())?,
        module = spec.import_module
    );
    let output = Command::new(host_python)
        .args(["-s", "-c", &script])
        .env("PYTHONPATH", package_root)
        .output()
        .map_err(|error| AppError::Io(format!("Office runtime validation failed: {error}")))?;
    if !output.status.success() {
        return Err(AppError::ValidationFailed(format!(
            "Office runtime {} is invalid: {}",
            spec.package_name,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_office_plugin_slugs_to_capabilities() {
        assert_eq!(
            capability_for_slug("bob-work-microsoft-word"),
            Some("docx")
        );
        assert_eq!(
            capability_for_slug("bob-work-microsoft-powerpoint"),
            Some("pptx")
        );
        assert_eq!(
            capability_for_slug("bob-work-microsoft-excel"),
            Some("xlsx")
        );
    }

    #[test]
    fn seeds_three_shared_office_manifests() {
        let manifests = manifests();
        assert_eq!(manifests.len(), 3);
        assert!(manifests.iter().any(|item| item.id == "shared.docx"));
        assert!(manifests.iter().any(|item| item.id == "shared.pptx"));
        assert!(manifests.iter().any(|item| item.id == "shared.xlsx"));
    }

    #[test]
    fn maps_attachment_extensions_to_capabilities() {
        assert_eq!(
            capabilities_for_paths(&[
                "/tmp/report.docx".into(),
                "/tmp/deck.pptx".into(),
                "/tmp/data.xlsx".into(),
            ]),
            vec!["docx", "pptx", "xlsx"]
        );
    }

    #[test]
    fn detects_alternative_office_tool_requests() {
        assert!(!user_requests_alternative_office_tool(
            "Modifie ce DOCX et ajoute une section"
        ));
        assert!(user_requests_alternative_office_tool(
            "Convertis ce DOCX avec Docling en markdown"
        ));
        assert!(user_requests_alternative_office_tool(
            "Use pandoc to transform this docx"
        ));
    }

    #[test]
    fn default_policy_mentions_shared_runtimes() {
        let block = default_runtime_policy_block(&["docx", "pptx"], false);
        assert!(block.contains("shared.docx"));
        assert!(block.contains("shared.pptx"));
        assert!(block.contains("python-docx"));
        assert!(block.contains("python-pptx"));
    }

    #[test]
    fn detects_office_intent_from_message_without_attachments() {
        assert_eq!(
            capabilities_for_message("Crée une présentation PowerPoint sur l’IA", "agent"),
            vec!["pptx"]
        );
        assert_eq!(
            capabilities_for_message("Mets à jour ce classeur Excel", "agent"),
            vec!["xlsx"]
        );
        assert_eq!(
            capabilities_for_message("Rédige un document Word structuré", "agent"),
            vec!["docx"]
        );
    }

    #[test]
    fn merges_attachment_and_message_office_capabilities() {
        assert_eq!(
            capabilities_for_prompt(
                "Ajoute un slide récap",
                "agent",
                &["/tmp/report.docx".into()],
            ),
            vec!["docx", "pptx"]
        );
        assert_eq!(
            capabilities_for_prompt("Mode tableur", "spreadsheet", &[]),
            vec!["xlsx"]
        );
    }
}
