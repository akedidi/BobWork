//! App-level permission governance for Bob Shell launches.
//!
//! Bob Shell 2 headless (`bob run`) does not emit a documented `approval_required`
//! stream event. Starting a session is default-allow (no “autoriser bob run”
//! popup): Bob Work is unusable without `bob run`. Mid-run risky actions keep
//! their own paths. `--trust` is still withheld in sandbox mode, and restrictive
//! policies still require a grant unless the built-in session-start grant exists.

use crate::db::Database;
use crate::error::AppResult;
use rusqlite::params;

pub const ACTION_SESSION_START: &str = "bob.session_start";
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

    /// Sandbox mode keeps sessions inside the workspace: no desktop/browser control elevation.
    pub fn with_sandbox(&self, sandbox: bool) -> Self {
        if !sandbox {
            return self.clone();
        }
        Self {
            computer_use: false,
            chrome: false,
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
        "Politique « {} » : une tâche planifiée ne peut pas afficher de carte d’approbation. Enregistrez la clé IBM Bob dans le coffre (Réglages → IBM Bob), accordez une autorisation persistante « Toujours », ou choisissez « Ne jamais demander ».",
        policy_label(policy)
    )
}

/// Whether the child `bob run` may receive `--trust`.
///
/// Sandbox mode never trusts the workspace. Session start itself is never
/// gated; restrictive policies still withhold `--trust` unless a grant exists
/// (including the built-in `bob.session_start` default-allow grant).
pub fn should_pass_trust(
    policy: &str,
    preflight_approved: bool,
    has_grant: bool,
    sandbox_mode: bool,
) -> bool {
    if sandbox_mode {
        return false;
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
        assert!(!should_pass_trust("never_ask", false, false, true));
    }

    #[test]
    fn ask_for_important_skips_preflight_and_trusts_unless_sandbox() {
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
        assert!(!should_pass_trust("ask_for_important", true, false, true));
    }

    #[test]
    fn trust_requires_approval_or_grant_for_always_ask() {
        assert!(!should_pass_trust("always_ask", false, false, false));
        assert!(should_pass_trust("always_ask", true, false, false));
        assert!(should_pass_trust("always_ask", false, true, false));
        assert!(!should_pass_trust("always_ask", true, true, true));
    }

    #[test]
    fn sandbox_strips_elevated_risk() {
        let risk = RiskContext {
            computer_use: true,
            chrome: true,
            mcp: true,
            web: true,
        }
        .with_sandbox(true);
        assert!(!risk.elevated());
        assert!(risk.mcp);
        assert!(risk.web);
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
