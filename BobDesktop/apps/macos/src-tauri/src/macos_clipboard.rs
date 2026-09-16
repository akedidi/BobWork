//! Read Finder file copies and write pasted image bytes for the composer.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImageInput {
    pub bytes: Vec<u8>,
    pub mime: String,
}

/// Absolute paths currently on the macOS pasteboard as file URLs (Finder copy).
#[cfg(target_os = "macos")]
pub fn read_clipboard_file_paths() -> Vec<String> {
    let script = r#"
ObjC.import('AppKit');
ObjC.import('Foundation');
var pb = $.NSPasteboard.generalPasteboard;
var classes = $.NSArray.arrayWithObject($.NSURL.class);
var items = pb.readObjectsForClassesOptions(classes, $());
var paths = [];
if (items) {
  for (var i = 0; i < items.count; i++) {
    var url = items.objectAtIndex(i);
    if (url && url.isFileURL) {
      paths.push(ObjC.unwrap(url.path));
    }
  }
}
paths.join('\n');
"#;
    let output = std::process::Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn read_clipboard_file_paths() -> Vec<String> {
    Vec::new()
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/heic" | "image/heif" => "heic",
        "image/tiff" => "tiff",
        "image/bmp" => "bmp",
        _ => "png",
    }
}

/// Persist clipboard image bytes under app data so they can be attached like a drop.
pub fn write_clipboard_image(app: &AppHandle, input: ClipboardImageInput) -> AppResult<String> {
    if input.bytes.is_empty() {
        return Err(AppError::ValidationFailed("Image presse-papiers vide".into()));
    }
    if input.bytes.len() > 80 * 1024 * 1024 {
        return Err(AppError::ValidationFailed(
            "Image presse-papiers trop volumineuse (80 Mo max)".into(),
        ));
    }
    let mime = input.mime.trim().to_ascii_lowercase();
    if !mime.starts_with("image/") {
        return Err(AppError::ValidationFailed(
            "Seules les images du presse-papiers peuvent être collées ainsi".into(),
        ));
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Io(error.to_string()))?;
    let dir = data_dir.join("tmp").join("composer-paste");
    std::fs::create_dir_all(&dir)?;
    let ext = extension_for_mime(&mime);
    let path = dir.join(format!("paste-{}.{}", Uuid::new_v4(), ext));
    std::fs::write(&path, &input.bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::extension_for_mime;

    #[test]
    fn maps_common_image_mimes() {
        assert_eq!(extension_for_mime("image/png"), "png");
        assert_eq!(extension_for_mime("image/jpeg"), "jpg");
        assert_eq!(extension_for_mime("image/webp"), "webp");
        assert_eq!(extension_for_mime("application/octet-stream"), "png");
    }
}
