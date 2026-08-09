// ============================================================
// Bob Work - Plugin Deployment Service
// Installs/uninstalls plugins into ~/.bob/skills/ and modes
// with transactional safety and rollback support
// ============================================================

use crate::error::{AppError, AppResult};
use crate::services::office_plugin_bundle::OfficePluginBundle;
use serde_json::Value;
use std::path::PathBuf;
use tracing::info;

pub struct PluginDeployService;

impl PluginDeployService {
    pub fn new() -> Self {
        Self
    }

    /// Deploy a plugin manifest using Bob Shell 2's canonical
    /// `~/.bob/skills/<slug>/SKILL.md` layout.
    pub fn deploy(&self, plugin_id: &str, manifest: &Value) -> AppResult<PathBuf> {
        let skills_dir = Self::bob_skills_dir()?;
        std::fs::create_dir_all(&skills_dir)?;

        let requested_name = manifest
            .get("slug")
            .and_then(|v| v.as_str())
            .or_else(|| manifest.get("name").and_then(|v| v.as_str()))
            .unwrap_or(plugin_id);
        let slug = Self::safe_slug(requested_name, plugin_id);
        let skill_dir = skills_dir.join(&slug);
        std::fs::create_dir_all(&skill_dir)?;
        let skill_path = skill_dir.join("SKILL.md");
        let backup_path = skill_dir.join("SKILL.md.bak");

        // Backup existing skill if any. A manual enable/disable choice made in
        // Bob Work must survive the automatic refresh of built-in plugins.
        let was_disabled = std::fs::read_to_string(&skill_path)
            .ok()
            .is_some_and(|content| Self::skill_is_disabled(&content));
        if skill_path.exists() {
            std::fs::copy(&skill_path, &backup_path)
                .map_err(|e| AppError::Plugin(format!("Failed to backup skill: {}", e)))?;
        }

        // Write new skill YAML
        let markdown = Self::with_disabled_state(
            Self::manifest_to_skill_markdown(&slug, manifest),
            was_disabled,
        );
        if let Err(e) = std::fs::write(&skill_path, &markdown) {
            // Rollback
            if backup_path.exists() {
                let _ = std::fs::copy(&backup_path, &skill_path);
            } else {
                let _ = std::fs::remove_file(&skill_path);
            }
            return Err(AppError::Plugin(format!("Failed to write skill: {}", e)));
        }

        // Remove backup on success
        let _ = std::fs::remove_file(&backup_path);
        let _ = std::fs::write(skill_dir.join(".bob-work-plugin-id"), plugin_id);

        OfficePluginBundle::write_bundle(&skill_dir, plugin_id, manifest)?;

        info!(
            "Deployed plugin {} as Bob skill {} to {:?}",
            plugin_id, slug, skill_path
        );
        Ok(skill_path)
    }

    /// Remove a plugin from Bob's skills directory
    pub fn undeploy(&self, plugin_id: &str) -> AppResult<()> {
        let skills_dir = Self::bob_skills_dir()?;
        let direct_dir = skills_dir.join(plugin_id);
        let mut candidates = vec![direct_dir];
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.filter_map(Result::ok) {
                let marker = entry.path().join(".bob-work-plugin-id");
                if std::fs::read_to_string(marker).ok().as_deref() == Some(plugin_id) {
                    candidates.push(entry.path());
                }
            }
        }
        for skill_dir in candidates {
            let skill_path = skill_dir.join("SKILL.md");
            if skill_path.exists() {
                let backup_path = skill_dir.join("SKILL.md.removed");
                std::fs::rename(&skill_path, &backup_path)?;
                info!("Undeployed plugin {}", plugin_id);
            }
        }
        Ok(())
    }

    /// Retire the discovery manifest of an agent-created bundle while keeping
    /// a recoverable local copy. Without this, the next registry scan would
    /// recreate a plugin that the user had explicitly deleted.
    pub fn retire_agentic_bundle(&self, plugin_id: &str) -> AppResult<()> {
        let skills_dir = Self::bob_skills_dir()?;
        if !skills_dir.is_dir() {
            return Ok(());
        }
        for entry in std::fs::read_dir(&skills_dir)?.filter_map(Result::ok) {
            let skill_dir = entry.path();
            let marker = skill_dir.join(".bob-work-plugin-id");
            if std::fs::read_to_string(&marker).ok().as_deref() != Some(plugin_id) {
                continue;
            }
            let manifest = skill_dir.join(".bob-work-plugin.json");
            if manifest.exists() {
                std::fs::rename(&manifest, skill_dir.join(".bob-work-plugin.json.removed"))?;
            }
        }
        Ok(())
    }

    /// Restore a plugin from its backup
    #[allow(dead_code)]
    pub fn rollback(&self, plugin_id: &str) -> AppResult<()> {
        let skills_dir = Self::bob_skills_dir()?;
        let skill_dir = skills_dir.join(plugin_id);
        let skill_path = skill_dir.join("SKILL.md");
        let backup_path = skill_dir.join("SKILL.md.bak");

        if backup_path.exists() {
            std::fs::copy(&backup_path, &skill_path)?;
            std::fs::remove_file(&backup_path)?;
            info!("Rolled back plugin {}", plugin_id);
            Ok(())
        } else {
            Err(AppError::NotFound(format!(
                "No backup found for plugin {}",
                plugin_id
            )))
        }
    }

    /// List all deployed plugins (skill YAML files in ~/.bob/skills/)
    #[allow(dead_code)]
    pub fn list_deployed(&self) -> Vec<String> {
        let Ok(dir) = Self::bob_skills_dir() else {
            return vec![];
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            return vec![];
        };

        entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().join("SKILL.md").is_file())
            .filter_map(|e| {
                e.path()
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .collect()
    }

    fn bob_skills_dir() -> AppResult<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".to_string()))?;
        Ok(home.join(".bob").join("skills"))
    }

    fn safe_slug(name: &str, fallback: &str) -> String {
        let slug = name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect::<String>();
        let slug = slug
            .split('-')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        let slug = slug.chars().take(64).collect::<String>();
        if slug.is_empty() {
            fallback.to_string()
        } else {
            slug
        }
    }

    /// Convert a Bob Work manifest to Bob Shell 2 SKILL.md.
    fn manifest_to_skill_markdown(slug: &str, manifest: &Value) -> String {
        let description = manifest
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let instructions = manifest
            .get("instructions")
            .and_then(|v| v.as_str())
            .or_else(|| manifest.get("content").and_then(|v| v.as_str()));
        let skill_body = if let Some(instructions) = instructions {
            instructions.to_string()
        } else if let Some(skills) = manifest.get("skills").and_then(|s| s.as_array()) {
            skills
                .iter()
                .map(|skill| {
                    let sname = skill
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("skill");
                    let sdesc = skill
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let scontent = skill.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    format!("## {}\n\n{}\n\n{}", sname, sdesc, scontent)
                })
                .collect::<Vec<_>>()
                .join("\n\n")
        } else {
            description.to_string()
        };
        let safe_description = description.replace('\n', " ").replace('"', "\\\"");
        format!(
            "---\nname: {}\ndescription: \"{}\"\nuser-invocable: true\n---\n\n{}\n",
            slug, safe_description, skill_body
        )
    }

    fn skill_is_disabled(markdown: &str) -> bool {
        markdown.lines().any(|line| {
            line.trim()
                .eq_ignore_ascii_case("disable-model-invocation: true")
        })
    }

    fn with_disabled_state(markdown: String, disabled: bool) -> String {
        if !disabled {
            return markdown;
        }
        markdown.replacen(
            "user-invocable: true\n",
            "user-invocable: true\ndisable-model-invocation: true\n",
            1,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::PluginDeployService;

    #[test]
    fn preserves_a_disabled_skill_when_a_plugin_is_refreshed() {
        let refreshed = PluginDeployService::with_disabled_state(
            "---\nname: example\nuser-invocable: true\n---\n\nBody\n".into(),
            true,
        );
        assert!(PluginDeployService::skill_is_disabled(&refreshed));
        assert_eq!(
            refreshed.matches("disable-model-invocation: true").count(),
            1
        );
    }
}
