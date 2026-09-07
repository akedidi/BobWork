use crate::error::{AppError, AppResult};
use crate::models::plugin::{PluginFileResource, PluginLinkedDatabase};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &[
    "pdf", "xls", "xlsx", "xlsm", "csv", "tsv", "ods", "doc", "docx", "ppt", "pptx", "txt", "md",
    "json",
];

#[cfg(test)]
thread_local! {
    static TEST_BOB_HOME: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

pub struct PluginUserResourceService;

impl PluginUserResourceService {
    pub fn new() -> Self {
        Self
    }

    pub fn list_files(&self, plugin_id: &str) -> AppResult<Vec<PluginFileResource>> {
        let plugin_id = sanitize_plugin_id(plugin_id)?;
        let overlay = Overlay::load(&plugin_id)?;
        Ok(overlay
            .files
            .into_iter()
            .map(|file| file.into_resource(&plugin_id))
            .collect())
    }

    pub fn file_paths(&self, plugin_id: &str) -> AppResult<Vec<String>> {
        Ok(self
            .list_files(plugin_id)?
            .into_iter()
            .map(|file| file.path)
            .collect())
    }

    pub fn paths_for_plugin_mentions(&self, message: &str) -> Vec<String> {
        let Ok(regex) = regex::Regex::new(r"@plugin:([A-Za-z0-9-]+)") else {
            return vec![];
        };
        let mut seen = std::collections::HashSet::new();
        let mut paths = Vec::new();
        for captures in regex.captures_iter(message) {
            let plugin_id = &captures[1];
            if !seen.insert(plugin_id.to_string()) {
                continue;
            }
            if let Ok(files) = self.file_paths(plugin_id) {
                paths.extend(files);
            }
        }
        paths
    }

    pub fn upload(&self, plugin_id: &str, source_path: &str) -> AppResult<PluginFileResource> {
        let plugin_id = sanitize_plugin_id(plugin_id)?;
        let source = Path::new(source_path);
        if source_path.contains("..") {
            return Err(AppError::ValidationFailed(
                "Chemin de fichier refusé.".into(),
            ));
        }
        if !source.is_file() {
            return Err(AppError::ValidationFailed(
                "Le fichier à importer est introuvable.".into(),
            ));
        }
        let file_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| AppError::ValidationFailed("Nom de fichier invalide.".into()))?;
        let ext = extension_of(file_name)?;
        let size = source
            .metadata()
            .map_err(|error| AppError::Io(error.to_string()))?
            .len();
        if size > MAX_FILE_BYTES {
            return Err(AppError::ValidationFailed(
                "Fichier trop volumineux (limite 25 Mo).".into(),
            ));
        }
        let id = Uuid::new_v4().to_string();
        let stored_name = format!("{id}.{ext}");
        let files_dir = overlay_dir(&plugin_id)?.join("files");
        fs::create_dir_all(&files_dir)?;
        let dest = files_dir.join(&stored_name);
        fs::copy(source, &dest)?;
        let mut overlay = Overlay::load(&plugin_id)?;
        let record = OverlayFile {
            id: id.clone(),
            file_name: file_name.to_string(),
            stored_name,
            kind: kind_for_ext(&ext).to_string(),
            size,
            uploaded_at: chrono::Utc::now().to_rfc3339(),
        };
        overlay.files.push(record.clone());
        overlay.save(&plugin_id)?;
        Ok(record.into_resource(&plugin_id))
    }

    pub fn delete_file(&self, plugin_id: &str, file_id: &str) -> AppResult<()> {
        let plugin_id = sanitize_plugin_id(plugin_id)?;
        let mut overlay = Overlay::load(&plugin_id)?;
        let Some(index) = overlay.files.iter().position(|file| file.id == file_id) else {
            return Err(AppError::NotFound("Fichier introuvable.".into()));
        };
        let removed = overlay.files.remove(index);
        let path = overlay_dir(&plugin_id)?
            .join("files")
            .join(&removed.stored_name);
        let _ = fs::remove_file(path);
        overlay.save(&plugin_id)?;
        Ok(())
    }

    pub fn file_path(&self, plugin_id: &str, file_id: &str) -> AppResult<String> {
        let plugin_id = sanitize_plugin_id(plugin_id)?;
        let overlay = Overlay::load(&plugin_id)?;
        overlay
            .files
            .iter()
            .find(|file| file.id == file_id)
            .map(|file| file.absolute_path(&plugin_id))
            .ok_or_else(|| AppError::NotFound("Fichier introuvable.".into()))
    }

    pub fn list_linked_databases(&self, plugin_id: &str) -> AppResult<Vec<PluginLinkedDatabase>> {
        let plugin_id = sanitize_plugin_id(plugin_id)?;
        Ok(Overlay::load(&plugin_id)?.linked_databases)
    }

    pub fn link_database(
        &self,
        plugin_id: &str,
        connection_id: &str,
        name: &str,
    ) -> AppResult<Vec<PluginLinkedDatabase>> {
        let plugin_id = sanitize_plugin_id(plugin_id)?;
        let mut overlay = Overlay::load(&plugin_id)?;
        if overlay
            .linked_databases
            .iter()
            .any(|item| item.connection_id == connection_id)
        {
            return Ok(overlay.linked_databases);
        }
        overlay.linked_databases.push(PluginLinkedDatabase {
            connection_id: connection_id.to_string(),
            name: name.to_string(),
        });
        overlay.save(&plugin_id)?;
        Ok(overlay.linked_databases)
    }

    pub fn unlink_database(
        &self,
        plugin_id: &str,
        connection_id: &str,
    ) -> AppResult<Vec<PluginLinkedDatabase>> {
        let plugin_id = sanitize_plugin_id(plugin_id)?;
        let mut overlay = Overlay::load(&plugin_id)?;
        overlay
            .linked_databases
            .retain(|item| item.connection_id != connection_id);
        overlay.save(&plugin_id)?;
        Ok(overlay.linked_databases)
    }

    pub fn linked_connection_ids_for_message(&self, message: &str) -> Vec<String> {
        let Ok(regex) = regex::Regex::new(r"@plugin:([A-Za-z0-9-]+)") else {
            return vec![];
        };
        let mut ids = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for captures in regex.captures_iter(message) {
            let plugin_id = &captures[1];
            if let Ok(linked) = self.list_linked_databases(plugin_id) {
                for item in linked {
                    if seen.insert(item.connection_id.clone()) {
                        ids.push(item.connection_id);
                    }
                }
            }
        }
        ids
    }
}

#[cfg(test)]
pub fn set_test_bob_home(path: PathBuf) {
    TEST_BOB_HOME.with(|home| *home.borrow_mut() = Some(path));
}

fn bob_home() -> AppResult<PathBuf> {
    #[cfg(test)]
    {
        if let Some(path) = TEST_BOB_HOME.with(|home| home.borrow().clone()) {
            return Ok(path);
        }
    }
    dirs::home_dir()
        .map(|home| home.join(".bob"))
        .ok_or_else(|| AppError::Io("Répertoire home introuvable.".into()))
}

fn overlay_dir(plugin_id: &str) -> AppResult<PathBuf> {
    Ok(bob_home()?.join("plugin-user-resources").join(plugin_id))
}

fn sanitize_plugin_id(plugin_id: &str) -> AppResult<String> {
    if plugin_id.is_empty()
        || plugin_id.contains("..")
        || !plugin_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(AppError::ValidationFailed(
            "Identifiant de plugin invalide.".into(),
        ));
    }
    Ok(plugin_id.to_string())
}

fn extension_of(file_name: &str) -> AppResult<String> {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::ValidationFailed(format!(
            "Type de fichier « .{ext} » non autorisé."
        )));
    }
    Ok(ext)
}

fn kind_for_ext(ext: &str) -> &'static str {
    match ext {
        "pdf" => "pdf",
        "xls" | "xlsx" | "xlsm" | "csv" | "tsv" | "ods" => "spreadsheet",
        _ => "file",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Overlay {
    #[serde(default)]
    files: Vec<OverlayFile>,
    #[serde(default)]
    linked_databases: Vec<PluginLinkedDatabase>,
}

impl Overlay {
    fn path(plugin_id: &str) -> AppResult<PathBuf> {
        Ok(overlay_dir(plugin_id)?.join("manifest.json"))
    }

    fn load(plugin_id: &str) -> AppResult<Self> {
        let path = Self::path(plugin_id)?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    fn save(&self, plugin_id: &str) -> AppResult<()> {
        let dir = overlay_dir(plugin_id)?;
        fs::create_dir_all(&dir)?;
        fs::write(Self::path(plugin_id)?, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlayFile {
    id: String,
    file_name: String,
    stored_name: String,
    kind: String,
    size: u64,
    uploaded_at: String,
}

impl OverlayFile {
    fn absolute_path(&self, plugin_id: &str) -> String {
        overlay_dir(plugin_id)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("files")
            .join(&self.stored_name)
            .to_string_lossy()
            .to_string()
    }

    fn into_resource(self, plugin_id: &str) -> PluginFileResource {
        PluginFileResource {
            path: self.absolute_path(plugin_id),
            id: self.id,
            plugin_id: plugin_id.to_string(),
            file_name: self.file_name,
            kind: self.kind,
            size: self.size,
            uploaded_at: self.uploaded_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (PathBuf, PluginUserResourceService) {
        let home = std::env::temp_dir().join(format!("bob-overlay-{}", Uuid::new_v4()));
        fs::create_dir_all(&home).unwrap();
        set_test_bob_home(home.clone());
        (home, PluginUserResourceService::new())
    }

    #[test]
    fn rejects_disallowed_extension_and_traversal() {
        let (_home, svc) = setup();
        let exe = std::env::temp_dir().join(format!("bob-bad-{}.exe", Uuid::new_v4()));
        fs::write(&exe, b"MZ").unwrap();
        let err = svc.upload("plugin-a", &exe.to_string_lossy()).unwrap_err();
        assert!(err.to_string().contains("non autorisé"));
        let err = svc.upload("../etc", "/tmp/x.pdf").unwrap_err();
        assert!(err.to_string().contains("invalide"));
    }

    #[test]
    fn upload_list_delete_pdf_and_xlsx() {
        let (_home, svc) = setup();
        let pdf = std::env::temp_dir().join(format!("bob-doc-{}.pdf", Uuid::new_v4()));
        let xlsx = std::env::temp_dir().join(format!("bob-sheet-{}.xlsx", Uuid::new_v4()));
        fs::write(&pdf, b"%PDF-1.4").unwrap();
        fs::write(&xlsx, b"PK").unwrap();
        let uploaded_pdf = svc.upload("builtin-word", &pdf.to_string_lossy()).unwrap();
        let uploaded_xlsx = svc.upload("builtin-word", &xlsx.to_string_lossy()).unwrap();
        let files = svc.list_files("builtin-word").unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(uploaded_pdf.kind, "pdf");
        assert_eq!(uploaded_xlsx.kind, "spreadsheet");
        svc.delete_file("builtin-word", &uploaded_pdf.id).unwrap();
        assert_eq!(svc.list_files("builtin-word").unwrap().len(), 1);
        let linked = svc
            .link_database("builtin-word", "conn-1", "sales")
            .unwrap();
        assert_eq!(linked.len(), 1);
        assert_eq!(
            svc.linked_connection_ids_for_message("@plugin:builtin-word hello"),
            vec!["conn-1"]
        );
        let paths = svc.paths_for_plugin_mentions("@plugin:builtin-word go");
        assert_eq!(paths.len(), 1);
    }

    #[test]
    fn rejects_oversized_file() {
        let (_home, svc) = setup();
        let big = std::env::temp_dir().join(format!("bob-big-{}.pdf", Uuid::new_v4()));
        fs::write(&big, vec![0_u8; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        let err = svc.upload("p1", &big.to_string_lossy()).unwrap_err();
        assert!(err.to_string().contains("25 Mo"));
    }
}
