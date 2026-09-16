//! App-level permission governance for Bob Shell launches.
//!
//! Bob Shell 2 headless (`bob run`) does not emit a documented `approval_required`
//! stream event. Starting a session is default-allow (no “autoriser bob run”
//! popup): Bob Work is unusable without `bob run`. Mid-run risky actions keep
//! their own paths. In sandbox mode `--trust` is passed so Bob Shell tools are
//! not soft-blocked outside the workspace folder — Seatbelt remains the FS
//! boundary (including writable host `~/.bob/skills` for skill/plugin creation).
//! Restrictive policies still require a grant unless the built-in session-start
//! grant exists.

use crate::db::Database;
use crate::error::AppResult;
use rusqlite::params;

pub const ACTION_SESSION_START: &str = "bob.session_start";

/// Response guidance, not an OS isolation boundary. Shared by chat and scheduler.
/// Folder-scoped work: no host desktop, no privilege
/// escalation advice. Seatbelt (`sandbox-exec`) enforces the hard FS/process boundary.
/// French sandbox guidance (legacy default). Prefer `agent_locale::sandbox_guidance`.
pub fn sandbox_guidance_fr() -> String {
    "Mode sandbox Bob Work : tu travailles uniquement dans le dossier connecté via Bob Work (workspace) et un HOME/TMP privés de session, détruits à la fin du run — installs et états locaux ne sont pas conservés. Aucun accès aux autres dossiers du Mac (Maison, Bureau, Documents, Downloads, /etc, autres projets) ni au bureau macOS — la confinement disque est assurée par la sandbox OS (Seatbelt), pas par un soft-block workspace des outils. Computer Use est indisponible. Chrome et les sous-agents restent utilisables s’ils sont activés (Chrome via le bridge hôte Bob Work). Les serveurs MCP locaux configurés restent utilisables. Ces limites s’appliquent aussi au terminal, scripts, sous-processus, liens symboliques et plugins. Ne retente jamais une opération refusée (Operation not permitted / limitations sandbox) avec un autre outil pour contourner la limite.\n\
$HOME pointe vers un HOME privé de sandbox, pas la maison réelle de l’utilisateur : un succès sur ~/Desktop ou ~/Documents crée/lit seulement ce HOME isolé. Pour prouver une limite hors workspace, utilise un chemin absolu du Mac hôte (par ex. /Users/<user>/Desktop/…) et rapporte explicitement que c’est bloqué par les limitations de la sandbox Bob Work (Operation not permitted) — ne présente pas le HOME isolé comme le Bureau réel.\n\
Réseau : HTTPS public reste disponible pour l’inférence ; le réseau local, les adresses privées (RFC1918), le link-local et les métadonnées cloud (169.254.169.254) sont interdits. Quotas : durée, CPU, mémoire, taille de fichier et stockage du HOME de session sont plafonnés.\n\
Runtimes partagés plateforme (LaTeX, Pandoc, diagram/D2, skills) sont exposés via `$HOME/.bob/skills` et `$HOME/.bob/runtimes` (liens vers l’hôte) et via PATH / `$BOB_WORK_D2`. Utilise ces chemins — ne déclare pas le plugin ou D2 absents sans avoir testé `test -f \"$HOME/.bob/skills/cloud-architect/scripts/render_professional_svg.py\"` et `command -v d2` (ou `$BOB_WORK_D2`). Exception création skill/plugin : sur demande explicite (`@skill:skill-creator`, `@skill:plugin-creator`, modes skill_builder / plugin_builder, « crée un skill/plugin »), tu **dois** créer ou modifier des bundles sous `$HOME/.bob/skills/<slug>/` avec `write_file` / outils d’édition (ou le terminal) — ces écritures vont sur l’hôte et **persistent** après la session. Ne refuse pas en citant un soft-block workspace : cet arbre est autorisé en sandbox. N’écris pas ailleurs sous `~/.bob` (settings, vault, runtimes). Exception runtime externe : si un plugin ne peut pas s’exécuter parce qu’il dépend d’un runtime externe (`externalRuntimes`, CLI hôte hors runtimes partagés, installation sous ~/.bob/runtimes/external) et que l’échec vient de la sandbox, commence toujours par « Cette action est bloquée par les limitations de la sandbox Bob Work : ce plugin dépend d’un runtime externe » ; nomme le plugin et le runtime ; dis clairement à l’utilisateur de désactiver le mode sandbox dans Réglages → Permissions, puis de relancer hors isolation. Ne simule pas le résultat.\n\
Pour les résumés courts, préfère une liste à puces Markdown (une ligne par constat) plutôt qu’un tableau.\n\
En cas de refus : commence toujours par « Cette action est bloquée par les limitations de la sandbox Bob Work : … » ; nomme l’action et la ressource sans révéler de secret ; distingue un refus de consigne d’une erreur réellement renvoyée par un outil et ne prétends pas avoir effectué une opération non exécutée.\n\
Ne conseille jamais de désactiver la sandbox, de passer en accès direct au disque, d’activer Computer Use ou l’accès complet à l’ordinateur, ni d’élever les privilèges — sauf l’exception runtime externe ci-dessus. Propose plutôt de joindre une copie du fichier nécessaire à la conversation ou de travailler sur une copie explicitement fournie dans le workspace. Pour une action système ou une installation incompatible hors runtime externe, explique la limite sandbox et fournis seulement les étapes que l’utilisateur peut examiner et effectuer lui-même, sans les exécuter. Si aucune solution dans le workspace ne convient, arrête cette action et demande une entrée compatible."
        .to_string()
}

pub fn sandbox_guidance() -> String {
    sandbox_guidance_fr()
}
/// Persistent default-allow for launching `bob run` (any workspace).
/// Matches `MIGRATION_011_SESSION_START_DEFAULT_ALLOW` in `db.rs`.
pub const SESSION_START_DEFAULT_GRANT_ID: &str = "grant_bob_session_start_default";

#[derive(Debug, Clone, Default)]
pub struct RiskContext {
    pub computer_use: bool,
    pub chrome: bool,
    pub mcp: bool,
    pub web: bool,
}

impl RiskContext {
    /// Computer Use / Chrome elevation — kept for mid-run / future gates.
    #[allow(dead_code)]
    pub fn elevated(&self) -> bool {
        self.computer_use || self.chrome
    }

    /// Sandbox mode: Computer Use is always off. Chrome / MCP / web follow
    /// the caller's RiskContext (Chrome uses the host AppleScript bridge).
    pub fn with_sandbox(&self, sandbox: bool) -> Self {
        if !sandbox {
            return self.clone();
        }
        Self {
            computer_use: false,
            chrome: self.chrome,
            mcp: self.mcp,
            web: self.web,
        }
    }

    pub fn summary(&self) -> String {
        let mut parts = Vec::new();
        if self.computer_use {
            parts.push("Computer Use");
        }
        if self.chrome {
            parts.push("Contrôle Chrome");
        }
        if self.mcp {
            parts.push("MCP");
        }
        if self.web {
            parts.push("Accès web");
        }
        if parts.is_empty() {
            "session Bob Shell (fichiers / outils du workspace)".into()
        } else {
            parts.join(", ")
        }
    }

    pub fn risk_level(&self) -> &'static str {
        if self.computer_use || self.chrome {
            "high"
        } else if self.mcp || self.web {
            "medium"
        } else {
            "medium"
        }
    }
}

/// Whether Bob Work must show a preflight approval before starting `bob run`.
///
/// Session start is always allowed: the “Autoriser Bob à démarrer” gate made
/// the app unusable. Risky mid-run actions (file delete, network, plugins)
/// are not governed here.
pub fn needs_preflight(_policy: &str, _risk: &RiskContext, _has_grant: bool) -> bool {
    false
}

/// Scheduled runs cannot show an approval card. Restrictive policies therefore
/// fail unless the user saved a permanent grant (not the built-in session-start
/// default) or chose « Ne jamais demander ».
pub fn needs_unattended_preflight(policy: &str, risk: &RiskContext, has_user_grant: bool) -> bool {
    if has_user_grant {
        return false;
    }
    match normalize_policy(policy) {
        "never_ask" => false,
        "ask_for_important" => risk.elevated(),
        _ => true,
    }
}

pub fn unattended_preflight_message(policy: &str) -> String {
    format!(
        "Politique « {} » : une tâche planifiée ne peut pas afficher de carte d'approbation. Une exécution autorisée réutilise la clé IBM Bob du coffre local. Pour autoriser l'exécution en arrière-plan, allez dans Réglages → Autorisations et choisissez la politique « Toujours » (ou « Ne jamais demander » pour exécuter sans demande interactive).",
        policy_label(policy)
    )
}

/// Whether the child `bob run` may receive `--trust`.
///
/// Sandbox mode always passes `--trust`: Seatbelt is the FS boundary, and Bob
/// Shell's soft workspace check must not cancel `write_file` under the allowed
/// host remount `~/.bob/skills` (skill/plugin creation). Outside sandbox,
/// restrictive policies still withhold `--trust` unless a grant exists
/// (including the built-in `bob.session_start` default-allow grant).
pub fn should_pass_trust(
    policy: &str,
    preflight_approved: bool,
    has_grant: bool,
    sandbox_mode: bool,
) -> bool {
    if sandbox_mode {
        return true;
    }
    if has_grant || preflight_approved {
        return true;
    }
    matches!(normalize_policy(policy), "never_ask" | "ask_for_important")
}

pub fn normalize_policy(policy: &str) -> &str {
    match policy.trim() {
        "never_ask" | "ask_for_important" | "ask_for_modifications" | "always_ask" => policy.trim(),
        _ => "always_ask",
    }
}

/// Tool groups accepted by `bob run --disable-tool-groups`.
/// `subtask` is composer-only and maps to `subagent` on the CLI.
pub const CLI_TOOL_GROUPS: &[&str] = &[
    "read", "edit", "execute", "mcp", "skill", "todo", "subagent", "mode",
];

/// Map Bob Shell / Bob Work approval action types to composer permission groups.
pub fn approval_group(action_type: &str) -> &str {
    let normalized = action_type.trim();
    match normalized {
        "read" | "file.read" | "bob.read" | "bob.execute.read" => "read",
        "edit" | "file.write" | "file.delete" | "bob.edit" | "bob.execute.edit" => "edit",
        "execute" | "command.execute" | "bob.execute" | "bob.execute.command" => "execute",
        "mcp" | "mcp.connect" | "bob.mcp" | "bob.execute.mcp" => "mcp",
        "skill" | "bob.skill" | "bob.execute.skill" => "skill",
        "todo" | "bob.todo" | "bob.execute.todo" => "todo",
        "subtask" | "bob.subtask" | "bob.execute.subtask" => "subtask",
        "subagent" | "spawn_subagent" | "bob.subagent" | "bob.execute.subagent" => "subagent",
        "mode" | "mode.switch" | "bob.mode" | "bob.execute.mode" => "mode",
        other if other.starts_with("bob.execute.") => {
            other.trim_start_matches("bob.execute.")
        }
        other => other,
    }
}

pub fn is_composer_permission_group(group: &str) -> bool {
    matches!(
        group,
        "read" | "edit" | "execute" | "mcp" | "skill" | "todo" | "subtask" | "subagent" | "mode"
    )
}

pub fn composer_group_label(group: &str) -> &'static str {
    match group {
        "read" => "Read",
        "edit" => "Edit",
        "execute" => "Execute",
        "mcp" => "MCP",
        "skill" => "Skill",
        "todo" => "Todo",
        "subtask" => "Subtask",
        "subagent" => "Subagent",
        "mode" => "Mode",
        _ => "Tool",
    }
}

/// Backward-compatible alias — permission group names are always English.
pub fn composer_group_label_fr(group: &str) -> &'static str {
    composer_group_label(group)
}

/// Map a Bob Shell tool name to a composer permission group.
pub fn tool_permission_group(tool_name: &str) -> Option<&'static str> {
    let short = tool_name
        .rsplit([':', '/', '.'])
        .next()
        .unwrap_or(tool_name);
    let short = short.rsplit("__").next().unwrap_or(short);
    match short {
        "read_file" | "read_xlsx" | "search_files" | "list_files" | "glob" | "grep"
        | "find_symbol" | "find_referencing_symbols" | "list_code_definition_names"
        | "read_files" => Some("read"),
        "write_file" | "write_to_file" | "apply_diff" | "insert_content"
        | "search_and_replace" | "delete_file" | "remove_file" | "edit_file" => Some("edit"),
        "execute_command" | "run_command" => Some("execute"),
        "use_mcp_tool" => Some("mcp"),
        "update_todo_list" => Some("todo"),
        "spawn_subagent" => Some("subagent"),
        "switch_mode" => Some("mode"),
        name if name.contains("skill") => Some("skill"),
        // Direct MCP tool ids (`mcp__server__tool`) are not composer task-permission
        // checklist entries — they must not open an ask-on-use card. Gating stays on
        // `use_mcp_tool` / explicit `mcp` action types when the MCP checkbox is off.
        _ => None,
    }
}

/// Resolve a Bob Shell / Bob Work action to a composer task-permission group.
/// Raw tool names (`mcp__…__web_fetch`) map through [`tool_permission_group`].
pub fn resolve_composer_permission_group(action_type: &str) -> Option<&'static str> {
    let group = approval_group(action_type);
    if is_composer_permission_group(group) {
        return CLI_TOOL_GROUPS.iter().copied().find(|item| *item == group);
    }
    // `subtask` is composer-only (not in CLI_TOOL_GROUPS).
    if group == "subtask" {
        return Some("subtask");
    }
    tool_permission_group(action_type)
}

pub fn is_task_permission_allowed(action_type: &str, allowed_permissions: &[String]) -> bool {
    let Some(group) = resolve_composer_permission_group(action_type) else {
        return false;
    };
    allowed_permissions.iter().any(|permission| permission == group)
}

/// Composer sent an explicit allow-list that does not include this group.
/// An empty list (scheduler / unspecified) is not treated as a denial.
pub fn task_group_explicitly_denied(allowed_permissions: &[String], group: &str) -> bool {
    !allowed_permissions.is_empty() && !allowed_permissions.iter().any(|permission| permission == group)
}

/// Groups to pass to `bob run --disable-tool-groups`.
/// Scheduler (`enforce = false`) never disables groups.
pub fn disabled_tool_groups(allowed_permissions: &[String], enforce: bool) -> Vec<String> {
    if !enforce {
        return Vec::new();
    }
    let mut allowed: std::collections::HashSet<&str> =
        allowed_permissions.iter().map(String::as_str).collect();
    if allowed.contains("subtask") {
        allowed.insert("subagent");
    }
    CLI_TOOL_GROUPS
        .iter()
        .copied()
        // MCP server tools (`mcp__…`) are outside the ask-on-use checklist; keeping
        // `mcp` disabled here only produced cards for bridge tools like web_fetch.
        .filter(|group| *group != "mcp" && !allowed.contains(group))
        .map(str::to_string)
        .collect()
}

/// Actions that stay interactive even when they are outside the composer
/// task-permission checklist (desktop bridge, session start, …).
pub fn is_always_interactive_permission(action_type: &str) -> bool {
    matches!(
        action_type.trim(),
        "computer.use" | "bob.session_start" | ACTION_SESSION_START
    )
}

/// Auto-approve when:
/// - the action maps to a checked composer task-permission group, or
/// - the action is outside the task-permission list (unknown / non-composer types).
/// Sensitive non-composer actions ([`is_always_interactive_permission`]) never auto-approve here.
pub fn should_auto_approve_task(action_type: &str, allowed_permissions: &[String]) -> bool {
    if is_always_interactive_permission(action_type) {
        return false;
    }
    match resolve_composer_permission_group(action_type) {
        Some(group) => allowed_permissions.iter().any(|permission| permission == group),
        None => true,
    }
}

pub fn policy_label(policy: &str) -> &'static str {
    match normalize_policy(policy) {
        "never_ask" => "Ne jamais demander",
        "ask_for_important" => "Demander pour les actions importantes",
        "ask_for_modifications" => "Demander avant modification",
        _ => "Toujours demander",
    }
}

/// Active allow grant for this action/resource (always, or scoped to task).
pub fn has_allow_grant(
    db: &Database,
    action_type: &str,
    resource: &str,
    task_id: Option<&str>,
) -> AppResult<bool> {
    has_matching_allow_grant(db, action_type, resource, task_id, false)
}

/// Like [`has_allow_grant`], but ignores the migrated default session-start grant.
pub fn has_user_allow_grant(
    db: &Database,
    action_type: &str,
    resource: &str,
    task_id: Option<&str>,
) -> AppResult<bool> {
    has_matching_allow_grant(db, action_type, resource, task_id, true)
}

fn has_matching_allow_grant(
    db: &Database,
    action_type: &str,
    resource: &str,
    task_id: Option<&str>,
    exclude_default_session_start: bool,
) -> AppResult<bool> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, scope, scope_id, resource FROM permission_grants
         WHERE revoked_at IS NULL
           AND decision = 'allow'
           AND action_type = ?1
           AND (expires_at IS NULL OR expires_at > datetime('now'))",
    )?;
    let rows = stmt.query_map(params![action_type], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    for row in rows.flatten() {
        let (id, scope, scope_id, grant_resource) = row;
        if exclude_default_session_start && id == SESSION_START_DEFAULT_GRANT_ID {
            continue;
        }
        let resource_ok = grant_resource == "*"
            || grant_resource == resource
            || resource.starts_with(&format!("{grant_resource}/"));
        if !resource_ok {
            continue;
        }
        match scope.as_str() {
            "always" => return Ok(true),
            "task" => {
                if task_id.is_some() && scope_id.as_deref() == task_id {
                    return Ok(true);
                }
            }
            _ => {}
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    #[test]
    fn sandbox_refusal_explains_limits_without_suggesting_escalation() {
        let guidance = super::sandbox_guidance();
        for required in [
            "limitations de la sandbox Bob Work",
            "distingue un refus de consigne",
            "Ne conseille jamais de désactiver la sandbox",
            "Exception runtime externe",
            "Exception création skill/plugin",
            "$HOME/.bob/skills/<slug>/",
            "Réglages → Permissions",
            "Computer Use",
            "joindre une copie du fichier",
            "Ne retente jamais une opération refusée",
            "sous-processus",
            "169.254.169.254",
        ] {
            assert!(guidance.contains(required), "Missing safeguard: {required}");
        }
        assert!(
            guidance.contains("sauf l’exception runtime externe"),
            "must allow advising sandbox exit only for external runtimes"
        );
        assert!(
            !guidance.contains("ni à Chrome")
                || guidance.contains("Chrome et les sous-agents restent"),
            "Chrome must remain usable in sandbox guidance"
        );
    }
    use super::*;

    #[test]
    fn session_start_never_requires_preflight() {
        assert!(!needs_preflight(
            "always_ask",
            &RiskContext::default(),
            false
        ));
        assert!(!needs_preflight(
            "always_ask",
            &RiskContext::default(),
            true
        ));
        assert!(!needs_preflight(
            "ask_for_modifications",
            &RiskContext {
                computer_use: true,
                chrome: true,
                ..RiskContext::default()
            },
            false
        ));
    }

    #[test]
    fn unattended_preflight_respects_policy_and_user_grant() {
        let idle = RiskContext::default();
        let elevated = RiskContext {
            computer_use: true,
            chrome: false,
            mcp: false,
            web: false,
        };
        assert!(needs_unattended_preflight("always_ask", &idle, false));
        assert!(needs_unattended_preflight(
            "ask_for_modifications",
            &idle,
            false
        ));
        assert!(!needs_unattended_preflight("always_ask", &idle, true));
        assert!(!needs_unattended_preflight("never_ask", &elevated, false));
        assert!(!needs_unattended_preflight(
            "ask_for_important",
            &idle,
            false
        ));
        assert!(needs_unattended_preflight(
            "ask_for_important",
            &elevated,
            false
        ));
        assert!(!needs_unattended_preflight(
            "ask_for_important",
            &elevated,
            true
        ));
        assert!(unattended_preflight_message("always_ask").contains("coffre"));
        assert!(unattended_preflight_message("always_ask").contains("Ne jamais demander"));
    }

    #[test]
    fn never_ask_skips_preflight_and_trusts() {
        assert!(!needs_preflight(
            "never_ask",
            &RiskContext {
                computer_use: true,
                ..RiskContext::default()
            },
            false
        ));
        assert!(should_pass_trust("never_ask", false, false, false));
        assert!(should_pass_trust("never_ask", false, false, true));
    }

    #[test]
    fn ask_for_important_skips_preflight_and_trusts_including_sandbox() {
        assert!(!needs_preflight(
            "ask_for_important",
            &RiskContext::default(),
            false
        ));
        assert!(!needs_preflight(
            "ask_for_important",
            &RiskContext {
                computer_use: true,
                ..RiskContext::default()
            },
            false
        ));
        assert!(should_pass_trust("ask_for_important", false, false, false));
        assert!(should_pass_trust("ask_for_important", true, false, false));
        assert!(should_pass_trust("ask_for_important", true, false, true));
    }

    #[test]
    fn trust_requires_approval_or_grant_for_always_ask() {
        assert!(!should_pass_trust("always_ask", false, false, false));
        assert!(should_pass_trust("always_ask", true, false, false));
        assert!(should_pass_trust("always_ask", false, true, false));
        assert!(should_pass_trust("always_ask", true, true, true));
    }

    #[test]
    fn approval_group_maps_shell_action_types() {
        assert_eq!(approval_group("file.read"), "read");
        assert_eq!(approval_group("file.write"), "edit");
        assert_eq!(approval_group("bob.execute.edit"), "edit");
        assert_eq!(approval_group("command.execute"), "execute");
        assert_eq!(approval_group("mcp.connect"), "mcp");
        assert_eq!(approval_group("spawn_subagent"), "subagent");
        assert!(should_auto_approve_task("read", &["read".into()]));
        assert!(!should_auto_approve_task("execute", &["read".into()]));
        assert!(!is_task_permission_allowed("bob.execute.edit", &["read".into()]));
        assert!(is_task_permission_allowed("bob.execute.edit", &["edit".into()]));
        assert!(task_group_explicitly_denied(&["read".into()], "edit"));
        assert!(!task_group_explicitly_denied(&["read".into(), "edit".into()], "edit"));
        assert!(!task_group_explicitly_denied(&[], "edit"));
        assert_eq!(tool_permission_group("write_to_file"), Some("edit"));
        assert_eq!(tool_permission_group("execute_command"), Some("execute"));
        assert_eq!(tool_permission_group("use_mcp_tool"), Some("mcp"));
        assert_eq!(
            tool_permission_group("mcp__bob-work-chrome-control_6001__web_fetch"),
            None
        );
        assert!(should_auto_approve_task(
            "mcp__bob-work-chrome-control_6001__web_fetch",
            &["read".into()]
        ));
        assert!(!should_auto_approve_task("use_mcp_tool", &["read".into()]));
        assert!(should_auto_approve_task("use_mcp_tool", &["mcp".into()]));
        assert_eq!(
            disabled_tool_groups(&["read".into()], true),
            vec![
                "edit".to_string(),
                "execute".to_string(),
                "skill".to_string(),
                "todo".to_string(),
                "subagent".to_string(),
                "mode".to_string(),
            ]
        );
        assert!(disabled_tool_groups(&["read".into()], false).is_empty());
        assert_eq!(
            disabled_tool_groups(&[], true).len(),
            CLI_TOOL_GROUPS.len() - 1
        );
    }

    #[test]
    fn sandbox_strips_computer_use_only() {
        let risk = RiskContext {
            computer_use: true,
            chrome: true,
            mcp: true,
            web: true,
        }
        .with_sandbox(true);
        assert!(!risk.computer_use);
        assert!(risk.chrome);
        assert!(risk.mcp);
        assert!(risk.web);
        // Chrome still counts as elevated mid-run risk; Computer Use is gone.
        assert!(risk.elevated());
    }

    #[test]
    fn migrated_db_persists_session_start_default_allow() {
        let db = crate::db::Database::new_in_memory().expect("in-memory db");
        db.run_migrations().expect("migrations");
        assert!(has_allow_grant(&db, ACTION_SESSION_START, "/tmp/workspace", None).unwrap());
        assert!(has_allow_grant(&db, ACTION_SESSION_START, "*", Some("task_1")).unwrap());
        let conn = db.conn.lock().unwrap();
        let grant_id: String = conn
            .query_row(
                "SELECT id FROM permission_grants WHERE action_type = ?1 AND resource = '*' AND scope = 'always'",
                params![ACTION_SESSION_START],
                |row| row.get(0),
            )
            .expect("default grant");
        assert_eq!(grant_id, SESSION_START_DEFAULT_GRANT_ID);
        let policy: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'permission_policy'",
                [],
                |row| row.get(0),
            )
            .expect("policy");
        assert_eq!(policy, "\"ask_for_important\"");
    }
}
