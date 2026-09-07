// ============================================================
// Bob Work — Plugin zip import / export
// Limits: 5_000 files, 100 MiB uncompressed (documented).
// ============================================================

use crate::error::{AppError, AppResult};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const MAX_FILES: usize = 5_000;
const MAX_UNCOMPRESSED_BYTES: u64 = 100 * 1024 * 1024;

pub struct PluginArchiveService;

impl PluginArchiveService {
    pub fn new() -> Self {
        Self
    }

    pub fn export_dir_to_zip(&self, bundle_dir: &Path, destination: &Path) -> AppResult<()> {
        if !bundle_dir.is_dir() {
            return Err(AppError::NotFound(format!(
                "Bundle introuvable : {}",
                bundle_dir.display()
            )));
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = File::create(destination).map_err(|e| AppError::Io(e.to_string()))?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut file_count = 0usize;
        let mut total_bytes = 0u64;

        collect_files(bundle_dir, &mut |path| {
            let rel = path
                .strip_prefix(bundle_dir)
                .map_err(|e| AppError::Io(e.to_string()))?;
            let name = rel.to_string_lossy().replace('\\', "/");
            if name.is_empty() || name.contains("..") {
                return Ok(());
            }
            file_count += 1;
            if file_count > MAX_FILES {
                return Err(AppError::Plugin(format!(
                    "Export refusé : plus de {MAX_FILES} fichiers dans le bundle."
                )));
            }
            let meta = std::fs::metadata(path)?;
            total_bytes = total_bytes.saturating_add(meta.len());
            if total_bytes > MAX_UNCOMPRESSED_BYTES {
                return Err(AppError::Plugin(
                    "Export refusé : bundle supérieur à 100 Mo.".into(),
                ));
            }
            zip.start_file(name, options)
                .map_err(|e| AppError::Io(e.to_string()))?;
            let mut bytes = Vec::new();
            File::open(path)?.read_to_end(&mut bytes)?;
            zip.write_all(&bytes)
                .map_err(|e| AppError::Io(e.to_string()))?;
            Ok(())
        })?;

        zip.finish().map_err(|e| AppError::Io(e.to_string()))?;
        Ok(())
    }

    /// Extract zip into `~/.bob/skills/<slug>/`.
    pub fn import_zip_to_skills(&self, zip_path: &Path) -> AppResult<PathBuf> {
        let file = File::open(zip_path).map_err(|e| AppError::Io(e.to_string()))?;
        let mut archive = ZipArchive::new(file).map_err(|e| AppError::Plugin(e.to_string()))?;
        if archive.len() > MAX_FILES {
            return Err(AppError::Plugin(format!(
                "Import refusé : plus de {MAX_FILES} fichiers dans l’archive."
            )));
        }

        let mut total = 0u64;
        for i in 0..archive.len() {
            let entry = archive
                .by_index(i)
                .map_err(|e| AppError::Plugin(e.to_string()))?;
            total = total.saturating_add(entry.size());
            if total > MAX_UNCOMPRESSED_BYTES {
                return Err(AppError::Plugin(
                    "Import refusé : archive supérieure à 100 Mo.".into(),
                ));
            }
        }

        let staging =
            std::env::temp_dir().join(format!("bob-work-plugin-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&staging)?;

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| AppError::Plugin(e.to_string()))?;
            let Some(enclosed) = entry.enclosed_name() else {
                continue;
            };
            if has_parent_component(&enclosed) {
                continue;
            }
            let out = staging.join(enclosed);
            if entry.is_dir() {
                std::fs::create_dir_all(&out)?;
                continue;
            }
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut dest = File::create(&out)?;
            std::io::copy(&mut entry, &mut dest)?;
        }

        let source_root = resolve_bundle_root(&staging)?;
        let slug = read_slug(&source_root)?.unwrap_or_else(|| {
            source_root
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("imported-plugin")
                .to_string()
        });
        let slug = sanitize_slug(&slug);
        let skills = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?
            .join(".bob")
            .join("skills");
        std::fs::create_dir_all(&skills)?;
        let target = skills.join(&slug);
        if target.exists() {
            let backup = skills.join(format!(
                "{slug}.bak-{}",
                chrono::Utc::now().format("%Y%m%d%H%M%S")
            ));
            std::fs::rename(&target, &backup)?;
        }
        copy_dir_recursive(&source_root, &target)?;
        let _ = std::fs::remove_dir_all(&staging);
        Ok(target)
    }
}

fn collect_files(dir: &Path, visit: &mut dyn FnMut(&Path) -> AppResult<()>) -> AppResult<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, visit)?;
        } else if path.is_file() {
            visit(&path)?;
        }
    }
    Ok(())
}

fn has_parent_component(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir))
}

fn resolve_bundle_root(staging: &Path) -> AppResult<PathBuf> {
    if staging.join(".bob-work-plugin.json").is_file() || staging.join("SKILL.md").is_file() {
        return Ok(staging.to_path_buf());
    }
    let children = std::fs::read_dir(staging)?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect::<Vec<_>>();
    if children.len() == 1 {
        return Ok(children[0].clone());
    }
    for child in &children {
        if child.join(".bob-work-plugin.json").is_file() || child.join("SKILL.md").is_file() {
            return Ok(child.clone());
        }
    }
    Err(AppError::Plugin(
        "Archive invalide : aucun bundle plugin (.bob-work-plugin.json / SKILL.md) trouvé.".into(),
    ))
}

fn read_slug(bundle: &Path) -> AppResult<Option<String>> {
    let meta = bundle.join(".bob-work-plugin.json");
    if !meta.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&meta)?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| AppError::Plugin(e.to_string()))?;
    Ok(value
        .get("slug")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

fn sanitize_slug(raw: &str) -> String {
    let slug = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "imported-plugin".into()
    } else {
        trimmed.to_string()
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let target = dst.join(name);
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else if path.is_file() {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_a_minimal_plugin_bundle() {
        let root = std::env::temp_dir().join(format!("bob-archive-{}", uuid::Uuid::new_v4()));
        let bundle = root.join("my-plugin");
        std::fs::create_dir_all(&bundle).unwrap();
        std::fs::write(
            bundle.join(".bob-work-plugin.json"),
            r#"{"slug":"my-plugin","name":"My Plugin","version":"1.0.0"}"#,
        )
        .unwrap();
        std::fs::write(bundle.join("SKILL.md"), "# skill\n").unwrap();
        let zip_path = root.join("plugin.zip");
        PluginArchiveService::new()
            .export_dir_to_zip(&bundle, &zip_path)
            .unwrap();

        let home = root.join("home");
        std::fs::create_dir_all(home.join(".bob").join("skills")).unwrap();
        let prev = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);
        let imported = PluginArchiveService::new()
            .import_zip_to_skills(&zip_path)
            .unwrap();
        if let Some(prev) = prev {
            std::env::set_var("HOME", prev);
        } else {
            std::env::remove_var("HOME");
        }
        assert!(imported.join("SKILL.md").is_file());
        assert!(imported.join(".bob-work-plugin.json").is_file());
        let _ = std::fs::remove_dir_all(root);
    }
}
