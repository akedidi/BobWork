//! Bundled document engines shared by all conversations and plugins.
use crate::error::{AppError, AppResult};
use crate::models::runtime::{PythonMode, RuntimeClass, RuntimeManifest, RuntimeSource};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const LATEX_ID: &str = "shared.latex";
pub const PANDOC_ID: &str = "shared.pandoc";
static MATERIALIZE_LOCK: Mutex<()> = Mutex::new(());

pub fn engine(id: &str) -> Option<(&'static str, &'static str)> {
    match id {
        LATEX_ID => Some(("tectonic", "0.17.0")),
        PANDOC_ID => Some(("pandoc", "3.11")),
        _ => None,
    }
}

fn bundle(id: &str) -> AppResult<&'static [u8]> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    match id {
        LATEX_ID => {
            return Ok(include_bytes!(
                "../../resources/shared-runtimes/documents/tectonic-darwin-arm64.zip"
            ))
        }
        PANDOC_ID => {
            return Ok(include_bytes!(
                "../../resources/shared-runtimes/documents/pandoc-darwin-arm64.zip"
            ))
        }
        _ => {}
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    match id {
        LATEX_ID => {
            return Ok(include_bytes!(
                "../../resources/shared-runtimes/documents/tectonic-darwin-x64.zip"
            ))
        }
        PANDOC_ID => {
            return Ok(include_bytes!(
                "../../resources/shared-runtimes/documents/pandoc-darwin-x64.zip"
            ))
        }
        _ => {}
    }
    Err(AppError::NotFound(format!(
        "Document runtime {id} is unavailable on this platform"
    )))
}

pub fn manifests() -> Vec<RuntimeManifest> {
    [LATEX_ID, PANDOC_ID]
        .into_iter()
        .map(|id| {
            let (binary, version) = engine(id).unwrap();
            RuntimeManifest {
                id: id.into(),
                name: if id == LATEX_ID {
                    "LaTeX · Tectonic"
                } else {
                    "Pandoc"
                }
                .into(),
                version: version.into(),
                purpose: if id == LATEX_ID {
                    "Compilation LaTeX en PDF, partagée entre conversations et plugins"
                } else {
                    "Conversion de documents Markdown, LaTeX, HTML, DOCX, EPUB et PDF"
                }
                .into(),
                runtime_type: RuntimeClass::Shared,
                capabilities: if id == LATEX_ID {
                    vec!["latex".into()]
                } else {
                    vec!["pandoc".into(), "document.convert".into()]
                },
                platforms: vec!["darwin-arm64".into(), "darwin-x64".into()],
                dependencies: vec![],
                python_mode: Some(PythonMode::None),
                python_compatibility: None,
                packages: vec![],
                source: Some(RuntimeSource {
                    kind: "bundled".into(),
                    location: format!("bob-work://shared-runtimes/{binary}"),
                    // Avoid hashing ~60MB of embedded zips on every seed/list.
                    // Digests are written to bundle.sha256 when materializing.
                    sha256: None,
                }),
                estimated_size_bytes: match id {
                    LATEX_ID => Some(20_000_000),
                    PANDOC_ID => Some(40_000_000),
                    _ => None,
                },
                removable: false,
            }
        })
        .collect()
}

pub fn materialize(root: &Path, id: &str) -> AppResult<PathBuf> {
    let _guard = MATERIALIZE_LOCK
        .lock()
        .map_err(|_| AppError::Io("Document runtime lock poisoned".into()))?;
    let (binary, version) = engine(id).ok_or_else(|| AppError::NotFound(id.into()))?;
    let parent = root.join("shared").join(id.trim_start_matches("shared."));
    let target = parent.join(version);
    let executable = target.join("bin").join(binary);
    // Fast path: trust an already-extracted install. Do not load/hash the
    // embedded zip on every launch — that alone costs seconds on cold start.
    if executable.is_file() && target.join("bundle.sha256").is_file() {
        return Ok(target);
    }
    let bytes = bundle(id)?;
    let digest = format!("{:x}", Sha256::digest(bytes));
    if executable.is_file()
        && std::fs::read_to_string(target.join("bundle.sha256"))
            .ok()
            .as_deref()
            == Some(digest.as_str())
    {
        return Ok(target);
    }
    std::fs::create_dir_all(&parent)?;
    let staging = tempfile::tempdir_in(&parent)?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| AppError::Io(e.to_string()))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::Io(e.to_string()))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| AppError::Security("Unsafe document bundle path".into()))?;
        let output = staging.path().join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(output)?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::io::copy(&mut entry, &mut std::fs::File::create(&output)?)?;
    }
    let staged_executable = staging.path().join("bin").join(binary);
    if !staged_executable.is_file() {
        return Err(AppError::Io("Document engine missing from bundle".into()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged_executable, std::fs::Permissions::from_mode(0o755))?;
    }
    let license = if id == LATEX_ID {
        include_str!("../../resources/shared-runtimes/documents/LICENSE-tectonic")
    } else {
        include_str!("../../resources/shared-runtimes/documents/COPYRIGHT-pandoc")
    };
    std::fs::write(staging.path().join("LICENSE"), license)?;
    std::fs::write(staging.path().join("bundle.sha256"), digest)?;
    std::fs::write(
        staging.path().join("runtime.json"),
        serde_json::to_vec(
            &serde_json::json!({"runtimeId":id,"version":version,"managedBy":"bob-work"}),
        )?,
    )?;
    if target.exists() {
        std::fs::remove_dir_all(&target)?;
    }
    std::fs::rename(staging.path(), &target)?;
    Ok(target)
}
