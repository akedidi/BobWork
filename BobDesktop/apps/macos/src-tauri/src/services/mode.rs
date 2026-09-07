// ============================================================
// Bob Work - Custom modes marketplace (curated local catalog)
// ============================================================

use crate::error::{AppError, AppResult};
use crate::services::bob::BobMode;
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const CATALOG_YAML: &str = include_str!("../../resources/modes/catalog.yaml");
const BUILTIN_SLUGS: &[&str] = &["agent", "plan", "ask"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeCatalogEntry {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub groups: Vec<String>,
    pub builtin: bool,
    pub source: String,
    pub installed: bool,
    /// True when the mode comes from the curated Bob Work catalog.
    pub catalog: bool,
}

pub struct ModeService;

impl ModeService {
    pub fn settings_modes_path(home: &Path) -> PathBuf {
        home.join(".bob/settings/custom_modes.yaml")
    }

    pub fn home_modes_path(home: &Path) -> PathBuf {
        home.join(".bob/custom_modes.yaml")
    }

    pub fn list_marketplace(
        installed: &[BobMode],
        workspace: Option<&str>,
    ) -> Vec<ModeCatalogEntry> {
        let installed_slugs: HashSet<&str> = installed.iter().map(|m| m.slug.as_str()).collect();
        let mut entries: Vec<ModeCatalogEntry> = installed
            .iter()
            .map(|mode| ModeCatalogEntry {
                slug: mode.slug.clone(),
                name: mode.name.clone(),
                description: mode.description.clone(),
                groups: mode.groups.clone(),
                builtin: mode.builtin,
                source: mode.source.clone(),
                installed: true,
                catalog: false,
            })
            .collect();

        for mode in parse_catalog_modes() {
            let already = installed_slugs.contains(mode.slug.as_str());
            if already {
                if let Some(entry) = entries.iter_mut().find(|e| e.slug == mode.slug) {
                    entry.catalog = true;
                }
                continue;
            }
            entries.push(ModeCatalogEntry {
                slug: mode.slug,
                name: mode.name,
                description: mode.description,
                groups: mode.groups,
                builtin: false,
                source: "bob-work-catalog".into(),
                installed: false,
                catalog: true,
            });
        }

        // Workspace hint kept for API symmetry with get_bob_modes.
        let _ = workspace;
        entries
    }

    pub fn install_mode(home: &Path, slug: &str) -> AppResult<BobMode> {
        let slug = slug.trim();
        if slug.is_empty() {
            return Err(AppError::ValidationFailed(
                "Identifiant de mode manquant.".into(),
            ));
        }
        if is_builtin(slug) {
            return Err(AppError::ValidationFailed(format!(
                "Le mode intégré « {slug} » ne peut pas être installé."
            )));
        }
        let entry = catalog_raw_entry(slug).ok_or_else(|| {
            AppError::NotFound(format!(
                "Mode « {slug} » introuvable dans le catalogue Bob Work."
            ))
        })?;
        upsert_mode_value(home, entry.clone())?;
        Ok(mode_summary_from_value(
            &entry,
            &Self::settings_modes_path(home),
        ))
    }

    pub fn uninstall_mode(home: &Path, slug: &str) -> AppResult<()> {
        let slug = slug.trim();
        if slug.is_empty() {
            return Err(AppError::ValidationFailed(
                "Identifiant de mode manquant.".into(),
            ));
        }
        if is_builtin(slug) {
            return Err(AppError::ValidationFailed(format!(
                "Le mode intégré « {slug} » ne peut pas être désinstallé."
            )));
        }
        let mut removed = false;
        for path in [Self::settings_modes_path(home), Self::home_modes_path(home)] {
            if remove_mode_from_file(&path, slug)? {
                removed = true;
            }
        }
        if !removed {
            return Err(AppError::NotFound(format!(
                "Mode « {slug} » introuvable dans ~/.bob/settings/custom_modes.yaml."
            )));
        }
        Ok(())
    }

    pub fn import_mode_yaml(home: &Path, yaml: &str) -> AppResult<BobMode> {
        let value: Value = serde_yaml::from_str(yaml)
            .map_err(|e| AppError::ValidationFailed(format!("YAML de mode invalide : {e}")))?;
        let entries = extract_mode_entries(&value)?;
        if entries.is_empty() {
            return Err(AppError::ValidationFailed(
                "Aucun mode trouvé. Fournissez un objet mode ou un bloc customModes:.".into(),
            ));
        }
        let mut last: Option<BobMode> = None;
        for entry in entries {
            let slug = entry
                .get("slug")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if slug.is_empty() {
                return Err(AppError::ValidationFailed(
                    "Chaque mode importé doit avoir un slug.".into(),
                ));
            }
            if is_builtin(&slug) {
                return Err(AppError::ValidationFailed(format!(
                    "Impossible d’importer le slug réservé « {slug} »."
                )));
            }
            upsert_mode_value(home, entry.clone())?;
            last = Some(mode_summary_from_value(
                &entry,
                &Self::settings_modes_path(home),
            ));
        }
        last.ok_or_else(|| AppError::Unknown("Import mode sans résultat.".into()))
    }
}

fn is_builtin(slug: &str) -> bool {
    BUILTIN_SLUGS.iter().any(|s| *s == slug)
}

fn parse_catalog_modes() -> Vec<BobMode> {
    let Ok(value) = serde_yaml::from_str::<Value>(CATALOG_YAML) else {
        return vec![];
    };
    value
        .get("customModes")
        .and_then(|v| v.as_sequence())
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let path = Path::new("bob-work-catalog");
            let mode = mode_summary_from_value(entry, path);
            if mode.slug.is_empty() {
                None
            } else {
                Some(mode)
            }
        })
        .collect()
}

fn catalog_raw_entry(slug: &str) -> Option<Value> {
    let value: Value = serde_yaml::from_str(CATALOG_YAML).ok()?;
    let entries = value.get("customModes")?.as_sequence()?;
    entries
        .iter()
        .find(|entry| entry.get("slug").and_then(|v| v.as_str()) == Some(slug))
        .cloned()
}

fn extract_mode_entries(value: &Value) -> AppResult<Vec<Value>> {
    if let Some(seq) = value.get("customModes").and_then(|v| v.as_sequence()) {
        return Ok(seq.clone());
    }
    if value.get("slug").and_then(|v| v.as_str()).is_some() {
        return Ok(vec![value.clone()]);
    }
    if let Some(seq) = value.as_sequence() {
        return Ok(seq.clone());
    }
    Err(AppError::ValidationFailed(
        "Format attendu : un mode YAML (slug/name/…) ou customModes: [...].".into(),
    ))
}

fn upsert_mode_value(home: &Path, entry: Value) -> AppResult<()> {
    let path = ModeService::settings_modes_path(home);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut doc = load_modes_document(&path).unwrap_or_else(|_| empty_modes_doc());
    let slug = entry
        .get("slug")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let modes = doc
        .get_mut("customModes")
        .and_then(|v| v.as_sequence_mut())
        .ok_or_else(|| {
            AppError::ValidationFailed(
                "Le fichier custom_modes.yaml doit contenir customModes:.".into(),
            )
        })?;
    if let Some(idx) = modes
        .iter()
        .position(|m| m.get("slug").and_then(|v| v.as_str()) == Some(slug.as_str()))
    {
        modes[idx] = entry;
    } else {
        modes.push(entry);
    }
    write_modes_document_atomic(&path, &doc)
}

fn remove_mode_from_file(path: &Path, slug: &str) -> AppResult<bool> {
    if !path.is_file() {
        return Ok(false);
    }
    let mut doc = load_modes_document(path)?;
    let Some(modes) = doc.get_mut("customModes").and_then(|v| v.as_sequence_mut()) else {
        return Ok(false);
    };
    let before = modes.len();
    modes.retain(|m| m.get("slug").and_then(|v| v.as_str()) != Some(slug));
    if modes.len() == before {
        return Ok(false);
    }
    write_modes_document_atomic(path, &doc)?;
    Ok(true)
}

fn load_modes_document(path: &Path) -> AppResult<Value> {
    let content = fs::read_to_string(path)?;
    serde_yaml::from_str(&content)
        .map_err(|e| AppError::Serialization(format!("YAML modes invalide ({path:?}): {e}")))
}

fn empty_modes_doc() -> Value {
    serde_yaml::from_str("customModes: []\n").expect("empty modes doc")
}

fn write_modes_document_atomic(path: &Path, doc: &Value) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let yaml = serde_yaml::to_string(doc).map_err(|e| {
        AppError::Serialization(format!("Impossible de sérialiser les modes : {e}"))
    })?;
    if path.is_file() {
        let bak = path.with_extension("yaml.bak");
        let _ = fs::copy(path, &bak);
    }
    let tmp = path.with_extension("yaml.tmp");
    fs::write(&tmp, yaml)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn mode_summary_from_value(entry: &Value, path: &Path) -> BobMode {
    let slug = entry
        .get("slug")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let name = entry
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&slug)
        .to_string();
    let description = entry
        .get("description")
        .and_then(|v| v.as_str())
        .or_else(|| entry.get("whenToUse").and_then(|v| v.as_str()))
        .map(|text| text.trim().chars().take(500).collect::<String>());
    let groups = entry
        .get("groups")
        .and_then(|v| v.as_sequence())
        .map(|groups| {
            groups
                .iter()
                .filter_map(|group| {
                    if let Some(name) = group.as_str() {
                        return Some(name.to_string());
                    }
                    group
                        .as_sequence()
                        .and_then(|nested| nested.first())
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    BobMode {
        slug,
        name,
        description,
        groups,
        builtin: false,
        source: path.to_string_lossy().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_home() -> PathBuf {
        std::env::temp_dir().join(format!("bob-work-modes-{}", Uuid::new_v4()))
    }

    #[test]
    fn catalog_lists_curated_modes() {
        let modes = parse_catalog_modes();
        assert!(modes.iter().any(|m| m.slug == "shell-debug"));
        assert!(modes.iter().any(|m| m.slug == "prod-ops"));
        assert!(modes.iter().any(|m| m.slug == "docs-writer"));
    }

    #[test]
    fn marketplace_marks_installed_catalog_overlap() {
        let installed = vec![BobMode {
            slug: "shell-debug".into(),
            name: "Shell Debugger".into(),
            description: None,
            groups: vec!["read".into()],
            builtin: false,
            source: "/tmp/custom_modes.yaml".into(),
        }];
        let list = ModeService::list_marketplace(&installed, None);
        let entry = list.iter().find(|m| m.slug == "shell-debug").unwrap();
        assert!(entry.installed);
        assert!(entry.catalog);
        assert!(list.iter().any(|m| m.slug == "test-runner" && !m.installed));
    }

    #[test]
    fn install_merges_without_wiping_siblings() {
        let home = test_home();
        let path = ModeService::settings_modes_path(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"customModes:
  - slug: keep-me
    name: Keep Me
    roleDefinition: stay
    groups:
      - read
"#,
        )
        .unwrap();

        ModeService::install_mode(&home, "shell-debug").unwrap();
        let doc = load_modes_document(&path).unwrap();
        let modes = doc.get("customModes").unwrap().as_sequence().unwrap();
        assert_eq!(modes.len(), 2);
        assert!(modes
            .iter()
            .any(|m| m.get("slug").and_then(|v| v.as_str()) == Some("keep-me")));
        assert!(modes
            .iter()
            .any(|m| m.get("slug").and_then(|v| v.as_str()) == Some("shell-debug")));
        let keep = modes
            .iter()
            .find(|m| m.get("slug").and_then(|v| v.as_str()) == Some("keep-me"))
            .unwrap();
        assert_eq!(
            keep.get("roleDefinition").and_then(|v| v.as_str()),
            Some("stay")
        );
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn uninstall_removes_mode_and_refuses_builtin() {
        let home = test_home();
        ModeService::install_mode(&home, "safe-reviewer").unwrap();
        ModeService::uninstall_mode(&home, "safe-reviewer").unwrap();
        let doc = load_modes_document(&ModeService::settings_modes_path(&home)).unwrap();
        let modes = doc.get("customModes").unwrap().as_sequence().unwrap();
        assert!(modes
            .iter()
            .all(|m| m.get("slug").and_then(|v| v.as_str()) != Some("safe-reviewer")));
        assert!(ModeService::uninstall_mode(&home, "agent").is_err());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn import_accepts_single_mode_object() {
        let home = test_home();
        let imported = ModeService::import_mode_yaml(
            &home,
            r#"
slug: my-custom
name: My Custom
whenToUse: for tests
groups:
  - read
"#,
        )
        .unwrap();
        assert_eq!(imported.slug, "my-custom");
        let doc = load_modes_document(&ModeService::settings_modes_path(&home)).unwrap();
        assert!(doc
            .get("customModes")
            .unwrap()
            .as_sequence()
            .unwrap()
            .iter()
            .any(|m| m.get("slug").and_then(|v| v.as_str()) == Some("my-custom")));
        let _ = fs::remove_dir_all(&home);
    }
}
