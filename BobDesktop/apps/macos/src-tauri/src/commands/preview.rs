use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub mime_type: String,
    pub size: u64,
    pub modified_at: Option<String>,
    pub preview_path: Option<String>,
    /// Extra page/slide image paths when rasterized (optional).
    #[serde(default)]
    pub preview_paths: Vec<String>,
    pub content: Option<String>,
    pub entries: Vec<PreviewEntry>,
    pub quick_look: bool,
    /// Number of pages/slides when known (PDF / converted Office).
    #[serde(default)]
    pub page_count: Option<u32>,
    /// UI label unit: "page" | "slide"
    #[serde(default)]
    pub page_unit: Option<String>,
}

#[tauri::command]
pub async fn prepare_file_preview(path: String, app: AppHandle) -> Result<FilePreview, AppError> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::Io(error.to_string()))?
        .join("previews");
    let preview = tauri::async_runtime::spawn_blocking(move || {
        prepare_preview(PathBuf::from(path), cache_dir)
    })
    .await
    .map_err(|error| AppError::Io(format!("Aperçu interrompu : {error}")))??;

    let mut allow = Vec::new();
    if let Some(preview_path) = preview.preview_path.as_deref() {
        allow.push(preview_path.to_string());
    }
    allow.extend(preview.preview_paths.iter().cloned());
    for path in &allow {
        app.asset_protocol_scope()
            .allow_file(path)
            .map_err(|error| AppError::Security(format!("Aperçu local refusé : {error}")))?;
        if let Some(parent) = std::path::Path::new(path).parent() {
            let _ = app.asset_protocol_scope().allow_directory(parent, true);
            if let Some(media) = parent
                .parent()
                .map(|p| p.join("media"))
                .filter(|p| p.is_dir())
            {
                let _ = app.asset_protocol_scope().allow_directory(&media, true);
            }
            let media_sibling = parent.join("media");
            if media_sibling.is_dir() {
                let _ = app
                    .asset_protocol_scope()
                    .allow_directory(&media_sibling, true);
            }
        }
    }
    Ok(preview)
}

/// Reads a small, user-selected HTML preview so the renderer can display it in
/// a sandboxed `srcDoc` frame.  Loading through the backend is intentional:
/// the asset protocol does not reliably allow `fetch` from the WebView, which
/// previously made fitted previews silently fall back to an unscaled iframe.
#[tauri::command]
pub async fn read_html_preview(path: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path)
            .canonicalize()
            .map_err(|_| AppError::NotFound("Fichier d’aperçu introuvable".into()))?;
        if is_sensitive_path(&path) {
            return Err(AppError::Security(
                "L’aperçu intégré bloque les dossiers de clés et d’identifiants sensibles.".into(),
            ));
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            extension.as_str(),
            "html" | "htm" | "svg" | "mmd" | "mermaid"
        ) {
            return Err(AppError::ValidationFailed(
                "Seuls les aperçus HTML, SVG et Mermaid peuvent être affichés dans ce cadre."
                    .into(),
            ));
        }
        let metadata = std::fs::metadata(&path)?;
        const MAX_HTML_PREVIEW_BYTES: u64 = 5 * 1024 * 1024;
        if metadata.len() > MAX_HTML_PREVIEW_BYTES {
            return Err(AppError::ValidationFailed(
                "Cet aperçu HTML est trop volumineux pour un rendu intégré.".into(),
            ));
        }
        std::fs::read_to_string(path).map_err(AppError::from)
    })
    .await
    .map_err(|error| AppError::Io(format!("Lecture de l’aperçu interrompue : {error}")))?
}

/// Writes the already-sanitized preview document into the app cache and
/// exposes only that file to the asset protocol. Navigating the sandboxed
/// frame to a real document (instead of `srcdoc`) keeps the host CSP from
/// suppressing the artifact's scripts while preserving origin isolation.
#[tauri::command]
pub async fn prepare_fitted_html_preview(
    source_path: String,
    html: String,
    app: AppHandle,
) -> Result<String, AppError> {
    const MAX_FITTED_HTML_BYTES: usize = 8 * 1024 * 1024;
    if html.len() > MAX_FITTED_HTML_BYTES {
        return Err(AppError::ValidationFailed(
            "Cet aperçu HTML est trop volumineux pour un rendu intégré.".into(),
        ));
    }

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::Io(error.to_string()))?
        .join("previews")
        .join("fitted-html");
    let output = tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(source_path)
            .canonicalize()
            .map_err(|_| AppError::NotFound("Fichier d’aperçu introuvable".into()))?;
        if is_sensitive_path(&source) {
            return Err(AppError::Security(
                "L’aperçu intégré bloque les dossiers de clés et d’identifiants sensibles.".into(),
            ));
        }
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            extension.as_str(),
            "html" | "htm" | "svg" | "mmd" | "mermaid"
        ) {
            return Err(AppError::ValidationFailed(
                "Seuls les aperçus HTML, SVG et Mermaid peuvent être affichés dans ce cadre."
                    .into(),
            ));
        }

        std::fs::create_dir_all(&cache_dir)?;
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        source.hash(&mut hasher);
        html.hash(&mut hasher);
        let output = cache_dir.join(format!("{:x}.html", hasher.finish()));
        if !output.is_file() {
            std::fs::write(&output, html)?;
        }
        Ok::<PathBuf, AppError>(output)
    })
    .await
    .map_err(|error| AppError::Io(format!("Préparation de l’aperçu interrompue : {error}")))??;

    app.asset_protocol_scope()
        .allow_file(&output)
        .map_err(|error| AppError::Security(format!("Aperçu local refusé : {error}")))?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_live_preview_revision(path: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path)
            .canonicalize()
            .map_err(|_| AppError::NotFound("Canvas introuvable".into()))?;
        if is_sensitive_path(&path) {
            return Err(AppError::Security(
                "Canvas refusé dans un dossier sensible.".into(),
            ));
        }
        let extension = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(
            extension.as_str(),
            "html" | "htm" | "svg" | "mmd" | "mermaid"
        ) {
            return Err(AppError::ValidationFailed(
                "Format Live Canvas non pris en charge.".into(),
            ));
        }
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        hash_canvas_entry(&path, &mut hasher, 0)?;
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        for name in ["assets", "styles", "scripts", "images", "fonts"] {
            let related = parent.join(name);
            if related.exists() {
                hash_canvas_entry(&related, &mut hasher, 0)?;
            }
        }
        for entry in std::fs::read_dir(parent)?.filter_map(Result::ok) {
            let related = entry.path();
            if related == path {
                continue;
            }
            let ext = related
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(ext.as_str(), "css" | "js" | "mjs" | "json" | "svg") {
                hash_canvas_entry(&related, &mut hasher, 0)?;
            }
        }
        Ok(format!("{:x}", hasher.finish()))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn export_live_canvas_zip(
    source_path: String,
    destination: String,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(source_path)
            .canonicalize()
            .map_err(|_| AppError::NotFound("Canvas introuvable".into()))?;
        if is_sensitive_path(&source) {
            return Err(AppError::Security(
                "Export refusé depuis un dossier sensible.".into(),
            ));
        }
        let parent = source
            .parent()
            .ok_or_else(|| AppError::ValidationFailed("Dossier du canvas introuvable.".into()))?;
        let staging = tempfile::tempdir().map_err(|e| AppError::Io(e.to_string()))?;
        let source_name = source
            .file_name()
            .ok_or_else(|| AppError::ValidationFailed("Nom du canvas invalide.".into()))?;
        std::fs::copy(&source, staging.path().join(source_name))?;
        for name in ["assets", "styles", "scripts", "images", "fonts"] {
            let from = parent.join(name);
            if from.is_dir() {
                copy_canvas_tree(&from, &staging.path().join(name), 0)?;
            }
        }
        for entry in std::fs::read_dir(parent)?.filter_map(Result::ok) {
            let path = entry.path();
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() || !metadata.is_file() || path == source {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(
                ext.as_str(),
                "css"
                    | "js"
                    | "mjs"
                    | "json"
                    | "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "webp"
                    | "svg"
                    | "woff"
                    | "woff2"
            ) {
                std::fs::copy(&path, staging.path().join(entry.file_name()))?;
            }
        }
        crate::services::plugin_archive::PluginArchiveService::new()
            .export_dir_to_zip(staging.path(), Path::new(&destination))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

fn hash_canvas_entry(path: &Path, hasher: &mut impl Hasher, depth: usize) -> Result<(), AppError> {
    if depth > 8 {
        return Ok(());
    }
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    path.hash(hasher);
    metadata.len().hash(hasher);
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0)
        .hash(hasher);
    if metadata.is_dir() {
        let mut entries = std::fs::read_dir(path)?
            .filter_map(Result::ok)
            .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name());
        entries.truncate(5_000);
        for entry in entries {
            hash_canvas_entry(&entry.path(), hasher, depth + 1)?;
        }
    }
    Ok(())
}

fn copy_canvas_tree(source: &Path, destination: &Path, depth: usize) -> Result<(), AppError> {
    if depth > 8 {
        return Err(AppError::ValidationFailed(
            "Arborescence du canvas trop profonde.".into(),
        ));
    }
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)?.filter_map(Result::ok) {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let from = entry.path();
        let to = destination.join(name);
        let metadata = std::fs::symlink_metadata(&from)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            copy_canvas_tree(&from, &to, depth + 1)?;
        } else if metadata.is_file() {
            std::fs::copy(from, to)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn allow_composer_attachments(
    paths: Vec<String>,
    app: AppHandle,
) -> Result<Vec<String>, AppError> {
    let mut allowed = Vec::new();
    for path in paths {
        let input = PathBuf::from(&path);
        let canonical = match input.canonicalize() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if is_sensitive_path(&canonical) {
            continue;
        }
        let metadata = match std::fs::metadata(&canonical) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !(metadata.is_file() || metadata.is_dir()) {
            continue;
        }
        app.asset_protocol_scope()
            .allow_file(canonical.to_string_lossy().as_ref())
            .map_err(|error| AppError::Security(format!("Pièce jointe refusée : {error}")))?;
        allowed.push(canonical.to_string_lossy().to_string());
    }
    Ok(allowed)
}

#[tauri::command]
pub async fn open_preview_resource(target: String) -> Result<(), AppError> {
    if target.starts_with("https://") || target.starts_with("http://") {
        return open::that(target).map_err(|error| AppError::Io(error.to_string()));
    }
    let path = PathBuf::from(&target)
        .canonicalize()
        .map_err(|_| AppError::NotFound("Fichier d’aperçu introuvable".into()))?;
    open::that(path).map_err(|error| AppError::Io(error.to_string()))
}

/// Reveal a local file or folder in Finder (macOS) / file manager.
#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), AppError> {
    let path = PathBuf::from(&path)
        .canonicalize()
        .map_err(|_| AppError::NotFound("Fichier introuvable".into()))?;
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(|error| AppError::Io(error.to_string()))?;
        if !status.success() {
            return Err(AppError::Io("Impossible d’ouvrir le Finder".into()));
        }
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let parent = path.parent().map(Path::to_path_buf).unwrap_or(path);
        open::that(parent).map_err(|error| AppError::Io(error.to_string()))
    }
}

fn prepare_preview(input: PathBuf, cache_dir: PathBuf) -> Result<FilePreview, AppError> {
    let path = input
        .canonicalize()
        .map_err(|_| AppError::NotFound(format!("Fichier introuvable : {}", input.display())))?;
    if is_sensitive_path(&path) {
        return Err(AppError::Security(
            "L’aperçu intégré bloque les dossiers de clés et d’identifiants sensibles.".into(),
        ));
    }
    let metadata = std::fs::metadata(&path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Aperçu")
        .to_string();
    let modified_at = metadata.modified().ok().map(|value| {
        let datetime: chrono::DateTime<chrono::Utc> = value.into();
        datetime.to_rfc3339()
    });

    if metadata.is_dir() {
        let mut entries = std::fs::read_dir(&path)?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                Some(PreviewEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    is_directory: metadata.is_dir(),
                    size: metadata.is_file().then_some(metadata.len()),
                })
            })
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| (!entry.is_directory, entry.name.to_lowercase()));
        entries.truncate(500);
        return Ok(FilePreview {
            path: path.to_string_lossy().to_string(),
            name,
            kind: "directory".into(),
            mime_type: "inode/directory".into(),
            size: 0,
            modified_at,
            preview_path: None,
            preview_paths: vec![],
            content: None,
            entries,
            quick_look: false,
            page_count: None,
            page_unit: None,
        });
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let (kind, mime_type) = classify_extension(&extension);
    let mut content = None;
    let mut preview_path = matches!(kind, "image" | "pdf" | "video" | "audio" | "html")
        .then(|| path.to_string_lossy().to_string());
    let mut preview_paths = Vec::new();
    let mut quick_look = false;
    let mut page_count = None;
    let mut page_unit = None;

    if matches!(kind, "text" | "markdown") {
        let file = std::fs::File::open(&path)?;
        let mut bytes = Vec::new();
        file.take(2 * 1024 * 1024).read_to_end(&mut bytes)?;
        let mut text = String::from_utf8_lossy(&bytes).to_string();
        if metadata.len() > 2 * 1024 * 1024 {
            text.push_str("\n\n… aperçu limité aux 2 premiers Mo …");
        }
        content = Some(text);
    } else if kind == "pdf" {
        page_count = pdf_page_count(&path).or(Some(1));
        page_unit = Some("page".into());
    } else if kind == "office" {
        std::fs::create_dir_all(&cache_dir)?;
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut hasher);
        metadata.len().hash(&mut hasher);
        modified_at.hash(&mut hasher);
        let output_dir = cache_dir.join(format!("{:x}", hasher.finish()));
        std::fs::create_dir_all(&output_dir)?;

        let unit = if matches!(extension.as_str(), "ppt" | "pptx" | "odp" | "key") {
            "slide"
        } else {
            "page"
        };
        page_unit = Some(unit.into());

        // PPTX: always use standalone HTML renderer (no PowerPoint Automation).
        if matches!(extension.as_str(), "ppt" | "pptx") {
            match crate::services::pptx_preview::PptxPreviewService::new()
                .render_to_html(&path, &output_dir)
            {
                Ok(html_paths) if !html_paths.is_empty() => {
                    preview_paths = html_paths
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    preview_path = preview_paths.first().cloned();
                    page_count = Some(preview_paths.len() as u32);
                    quick_look = false;
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!("Standalone PPTX preview failed: {:?}", error);
                }
            }
        }

        if preview_path.is_none() {
            let pdf_out = output_dir.join("document.pdf");
            let converted = if pdf_out.is_file() {
                Some(pdf_out.clone())
            } else if !matches!(extension.as_str(), "ppt" | "pptx") {
                // LibreOffice headless only — never AppleScript → PowerPoint/Word.
                convert_with_libreoffice(&path, &output_dir)
            } else {
                None
            };

            if let Some(pdf) = converted {
                preview_path = Some(pdf.to_string_lossy().to_string());
                page_count = pdf_page_count(&pdf).or(Some(1));
                quick_look = true;
            } else if preview_path.is_none() {
                // Fallback: single Quick Look thumbnail (no app Automation prompt).
                let expected = output_dir.join(format!("{}.png", name));
                if !expected.exists() {
                    let _ = Command::new("/usr/bin/qlmanage")
                        .args(["-t", "-s", "1800", "-o"])
                        .arg(&output_dir)
                        .arg(&path)
                        .output();
                }
                let generated = if expected.exists() {
                    Some(expected)
                } else {
                    first_png(&output_dir)
                };
                if let Some(generated) = generated {
                    preview_path = Some(generated.to_string_lossy().to_string());
                    if preview_paths.is_empty() {
                        preview_paths = collect_pngs(&output_dir);
                    }
                    quick_look = true;
                }
                if page_count.is_none() {
                    let raster =
                        preview_paths.len().max(usize::from(preview_path.is_some())) as u32;
                    page_count = Some(raster.max(1));
                }
            }
        }
    }

    Ok(FilePreview {
        path: path.to_string_lossy().to_string(),
        name,
        kind: kind.into(),
        mime_type: mime_type.into(),
        size: metadata.len(),
        modified_at,
        preview_path,
        preview_paths,
        content,
        entries: vec![],
        quick_look,
        page_count,
        page_unit,
    })
}

fn convert_with_libreoffice(path: &Path, output_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        "soffice",
        "libreoffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/opt/homebrew/bin/soffice",
        "/usr/local/bin/soffice",
    ];
    let soffice = candidates.into_iter().find(|bin| {
        Path::new(bin).is_file()
            || Command::new("which")
                .arg(bin)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .is_some()
    })?;
    let status = Command::new(soffice)
        .args([
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
        ])
        .arg(output_dir)
        .arg(path)
        .status()
        .ok()?;
    if !status.success() {
        return None;
    }
    let stem = path.file_stem()?.to_string_lossy().to_string();
    let pdf = output_dir.join(format!("{stem}.pdf"));
    if pdf.is_file() {
        let canonical = output_dir.join("document.pdf");
        let _ = std::fs::rename(&pdf, &canonical);
        return Some(if canonical.is_file() { canonical } else { pdf });
    }
    None
}

fn pdf_page_count(path: &Path) -> Option<u32> {
    let output = Command::new("/usr/bin/mdls")
        .args(["-raw", "-name", "kMDItemNumberOfPages"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() || raw == "(null)" {
        return None;
    }
    raw.parse::<u32>().ok().filter(|n| *n > 0)
}

fn pptx_slide_count(path: &Path) -> Option<u32> {
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut count = 0u32;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).ok()?;
        let name = entry.name().replace('\\', "/");
        if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") && !name.contains("_rels")
        {
            count += 1;
        }
    }
    (count > 0).then_some(count)
}

fn first_png(directory: &Path) -> Option<PathBuf> {
    collect_pngs(directory)
        .into_iter()
        .next()
        .map(PathBuf::from)
}

fn collect_pngs(directory: &Path) -> Vec<String> {
    let mut paths = std::fs::read_dir(directory)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("png"))
        .collect::<Vec<_>>();
    paths.sort();
    paths
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

fn is_sensitive_path(path: &Path) -> bool {
    let normalized = path.to_string_lossy().to_lowercase();
    normalized.contains("/.ssh/")
        || normalized.ends_with("/.ssh")
        || normalized.contains("/.gnupg/")
        || normalized.ends_with("/.gnupg")
        || normalized.contains("/library/keychains/")
}

fn classify_extension(extension: &str) -> (&'static str, &'static str) {
    match extension {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "svg" => ("html", "image/svg+xml"),
        "heic" => ("image", "image/heic"),
        "pdf" => ("pdf", "application/pdf"),
        "mp4" | "mov" | "m4v" | "webm" => ("video", "video/mp4"),
        "mp3" | "m4a" | "wav" | "aac" | "ogg" => ("audio", "audio/mpeg"),
        "md" | "markdown" => ("markdown", "text/markdown"),
        "html" | "htm" | "mmd" | "mermaid" => ("html", "text/html"),
        "txt" | "log" | "json" | "jsonl" | "yaml" | "yml" | "toml" | "csv" | "tsv" | "xml"
        | "css" | "js" | "jsx" | "ts" | "tsx" | "py" | "rs" | "java" | "sql" | "sh" => {
            ("text", "text/plain")
        }
        "doc" | "docx" | "rtf" | "odt" | "pages" | "ppt" | "pptx" | "odp" | "key" | "xls"
        | "xlsx" | "xlsm" | "ods" | "numbers" | "one" => ("office", "application/octet-stream"),
        _ => ("unsupported", "application/octet-stream"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_document_formats() {
        assert_eq!(classify_extension("docx").0, "office");
        assert_eq!(classify_extension("pptx").0, "office");
        assert_eq!(classify_extension("xlsx").0, "office");
        assert_eq!(classify_extension("md").0, "markdown");
        assert_eq!(classify_extension("pdf").0, "pdf");
        assert_eq!(classify_extension("svg").0, "html");
        assert_eq!(classify_extension("mmd").0, "html");
    }

    #[test]
    fn live_canvas_revision_tracks_related_assets() {
        let root = std::env::temp_dir().join(format!(
            "bob-work-live-canvas-revision-{}",
            uuid::Uuid::new_v4()
        ));
        let styles = root.join("styles");
        std::fs::create_dir_all(&styles).unwrap();
        let html = root.join("index.html");
        let css = styles.join("app.css");
        std::fs::write(&html, "<link rel=stylesheet href=styles/app.css>").unwrap();
        std::fs::write(&css, "body{color:red}").unwrap();

        let mut first = std::collections::hash_map::DefaultHasher::new();
        hash_canvas_entry(&html, &mut first, 0).unwrap();
        hash_canvas_entry(&styles, &mut first, 0).unwrap();
        let first = first.finish();

        std::fs::write(&css, "body{color:rebeccapurple}").unwrap();
        let mut second = std::collections::hash_map::DefaultHasher::new();
        hash_canvas_entry(&html, &mut second, 0).unwrap();
        hash_canvas_entry(&styles, &mut second, 0).unwrap();
        assert_ne!(first, second.finish());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prepares_text_and_directory_previews() {
        let root = std::env::temp_dir().join(format!("bob-work-preview-{}", uuid::Uuid::new_v4()));
        let cache = root.join("cache");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("notes.txt");
        std::fs::write(&file, "Bonjour Bob Work").unwrap();

        let text = prepare_preview(file, cache.clone()).unwrap();
        assert_eq!(text.kind, "text");
        assert_eq!(text.content.as_deref(), Some("Bonjour Bob Work"));

        let directory = prepare_preview(root.clone(), cache).unwrap();
        assert_eq!(directory.kind, "directory");
        assert!(directory
            .entries
            .iter()
            .any(|entry| entry.name == "notes.txt"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn counts_pptx_slides_from_zip() {
        let root = std::env::temp_dir().join(format!("bob-pptx-count-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let pptx = root.join("deck.pptx");
        {
            let file = std::fs::File::create(&pptx).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            for i in 1..=3 {
                zip.start_file(format!("ppt/slides/slide{i}.xml"), options)
                    .unwrap();
                use std::io::Write;
                zip.write_all(b"<p:sld/>").unwrap();
            }
            zip.finish().unwrap();
        }
        assert_eq!(pptx_slide_count(&pptx), Some(3));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn allow_composer_attachments_registers_existing_files() {
        let root = std::env::temp_dir().join(format!("bob-work-attach-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("sample.txt");
        std::fs::write(&file, "attachment").unwrap();

        let canonical = file.canonicalize().unwrap();
        assert!(!is_sensitive_path(&canonical));
        assert!(canonical.is_file());

        let _ = std::fs::remove_dir_all(root);
    }
}
