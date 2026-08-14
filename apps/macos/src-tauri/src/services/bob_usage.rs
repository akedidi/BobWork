// ============================================================
// Bob Work - Bobcoins / usage snapshot (IBM Bob Shell account)
// Mirrors Bob Shell / IDE: profile + budget via gateway admin API.
// Auth: API key (`Authorization: apikey …`) or SSO access token.
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::services::bob::SECRET_IBM_API;
use crate::services::keychain::KeychainService;
use chrono::{DateTime, Utc};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;
use zeroize::Zeroizing;

const DEFAULT_GATEWAY: &str = "https://api.us-east.bob.ibm.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshotData {
    pub used_amount: Option<f64>,
    pub remaining_amount: Option<f64>,
    pub total_amount: Option<f64>,
    pub unit: String,
    pub instance_label: Option<String>,
    pub captured_at: String,
}

enum GatewayAuth {
    ApiKey(Zeroizing<String>),
    Bearer(String),
}

pub struct BobUsageService;

impl BobUsageService {
    pub fn new() -> Self {
        Self
    }

    pub fn refresh_snapshot(&self, db: &Database) -> AppResult<Option<UsageSnapshotData>> {
        let Some((gateway, auth)) = resolve_gateway_auth()? else {
            return Ok(None);
        };
        let profile = fetch_profile(&gateway, &auth)?;
        let mut selected = pick_profile(&profile);
        if let Some(profile) = selected.as_mut() {
            if let (Some(team_id), Some(instance_user_id)) =
                (profile.team_id.clone(), profile.instance_user_id.clone())
            {
                if let Ok(budget) = fetch_budget(&gateway, &auth, &team_id, &instance_user_id) {
                    profile.used_amount = budget.used_amount.or(profile.used_amount);
                    profile.total_amount = budget.total_amount.or(profile.total_amount);
                }
            }
        }
        let Some(selected) = selected else {
            return Ok(None);
        };
        let remaining = match (selected.total_amount, selected.used_amount) {
            (Some(total), Some(used)) => Some((total - used).max(0.0)),
            _ => None,
        };
        let captured_at = Utc::now().to_rfc3339();
        let snapshot = UsageSnapshotData {
            used_amount: selected.used_amount,
            remaining_amount: remaining,
            total_amount: selected.total_amount,
            unit: "Bobcoins".into(),
            instance_label: selected.label,
            captured_at: captured_at.clone(),
        };
        self.persist_snapshot(db, &snapshot, &profile.raw)?;
        Ok(Some(snapshot))
    }

    pub fn latest_snapshot(&self, db: &Database) -> AppResult<Option<UsageSnapshotData>> {
        let conn = db.conn.lock().unwrap();
        let row = conn.query_row(
            "SELECT used_amount, remaining_amount, unit, raw, captured_at
             FROM usage_snapshots ORDER BY captured_at DESC LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, Option<f64>>(0)?,
                    row.get::<_, Option<f64>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        );
        match row {
            Ok((used, remaining, unit, raw, captured_at)) => {
                let meta: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
                let total_amount = json_f64(meta.get("totalAmount"))
                    .or_else(|| json_f64(meta.get("budgetLimit")))
                    .or_else(|| json_f64(meta.pointer("/profile/instances/0/teams/0/budget_limit")))
                    .or_else(|| match (used, remaining) {
                        (Some(used_amount), Some(remaining_amount)) => {
                            let total = used_amount + remaining_amount;
                            (total > 0.0).then_some(total)
                        }
                        _ => None,
                    });
                Ok(Some(UsageSnapshotData {
                    used_amount: used,
                    remaining_amount: remaining,
                    total_amount,
                    unit: unit.unwrap_or_else(|| "Bobcoins".into()),
                    instance_label: meta
                        .get("instanceLabel")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    captured_at,
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(AppError::Database(error.to_string())),
        }
    }

    pub fn should_refresh(latest: Option<&UsageSnapshotData>) -> bool {
        match latest {
            None => true,
            Some(snapshot) => DateTime::parse_from_rfc3339(&snapshot.captured_at)
                .map(|value| (Utc::now() - value.with_timezone(&Utc)).num_minutes() >= 5)
                .unwrap_or(true),
        }
    }

    /// Apply a session spend immediately so the meter moves before the gateway refresh.
    pub fn apply_session_cost(
        &self,
        db: &Database,
        session_cost: f64,
    ) -> AppResult<Option<UsageSnapshotData>> {
        if !(session_cost.is_finite() && session_cost > 0.0) {
            return self.latest_snapshot(db);
        }
        let Some(mut latest) = self.latest_snapshot(db)? else {
            return Ok(None);
        };
        let used =
            latest
                .used_amount
                .or_else(|| match (latest.total_amount, latest.remaining_amount) {
                    (Some(total), Some(remaining)) => Some((total - remaining).max(0.0)),
                    _ => None,
                });
        let Some(used) = used else {
            return Ok(Some(latest));
        };
        let new_used = used + session_cost;
        latest.used_amount = Some(new_used);
        if let Some(total) = latest.total_amount {
            latest.remaining_amount = Some((total - new_used).max(0.0));
        } else if let Some(remaining) = latest.remaining_amount {
            latest.remaining_amount = Some((remaining - session_cost).max(0.0));
        }
        latest.captured_at = Utc::now().to_rfc3339();
        self.persist_snapshot(db, &latest, &serde_json::json!({}))?;
        Ok(Some(latest))
    }

    fn persist_snapshot(
        &self,
        db: &Database,
        snapshot: &UsageSnapshotData,
        profile_raw: &Value,
    ) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let raw = serde_json::json!({
            "profile": profile_raw,
            "totalAmount": snapshot.total_amount,
            "budgetLimit": snapshot.total_amount,
            "instanceLabel": snapshot.instance_label,
        });
        conn.execute(
            "INSERT INTO usage_snapshots (id, source, used_amount, remaining_amount, unit, raw, captured_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4().to_string(),
                "bob-shell-profile",
                snapshot.used_amount,
                snapshot.remaining_amount,
                snapshot.unit,
                raw.to_string(),
                snapshot.captured_at,
            ],
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct ParsedProfileRow {
    label: Option<String>,
    used_amount: Option<f64>,
    total_amount: Option<f64>,
    team_id: Option<String>,
    instance_user_id: Option<String>,
}

#[derive(Debug)]
struct ProfileResponse {
    raw: Value,
    rows: Vec<ParsedProfileRow>,
}

#[derive(Debug, Deserialize)]
struct BudgetResponse {
    #[serde(alias = "used_amount", alias = "usedAmount")]
    usage: Option<f64>,
    #[serde(alias = "budgetLimit")]
    budget_limit: Option<f64>,
}

fn bob_settings_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".bob").join("settings"))
}

pub(crate) fn read_vault_or_env_api_key() -> Option<Zeroizing<String>> {
    if let Ok(Some(value)) = KeychainService::new().get(SECRET_IBM_API) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(Zeroizing::new(trimmed.to_string()));
        }
    }
    for name in ["BOB_API_KEY", "BOBSHELL_API_KEY"] {
        if let Ok(value) = std::env::var(name) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(Zeroizing::new(trimmed.to_string()));
            }
        }
    }
    None
}

pub fn ibm_sso_session_available() -> bool {
    read_bob_shell_access_token().is_some()
}

/// Whether Bob Work can run `bob run` (vault/env API key or IBM Bob Shell SSO session).
pub fn credentials_available_for_run() -> bool {
    read_vault_or_env_api_key().is_some() || ibm_sso_session_available()
}

pub fn resolve_run_authentication_method() -> &'static str {
    if KeychainService::new()
        .get(SECRET_IBM_API)
        .ok()
        .flatten()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return "api_key_session";
    }
    if std::env::var("BOB_API_KEY")
        .or_else(|_| std::env::var("BOBSHELL_API_KEY"))
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return "api_key_environment";
    }
    if ibm_sso_session_available() {
        return "sso_session_detected";
    }
    "required"
}

pub(crate) fn read_bob_shell_access_token() -> Option<(String, String)> {
    let settings_dir = bob_settings_dir()?;
    let path = settings_dir.join("auth-secrets.json");
    read_bob_shell_access_token_from(&path)
}

fn read_bob_shell_access_token_from(path: &Path) -> Option<(String, String)> {
    if !path.is_file() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let map: HashMap<String, Value> = serde_json::from_str(&content).unwrap_or_default();
    for (key, value) in map {
        let Some(gateway) = key.strip_prefix("bob.auth.tokens-") else {
            continue;
        };
        let token_string = value.as_str().unwrap_or_default();
        if token_string.is_empty() {
            continue;
        }
        let token_json: Value = serde_json::from_str(token_string).unwrap_or(Value::Null);
        if let Some(access) = token_json
            .get("accessToken")
            .or_else(|| token_json.get("token"))
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
        {
            return Some((gateway.to_string(), access.to_string()));
        }
    }
    None
}

/// Prefer the inference API key (same path as `bob run` / IDE API-key mode),
/// then fall back to a Bob Shell SSO access token from `auth-secrets.json`.
fn resolve_gateway_auth() -> AppResult<Option<(String, GatewayAuth)>> {
    let gateway = read_bob_shell_access_token()
        .map(|(gateway, _)| gateway)
        .unwrap_or_else(|| DEFAULT_GATEWAY.to_string());

    if let Some(api_key) = read_vault_or_env_api_key() {
        return Ok(Some((gateway, GatewayAuth::ApiKey(api_key))));
    }

    if let Some((gateway, access)) = read_bob_shell_access_token() {
        return Ok(Some((gateway, GatewayAuth::Bearer(access))));
    }

    Ok(None)
}

fn http_client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| AppError::BobExecutionFailed(error.to_string()))
}

fn auth_headers(auth: &GatewayAuth) -> AppResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    let value = match auth {
        GatewayAuth::ApiKey(key) => format!("apikey {}", key.as_str()),
        GatewayAuth::Bearer(token) => format!("Bearer {token}"),
    };
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&value).map_err(|error| {
            AppError::BobExecutionFailed(format!("En-tête auth invalide : {error}"))
        })?,
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("BobWork/0.1.4 (macOS; bobcoins)"),
    );
    Ok(headers)
}

fn fetch_profile(gateway: &str, auth: &GatewayAuth) -> AppResult<ProfileResponse> {
    let url = format!("{}/admin/v1/profile", gateway.trim_end_matches('/'));
    let response = http_client()?
        .get(url)
        .headers(auth_headers(auth)?)
        .send()
        .map_err(|error| {
            AppError::BobExecutionFailed(format!("Profil Bob inaccessible : {error}"))
        })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::BobAuthFailed(
            "Authentification Bob refusée. Vérifiez la clé API du coffre ou reconnectez Bob Shell."
                .into(),
        ));
    }
    if !response.status().is_success() {
        return Err(AppError::BobExecutionFailed(format!(
            "Profil Bob inaccessible (HTTP {}).",
            response.status()
        )));
    }
    let raw: Value = response.json().map_err(|error| {
        AppError::BobExecutionFailed(format!("Réponse profil Bob invalide : {error}"))
    })?;
    Ok(ProfileResponse {
        rows: parse_profile_rows(&raw),
        raw,
    })
}

fn fetch_budget(
    gateway: &str,
    auth: &GatewayAuth,
    team_id: &str,
    instance_user_id: &str,
) -> AppResult<ParsedProfileRow> {
    let url = format!(
        "{}/admin/v1/teams/{}/users/{}",
        gateway.trim_end_matches('/'),
        team_id,
        instance_user_id
    );
    let response = http_client()?
        .get(url)
        .headers(auth_headers(auth)?)
        .send()
        .map_err(|error| {
            AppError::BobExecutionFailed(format!("Budget Bob inaccessible : {error}"))
        })?;
    if !response.status().is_success() {
        return Err(AppError::BobExecutionFailed(format!(
            "Budget Bob inaccessible (HTTP {}).",
            response.status()
        )));
    }
    let budget: BudgetResponse = response.json().map_err(|error| {
        AppError::BobExecutionFailed(format!("Réponse budget Bob invalide : {error}"))
    })?;
    Ok(ParsedProfileRow {
        label: None,
        used_amount: budget.usage,
        total_amount: budget.budget_limit,
        team_id: Some(team_id.to_string()),
        instance_user_id: Some(instance_user_id.to_string()),
    })
}

pub(crate) fn profile_display_name(raw: &Value) -> Option<String> {
    [
        raw.get("name"),
        raw.get("display_name"),
        raw.get("displayName"),
        raw.get("full_name"),
        raw.get("fullName"),
        raw.pointer("/user/name"),
        raw.pointer("/user/displayName"),
        raw.get("email"),
        raw.pointer("/user/email"),
    ]
    .into_iter()
    .find_map(|value| {
        value
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| {
                name.split('@')
                    .next()
                    .unwrap_or(name)
                    .split(['.', '_', '-'])
                    .next()
                    .unwrap_or(name)
                    .to_string()
            })
    })
    .map(|name| {
        let mut chars = name.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => name,
        }
    })
}

fn parse_profile_rows(raw: &Value) -> Vec<ParsedProfileRow> {
    let mut rows = vec![];
    let Some(instances) = raw.get("instances").and_then(Value::as_array) else {
        return rows;
    };
    for instance in instances {
        let instance_name = instance
            .get("instance_name")
            .or_else(|| instance.get("name"))
            .and_then(Value::as_str);
        let instance_user_id = instance
            .get("user_id")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(teams) = instance.get("teams").and_then(Value::as_array) {
            for team in teams {
                rows.push(ParsedProfileRow {
                    label: Some(format_profile_label(instance_name, team)),
                    used_amount: team.get("usage").and_then(value_to_f64),
                    total_amount: team
                        .get("budget_limit")
                        .and_then(value_to_f64)
                        .or_else(|| instance.get("budget_limit").and_then(value_to_f64)),
                    team_id: team.get("id").and_then(Value::as_str).map(str::to_string),
                    instance_user_id: instance_user_id.clone(),
                });
            }
        } else {
            rows.push(ParsedProfileRow {
                label: instance_name.map(str::to_string),
                used_amount: instance.get("usage").and_then(value_to_f64),
                total_amount: instance.get("budget_limit").and_then(value_to_f64),
                team_id: None,
                instance_user_id: instance_user_id.clone(),
            });
        }
    }
    rows
}

fn pick_profile(response: &ProfileResponse) -> Option<ParsedProfileRow> {
    response
        .rows
        .iter()
        .find(|row| row.used_amount.is_some() || row.total_amount.is_some())
        .cloned()
        .or_else(|| response.rows.first().cloned())
}

fn format_profile_label(instance_name: Option<&str>, team: &Value) -> String {
    let team_name = team.get("name").and_then(Value::as_str);
    match (instance_name, team_name) {
        (Some(instance), Some(team)) => format!("{instance} · {team}"),
        (Some(instance), None) => instance.to_string(),
        (None, Some(team)) => team.to_string(),
        (None, None) => "Compte Bob".into(),
    }
}

pub fn extract_session_cost(value: &Value) -> Option<f64> {
    [
        value.pointer("/stats/session_costs"),
        value.pointer("/stats/sessionCosts"),
        value.pointer("/costs/cost"),
        value.get("session_costs"),
        value.get("cost"),
        value.pointer("/usage/cost"),
        value.pointer("/usage/total_cost"),
        value.pointer("/usage/bobcoins"),
    ]
    .into_iter()
    .find_map(|candidate| {
        candidate
            .and_then(value_to_f64)
            .filter(|amount| amount.is_finite() && *amount > 0.0)
    })
}

fn json_f64(value: Option<&Value>) -> Option<f64> {
    value.and_then(value_to_f64)
}

fn value_to_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|v| v as f64))
        .or_else(|| value.as_u64().map(|v| v as f64))
        .or_else(|| value.as_str().and_then(|v| v.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_ibm_sso_access_token_from_auth_secrets() {
        let dir = std::env::temp_dir().join(format!("bob-sso-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("auth-secrets.json");
        std::fs::write(
            &path,
            r#"{"bob.auth.tokens-https://api.us-east.bob.ibm.com":"{\"accessToken\":\"sso-token-value\"}"}"#,
        )
        .unwrap();
        let parsed = read_bob_shell_access_token_from(&path).expect("sso token");
        assert_eq!(parsed.0, "https://api.us-east.bob.ibm.com");
        assert_eq!(parsed.1, "sso-token-value");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn parses_profile_rows_with_team_budget() {
        let raw = serde_json::json!({
            "user_id": "user-1",
            "instances": [{
                "user_id": "iu-1",
                "instance_id": "inst-1",
                "instance_name": "IBM Internal",
                "teams": [{
                    "id": "team-1",
                    "name": "Platform",
                    "budget_limit": 160,
                    "usage": 42.5
                }]
            }]
        });
        let rows = parse_profile_rows(&raw);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].total_amount, Some(160.0));
        assert_eq!(rows[0].used_amount, Some(42.5));
        assert_eq!(rows[0].label.as_deref(), Some("IBM Internal · Platform"));
    }

    #[test]
    fn json_f64_reads_integers_and_strings() {
        assert_eq!(json_f64(Some(&serde_json::json!(500))), Some(500.0));
        assert_eq!(json_f64(Some(&serde_json::json!(42.5))), Some(42.5));
        assert_eq!(json_f64(Some(&serde_json::json!("160"))), Some(160.0));
    }

    #[test]
    fn extracts_session_cost_from_result_stats() {
        let payload = serde_json::json!({
            "type": "result",
            "stats": { "session_costs": 3.5, "tool_calls": 2 }
        });
        assert_eq!(extract_session_cost(&payload), Some(3.5));
        assert_eq!(
            extract_session_cost(&serde_json::json!({ "costs": { "cost": 1.25 } })),
            Some(1.25)
        );
        assert_eq!(
            extract_session_cost(&serde_json::json!({ "stats": { "tool_calls": 1 } })),
            None
        );
    }
}
