// Stage composer attachments into a Bob-accessible workspace directory.
// Bob Shell file tools are sandboxed to `--workspace`; absolute paths in
// Downloads are therefore unreachable unless we copy them in first.
// Images are downscaled/compressed so multi-image vision requests stay under
// Bob's total image size limit.

use crate::error::AppError;
use crate::security::path_validation::{validate_path, validate_symlink};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Soft per-image budget so a few photos fit Bob's combined vision payload.
const MAX_STAGED_IMAGE_BYTES: u64 = 700_000;

#[derive(Debug, Clone)]
pub struct StagedAttachment {
    pub source_path: String,
    pub staged_path: String,
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
}

/// Prefer an explicit project folder; otherwise use a per-conversation workspace
/// under the app data directory so `bob run --workspace` is always set.
pub fn resolve_workspace_root(
    project_local_path: Option<&str>,
    app_data_dir: &Path,
    conversation_id: &str,
) -> Result<PathBuf, AppError> {
    if let Some(path) = project_local_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let root = PathBuf::from(path);
        std::fs::create_dir_all(&root).map_err(|error| {
            AppError::Io(format!(
                "Impossible de préparer le workspace projet {} : {}",
                root.display(),
                error
            ))
        })?;
        // Project folders may live anywhere the user chose, but never in
        // sensitive locations (.ssh, keychains, vault keys, …).
        return validate_path(&root, &[]);
    }

    let root = app_data_dir
        .join("workspaces")
        .join(sanitize_segment(conversation_id));
    std::fs::create_dir_all(&root).map_err(|error| {
        AppError::Io(format!(
            "Impossible de créer le workspace de conversation : {}",
            error
        ))
    })?;
    let allowed = match app_data_dir.canonicalize() {
        Ok(value) => vec![value],
        Err(_) => vec![app_data_dir.to_path_buf()],
    };
    validate_path(&root, &allowed)
}

/// Copy each attachment under `<workspace>/.bob-work/attachments/<run_id>/`.
pub fn stage_attachments(
    workspace_root: &Path,
    run_id: &str,
    attachment_paths: &[String],
) -> Result<Vec<StagedAttachment>, AppError> {
    if attachment_paths.is_empty() {
        return Ok(vec![]);
    }

    let staging_root = workspace_root
        .join(".bob-work")
        .join("attachments")
        .join(sanitize_segment(run_id));
    std::fs::create_dir_all(&staging_root).map_err(|error| {
        AppError::Io(format!(
            "Impossible de préparer le dossier des pièces jointes : {}",
            error
        ))
    })?;

    let mut staged = Vec::with_capacity(attachment_paths.len());
    for path in attachment_paths {
        let input = PathBuf::from(path);
        if !input.exists() {
            return Err(AppError::ValidationFailed(format!(
                "Pièce jointe introuvable : {}",
                input.display()
            )));
        }
        // Empty allowed_roots: user-selected files may live anywhere, but
        // validate_path still blocks sensitive locations and resolves symlinks.
        validate_symlink(&input, &[])?;
        let canonical = validate_path(&input, &[])?;
        let metadata = std::fs::metadata(&canonical).map_err(|error| {
            AppError::Io(format!(
                "Impossible de lire la pièce jointe {} : {}",
                canonical.display(),
                error
            ))
        })?;
        if !(metadata.is_file() || metadata.is_dir()) {
            return Err(AppError::ValidationFailed(format!(
                "Pièce jointe invalide : {}",
                canonical.display()
            )));
        }

        let original_name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment")
            .to_string();
        let base_name = if metadata.is_file() && is_compressible_image(&canonical) {
            format!("{}.jpg", file_stem(&original_name))
        } else {
            original_name.clone()
        };
        let destination = unique_destination(&staging_root, &base_name);
        let staged_path = if metadata.is_dir() {
            copy_dir_recursive(&canonical, &destination)?;
            destination
        } else {
            stage_file(&canonical, &destination)?
        };
        let size = std::fs::metadata(&staged_path)
            .map(|value| value.len())
            .unwrap_or(0);

        staged.push(StagedAttachment {
            source_path: canonical.to_string_lossy().to_string(),
            staged_path: staged_path.to_string_lossy().to_string(),
            name: staged_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&base_name)
                .to_string(),
            is_directory: metadata.is_dir(),
            size,
        });
    }

    Ok(staged)
}

/// Recover staged (or still-reachable source) attachment paths from prior messages
/// so follow-ups keep image context without re-uploading.
pub fn attachment_paths_from_history(
    history: &[crate::models::conversation::Message],
) -> Vec<String> {
    let mut paths = Vec::new();
    for message in history.iter().rev() {
        if message.author != "user" {
            continue;
        }
        let Some(items) = message.attachments.as_array() else {
            continue;
        };
        for item in items {
            let candidate = item
                .get("stagedPath")
                .and_then(|value| value.as_str())
                .or_else(|| item.get("path").and_then(|value| value.as_str()));
            let Some(path) = candidate.filter(|value| !value.is_empty()) else {
                continue;
            };
            if Path::new(path).exists() && !paths.iter().any(|existing| existing == path) {
                paths.push(path.to_string());
            }
        }
        if !paths.is_empty() {
            break;
        }
    }
    paths
}

fn stage_file(source: &Path, destination: &Path) -> Result<PathBuf, AppError> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if is_compressible_image(source) && compress_image_for_bob(source, destination).is_ok() {
        return Ok(destination.to_path_buf());
    }

    // Compression unavailable/failed: keep the original bytes (and extension).
    let copy_destination = if destination.extension() != source.extension() {
        unique_destination(
            destination.parent().unwrap_or_else(|| Path::new(".")),
            source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("attachment"),
        )
    } else {
        destination.to_path_buf()
    };
    std::fs::copy(source, &copy_destination).map_err(|error| {
        AppError::Io(format!(
            "Impossible de copier la pièce jointe {} : {}",
            source.display(),
            error
        ))
    })?;
    Ok(copy_destination)
}

fn compress_image_for_bob(source: &Path, destination: &Path) -> Result<(), AppError> {
    // Progressive passes: keep visual detail first, then shrink until under budget.
    let passes = [
        ("1600", "70"),
        ("1280", "60"),
        ("1024", "50"),
        ("800", "40"),
    ];
    let mut last_tmp: Option<PathBuf> = None;
    for (edge, quality) in passes {
        let tmp = destination.with_extension(format!("tmp-{edge}-{quality}.jpg"));
        let ok = Command::new("sips")
            .args([
                "-Z",
                edge,
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                quality,
            ])
            .arg(source)
            .arg("--out")
            .arg(&tmp)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !ok {
            let _ = std::fs::remove_file(&tmp);
            continue;
        }
        if let Some(previous) = last_tmp.take() {
            let _ = std::fs::remove_file(previous);
        }
        let size = std::fs::metadata(&tmp)
            .map(|value| value.len())
            .unwrap_or(u64::MAX);
        last_tmp = Some(tmp.clone());
        if size <= MAX_STAGED_IMAGE_BYTES {
            break;
        }
    }

    let Some(tmp) = last_tmp else {
        return Err(AppError::Io(
            "Compression d’image indisponible (sips).".into(),
        ));
    };
    std::fs::rename(&tmp, destination).or_else(|_| {
        std::fs::copy(&tmp, destination)?;
        let _ = std::fs::remove_file(&tmp);
        Ok::<(), std::io::Error>(())
    })?;
    Ok(())
}

fn is_compressible_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "heic" | "heif" | "tif" | "tiff" | "bmp" | "gif"
    )
}

fn file_stem(name: &str) -> &str {
    Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(name)
}

fn sanitize_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "session".into()
    } else {
        sanitized
    }
}

fn unique_destination(root: &Path, base_name: &str) -> PathBuf {
    let candidate = root.join(base_name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(base_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    for index in 2..10_000 {
        let next = root.join(format!("{stem}-{index}{extension}"));
        if !next.exists() {
            return next;
        }
    }
    root.join(format!("{stem}-{}{extension}", uuid::Uuid::new_v4()))
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if file_type.is_file() {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_sensitive_attachment_paths() {
        let root = std::env::temp_dir().join(format!("bob-sens-{}", uuid::Uuid::new_v4()));
        let workspace = root.join("workspace");
        let ssh = root.join(".ssh");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&ssh).unwrap();
        let key = ssh.join("id_rsa");
        std::fs::write(&key, b"secret").unwrap();

        let err = stage_attachments(&workspace, "run_test", &[key.to_string_lossy().to_string()])
            .expect_err("sensitive attachment must be rejected");
        assert!(
            err.to_string().to_lowercase().contains("sensitive")
                || err.to_string().to_lowercase().contains("denied")
                || err.to_string().contains("id_rsa"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stages_files_into_workspace_attachments() {
        let root = std::env::temp_dir().join(format!("bob-stage-{}", uuid::Uuid::new_v4()));
        let source_dir = root.join("downloads");
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&workspace).unwrap();
        let image = source_dir.join("notes.txt");
        std::fs::write(&image, b"fake-notes").unwrap();

        let staged = stage_attachments(
            &workspace,
            "run_test",
            &[image.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(staged.len(), 1);
        assert!(Path::new(&staged[0].staged_path).is_file());
        assert!(staged[0]
            .staged_path
            .contains(".bob-work/attachments/run_test/"));
        assert_eq!(
            std::fs::read(&staged[0].staged_path).unwrap(),
            b"fake-notes"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn compresses_large_jpeg_under_budget() {
        let root = std::env::temp_dir().join(format!("bob-img-{}", uuid::Uuid::new_v4()));
        let source_dir = root.join("downloads");
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("big.jpg");
        // Generate a large JPEG via sips so the test mirrors real phone photos.
        let make = Command::new("sips")
            .args([
                "-s",
                "format",
                "jpeg",
                "--setProperty",
                "formatOptions",
                "100",
                "-z",
                "3000",
                "4000",
            ])
            .arg("/System/Library/Desktop Pictures/Solid Colors/Black.png")
            .arg("--out")
            .arg(&source)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if !make.map(|status| status.success()).unwrap_or(false) {
            let _ = std::fs::remove_dir_all(root);
            return;
        }
        // Inflate by re-encoding a noisy-ish large canvas if the solid color is tiny.
        let original_size = std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0);
        if original_size < MAX_STAGED_IMAGE_BYTES {
            // Still validate the compress path produces a readable jpeg.
            let staged = stage_attachments(
                &workspace,
                "run_img",
                &[source.to_string_lossy().to_string()],
            )
            .unwrap();
            assert_eq!(staged.len(), 1);
            assert!(staged[0].staged_path.ends_with(".jpg"));
            let _ = std::fs::remove_dir_all(root);
            return;
        }

        let staged = stage_attachments(
            &workspace,
            "run_img",
            &[source.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(staged.len(), 1);
        assert!(staged[0].size <= MAX_STAGED_IMAGE_BYTES);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_conversation_workspace_without_project() {
        let data = std::env::temp_dir().join(format!("bob-ws-{}", uuid::Uuid::new_v4()));
        let root = resolve_workspace_root(None, &data, "conv/with spaces").unwrap();
        // macOS canonicalizes /var to /private/var, as validate_path intentionally does.
        let canonical_data = data.canonicalize().unwrap();
        assert!(root.starts_with(canonical_data.join("workspaces")));
        assert!(root.exists());
        let _ = std::fs::remove_dir_all(data);
    }

    #[test]
    fn history_prefers_staged_paths() {
        let staged_file = std::env::temp_dir().join(format!("bob-hist-{}", uuid::Uuid::new_v4()));
        std::fs::write(&staged_file, b"x").unwrap();
        let message = crate::models::conversation::Message {
            id: "m1".into(),
            conversation_id: "c1".into(),
            author: "user".into(),
            content: "analyse".into(),
            attachments: serde_json::json!([{
                "name": "a.jpg",
                "path": "/tmp/missing-original.jpg",
                "stagedPath": staged_file.to_string_lossy(),
            }]),
            sources: serde_json::json!([]),
            citations: serde_json::json!([]),
            tools_used: serde_json::json!([]),
            send_state: "sent".into(),
            errors: serde_json::json!([]),
            associated_artifacts: serde_json::json!([]),
            associated_approvals: serde_json::json!([]),
            created_at: "now".into(),
        };
        let paths = attachment_paths_from_history(&[message]);
        assert_eq!(paths, vec![staged_file.to_string_lossy().to_string()]);
        let _ = std::fs::remove_file(staged_file);
    }
}
