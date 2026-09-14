// ============================================================
// Bob Work - Plugin Deployment Service
// Installs/uninstalls plugins into ~/.bob/skills/ and modes
// with transactional safety and rollback support
// ============================================================

use crate::error::{AppError, AppResult};
use crate::services::office_plugin_bundle::OfficePluginBundle;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tracing::{info, warn};

pub struct PluginDeployService;

const DEPLOYED_VERSION_MARKER: &str = ".bob-work-deployed-version";
pub const PLUGIN_INVOCATION_POLICY: &str = "Politique plugins/skills Bob Work : (1) Une mention `@plugin:` ou `@skill:` dans le prompt courant prime toujours — charge et suis cette ressource en premier. (2) Sans @mention, décide d’abord avec `@skill:capability-router` (ou sa règle) : tâches natives (fichier .txt vide, markdown, édition code, shell simple) → outils Bob natifs, sans plugin. (3) Active un handler plateforme seulement quand l’intention/pièces jointes l’exigent sans ambiguïté (Visualize pour charts/HTML interactif, PowerPoint, Word, Excel, Documents, Docling, Chrome seulement pour un site web http(s) visible, Computer Use si autorisé). (4) Ne charge pas un plugin par proximité thématique, historique ou « enrichissement ». (5) Le choix explicite d’un autre outil (Docling, Pandoc, LibreOffice, Chrome…) prime. (6) Charge le minimum d’instructions ; pas d’exploration de catalogue. (7) Ne crée ni ne modifie jamais un plugin/skill sous `~/.bob/skills/` sauf demande explicite (« crée un plugin/skill », modes plugin_builder / skill_builder).";

pub const PLUGIN_ROUTING_GUIDANCE: &str = "Routage intelligent natif vs plugin : pour une action triviale (créer `fichier.txt`, écrire du markdown, lister le workspace) utilise les outils natifs — plus rapide et plus fiable. Pour un graphique, dashboard ou visuel interactif (même demandé avec un PPT), charge `builtin-visualize` / `@plugin:visualize` : écris un `.html` durable dans le workspace et cite son chemin absolu (`/Users/.../file.html`, jamais `file://`) — Bob Work l’affiche en preview inline dans la conversation. Le PPTX (`builtin-powerpoint`) est un export Office en plus, pas un substitut à cette preview. N’utilise jamais Chrome pour prévisualiser un HTML local. Pour DOCX/XLSX, PDF riche/OCR (Docling), diagramme d’architecture pro, site web http(s) visible (Chrome) ou Computer Use, charge le skill/plugin dédié dès que l’intention est claire. En cas d’hésitation, appelle `@skill:capability-router`. Ne parcours pas le catalogue ; en doute entre deux handlers, choisis le plus spécifique ou pose une question courte.";

/// Short block injected so Bob knows MCP/skills are loaded lazily.
pub const LAZY_CAPABILITY_GUIDANCE: &str = "Chargement lazy Bob Work : les serveurs MCP et le contexte plugin ne sont pas tous préchargés. Les tâches natives restent disponibles immédiatement. Si tu as besoin d’un plugin/skill spécialisé (Visualize, Office, Docling, Chrome, architecture…), charge-le à la volée avec `use_skill` / la mention appropriée — le routeur `@skill:capability-router` t’y aide. Ne dégrade pas la réponse : si le natif ne suffit pas, charge le bon plugin plutôt que d’improviser.";

impl PluginDeployService {
    pub fn new() -> Self {
        Self
    }

    /// Deploy a plugin manifest using Bob Shell 2's canonical
    /// `~/.bob/skills/<slug>/SKILL.md` layout.
    pub fn deploy(&self, plugin_id: &str, manifest: &Value) -> AppResult<PathBuf> {
        self.deploy_with_options(plugin_id, manifest, true)
    }

    /// Like [`deploy`](Self::deploy), but keep existing Office/CTO Python files
    /// when present (used when the active version is ahead of the packaged one).
    pub fn deploy_preserving_embedded(
        &self,
        plugin_id: &str,
        manifest: &Value,
    ) -> AppResult<PathBuf> {
        self.deploy_with_options(plugin_id, manifest, false)
    }

    /// True when `~/.bob/skills/<slug>` already matches this plugin id + version.
    pub fn is_current_deploy(&self, plugin_id: &str, version: &str, manifest: &Value) -> bool {
        let Ok(skill_dir) = self.skill_dir_for(plugin_id, manifest) else {
            return false;
        };
        if !std::fs::read_to_string(skill_dir.join("SKILL.md"))
            .is_ok_and(|content| content.contains(PLUGIN_INVOCATION_POLICY))
        {
            return false;
        }
        let owned_by = std::fs::read_to_string(skill_dir.join(".bob-work-plugin-id"))
            .ok()
            .map(|value| value.trim().to_string());
        if owned_by.as_deref() != Some(plugin_id) {
            return false;
        }
        let marker = std::fs::read_to_string(skill_dir.join(DEPLOYED_VERSION_MARKER))
            .ok()
            .map(|value| value.trim().to_string());
        let expected = OfficePluginBundle::deployment_fingerprint(plugin_id, manifest)
            .ok()
            .map(|fingerprint| format!("{plugin_id}\n{version}\nsha256:{fingerprint}"));
        marker.as_deref() == expected.as_deref()
    }

    fn deploy_with_options(
        &self,
        plugin_id: &str,
        manifest: &Value,
        overwrite_embedded: bool,
    ) -> AppResult<PathBuf> {
        let skills_dir = Self::bob_skills_dir()?;
        let skill_dir = self.skill_dir_for(plugin_id, manifest)?;
        let requested_name = manifest
            .get("slug")
            .and_then(|v| v.as_str())
            .or_else(|| manifest.get("name").and_then(|v| v.as_str()))
            .unwrap_or(plugin_id);
        let slug = Self::safe_slug(requested_name, plugin_id);

        // Backup existing skill if any. A manual enable/disable choice made in
        // Bob Work must survive the automatic refresh of built-in plugins.
        let was_disabled = std::fs::read_to_string(skill_dir.join("SKILL.md"))
            .ok()
            .is_some_and(|content| Self::skill_is_disabled(&content));
        let owned_by_plugin = std::fs::read_to_string(skill_dir.join(".bob-work-plugin-id"))
            .ok()
            .is_some_and(|value| value.trim() == plugin_id);
        // Personal agentic bundles must never hit replace_managed_tree: that
        // regenerates SKILL.md with policy jargon and can delete
        // .bob-work-plugin.json. Callers (activate_version / toggle) already
        // skip deploy for requires_agentic_version_snapshot; this hardens any
        // remaining path that still owns a live authored tree.
        let authored_agentic_tree = skill_dir.join(".bob-work-plugin.json").is_file()
            && (plugin_id.starts_with("agentic-")
                || manifest.get("managedBy").and_then(|value| value.as_str()) == Some("bob-agent"));
        let replace_managed_tree =
            overwrite_embedded && owned_by_plugin && skill_dir.exists() && !authored_agentic_tree;
        if authored_agentic_tree {
            if skill_dir.join("SKILL.md").is_file() {
                return Ok(skill_dir.join("SKILL.md"));
            }
            return Err(AppError::Plugin(format!(
                "Le bundle agentique {} n’a pas de SKILL.md à déployer. Republiez depuis ~/.bob/skills/.",
                plugin_id
            )));
        }
        std::fs::create_dir_all(&skills_dir)?;
        let deployment_dir = if replace_managed_tree {
            skills_dir.join(format!(".{slug}.deploy-{}", uuid::Uuid::new_v4()))
        } else {
            skill_dir.clone()
        };
        std::fs::create_dir_all(&deployment_dir)?;
        let skill_path = deployment_dir.join("SKILL.md");
        let backup_path = deployment_dir.join("SKILL.md.bak");
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
        let _ = std::fs::write(deployment_dir.join(".bob-work-plugin-id"), plugin_id);

        if let Err(error) = OfficePluginBundle::write_bundle(
            &deployment_dir,
            plugin_id,
            manifest,
            overwrite_embedded,
        ) {
            if replace_managed_tree {
                let _ = std::fs::remove_dir_all(&deployment_dir);
            }
            return Err(error);
        }

        let version = manifest
            .get("version")
            .and_then(|value| value.as_str())
            .unwrap_or("0.0.0");
        let fingerprint = OfficePluginBundle::deployment_fingerprint(plugin_id, manifest)?;
        let _ = std::fs::write(
            deployment_dir.join(DEPLOYED_VERSION_MARKER),
            format!("{plugin_id}\n{version}\nsha256:{fingerprint}"),
        );

        if replace_managed_tree {
            let previous_dir =
                skills_dir.join(format!(".{slug}.previous-{}", uuid::Uuid::new_v4()));
            std::fs::rename(&skill_dir, &previous_dir)?;
            if let Err(error) = std::fs::rename(&deployment_dir, &skill_dir) {
                let _ = std::fs::rename(&previous_dir, &skill_dir);
                let _ = std::fs::remove_dir_all(&deployment_dir);
                return Err(error.into());
            }
            let _ = std::fs::remove_dir_all(previous_dir);
        }

        info!(
            "Deployed plugin {} as Bob skill {} to {:?}",
            plugin_id,
            slug,
            skill_dir.join("SKILL.md")
        );
        Ok(skill_dir.join("SKILL.md"))
    }

    fn skill_dir_for(&self, plugin_id: &str, manifest: &Value) -> AppResult<PathBuf> {
        let skills_dir = Self::bob_skills_dir()?;
        let requested_name = manifest
            .get("slug")
            .and_then(|v| v.as_str())
            .or_else(|| manifest.get("name").and_then(|v| v.as_str()))
            .unwrap_or(plugin_id);
        let slug = Self::safe_slug(requested_name, plugin_id);
        Ok(skills_dir.join(slug))
    }

    /// Remove obsolete copies of Bob-managed built-ins. This reconciles the
    /// filesystem with the registry after a plugin id or slug migration while
    /// leaving user-created plugins untouched.
    pub fn prune_stale_managed_deployments(
        &self,
        active_plugins: &[(String, Value)],
    ) -> AppResult<usize> {
        let skills_dir = Self::bob_skills_dir()?;
        Self::prune_stale_managed_deployments_in(&skills_dir, active_plugins)
    }

    /// Permanently remove generated deployment directories owned by an id that
    /// is being migrated. The source remains packaged with the app and can be
    /// rebuilt, so retaining the old generated tree only risks rediscovery.
    pub fn remove_owned_deployments(&self, plugin_id: &str) -> AppResult<usize> {
        let skills_dir = Self::bob_skills_dir()?;
        if !skills_dir.is_dir() {
            return Ok(0);
        }
        let mut removed = 0usize;
        for entry in std::fs::read_dir(skills_dir)?.filter_map(Result::ok) {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let path = entry.path();
            let owned = std::fs::read_to_string(path.join(".bob-work-plugin-id"))
                .ok()
                .is_some_and(|value| value.trim() == plugin_id);
            if owned {
                std::fs::remove_dir_all(path)?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    fn prune_stale_managed_deployments_in(
        skills_dir: &std::path::Path,
        active_plugins: &[(String, Value)],
    ) -> AppResult<usize> {
        if !skills_dir.is_dir() {
            return Ok(0);
        }
        let expected: BTreeMap<&str, PathBuf> = active_plugins
            .iter()
            .map(|(plugin_id, manifest)| {
                let requested_name = manifest
                    .get("slug")
                    .and_then(|value| value.as_str())
                    .or_else(|| manifest.get("name").and_then(|value| value.as_str()))
                    .unwrap_or(plugin_id);
                let slug = Self::safe_slug(requested_name, plugin_id);
                (plugin_id.as_str(), skills_dir.join(slug))
            })
            .collect();
        let mut removed = 0usize;
        for entry in std::fs::read_dir(skills_dir)?.filter_map(Result::ok) {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let path = entry.path();
            let Some(owner) = std::fs::read_to_string(path.join(".bob-work-plugin-id"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let obsolete_duplicate = expected.get(owner.as_str()).is_some_and(|canonical| {
                canonical != &path
                    && canonical.is_dir()
                    && std::fs::read_to_string(canonical.join(".bob-work-plugin-id"))
                        .ok()
                        .is_some_and(|value| value.trim() == owner)
            });
            let orphaned_builtin =
                !expected.contains_key(owner.as_str()) && path.join(".bob-work-builtin").is_file();
            if !obsolete_duplicate && !orphaned_builtin {
                continue;
            }
            match std::fs::remove_dir_all(&path) {
                Ok(()) => {
                    info!("Removed stale Bob-managed plugin deployment {:?}", path);
                    removed += 1;
                }
                Err(error) => warn!(
                    "Could not remove stale Bob-managed plugin deployment {:?}: {}",
                    path, error
                ),
            }
        }
        Ok(removed)
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

    /// Restore an agentic skill previously hidden by [`undeploy`] without
    /// regenerating SKILL.md from the database manifest.
    pub fn restore_agentic_skill(&self, plugin_id: &str) -> AppResult<()> {
        let skills_dir = Self::bob_skills_dir()?;
        if !skills_dir.is_dir() {
            return Ok(());
        }
        for entry in std::fs::read_dir(&skills_dir)?.filter_map(Result::ok) {
            let skill_dir = entry.path();
            let marker = skill_dir.join(".bob-work-plugin-id");
            if std::fs::read_to_string(&marker).ok().as_deref().map(str::trim) != Some(plugin_id) {
                continue;
            }
            let skill_path = skill_dir.join("SKILL.md");
            let removed_path = skill_dir.join("SKILL.md.removed");
            if !skill_path.exists() && removed_path.exists() {
                std::fs::rename(&removed_path, &skill_path)?;
                info!("Restored agentic skill for plugin {}", plugin_id);
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

    pub(crate) fn bob_skills_dir() -> AppResult<PathBuf> {
        #[cfg(test)]
        {
            let test_name = std::thread::current()
                .name()
                .unwrap_or("unknown")
                .to_string();
            let slug = Self::safe_slug(&test_name, "unknown");
            return Ok(std::env::temp_dir()
                .join("bob-work-rust-tests")
                .join(format!("{}-{slug}", std::process::id())));
        }
        #[cfg(not(test))]
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".to_string()))?;
        #[cfg(not(test))]
        return Ok(home.join(".bob").join("skills"));
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
        let description = format!(
            "Activation automatique si l’intention ou les pièces jointes correspondent, sinon sur @mention explicite. {description}"
        );
        let safe_description = description.replace('\n', " ").replace('"', "\\\"");
        let icon = manifest
            .get("icon")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let icon_line = if icon.is_empty() {
            String::new()
        } else {
            format!("icon: {icon}\n")
        };
        format!(
            "---\nname: {}\ndescription: \"{}\"\n{}user-invocable: true\n---\n\n{}\n\n{}\n",
            slug, safe_description, icon_line, PLUGIN_INVOCATION_POLICY, skill_body
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
    use std::fs;

    #[test]
    fn generated_plugin_gates_discovery_without_disabling_explicit_invocation() {
        let markdown = PluginDeployService::manifest_to_skill_markdown(
            "visualize",
            &serde_json::json!({"description": "Charts", "instructions": "Render charts"}),
        );
        let metadata: serde_yaml::Value =
            serde_yaml::from_str(markdown.split("---").nth(1).unwrap()).unwrap();
        assert!(metadata["description"]
            .as_str()
            .unwrap()
            .starts_with("Activation automatique"));
        assert_eq!(metadata["user-invocable"].as_bool(), Some(true));
        assert!(!PluginDeployService::skill_is_disabled(&markdown));
        assert!(markdown.contains(super::PLUGIN_INVOCATION_POLICY));
        assert!(markdown.ends_with("Render charts\n"));
    }

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

    #[test]
    fn prunes_only_obsolete_managed_deployments() {
        let root =
            std::env::temp_dir().join(format!("bob-work-prune-managed-{}", uuid::Uuid::new_v4()));
        let canonical = root.join("current-skill");
        let duplicate = root.join("old-skill-name");
        let orphan = root.join("removed-builtin");
        let personal = root.join("personal-plugin");
        for path in [&canonical, &duplicate, &orphan, &personal] {
            fs::create_dir_all(path).expect("create fixture");
        }
        fs::write(canonical.join(".bob-work-plugin-id"), "builtin-current")
            .expect("canonical owner");
        fs::write(duplicate.join(".bob-work-plugin-id"), "builtin-current")
            .expect("duplicate owner");
        fs::write(orphan.join(".bob-work-plugin-id"), "builtin-removed").expect("orphan owner");
        fs::write(orphan.join(".bob-work-builtin"), "true").expect("builtin marker");
        fs::write(personal.join(".bob-work-plugin-id"), "personal-removed")
            .expect("personal owner");

        let removed = PluginDeployService::prune_stale_managed_deployments_in(
            &root,
            &[(
                "builtin-current".to_string(),
                serde_json::json!({"slug": "current-skill"}),
            )],
        )
        .expect("prune");

        assert_eq!(removed, 2);
        assert!(canonical.is_dir());
        assert!(!duplicate.exists());
        assert!(!orphan.exists());
        assert!(personal.is_dir(), "personal plugins must never be pruned");
        let _ = fs::remove_dir_all(root);
    }
}
