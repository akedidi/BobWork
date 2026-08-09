use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
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
    pub content: Option<String>,
    pub entries: Vec<PreviewEntry>,
    pub quick_look: bool,
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
    if let Some(preview_path) = preview.preview_path.as_deref() {
        app.asset_protocol_scope()
            .allow_file(preview_path)
            .map_err(|error| AppError::Security(format!("Aperçu local refusé : {error}")))?;
    }
    Ok(preview)
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
            .map_err(|error| {
                AppError::Security(format!("Pièce jointe refusée : {error}"))
            })?;
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
            content: None,
            entries,
            quick_look: false,
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
    let mut quick_look = false;

    if matches!(kind, "text" | "markdown") {
        let file = std::fs::File::open(&path)?;
        let mut bytes = Vec::new();
        file.take(2 * 1024 * 1024).read_to_end(&mut bytes)?;
        let mut text = String::from_utf8_lossy(&bytes).to_string();
        if metadata.len() > 2 * 1024 * 1024 {
            text.push_str("\n\n… aperçu limité aux 2 premiers Mo …");
        }
        content = Some(text);
    } else if kind == "office" {
        std::fs::create_dir_all(&cache_dir)?;
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut hasher);
        metadata.len().hash(&mut hasher);
        modified_at.hash(&mut hasher);
        let output_dir = cache_dir.join(format!("{:x}", hasher.finish()));
        std::fs::create_dir_all(&output_dir)?;
        let expected = output_dir.join(format!("{}.png", name));
        if !expected.exists() {
            let _ = std::process::Command::new("/usr/bin/qlmanage")
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
            quick_look = true;
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
        content,
        entries: vec![],
        quick_look,
    })
}

fn first_png(directory: &Path) -> Option<PathBuf> {
    std::fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.extension().and_then(|value| value.to_str()) == Some("png"))
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
        "svg" => ("image", "image/svg+xml"),
        "heic" => ("image", "image/heic"),
        "pdf" => ("pdf", "application/pdf"),
        "mp4" | "mov" | "m4v" | "webm" => ("video", "video/mp4"),
        "mp3" | "m4a" | "wav" | "aac" | "ogg" => ("audio", "audio/mpeg"),
        "md" | "markdown" => ("markdown", "text/markdown"),
        "html" | "htm" => ("html", "text/html"),
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
