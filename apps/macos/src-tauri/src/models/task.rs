#![allow(dead_code)]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub objective: String,
    pub project_id: Option<String>,
    pub conversation_id: Option<String>,
    pub mode: Option<String>,
    pub permission_policy: String,
    pub budget: Option<f64>,
    pub max_time: Option<i64>,
    pub bob_process_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub summary: Option<String>,
    pub progress: f64,
    pub errors: serde_json::Value,
    pub resumable: bool,
    pub schedule_id: Option<String>,
    pub shell_task_id: Option<String>,
    pub last_event_at: Option<String>,
    pub pinned: bool,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStep {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub dependencies: serde_json::Value,
    pub responsible_agent: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub tools: serde_json::Value,
    pub inputs: serde_json::Value,
    pub outputs: serde_json::Value,
    pub retry_count: i64,
    pub error: Option<String>,
    pub validation_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub objective: String,
    pub project_id: Option<String>,
    pub conversation_id: Option<String>,
    pub mode: Option<String>,
    pub permission_policy: Option<String>,
    pub budget: Option<f64>,
    pub max_time: Option<i64>,
    pub schedule_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRun {
    pub id: String,
    pub task_id: String,
    pub attempt: i64,
    pub state: String,
    pub shell_session_id: Option<String>,
    pub shell_task_id: Option<String>,
    pub process_id: Option<i64>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub sequence: i64,
    pub event_type: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tool_name: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIo {
    pub id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub direction: String,
    pub io_type: String,
    pub name: String,
    pub path_or_url: Option<String>,
    pub mime_type: Option<String>,
    pub size: Option<i64>,
    pub sha256: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub task: Task,
    pub runs: Vec<TaskRun>,
    pub events: Vec<TaskEvent>,
    pub inputs: Vec<TaskIo>,
    pub outputs: Vec<TaskIo>,
}
