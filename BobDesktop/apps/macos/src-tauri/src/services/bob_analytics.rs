// ============================================================
// Bob Work - Bobalytics (Today + Patterns)
// Mixes local Bob Work activity with IBM gateway profile / analytics.
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::analytics::{
    BobalyticsDayPoint, BobalyticsKpis, BobalyticsPatterns, BobalyticsQuery, BobalyticsReport,
    BobalyticsTeamPoint, BobalyticsToday, BobalyticsUsageFrequency,
};
use crate::services::bob_usage::{profile_display_name, BobUsageService, UsageSnapshotData};
use chrono::{Datelike, Duration, Local, NaiveDate, Utc};
use rusqlite::params;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

const WEEKDAY_LABELS: [&str; 7] = ["S", "M", "T", "W", "T", "F", "S"];

#[derive(Debug, Clone)]
struct ActivityRow {
    day: NaiveDate,
    project_id: Option<String>,
    project_name: String,
    kind: ActivityKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActivityKind {
    Task,
    Message,
}

#[derive(Debug, Default, Clone)]
struct GatewayExtras {
    seats: Option<i64>,
    bob_factor_pct: Option<f64>,
    committed_lines: Option<i64>,
    bob_users: Option<i64>,
    typical_day_active: Option<f64>,
    greeting_name: Option<String>,
    instance_label: Option<String>,
    teams: Vec<BobalyticsTeamPoint>,
    source_hit: bool,
}

pub struct BobAnalyticsService;

impl BobAnalyticsService {
    pub fn new() -> Self {
        Self
    }

    pub fn report(&self, db: &Database, query: BobalyticsQuery) -> AppResult<BobalyticsReport> {
        let scope = normalize_scope(query.scope.as_deref());
        let range_days = normalize_range(query.range_days);
        let today = Local::now().date_naive();
        let range_start = today - Duration::days(range_days - 1);
        let activity = load_activity(db, range_start)?;
        // Use the latest cached Bobcoins snapshot only — never refresh the gateway here.
        // Settings already loads usage separately; probing analytics endpoints on open made the panel lag.
        let snapshot = BobUsageService::new().latest_snapshot(db).ok().flatten();
        let extras = load_gateway_extras(db, snapshot.as_ref());
        Ok(build_report(
            scope,
            range_days,
            today,
            &activity,
            snapshot.as_ref(),
            &extras,
        ))
    }

    pub fn export_csv(&self, db: &Database, query: BobalyticsQuery, path: &str) -> AppResult<()> {
        let report = self.report(db, query)?;
        std::fs::write(path, report_to_csv(&report))
            .map_err(|error| AppError::Io(error.to_string()))
    }
}

fn normalize_scope(scope: Option<&str>) -> String {
    match scope.unwrap_or("workspace") {
        "team" => "team".into(),
        "user" => "user".into(),
        _ => "workspace".into(),
    }
}

fn normalize_range(days: Option<i64>) -> i64 {
    match days.unwrap_or(30) {
        7 => 7,
        90 => 90,
        _ => 30,
    }
}

fn load_activity(db: &Database, range_start: NaiveDate) -> AppResult<Vec<ActivityRow>> {
    let conn = db.conn.lock().unwrap();
    let start = range_start
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .to_rfc3339();
    let mut rows = Vec::new();

    let mut stmt = conn
        .prepare(
            "SELECT t.created_at, t.updated_at, t.project_id, COALESCE(p.name, 'Sans projet')
             FROM tasks t
             LEFT JOIN projects p ON p.id = t.project_id
             WHERE t.created_at >= ?1 OR t.updated_at >= ?1",
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    let task_iter = stmt
        .query_map(params![start], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| AppError::Database(error.to_string()))?;
    for item in task_iter.flatten() {
        let (created, updated, project_id, project_name) = item;
        for stamp in [created, updated] {
            if let Some(day) = parse_day(&stamp) {
                if day >= range_start {
                    rows.push(ActivityRow {
                        day,
                        project_id: project_id.clone(),
                        project_name: project_name.clone(),
                        kind: ActivityKind::Task,
                    });
                }
            }
        }
    }

    let mut msg_stmt = conn
        .prepare(
            "SELECT m.created_at, c.project_id, COALESCE(p.name, 'Sans projet')
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             LEFT JOIN projects p ON p.id = c.project_id
             WHERE m.created_at >= ?1",
        )
        .map_err(|error| AppError::Database(error.to_string()))?;
    let msg_iter = msg_stmt
        .query_map(params![start], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| AppError::Database(error.to_string()))?;
    for item in msg_iter.flatten() {
        let (created, project_id, project_name) = item;
        if let Some(day) = parse_day(&created) {
            if day >= range_start {
                rows.push(ActivityRow {
                    day,
                    project_id,
                    project_name,
                    kind: ActivityKind::Message,
                });
            }
        }
    }
    Ok(rows)
}

fn parse_day(value: &str) -> Option<NaiveDate> {
    DateTimeParse(value).ok()
}

struct DateTimeParse<'a>(&'a str);

impl DateTimeParse<'_> {
    fn ok(self) -> Option<NaiveDate> {
        chrono::DateTime::parse_from_rfc3339(self.0)
            .ok()
            .map(|dt| dt.with_timezone(&Local).date_naive())
            .or_else(|| {
                NaiveDate::parse_from_str(&self.0.chars().take(10).collect::<String>(), "%Y-%m-%d")
                    .ok()
            })
    }
}

fn load_gateway_extras(db: &Database, snapshot: Option<&UsageSnapshotData>) -> GatewayExtras {
    let mut extras = GatewayExtras {
        instance_label: snapshot.and_then(|item| item.instance_label.clone()),
        ..GatewayExtras::default()
    };

    if let Ok(Some(latest)) = BobUsageService::new().latest_snapshot(db) {
        if extras.instance_label.is_none() {
            extras.instance_label = latest.instance_label;
        }
        let conn = db.conn.lock().unwrap();
        if let Ok(raw) = conn.query_row(
            "SELECT raw FROM usage_snapshots ORDER BY captured_at DESC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        ) {
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                let profile = value.get("profile").cloned().unwrap_or(value);
                extras.greeting_name = profile_display_name(&profile);
                merge_profile_teams(&mut extras, &profile);
                extras.source_hit = true;
            }
        }
    }

    // Do not probe speculative gateway analytics paths on open — unknown routes stall for seconds.
    // Enrich from the cached IBM profile already stored with usage_snapshots.
    extras
}

fn merge_profile_teams(extras: &mut GatewayExtras, profile: &Value) {
    let Some(instances) = profile.get("instances").and_then(Value::as_array) else {
        return;
    };
    if extras.instance_label.is_none() {
        extras.instance_label = instances
            .first()
            .and_then(|instance| {
                instance
                    .get("instance_name")
                    .or_else(|| instance.get("name"))
            })
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    let mut teams = Vec::new();
    let mut total_usage = 0.0;
    for instance in instances {
        if let Some(list) = instance.get("teams").and_then(Value::as_array) {
            for team in list {
                let usage = json_f64(team.get("usage")).unwrap_or(0.0);
                total_usage += usage;
                teams.push((
                    team.get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("team")
                        .to_string(),
                    team.get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Équipe")
                        .to_string(),
                    usage,
                    json_f64(team.get("member_count"))
                        .or_else(|| json_f64(team.get("seat_count")))
                        .unwrap_or(0.0),
                ));
            }
        }
        extras.seats = extras.seats.or_else(|| {
            json_f64(instance.get("seat_count"))
                .or_else(|| json_f64(instance.get("seats")))
                .map(|value| value.round() as i64)
        });
    }
    if extras.teams.is_empty() && !teams.is_empty() {
        extras.teams = teams
            .iter()
            .map(|(id, name, usage, members)| {
                let spend = if total_usage > 0.0 {
                    (usage / total_usage) * 100.0
                } else {
                    0.0
                };
                BobalyticsTeamPoint {
                    id: id.clone(),
                    name: name.clone(),
                    active_share_pct: if members > &0.0 {
                        (*members).min(100.0)
                    } else {
                        spend.min(100.0)
                    },
                    committed_share_pct: spend,
                    spend_share_pct: spend,
                    output_share_pct: spend,
                    typical_day_active_pct: spend.min(100.0),
                    highlight: None,
                }
            })
            .collect();
    }
}

fn json_f64(value: Option<&Value>) -> Option<f64> {
    value.and_then(|item| {
        item.as_f64()
            .or_else(|| item.as_i64().map(|v| v as f64))
            .or_else(|| item.as_u64().map(|v| v as f64))
            .or_else(|| item.as_str().and_then(|v| v.parse().ok()))
    })
}

fn build_report(
    scope: String,
    range_days: i64,
    today: NaiveDate,
    activity: &[ActivityRow],
    snapshot: Option<&UsageSnapshotData>,
    extras: &GatewayExtras,
) -> BobalyticsReport {
    let tasks_today = activity
        .iter()
        .filter(|row| row.kind == ActivityKind::Task && row.day == today)
        .count() as i64;
    let weekly_rhythm = weekly_rhythm(activity, today);
    let peak_day = weekly_rhythm
        .iter()
        .max_by(|a, b| {
            a.value
                .partial_cmp(&b.value)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .filter(|point| point.value > 0.0)
        .cloned();
    let streak_days = streak(activity, today);
    let momentum = if streak_days >= 5 {
        "Momentum looks good.".into()
    } else if streak_days >= 2 {
        "Keep the rhythm.".into()
    } else if tasks_today > 0 {
        "A solid start today.".into()
    } else {
        "Start a task today.".into()
    };

    let activity_days: HashSet<NaiveDate> = activity.iter().map(|row| row.day).collect();
    let activity_day_count = activity_days.len() as i64;
    let bobcoins = snapshot.and_then(|item| item.used_amount).unwrap_or(0.0);
    let local_teams = teams_from_activity(activity, scope.as_str());
    let teams = if extras.teams.is_empty() || scope == "user" {
        local_teams
    } else {
        extras.teams.clone()
    };
    let highlighted = teams
        .iter()
        .max_by(|a, b| {
            a.committed_share_pct
                .partial_cmp(&b.committed_share_pct)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();

    let seats = match scope.as_str() {
        "user" => 1,
        _ => extras.seats.unwrap_or(1).max(1),
    };
    let bob_users = extras
        .bob_users
        .unwrap_or(if activity_day_count > 0 { 1 } else { 0 });
    let typical_day = extras.typical_day_active.unwrap_or(if range_days > 0 {
        activity_day_count as f64 / range_days as f64
    } else {
        0.0
    });
    let adoption = if seats > 0 {
        (typical_day / seats as f64) * 100.0
    } else {
        0.0
    };
    let bob_users_pct = if seats > 0 {
        (bob_users as f64 / seats as f64) * 100.0
    } else {
        0.0
    };
    let typical_day_pct = if bob_users > 0 {
        (typical_day / bob_users as f64) * 100.0
    } else {
        0.0
    };
    let bob_factor = extras.bob_factor_pct.or_else(|| {
        if activity.is_empty() {
            None
        } else {
            let task_days = activity
                .iter()
                .filter(|row| row.kind == ActivityKind::Task)
                .map(|row| row.day)
                .collect::<HashSet<_>>()
                .len() as f64;
            Some(((task_days / range_days.max(1) as f64) * 100.0).min(100.0))
        }
    });

    let weekly_users =
        if streak_days >= 3 || weekly_rhythm.iter().filter(|d| d.value > 0.0).count() >= 3 {
            bob_users.min(1)
        } else {
            0
        };
    let light = (bob_users - weekly_users).max(0);
    let inactive = (seats - bob_users).max(0);

    let reach_ahead = bob_users_pct > typical_day_pct;
    let reach_headline = if reach_ahead {
        "Reach is ahead of habit.".into()
    } else if typical_day_pct > 40.0 {
        "Habit is catching up with reach.".into()
    } else {
        "Usage is still concentrating.".into()
    };

    let source = if extras.source_hit && snapshot.is_some() {
        "mixed"
    } else if extras.source_hit {
        "gateway"
    } else {
        "local"
    };
    let greeting = extras
        .greeting_name
        .clone()
        .or_else(|| std::env::var("USER").ok().and_then(title_case_name))
        .unwrap_or_else(|| "there".into());

    let message = if extras.source_hit {
        None
    } else {
        Some("Métriques calculées depuis Bob Work et votre compte IBM Bob. Les graphiques d’organisation Enterprise apparaissent dès que l’API Bobalytics est accessible.".into())
    };

    BobalyticsReport {
        generated_at: Utc::now().to_rfc3339(),
        greeting_name: greeting,
        instance_label: extras.instance_label.clone(),
        scope,
        range_days,
        source: source.into(),
        message,
        seats,
        today: BobalyticsToday {
            tasks_today,
            streak_days,
            momentum,
            weekly_rhythm,
            peak_day,
        },
        kpis: BobalyticsKpis {
            avg_daily_users: typical_day,
            seats,
            adoption_pct: adoption,
            bob_factor_pct: bob_factor,
            bobcoins,
        },
        patterns: BobalyticsPatterns {
            activity_days: activity_day_count,
            headline: format!(
                "{activity_day_count} day{} with task activity",
                if activity_day_count == 1 { "" } else { "s" }
            ),
            body: "Task work appeared across multiple days throughout the selected range, showing how activity distributed across the period.".into(),
            reach_headline,
            reach_body: format!(
                "{bob_users} of {seats} people showed recorded Bob usage in the selected period; {:.0} are active on a typical day.",
                typical_day
            ),
            bob_users,
            bob_users_pct,
            typical_day_active: typical_day,
            typical_day_pct,
            usage_frequency: BobalyticsUsageFrequency {
                weekly: weekly_users,
                light,
                inactive,
            },
            recorded_spend: bobcoins,
            committed_lines: extras.committed_lines,
            insight: format!(
                "Bob appears in {:.0}% of committed lines this month",
                bob_factor.unwrap_or(0.0)
            ),
            highlighted_team_id: highlighted.as_ref().map(|team| team.id.clone()),
            teams,
        },
    }
}

fn title_case_name(name: String) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut chars = trimmed.chars();
    Some(chars.next()?.to_uppercase().collect::<String>() + chars.as_str())
}

fn weekly_rhythm(activity: &[ActivityRow], today: NaiveDate) -> Vec<BobalyticsDayPoint> {
    let week_start = today - Duration::days(6);
    let mut counts = [0.0; 7];
    for row in activity {
        if row.day < week_start || row.kind != ActivityKind::Task {
            continue;
        }
        let index = row.day.weekday().num_days_from_sunday() as usize;
        counts[index] += 1.0;
    }
    (0..7)
        .map(|index| BobalyticsDayPoint {
            day: WEEKDAY_LABELS[index].into(),
            label: WEEKDAY_LABELS[index].into(),
            value: counts[index],
        })
        .collect()
}

fn streak(activity: &[ActivityRow], today: NaiveDate) -> i64 {
    let days: HashSet<NaiveDate> = activity.iter().map(|row| row.day).collect();
    let mut cursor = today;
    if !days.contains(&cursor) {
        cursor -= Duration::days(1);
    }
    let mut count = 0;
    while days.contains(&cursor) {
        count += 1;
        cursor -= Duration::days(1);
    }
    count
}

fn teams_from_activity(activity: &[ActivityRow], scope: &str) -> Vec<BobalyticsTeamPoint> {
    if scope == "user" {
        return Vec::new();
    }
    let mut by_project: BTreeMap<String, (String, i64, i64)> = BTreeMap::new();
    for row in activity {
        let id = row.project_id.clone().unwrap_or_else(|| "none".into());
        let entry = by_project
            .entry(id)
            .or_insert_with(|| (row.project_name.clone(), 0, 0));
        entry.1 += 1;
        if row.kind == ActivityKind::Task {
            entry.2 += 1;
        }
    }
    let total: i64 = by_project.values().map(|item| item.1).sum::<i64>().max(1);
    let task_total: i64 = by_project.values().map(|item| item.2).sum::<i64>().max(1);
    by_project
        .into_iter()
        .map(|(id, (name, events, tasks))| {
            let spend = (events as f64 / total as f64) * 100.0;
            let output = (tasks as f64 / task_total as f64) * 100.0;
            BobalyticsTeamPoint {
                id,
                name,
                active_share_pct: spend.min(100.0),
                committed_share_pct: output.min(100.0),
                spend_share_pct: spend.min(100.0),
                output_share_pct: output.min(100.0),
                typical_day_active_pct: spend.min(100.0),
                highlight: None,
            }
        })
        .collect()
}

fn report_to_csv(report: &BobalyticsReport) -> String {
    let mut out = String::from("table,metric,value\n");
    out.push_str(&format!("summary,scope,{}\n", report.scope));
    out.push_str(&format!("summary,rangeDays,{}\n", report.range_days));
    out.push_str(&format!("summary,seats,{}\n", report.seats));
    out.push_str(&format!(
        "summary,tasksToday,{}\n",
        report.today.tasks_today
    ));
    out.push_str(&format!(
        "summary,streakDays,{}\n",
        report.today.streak_days
    ));
    out.push_str(&format!(
        "summary,avgDailyUsers,{:.4}\n",
        report.kpis.avg_daily_users
    ));
    out.push_str(&format!(
        "summary,adoptionPct,{:.4}\n",
        report.kpis.adoption_pct
    ));
    out.push_str(&format!(
        "summary,bobFactorPct,{}\n",
        report
            .kpis
            .bob_factor_pct
            .map(|value| format!("{value:.4}"))
            .unwrap_or_else(|| "".into())
    ));
    out.push_str(&format!("summary,bobcoins,{:.4}\n", report.kpis.bobcoins));
    out.push_str(&format!(
        "summary,activityDays,{}\n",
        report.patterns.activity_days
    ));
    for point in &report.today.weekly_rhythm {
        out.push_str(&format!("weeklyRhythm,{},{}\n", point.day, point.value));
    }
    out.push_str("teams,name,spendSharePct,outputSharePct,activeSharePct,committedSharePct\n");
    for team in &report.patterns.teams {
        out.push_str(&format!(
            "teams,{},{:.4},{:.4},{:.4},{:.4}\n",
            csv_escape(&team.name),
            team.spend_share_pct,
            team.output_share_pct,
            team.active_share_pct,
            team.committed_share_pct
        ));
    }
    out
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(offset: i64) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 12).unwrap() - Duration::days(offset)
    }

    fn task(offset: i64, project: &str) -> ActivityRow {
        ActivityRow {
            day: day(offset),
            project_id: Some(project.into()),
            project_name: project.into(),
            kind: ActivityKind::Task,
        }
    }

    #[test]
    fn builds_today_streak_and_project_teams() {
        let today = day(0);
        let activity = vec![
            task(0, "Atlas"),
            task(0, "Atlas"),
            task(1, "Beacon"),
            task(2, "Atlas"),
        ];
        let report = build_report(
            "workspace".into(),
            30,
            today,
            &activity,
            None,
            &GatewayExtras::default(),
        );
        assert_eq!(report.today.tasks_today, 2);
        assert_eq!(report.today.streak_days, 3);
        assert_eq!(report.patterns.activity_days, 3);
        assert_eq!(report.seats, 1);
        assert!(report
            .patterns
            .teams
            .iter()
            .any(|team| team.name == "Atlas"));
        assert!(report.kpis.bob_factor_pct.is_some());
    }

    #[test]
    fn user_scope_hides_team_breakdown() {
        let today = day(0);
        let report = build_report(
            "user".into(),
            7,
            today,
            &[task(0, "Atlas")],
            None,
            &GatewayExtras::default(),
        );
        assert_eq!(report.scope, "user");
        assert!(report.patterns.teams.is_empty());
        assert_eq!(report.seats, 1);
    }

    #[test]
    fn csv_export_includes_kpis() {
        let report = build_report(
            "workspace".into(),
            30,
            day(0),
            &[task(0, "Atlas")],
            None,
            &GatewayExtras::default(),
        );
        let csv = report_to_csv(&report);
        assert!(csv.contains("summary,tasksToday,1"));
        assert!(csv.contains("weeklyRhythm"));
        assert!(csv.contains("Atlas"));
    }
}
