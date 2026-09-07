use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BobalyticsQuery {
    pub scope: Option<String>,
    pub range_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BobalyticsDayPoint {
    pub day: String,
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BobalyticsTeamPoint {
    pub id: String,
    pub name: String,
    pub active_share_pct: f64,
    pub committed_share_pct: f64,
    pub spend_share_pct: f64,
    pub output_share_pct: f64,
    pub typical_day_active_pct: f64,
    pub highlight: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BobalyticsToday {
    pub tasks_today: i64,
    pub streak_days: i64,
    pub momentum: String,
    pub weekly_rhythm: Vec<BobalyticsDayPoint>,
    pub peak_day: Option<BobalyticsDayPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BobalyticsKpis {
    pub avg_daily_users: f64,
    pub seats: i64,
    pub adoption_pct: f64,
    pub bob_factor_pct: Option<f64>,
    pub bobcoins: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BobalyticsPatterns {
    pub activity_days: i64,
    pub headline: String,
    pub body: String,
    pub reach_headline: String,
    pub reach_body: String,
    pub bob_users: i64,
    pub bob_users_pct: f64,
    pub typical_day_active: f64,
    pub typical_day_pct: f64,
    pub usage_frequency: BobalyticsUsageFrequency,
    pub recorded_spend: f64,
    pub committed_lines: Option<i64>,
    pub insight: String,
    pub teams: Vec<BobalyticsTeamPoint>,
    pub highlighted_team_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BobalyticsUsageFrequency {
    pub weekly: i64,
    pub light: i64,
    pub inactive: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BobalyticsReport {
    pub generated_at: String,
    pub greeting_name: String,
    pub instance_label: Option<String>,
    pub scope: String,
    pub range_days: i64,
    pub source: String,
    pub message: Option<String>,
    pub seats: i64,
    pub today: BobalyticsToday,
    pub kpis: BobalyticsKpis,
    pub patterns: BobalyticsPatterns,
}
