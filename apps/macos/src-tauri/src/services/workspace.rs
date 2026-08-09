use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::workspace::{
    CreatePermissionGrantInput, McpServer, PermissionGrant, SaveMcpServerInput, SaveSkillInput,
    SearchResult, Skill, UsageStatus,
};
use chrono::Utc;
use rusqlite::params;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use uuid::Uuid;

pub struct WorkspaceService;

impl WorkspaceService {
    pub fn new() -> Self {
        Self
    }

    pub fn search(&self, db: &Database, query: &str, limit: i64) -> AppResult<Vec<SearchResult>> {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|term| {
                term.chars()
                    .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                    .collect::<String>()
            })
            .filter(|term| !term.is_empty())
            .map(|term| format!("\"{}\"*", term.replace('"', "")))
            .collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let expression = terms.join(" AND ");
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT entity_type, entity_id, project_id, title,
             snippet(search_index, 4, '<mark>', '</mark>', ' … ', 18), bm25(search_index)
             FROM search_index WHERE search_index MATCH ?1 ORDER BY bm25(search_index) LIMIT ?2",
        )?;
        let mut seen = HashSet::new();
        let results = stmt
            .query_map(params![expression, limit.clamp(1, 100)], |row| {
                Ok(SearchResult {
                    entity_type: row.get(0)?,
                    entity_id: row.get(1)?,
                    project_id: row.get(2)?,
                    title: row.get(3)?,
                    snippet: row.get::<_, String>(4).unwrap_or_default(),
                    score: row.get::<_, f64>(5).unwrap_or(0.0),
                })
            })?
            .filter_map(Result::ok)
            .filter(|result| seen.insert(format!("{}:{}", result.entity_type, result.entity_id)))
            .collect();
        Ok(results)
    }

    pub fn list_skills(&self, workspace: Option<&str>) -> Vec<Skill> {
        let mut roots: Vec<(PathBuf, String)> = vec![];
        if let Some(home) = dirs::home_dir() {
            roots.push((home.join(".bob/skills"), "global-bob".into()));
            roots.push((home.join(".agents/skills"), "global-agents".into()));
            roots.push((home.join(".claude/skills"), "global-claude".into()));
        }
        if let Some(workspace) = workspace {
            let root = PathBuf::from(workspace);
            roots.push((root.join(".bob/skills"), "workspace-bob".into()));
            roots.push((root.join(".agents/skills"), "workspace-agents".into()));
            roots.push((root.join(".claude/skills"), "workspace-claude".into()));
        }
        let mut seen = HashSet::new();
        let mut skills = vec![];
        for (root, scope) in roots {
            let Ok(entries) = std::fs::read_dir(&root) else {
                continue;
            };
            for entry in entries.filter_map(Result::ok) {
                if !entry.path().is_dir() {
                    continue;
                }
                let path = entry.path().join("SKILL.md");
                let Ok(content) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let slug = entry.file_name().to_string_lossy().to_string();
                if !seen.insert(slug.clone()) {
                    continue;
                }
                let (frontmatter, body) = parse_frontmatter(&content);
                let description = frontmatter
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let name = frontmatter
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(&slug)
                    .to_string();
                let enabled = !frontmatter
                    .get("disable-model-invocation")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                skills.push(Skill {
                    slug,
                    name,
                    description,
                    content: body,
                    source_path: path.to_string_lossy().to_string(),
                    scope: scope.clone(),
                    enabled,
                });
            }
        }
        skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        skills
    }

    pub fn save_skill(&self, input: SaveSkillInput) -> AppResult<Skill> {
        validate_slug(&input.slug)?;
        if input.description.trim().is_empty() || input.content.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "La description et les instructions du skill sont obligatoires.".into(),
            ));
        }
        let root = if let Some(workspace) = input.workspace.as_deref() {
            PathBuf::from(workspace).join(".bob/skills")
        } else {
            dirs::home_dir()
                .ok_or_else(|| AppError::Io("Dossier utilisateur introuvable".into()))?
                .join(".bob/skills")
        };
        let skill_dir = root.join(&input.slug);
        std::fs::create_dir_all(&skill_dir)?;
        let path = skill_dir.join("SKILL.md");
        let backup = skill_dir.join("SKILL.md.bak");
        if path.exists() {
            std::fs::copy(&path, &backup)?;
        }
        let description = input.description.replace('\n', " ").replace('"', "\\\"");
        let markdown = format!(
            "---\nname: {}\ndescription: \"{}\"\nuser-invocable: true\n---\n\n{}\n",
            input.slug,
            description,
            input.content.trim()
        );
        let temporary = skill_dir.join("SKILL.md.tmp");
        std::fs::write(&temporary, markdown)?;
        std::fs::rename(&temporary, &path)?;
        let _ = std::fs::remove_file(backup);
        Ok(Skill {
            slug: input.slug.clone(),
            name: input.slug,
            description: input.description,
            content: input.content,
            source_path: path.to_string_lossy().to_string(),
            scope: if input.workspace.is_some() {
                "workspace-bob".into()
            } else {
                "global-bob".into()
            },
            enabled: true,
        })
    }

    pub fn set_skill_enabled(
        &self,
        slug: &str,
        scope: &str,
        workspace: Option<&str>,
        enabled: bool,
    ) -> AppResult<()> {
        validate_slug(slug)?;
        let root = match scope {
            "global-bob" => dirs::home_dir()
                .ok_or_else(|| AppError::Io("Dossier utilisateur introuvable".into()))?
                .join(".bob/skills"),
            "global-agents" => dirs::home_dir()
                .ok_or_else(|| AppError::Io("Dossier utilisateur introuvable".into()))?
                .join(".agents/skills"),
            "global-claude" => dirs::home_dir()
                .ok_or_else(|| AppError::Io("Dossier utilisateur introuvable".into()))?
                .join(".claude/skills"),
            "workspace-bob" | "workspace-agents" | "workspace-claude" => {
                let workspace = workspace.ok_or_else(|| {
                    AppError::ValidationFailed(
                        "Le dossier du projet est requis pour modifier ce skill.".into(),
                    )
                })?;
                let folder = match scope {
                    "workspace-bob" => ".bob/skills",
                    "workspace-agents" => ".agents/skills",
                    _ => ".claude/skills",
                };
                PathBuf::from(workspace).join(folder)
            }
            _ => {
                return Err(AppError::ValidationFailed(format!(
                    "Portée de skill inconnue : {}",
                    scope
                )))
            }
        };
        Self::set_skill_enabled_at_path(&root.join(slug).join("SKILL.md"), enabled)
    }

    fn set_skill_enabled_at_path(path: &std::path::Path, enabled: bool) -> AppResult<()> {
        if !path.is_file() {
            return Err(AppError::NotFound(format!(
                "Skill introuvable : {}",
                path.display()
            )));
        }
        let content = std::fs::read_to_string(path)?;
        let (mut frontmatter, body) = parse_frontmatter(&content);
        let metadata = frontmatter.as_object_mut().ok_or_else(|| {
            AppError::ValidationFailed("Le frontmatter du skill doit être un objet YAML.".into())
        })?;
        if enabled {
            metadata.remove("disable-model-invocation");
        } else {
            metadata.insert("disable-model-invocation".into(), Value::Bool(true));
        }
        let yaml = serde_yaml::to_string(&frontmatter)
            .map_err(|error| AppError::Serialization(error.to_string()))?;
        let markdown = format!("---\n{}---\n\n{}\n", yaml, body.trim());
        let temporary = path.with_extension("md.tmp");
        std::fs::write(&temporary, markdown)?;
        std::fs::rename(temporary, path)?;
        Ok(())
    }

    pub fn install_builtin_integration(&self, integration_id: &str) -> AppResult<Skill> {
        let (slug, description, content) = match integration_id {
            "github" => (
                "bob-work-github",
                "Use GitHub locally through the gh CLI for repositories, issues and pull requests.",
                "Use the `gh` CLI and the GH_TOKEN already provided by Bob Work. Never print, echo, log or persist the token. Start with read-only commands. Ask for explicit approval before creating or editing issues, opening or merging pull requests, pushing code, changing settings, or deleting anything. Summarize every external mutation with its URL.",
            ),
            "slack" => (
                "bob-work-slack",
                "Use the Slack Web API with the local Bob Work Slack credential.",
                "Use Slack Web API calls with the SLACK_BOT_TOKEN environment variable. Never print, echo, log or persist the token. Resolve channel and user identities before acting. Reading and searching may proceed within the granted scope; always ask explicit approval immediately before sending, editing, or deleting a message. Return channel, timestamp, and permalink when available.",
            ),
            "monday" => (
                "bob-work-monday",
                "Use Monday.com GraphQL API with the local Bob Work credential.",
                "Use the Monday.com GraphQL API with the MONDAY_API_TOKEN environment variable. Never print, echo, log or persist the token. Query schema and board/item identifiers before acting. Ask explicit approval before creating, changing, moving, archiving, or deleting any item, board, update, or automation. Summarize mutations with stable identifiers.",
            ),
            "outlook-mail" => (
                "bob-work-outlook-mail",
                "Use Microsoft Graph for Outlook mail with the Bob Work Microsoft OAuth credential.",
                "Use Microsoft Graph with the MICROSOFT_GRAPH_ACCESS_TOKEN environment variable. Never print, echo, log or persist the token. Prefer read/search/draft operations first. Ask explicit approval before sending, moving, deleting or permanently changing mail. Return stable Graph identifiers and web links when available.",
            ),
            "outlook-calendar" => (
                "bob-work-outlook-calendar",
                "Use Microsoft Graph for Outlook Calendar with the Bob Work Microsoft OAuth credential.",
                "Use Microsoft Graph with the MICROSOFT_GRAPH_ACCESS_TOKEN environment variable. Never print, echo, log or persist the token. Read availability and events before proposing changes. Ask explicit approval before creating, updating, cancelling or deleting calendar events. Return event IDs and web links when available.",
            ),
            "teams" => (
                "bob-work-teams",
                "Use Microsoft Graph for Teams channels and messages with the Bob Work Microsoft OAuth credential.",
                "Use Microsoft Graph with the MICROSOFT_GRAPH_ACCESS_TOKEN environment variable. Never print, echo, log or persist the token. Resolve team, channel and message identifiers before acting. Ask explicit approval before posting, editing or deleting Teams messages. Summarize every external mutation with stable identifiers.",
            ),
            "onedrive" => (
                "bob-work-onedrive",
                "Use Microsoft Graph for OneDrive files with the Bob Work Microsoft OAuth credential.",
                "Use Microsoft Graph with the MICROSOFT_GRAPH_ACCESS_TOKEN environment variable. Never print, echo, log or persist the token. Search and inspect files before writing. Ask explicit approval before uploading, overwriting, moving or deleting files. Return drive item IDs, paths and web URLs when available.",
            ),
            _ => return Err(AppError::ValidationFailed("Cette intégration n’a pas de skill local intégré.".into())),
        };
        self.save_skill(SaveSkillInput {
            slug: slug.into(),
            description: description.into(),
            content: content.into(),
            workspace: None,
        })
    }

    pub fn delete_skill(&self, slug: &str, workspace: Option<&str>) -> AppResult<()> {
        validate_slug(slug)?;
        let root = if let Some(workspace) = workspace {
            PathBuf::from(workspace).join(".bob/skills")
        } else {
            dirs::home_dir()
                .ok_or_else(|| AppError::Io("Dossier utilisateur introuvable".into()))?
                .join(".bob/skills")
        };
        let skill_dir = root.join(slug);
        if !skill_dir.join("SKILL.md").exists() {
            return Err(AppError::NotFound(format!("Skill {} introuvable", slug)));
        }
        let trash = root.join(".trash");
        std::fs::create_dir_all(&trash)?;
        let destination = trash.join(format!("{}-{}", slug, Utc::now().timestamp()));
        std::fs::rename(skill_dir, destination)?;
        Ok(())
    }

    pub fn list_mcp_servers(&self) -> Vec<McpServer> {
        let Some(home) = dirs::home_dir() else {
            return vec![];
        };
        Self::list_mcp_servers_from_home(&home)
    }

    fn list_mcp_servers_from_home(home: &std::path::Path) -> Vec<McpServer> {
        let candidates = [
            home.join(".bob/settings/mcp.json"),
            home.join(".bob/settings/mcp_settings.json"),
        ];
        let mut merged = HashMap::<String, McpServer>::new();
        for path in candidates {
            let Ok(content) = std::fs::read_to_string(path) else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<Value>(&content) else {
                continue;
            };
            let servers = json
                .get("mcpServers")
                .or_else(|| json.get("servers"))
                .and_then(Value::as_object);
            let Some(servers) = servers else {
                continue;
            };
            for (name, raw) in servers {
                let transport = raw
                    .get("type")
                    .or_else(|| raw.get("transport"))
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| {
                        if raw.get("url").is_some() {
                            "http"
                        } else {
                            "stdio"
                        }
                    })
                    .to_string();
                let command_or_url = raw
                    .get("url")
                    .or_else(|| raw.get("command"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let args = raw
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|args| {
                        args.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                let enabled = !raw
                    .get("disabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    && raw.get("enabled").and_then(Value::as_bool).unwrap_or(true);
                merged.insert(
                    name.clone(),
                    McpServer {
                        name: name.clone(),
                        transport,
                        command_or_url,
                        args,
                        enabled,
                        status: "configured".into(),
                        raw: redact_mcp_raw(raw.clone()),
                    },
                );
            }
        }
        let mut values: Vec<McpServer> = merged.into_values().collect();
        values.sort_by(|a, b| a.name.cmp(&b.name));
        values
    }

    pub fn save_mcp_server(&self, bob_path: &str, input: SaveMcpServerInput) -> AppResult<()> {
        validate_slug(&input.name)?;
        if input.command_or_url.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "Commande ou URL MCP obligatoire".into(),
            ));
        }
        let mut config = Map::new();
        if input.transport == "http" || input.transport == "sse" {
            config.insert("type".into(), Value::String(input.transport.clone()));
            config.insert("url".into(), Value::String(input.command_or_url));
        } else {
            config.insert("command".into(), Value::String(input.command_or_url));
            config.insert(
                "args".into(),
                Value::Array(input.args.into_iter().map(Value::String).collect()),
            );
        }
        let output = std::process::Command::new(bob_path)
            .args([
                "mcp",
                "add-json",
                &input.name,
                &Value::Object(config).to_string(),
            ])
            .output()
            .map_err(|e| AppError::BobExecutionFailed(e.to_string()))?;
        if !output.status.success() {
            return Err(AppError::BobExecutionFailed(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }
        if !input.enabled {
            let _ = std::process::Command::new(bob_path)
                .args(["mcp", "disable", &input.name])
                .output();
        }
        Ok(())
    }

    pub fn set_mcp_enabled(&self, bob_path: &str, name: &str, enabled: bool) -> AppResult<()> {
        validate_slug(name)?;
        let action = if enabled { "enable" } else { "disable" };
        let output = std::process::Command::new(bob_path)
            .args(["mcp", action, name])
            .output()
            .map_err(|e| AppError::BobExecutionFailed(e.to_string()))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(AppError::BobExecutionFailed(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ))
        }
    }

    pub fn delete_mcp_server(&self, bob_path: &str, name: &str) -> AppResult<()> {
        validate_slug(name)?;
        let output = std::process::Command::new(bob_path)
            .args(["mcp", "remove", name])
            .output()
            .map_err(|e| AppError::BobExecutionFailed(e.to_string()))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(AppError::BobExecutionFailed(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ))
        }
    }

    pub fn list_permission_grants(&self, db: &Database) -> AppResult<Vec<PermissionGrant>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,action_type,resource,scope,scope_id,decision,expires_at,revoked_at,created_at
             FROM permission_grants WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC"
        )?;
        let grants = stmt
            .query_map([], |row| {
                Ok(PermissionGrant {
                    id: row.get(0)?,
                    action_type: row.get(1)?,
                    resource: row.get(2)?,
                    scope: row.get(3)?,
                    scope_id: row.get(4)?,
                    decision: row.get(5)?,
                    expires_at: row.get(6)?,
                    revoked_at: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();
        Ok(grants)
    }

    pub fn create_permission_grant(
        &self,
        db: &Database,
        input: CreatePermissionGrantInput,
    ) -> AppResult<PermissionGrant> {
        if !matches!(
            input.scope.as_str(),
            "once" | "task" | "conversation" | "project" | "always"
        ) {
            return Err(AppError::ValidationFailed(
                "Portée de permission invalide".into(),
            ));
        }
        if !matches!(input.decision.as_str(), "allow" | "deny") {
            return Err(AppError::ValidationFailed(
                "Décision de permission invalide".into(),
            ));
        }
        let grant = PermissionGrant {
            id: Uuid::new_v4().to_string(),
            action_type: input.action_type,
            resource: input.resource,
            scope: input.scope,
            scope_id: input.scope_id,
            decision: input.decision,
            expires_at: input.expires_at,
            revoked_at: None,
            created_at: Utc::now().to_rfc3339(),
        };
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO permission_grants (id,action_type,resource,scope,scope_id,decision,expires_at,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![grant.id,grant.action_type,grant.resource,grant.scope,grant.scope_id,grant.decision,grant.expires_at,grant.created_at],
        )?;
        Ok(grant)
    }

    pub fn revoke_permission_grant(&self, db: &Database, id: &str) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE permission_grants SET revoked_at=?1 WHERE id=?2",
            params![Utc::now().to_rfc3339(), id],
        )?;
        if changed == 0 {
            Err(AppError::NotFound("Autorisation introuvable".into()))
        } else {
            Ok(())
        }
    }

    pub fn usage_status(&self, db: &Database) -> UsageStatus {
        use crate::services::bob_usage::BobUsageService;

        let service = BobUsageService::new();
        let latest = service.latest_snapshot(db).ok().flatten();
        let snapshot = if BobUsageService::should_refresh(latest.as_ref()) {
            match service.refresh_snapshot(db) {
                Ok(fresh) => fresh.or(latest),
                Err(error) => {
                    if let Some(existing) = latest {
                        return snapshot_to_status(existing, false, error.to_string());
                    }
                    return UsageStatus {
                        available: false,
                        used_amount: None,
                        remaining_amount: None,
                        total_amount: None,
                        unit: None,
                        captured_at: None,
                        instance_label: None,
                        message: error.to_string(),
                    };
                }
            }
        } else {
            latest
        };

        match snapshot {
            Some(data) => snapshot_to_status(data, true, "Consommation Bobcoins synchronisée avec Bob Shell.".into()),
            None => UsageStatus {
                available: false,
                used_amount: None,
                remaining_amount: None,
                total_amount: None,
                unit: None,
                captured_at: None,
                instance_label: None,
                message: "Connectez-vous à Bob Shell (bob chat) pour afficher vos Bobcoins.".into(),
            },
        }
    }
}

fn snapshot_to_status(
    data: crate::services::bob_usage::UsageSnapshotData,
    available: bool,
    message: String,
) -> UsageStatus {
    UsageStatus {
        available,
        used_amount: data.used_amount,
        remaining_amount: data.remaining_amount,
        total_amount: data.total_amount,
        unit: Some(data.unit),
        captured_at: Some(data.captured_at),
        instance_label: data.instance_label,
        message,
    }
}

#[cfg(test)]
mod mcp_tests {
    use super::WorkspaceService;

    fn isolated_home() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("bob-work-mcp-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn parses_and_redacts_native_bob_mcp_configuration() {
        let home = isolated_home();
        let settings = home.join(".bob/settings");
        std::fs::create_dir_all(&settings).unwrap();
        std::fs::write(
            settings.join("mcp.json"),
            r#"{"mcpServers":{"local":{"command":"/usr/bin/true","args":["--safe"],"env":{"TOKEN":"secret-value"}},"remote":{"type":"http","url":"https://example.test/mcp","disabled":true}}}"#,
        )
        .unwrap();

        let servers = WorkspaceService::list_mcp_servers_from_home(&home);
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "local");
        assert_eq!(servers[0].command_or_url, "/usr/bin/true");
        assert_eq!(servers[0].args, vec!["--safe"]);
        assert!(servers[0].enabled);
        assert!(!servers[0].raw.to_string().contains("secret-value"));
        assert_eq!(servers[1].transport, "http");
        assert!(!servers[1].enabled);

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn ignores_a_corrupted_mcp_file_without_crashing() {
        let home = isolated_home();
        let settings = home.join(".bob/settings");
        std::fs::create_dir_all(&settings).unwrap();
        std::fs::write(settings.join("mcp.json"), "{invalid-json").unwrap();

        assert!(WorkspaceService::list_mcp_servers_from_home(&home).is_empty());

        std::fs::remove_dir_all(&home).unwrap();
    }
}

#[cfg(test)]
mod skill_tests {
    use super::{parse_frontmatter, WorkspaceService};
    use serde_json::Value;

    fn isolated_skill() -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("bob-work-skill-test-{}", uuid::Uuid::new_v4()));
        let skill = root.join("example/SKILL.md");
        std::fs::create_dir_all(skill.parent().unwrap()).unwrap();
        std::fs::write(
            &skill,
            "---\nname: example\ndescription: Test\nuser-invocable: true\n---\n\nInstructions importantes.\n",
        )
        .unwrap();
        skill
    }

    #[test]
    fn disables_and_reenables_a_skill_without_losing_its_content() {
        let path = isolated_skill();

        WorkspaceService::set_skill_enabled_at_path(&path, false).unwrap();
        let disabled = std::fs::read_to_string(&path).unwrap();
        let (metadata, body) = parse_frontmatter(&disabled);
        assert_eq!(
            metadata.get("disable-model-invocation"),
            Some(&Value::Bool(true))
        );
        assert_eq!(
            metadata.get("description").and_then(Value::as_str),
            Some("Test")
        );
        assert_eq!(body, "Instructions importantes.");

        WorkspaceService::set_skill_enabled_at_path(&path, true).unwrap();
        let enabled = std::fs::read_to_string(&path).unwrap();
        let (metadata, body) = parse_frontmatter(&enabled);
        assert!(metadata.get("disable-model-invocation").is_none());
        assert_eq!(body, "Instructions importantes.");

        std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
}

fn validate_slug(slug: &str) -> AppResult<()> {
    let valid = !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--");
    if valid {
        Ok(())
    } else {
        Err(AppError::ValidationFailed(
            "Le nom doit utiliser a-z, 0-9 et des tirets simples (64 caractères maximum).".into(),
        ))
    }
}

fn parse_frontmatter(content: &str) -> (Value, String) {
    let normalized = content.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            let yaml = &rest[..end];
            let body = rest[end + 5..].trim().to_string();
            let value = serde_yaml::from_str::<serde_yaml::Value>(yaml)
                .ok()
                .and_then(|value| serde_json::to_value(value).ok())
                .unwrap_or_default();
            return (value, body);
        }
    }
    (Value::Object(Map::new()), normalized.trim().to_string())
}

fn redact_mcp_raw(mut value: Value) -> Value {
    if let Some(map) = value.as_object_mut() {
        for key in ["env", "headers", "token", "authorization"] {
            if map.contains_key(key) {
                map.insert(key.to_string(), Value::String("<stored securely>".into()));
            }
        }
    }
    value
}
