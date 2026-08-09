// ============================================================
// Bob Work - Bobcoins / usage snapshot (IBM Bob Shell account)
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use reqwest::blocking::Client;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;

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

pub struct BobUsageService;

impl BobUsageService {
    pub fn new() -> Self {
        Self
    }

    pub fn refresh_snapshot(&self, db: &Database) -> AppResult<Option<UsageSnapshotData>> {
        let Some((gateway, access_token)) = read_bob_shell_access_token()? else {
            return Ok(None);
        };
        let profile = fetch_profile(&gateway, &access_token)?;
        let mut selected = pick_profile(&profile);
        if let Some(profile) = selected.as_mut() {
            if profile.used_amount.is_none()
                && profile.team_id.is_some()
                && profile.instance_user_id.is_some()
            {
                if let Ok(budget) = fetch_budget(
                    &gateway,
                    &access_token,
                    profile.team_id.as_deref().unwrap(),
                    profile.instance_user_id.as_deref().unwrap(),
                ) {
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
                Ok(Some(UsageSnapshotData {
                    used_amount: used,
                    remaining_amount: remaining,
                    total_amount: meta
                        .get("totalAmount")
                        .and_then(Value::as_f64)
                        .or_else(|| meta.get("budgetLimit").and_then(Value::as_f64)),
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
    usage: Option<f64>,
    budget_limit: Option<f64>,
}

fn bob_settings_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".bob").join("settings"))
}

fn read_bob_shell_access_token() -> AppResult<Option<(String, String)>> {
    let Some(settings_dir) = bob_settings_dir() else {
        return Ok(None);
    };
    let path = settings_dir.join("auth-secrets.json");
    if !path.is_file() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)?;
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
            return Ok(Some((gateway.to_string(), access.to_string())));
        }
    }
    Ok(None)
}

fn http_client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|error| AppError::BobExecutionFailed(error.to_string()))
}

fn fetch_profile(gateway: &str, access_token: &str) -> AppResult<ProfileResponse> {
    let url = format!("{}/admin/v1/profile", gateway.trim_end_matches('/'));
    let response = http_client()?
        .get(url)
        .bearer_auth(access_token)
        .send()
        .map_err(|error| AppError::BobExecutionFailed(format!("Profil Bob inaccessible : {error}")))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::BobAuthFailed(
            "Session Bob Shell expirée. Relancez « bob chat » ou reconnectez-vous.".into(),
        ));
    }
    if !response.status().is_success() {
        return Err(AppError::BobExecutionFailed(format!(
            "Profil Bob inaccessible (HTTP {}).",
            response.status()
        )));
    }
    let raw: Value = response
        .json()
        .map_err(|error| AppError::BobExecutionFailed(format!("Réponse profil Bob invalide : {error}")))?;
    Ok(ProfileResponse {
        rows: parse_profile_rows(&raw),
        raw,
    })
}

fn fetch_budget(
    gateway: &str,
    access_token: &str,
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
        .bearer_auth(access_token)
        .send()
        .map_err(|error| AppError::BobExecutionFailed(format!("Budget Bob inaccessible : {error}")))?;
    if !response.status().is_success() {
        return Err(AppError::BobExecutionFailed(format!(
            "Budget Bob inaccessible (HTTP {}).",
            response.status()
        )));
    }
    let budget: BudgetResponse = response
        .json()
        .map_err(|error| AppError::BobExecutionFailed(format!("Réponse budget Bob invalide : {error}")))?;
    Ok(ParsedProfileRow {
        label: None,
        used_amount: budget.usage,
        total_amount: budget.budget_limit,
        team_id: Some(team_id.to_string()),
        instance_user_id: Some(instance_user_id.to_string()),
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
                    team_id: team
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string),
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

fn value_to_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|v| v as f64))
        .or_else(|| value.as_str().and_then(|v| v.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
