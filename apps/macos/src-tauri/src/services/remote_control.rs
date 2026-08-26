use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::approval::ResolveApprovalInput;
use crate::models::artifact::Artifact;
use crate::models::conversation::CreateConversationInput;
use crate::models::project::{CreateProjectInput, UpdateProjectInput};
use crate::services::artifact::ArtifactService;
use crate::services::bob::BobService;
use crate::services::conversation::ConversationService;
use crate::services::integration_oauth::IntegrationOAuthService;
use crate::services::plugin::PluginService;
use crate::services::project::ProjectService;
use crate::services::scheduler::{CreateScheduleInput, SchedulerService};
use crate::services::settings::SettingsService;
use crate::services::task::TaskService;
use crate::services::workspace::WorkspaceService;
use axum::body::Body;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, EventId, Listener, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

const API_VERSION: &str = "1";
const MAX_PROMPT_BYTES: usize = 64 * 1024;
const MAX_UPLOAD_BYTES: usize = 12 * 1024 * 1024;
const MAX_ARTIFACT_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControlStatus {
    pub enabled: bool,
    pub state: String,
    pub public_url: Option<String>,
    pub connection_url: Option<String>,
    pub error: Option<String>,
}

struct RuntimeHandles {
    server: JoinHandle<()>,
    tunnel: JoinHandle<()>,
    app: tauri::AppHandle,
    listeners: Vec<EventId>,
}

pub struct RemoteControlService {
    status: Arc<Mutex<RemoteControlStatus>>,
    runtime: Mutex<Option<RuntimeHandles>>,
    upload_dir: PathBuf,
}

impl RemoteControlService {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            status: Arc::new(Mutex::new(RemoteControlStatus {
                enabled: false,
                state: "disabled".into(),
                public_url: None,
                connection_url: None,
                error: None,
            })),
            runtime: Mutex::new(None),
            upload_dir: data_dir.join("remote-control-uploads"),
        }
    }

    pub fn status(&self) -> RemoteControlStatus {
        self.status.lock().unwrap().clone()
    }

    pub async fn start(&self, app_handle: tauri::AppHandle) -> AppResult<()> {
        if self.runtime.lock().unwrap().is_some() {
            return Ok(());
        }

        update_status(
            &self.status,
            &app_handle,
            RemoteControlStatus {
                enabled: true,
                state: "starting".into(),
                public_url: None,
                connection_url: None,
                error: None,
            },
        );
        let cloudflared = match resolve_cloudflared() {
            Some(path) => path,
            None => {
                let message =
                    "Cloudflared est introuvable. Installez-le avec Homebrew puis réessayez."
                        .to_string();
                set_runtime_error(&self.status, &app_handle, message.clone());
                return Err(AppError::Io(message));
            }
        };
        if let Err(error) = std::fs::create_dir_all(&self.upload_dir) {
            set_runtime_error(&self.status, &app_handle, error.to_string());
            return Err(error.into());
        }

        let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(error) => {
                let message = format!("Serveur distant indisponible : {error}");
                set_runtime_error(&self.status, &app_handle, message.clone());
                return Err(AppError::Io(message));
            }
        };
        let port = listener.local_addr()?.port();
        let mut token_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut token_bytes);
        let token = URL_SAFE_NO_PAD.encode(token_bytes);
        let (events, _) = broadcast::channel(512);
        let listeners = forward_live_events(&app_handle, events.clone());
        let api_state = ApiState {
            app: app_handle.clone(),
            token: Arc::new(token.clone()),
            upload_dir: self.upload_dir.clone(),
            events,
        };
        let router = api_router(api_state);
        let status_for_server = self.status.clone();
        let app_for_server = app_handle.clone();
        let server = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router).await {
                set_runtime_error(
                    &status_for_server,
                    &app_for_server,
                    format!("Le serveur mobile s’est arrêté : {error}"),
                );
            }
        });

        let status_for_tunnel = self.status.clone();
        let app_for_tunnel = app_handle.clone();
        let tunnel = tokio::spawn(async move {
            let mut child = match Command::new(&cloudflared)
                .args([
                    "tunnel",
                    "--url",
                    &format!("http://127.0.0.1:{port}"),
                    "--no-autoupdate",
                ])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn()
            {
                Ok(child) => child,
                Err(error) => {
                    set_runtime_error(
                        &status_for_tunnel,
                        &app_for_tunnel,
                        format!("Cloudflare Tunnel n’a pas démarré : {error}"),
                    );
                    return;
                }
            };

            let stdout = child.stdout.take().map(|pipe| BufReader::new(pipe).lines());
            let stderr = child.stderr.take().map(|pipe| BufReader::new(pipe).lines());
            let mut stdout = stdout;
            let mut stderr = stderr;
            let mut found_url = false;

            loop {
                tokio::select! {
                    line = next_line(&mut stdout) => {
                        match line {
                            Some(line) => found_url |= publish_tunnel_url(&line, &token, &status_for_tunnel, &app_for_tunnel),
                            None if stderr.is_none() => break,
                            None => stdout = None,
                        }
                    }
                    line = next_line(&mut stderr) => {
                        match line {
                            Some(line) => found_url |= publish_tunnel_url(&line, &token, &status_for_tunnel, &app_for_tunnel),
                            None if stdout.is_none() => break,
                            None => stderr = None,
                        }
                    }
                }
            }

            let exit = child.wait().await;
            let still_enabled = status_for_tunnel.lock().unwrap().enabled;
            if still_enabled {
                let detail = match exit {
                    Ok(status) => format!("Cloudflare Tunnel s’est arrêté ({status})."),
                    Err(error) => format!("Cloudflare Tunnel s’est arrêté : {error}"),
                };
                set_runtime_error(
                    &status_for_tunnel,
                    &app_for_tunnel,
                    if found_url {
                        detail
                    } else {
                        format!("Aucun lien Cloudflare reçu. {detail}")
                    },
                );
            }
        });

        *self.runtime.lock().unwrap() = Some(RuntimeHandles {
            server,
            tunnel,
            app: app_handle,
            listeners,
        });
        Ok(())
    }

    pub fn stop(&self) {
        if let Some(handles) = self.runtime.lock().unwrap().take() {
            handles.tunnel.abort();
            handles.server.abort();
            for listener in handles.listeners {
                handles.app.unlisten(listener);
            }
        }
        *self.status.lock().unwrap() = RemoteControlStatus {
            enabled: false,
            state: "disabled".into(),
            public_url: None,
            connection_url: None,
            error: None,
        };
    }
}

impl Drop for RemoteControlService {
    fn drop(&mut self) {
        if let Some(handles) = self.runtime.get_mut().ok().and_then(Option::take) {
            handles.tunnel.abort();
            handles.server.abort();
            for listener in handles.listeners {
                handles.app.unlisten(listener);
            }
        }
    }
}

fn forward_live_events(app: &tauri::AppHandle, sender: broadcast::Sender<Value>) -> Vec<EventId> {
    [
        "bob-token",
        "bob-activity",
        "bob-session-done",
        "task-updated",
        "approval-required",
        "approval-resolved",
        "conversation-updated",
        "conversation-messages-changed",
        "project-updated",
        "artifacts-updated",
        "schedule-updated",
    ]
    .into_iter()
    .map(|event_name| {
        let event_type = event_name.to_string();
        let sender = sender.clone();
        let listener_app = app.clone();
        let push_app = app.clone();
        listener_app.listen(event_name, move |event| {
            let payload = serde_json::from_str::<Value>(event.payload())
                .unwrap_or_else(|_| json!(event.payload()));
            let _ = sender.send(json!({
                "type": &event_type,
                "payload": &payload,
                "sentAt": chrono::Utc::now().to_rfc3339(),
            }));
            if matches!(
                event_type.as_str(),
                "bob-session-done" | "approval-required"
            ) {
                let app = push_app.clone();
                let event_type = event_type.clone();
                tauri::async_runtime::spawn(async move {
                    send_mobile_pushes(&app, &event_type, &payload).await;
                });
            }
        })
    })
    .collect()
}

async fn next_line<T: tokio::io::AsyncRead + Unpin>(
    lines: &mut Option<tokio::io::Lines<BufReader<T>>>,
) -> Option<String> {
    match lines {
        Some(lines) => lines.next_line().await.ok().flatten(),
        None => std::future::pending().await,
    }
}

fn publish_tunnel_url(
    line: &str,
    token: &str,
    status: &Arc<Mutex<RemoteControlStatus>>,
    app: &tauri::AppHandle,
) -> bool {
    let public_url = line
        .split_whitespace()
        .map(|part| {
            part.trim_matches(|character: char| {
                matches!(character, '"' | '\'' | ',' | ')' | '(' | '[' | ']')
            })
        })
        .find(|part| part.starts_with("https://") && part.contains("trycloudflare.com"))
        .map(|part| part.trim_end_matches('/').to_string());
    let Some(public_url) = public_url else {
        return false;
    };
    update_status(
        status,
        app,
        RemoteControlStatus {
            enabled: true,
            state: "ready".into(),
            connection_url: Some(format!("{public_url}/#token={token}")),
            public_url: Some(public_url),
            error: None,
        },
    );
    true
}

fn set_runtime_error(
    status: &Arc<Mutex<RemoteControlStatus>>,
    app: &tauri::AppHandle,
    error: String,
) {
    update_status(
        status,
        app,
        RemoteControlStatus {
            enabled: true,
            state: "error".into(),
            public_url: None,
            connection_url: None,
            error: Some(error),
        },
    );
}

fn update_status(
    status: &Arc<Mutex<RemoteControlStatus>>,
    app: &tauri::AppHandle,
    next: RemoteControlStatus,
) {
    *status.lock().unwrap() = next.clone();
    let _ = app.emit("remote-control-status", &next);
}

fn resolve_cloudflared() -> Option<PathBuf> {
    which::which("cloudflared").ok().or_else(|| {
        [
            "/opt/homebrew/bin/cloudflared",
            "/usr/local/bin/cloudflared",
        ]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
    })
}

#[derive(Clone)]
struct ApiState {
    app: tauri::AppHandle,
    token: Arc<String>,
    upload_dir: PathBuf,
    events: broadcast::Sender<Value>,
}

fn api_router(state: ApiState) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/bootstrap", get(bootstrap))
        .route("/api/v1/sync", get(sync_snapshot))
        .route("/api/v1/events", get(live_events))
        .route("/api/v1/tasks", get(list_tasks))
        .route(
            "/api/v1/tasks/{id}",
            get(get_task_detail).patch(update_remote_task),
        )
        .route(
            "/api/v1/tasks/{id}/cancel",
            axum::routing::post(cancel_task),
        )
        .route("/api/v1/tasks/{id}/retry", axum::routing::post(retry_task))
        .route(
            "/api/v1/tasks/{id}/reply",
            axum::routing::post(reply_to_task),
        )
        .route("/api/v1/approvals", get(list_approvals))
        .route(
            "/api/v1/approvals/{id}/resolve",
            axum::routing::post(resolve_approval),
        )
        .route(
            "/api/v1/devices/push-token",
            axum::routing::post(register_push_token).delete(unregister_push_token),
        )
        .route(
            "/api/v1/schedules",
            get(list_schedules).post(create_remote_schedule),
        )
        .route(
            "/api/v1/schedules/{id}",
            axum::routing::patch(update_remote_schedule).delete(delete_remote_schedule),
        )
        .route(
            "/api/v1/schedules/{id}/state",
            axum::routing::patch(update_remote_schedule_state),
        )
        .route(
            "/api/v1/schedules/{id}/run",
            axum::routing::post(run_remote_schedule),
        )
        .route("/api/v1/schedules/{id}/runs", get(list_schedule_runs))
        .route("/api/v1/artifacts", get(list_artifacts))
        .route(
            "/api/v1/artifacts/{id}",
            get(get_artifact).delete(delete_artifact),
        )
        .route("/api/v1/artifacts/{id}/content", get(get_artifact_content))
        .route("/api/v1/projects", get(list_projects).post(create_project))
        .route(
            "/api/v1/projects/{id}",
            axum::routing::patch(update_remote_project).delete(delete_remote_project),
        )
        .route("/api/v1/search", get(search_conversations))
        .route(
            "/api/v1/conversations",
            get(list_conversations).post(create_conversation),
        )
        .route(
            "/api/v1/conversations/{id}",
            axum::routing::patch(update_remote_conversation).delete(delete_remote_conversation),
        )
        .route(
            "/api/v1/conversations/{id}/messages",
            get(list_messages).post(send_prompt),
        )
        .route(
            "/api/v1/conversations/{id}/messages/{message_id}/resend",
            axum::routing::post(resend_prompt),
        )
        .route("/api/v1/catalog", get(catalog))
        .route("/api/v1/modes", get(list_modes))
        // JSON/base64 adds roughly 4/3 overhead to binary attachments.
        .layer(RequestBodyLimitLayer::new(
            (MAX_UPLOAD_BYTES * 4 / 3) + MAX_PROMPT_BYTES + (256 * 1024),
        ))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}

type ApiResult<T> = Result<Json<T>, ApiError>;

struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<AppError> for ApiError {
    fn from(error: AppError) -> Self {
        let status = match error {
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::PermissionDenied(_) | AppError::Security(_) => StatusCode::FORBIDDEN,
            AppError::ValidationFailed(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self(status, error.to_string())
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(error: rusqlite::Error) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
    }
}

async fn live_events(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    authorize(&headers, &state.token)?;
    let initial = tokio_stream::once(Ok::<SseEvent, Infallible>(
        SseEvent::default().data(
            json!({
                "type": "connected",
                "payload": { "apiVersion": API_VERSION },
                "sentAt": chrono::Utc::now().to_rfc3339(),
            })
            .to_string(),
        ),
    ));
    let updates = BroadcastStream::new(state.events.subscribe()).filter_map(|event| match event {
        Ok(value) => Some(Ok::<SseEvent, Infallible>(
            SseEvent::default().data(value.to_string()),
        )),
        Err(_) => None,
    });
    Ok(Sse::new(initial.chain(updates)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("keep-alive"),
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemotePushRegistration {
    token: String,
    platform: Option<String>,
    device_name: Option<String>,
    language: Option<String>,
}

async fn register_push_token(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(input): Json<RemotePushRegistration>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    if !is_valid_expo_push_token(&input.token) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Jeton push invalide.".into(),
        ));
    }
    let db = state.app.state::<Database>();
    let mut registrations = mobile_push_registrations(&db);
    registrations.retain(|registration| registration.token != input.token);
    registrations.push(input);
    registrations.truncate(12);
    db.conn.lock().unwrap().execute(
        "INSERT INTO settings (key,value,updated_at) VALUES ('remote_mobile_push_tokens',?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        rusqlite::params![
            serde_json::to_string(&registrations).unwrap_or_else(|_| "[]".into()),
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(Json(json!({ "registered": true })))
}

async fn unregister_push_token(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(input): Json<RemotePushRegistration>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let mut registrations = mobile_push_registrations(&db);
    registrations.retain(|registration| registration.token != input.token);
    db.conn.lock().unwrap().execute(
        "INSERT INTO settings (key,value,updated_at) VALUES ('remote_mobile_push_tokens',?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        rusqlite::params![
            serde_json::to_string(&registrations).unwrap_or_else(|_| "[]".into()),
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(Json(json!({ "registered": false })))
}

fn is_valid_expo_push_token(token: &str) -> bool {
    token.len() <= 256
        && (token.starts_with("ExponentPushToken[") || token.starts_with("ExpoPushToken["))
        && token.ends_with(']')
}

fn mobile_push_registrations(db: &Database) -> Vec<RemotePushRegistration> {
    let value = db
        .conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT value FROM settings WHERE key='remote_mobile_push_tokens'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "[]".into());
    serde_json::from_str(&value).unwrap_or_default()
}

async fn send_mobile_pushes(app: &tauri::AppHandle, event_type: &str, payload: &Value) {
    let db = app.state::<Database>();
    let registrations = mobile_push_registrations(&db);
    if registrations.is_empty() {
        return;
    }
    let success = payload
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let body = payload
        .get("humanDescription")
        .or_else(|| payload.get("fullOutput"))
        .or_else(|| payload.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("Bob Work demande votre attention.")
        .chars()
        .take(180)
        .collect::<String>();
    let messages = registrations
        .into_iter()
        .map(|registration| {
            let language = registration.language.as_deref().unwrap_or("fr");
            let title = match (language, event_type, success) {
                ("en", "approval-required", _) => "Bob Work needs approval",
                ("es", "approval-required", _) => "Bob Work necesita autorización",
                (_, "approval-required", _) => "Bob Work demande une autorisation",
                ("en", _, true) => "Bob task completed",
                ("es", _, true) => "Tarea de Bob terminada",
                (_, _, true) => "Tâche Bob terminée",
                ("en", _, false) => "Bob task failed",
                ("es", _, false) => "La tarea de Bob falló",
                (_, _, false) => "La tâche Bob a échoué",
            };
            json!({
                "to": registration.token,
                "title": title,
                "body": body,
                "sound": "default",
                "data": {
                    "conversationId": payload.get("conversationId"),
                    "taskId": payload.get("taskId"),
                    "type": event_type,
                },
            })
        })
        .collect::<Vec<_>>();
    let result = reqwest::Client::new()
        .post("https://exp.host/--/api/v2/push/send")
        .header("Accept", "application/json")
        .header("Accept-Encoding", "gzip, deflate")
        .json(&messages)
        .send()
        .await;
    match result {
        Ok(response) if !response.status().is_success() => {
            tracing::warn!(
                "Bob Mobile push notification was rejected with status {}",
                response.status()
            );
        }
        Err(error) => {
            tracing::warn!("Unable to send Bob Mobile push notification: {error}");
        }
        _ => {}
    }
}

fn authorize(headers: &HeaderMap, expected: &str) -> Result<(), ApiError> {
    let candidate = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    if constant_time_equal(candidate.as_bytes(), expected.as_bytes()) {
        Ok(())
    } else {
        Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Jeton d’accès invalide.".into(),
        ))
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

async fn health(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let bob = state.app.state::<BobService>();
    Ok(Json(json!({
        "status": "ok",
        "apiVersion": API_VERSION,
        "bobAvailable": bob.detect().found,
    })))
}

async fn bootstrap(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let settings = SettingsService::new().get(&db)?;
    let bob = state.app.state::<BobService>();
    Ok(Json(json!({
        "apiVersion": API_VERSION,
        "bobAvailable": bob.detect().found,
        "settings": {
            "theme": settings.theme,
            "language": settings.language,
            "defaultMode": settings.default_mode,
            "permissionPolicy": settings.permission_policy,
            "sandboxMode": settings.sandbox_mode,
            "mcpEnabled": settings.mcp_enabled,
            "subagentsEnabled": settings.subagents_enabled,
            "webEnabled": settings.web_enabled,
        }
    })))
}

/// Return the desktop history as one mobile snapshot. Every collection is read
/// from the exact same Database state managed by the running Bob Work process;
/// the mobile app never maintains a second conversation database.
async fn sync_snapshot(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let projects = remote_projects(&db)?;
    let conversations = remote_conversations(&db, None)?;
    let tasks = TaskService::new().get_all(&db, None)?;
    Ok(Json(json!({
        "syncedAt": chrono::Utc::now().to_rfc3339(),
        "projects": projects,
        "conversations": conversations,
        "tasks": tasks,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskQuery {
    project_id: Option<String>,
}

async fn list_tasks(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(query): Query<TaskQuery>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    Ok(Json(json!({
        "tasks": TaskService::new().get_all(&db, query.project_id.as_deref())?
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRemoteTaskInput {
    pinned: bool,
}

async fn update_remote_task(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<UpdateRemoteTaskInput>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    TaskService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Tâche introuvable.".into()))?;
    TaskService::new().set_pinned(&db, &id, input.pinned)?;
    let task = TaskService::new().get_by_id(&db, &id)?.unwrap();
    let _ = state.app.emit("task-updated", &id);
    Ok(Json(json!({ "task": task })))
}

async fn list_schedules(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    Ok(Json(
        json!({ "schedules": SchedulerService::new().get_all(&db)? }),
    ))
}

async fn create_remote_schedule(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(input): Json<CreateScheduleInput>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let schedule = SchedulerService::new().create(&state.app.state::<Database>(), input)?;
    let _ = state.app.emit("schedule-updated", &schedule.id);
    Ok(Json(json!({ "schedule": schedule })))
}

async fn update_remote_schedule(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<CreateScheduleInput>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    SchedulerService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Planification introuvable.".into()))?;
    let schedule = SchedulerService::new().update(&db, &id, input)?;
    let _ = state.app.emit("schedule-updated", &id);
    Ok(Json(json!({ "schedule": schedule })))
}

#[derive(Deserialize)]
struct RemoteScheduleStateInput {
    state: String,
}

async fn update_remote_schedule_state(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<RemoteScheduleStateInput>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    SchedulerService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Planification introuvable.".into()))?;
    SchedulerService::new().update_state(&db, &id, &input.state)?;
    let schedule = SchedulerService::new().get_by_id(&db, &id)?.unwrap();
    let _ = state.app.emit("schedule-updated", &id);
    Ok(Json(json!({ "schedule": schedule })))
}

async fn delete_remote_schedule(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    SchedulerService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Planification introuvable.".into()))?;
    SchedulerService::new().delete(&db, &id)?;
    let _ = state.app.emit("schedule-updated", &id);
    Ok(Json(json!({ "deleted": true, "scheduleId": id })))
}

async fn run_remote_schedule(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let task_id = SchedulerService::new().run_now(
        &state.app.state::<Database>(),
        &state.app.state::<BobService>(),
        &state.app,
        &id,
    )?;
    Ok(Json(json!({ "taskId": task_id })))
}

async fn list_schedule_runs(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    SchedulerService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Planification introuvable.".into()))?;
    Ok(Json(
        json!({ "runs": SchedulerService::new().get_runs(&db, &id)? }),
    ))
}

async fn get_task_detail(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let detail = TaskService::new()
        .get_detail(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Tâche introuvable.".into()))?;
    let artifacts = ArtifactService::new().get_all(&db, None)?;
    let artifacts_by_path = artifacts
        .into_iter()
        .map(|artifact| (artifact.file_path.clone(), artifact))
        .collect::<HashMap<_, _>>();
    let safe_io = |item: crate::models::task::TaskIo| {
        let artifact = item
            .path_or_url
            .as_deref()
            .and_then(|path| artifacts_by_path.get(path))
            .map(remote_artifact_metadata);
        json!({
            "id": item.id,
            "taskId": item.task_id,
            "runId": item.run_id,
            "direction": item.direction,
            "type": item.io_type,
            "name": item.name,
            "mimeType": item.mime_type,
            "size": item.size,
            "artifact": artifact,
            "createdAt": item.created_at,
        })
    };
    let events = detail
        .events
        .into_iter()
        .map(|event| {
            json!({
                "id": event.id,
                "taskId": event.task_id,
                "runId": event.run_id,
                "sequence": event.sequence,
                "type": event.event_type,
                "title": event.title,
                "content": event.content,
                "toolName": event.tool_name,
                "createdAt": event.created_at,
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "task": detail.task,
        "runs": detail.runs,
        "events": events,
        "inputs": detail.inputs.into_iter().map(&safe_io).collect::<Vec<_>>(),
        "outputs": detail.outputs.into_iter().map(safe_io).collect::<Vec<_>>(),
    })))
}

async fn cancel_task(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let task = TaskService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Tâche introuvable.".into()))?;
    if !matches!(
        task.state.as_str(),
        "starting" | "running" | "queued" | "awaiting_info" | "awaiting_approval" | "paused"
    ) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Cette tâche n’est plus active.".into(),
        ));
    }
    if let Some(session_id) = task.bob_process_id.as_deref() {
        let bob = state.app.state::<BobService>();
        let _ = bob.cancel_session(session_id);
    }
    let pending_approvals = {
        let conn = db.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id FROM approvals WHERE task_id=?1 AND decision='pending'")?;
        let approvals = stmt
            .query_map(rusqlite::params![&id], |row| row.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        approvals
    };
    for approval_id in pending_approvals {
        let bob = state.app.state::<BobService>();
        let _ = bob.take_pending_launch(&approval_id);
        db.conn.lock().unwrap().execute(
            "UPDATE approvals SET decision='denied',decided_by='mobile-cancel',decided_at=?1 WHERE id=?2",
            rusqlite::params![chrono::Utc::now().to_rfc3339(), &approval_id],
        )?;
        let _ = state.app.emit(
            "approval-resolved",
            json!({ "id": approval_id, "decision": "denied" }),
        );
    }
    TaskService::new().cancel(&db, &id)?;
    let _ = state.app.emit("task-updated", &id);
    Ok(Json(json!({ "taskId": id, "state": "cancelled" })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteTaskPrompt {
    prompt: Option<String>,
}

async fn retry_task(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<RemoteTaskPrompt>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let task = TaskService::new()
        .get_by_id(&state.app.state::<Database>(), &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Tâche introuvable.".into()))?;
    if matches!(task.state.as_str(), "starting" | "running" | "queued") {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Cette tâche est encore en cours.".into(),
        ));
    }
    let prompt = input
        .prompt
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if task.resumable {
                "Reprends cette tâche à partir de son dernier état et vérifie le résultat.".into()
            } else {
                task.objective.clone()
            }
        });
    start_task_follow_up(&state, task, prompt, true).await
}

async fn reply_to_task(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<RemoteTaskPrompt>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let prompt = input
        .prompt
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "La réponse est vide.".into()))?;
    let task = TaskService::new()
        .get_by_id(&state.app.state::<Database>(), &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Tâche introuvable.".into()))?;
    if matches!(task.state.as_str(), "starting" | "running" | "queued") {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Bob traite encore cette tâche.".into(),
        ));
    }
    start_task_follow_up(&state, task, prompt, false).await
}

async fn start_task_follow_up(
    state: &ApiState,
    task: crate::models::task::Task,
    prompt: String,
    retry: bool,
) -> ApiResult<Value> {
    let conversation_id = task
        .conversation_id
        .clone()
        .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "Conversation introuvable.".into()))?;
    let resume_task_id = (task.resumable && task.shell_task_id.is_some()).then(|| task.id.clone());
    let result = crate::commands::bob::send_message(
        state.app.clone(),
        conversation_id,
        prompt,
        task.mode.unwrap_or_else(|| "agent".into()),
        task.project_id,
        None,
        resume_task_id,
        None,
        state.app.state::<BobService>(),
        state.app.state::<Database>(),
    )
    .await?;
    let resumed_task_id = (result.task_id == task.id).then_some(task.id);
    Ok(Json(json!({
        "session": result,
        "resumedTaskId": resumed_task_id,
        "action": if retry { "retry" } else { "reply" },
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalQuery {
    conversation_id: Option<String>,
}

async fn list_approvals(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(query): Query<ApprovalQuery>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let approvals =
        crate::commands::approval::get_pending_approvals(state.app.state::<Database>()).await?;
    let approvals = if let Some(conversation_id) = query.conversation_id {
        let db = state.app.state::<Database>();
        approvals
            .into_iter()
            .filter(|approval| {
                TaskService::new()
                    .get_by_id(&db, &approval.task_id)
                    .ok()
                    .flatten()
                    .and_then(|task| task.conversation_id)
                    .as_deref()
                    == Some(conversation_id.as_str())
            })
            .collect::<Vec<_>>()
    } else {
        approvals
    };
    Ok(Json(json!({ "approvals": approvals })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteApprovalDecision {
    decision: String,
    permission_duration: Option<String>,
}

async fn resolve_approval(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<RemoteApprovalDecision>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    if !matches!(input.decision.as_str(), "approved" | "denied") {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Décision invalide.".into(),
        ));
    }
    if input
        .permission_duration
        .as_deref()
        .is_some_and(|duration| !matches!(duration, "once" | "task" | "always"))
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Durée d’autorisation invalide.".into(),
        ));
    }
    crate::commands::approval::resolve_approval(
        id.clone(),
        ResolveApprovalInput {
            decision: input.decision.clone(),
            permission_duration: input.permission_duration,
            modified_command: None,
        },
        state.app.clone(),
        state.app.state::<Database>(),
        state.app.state::<BobService>(),
    )
    .await?;
    Ok(Json(
        json!({ "approvalId": id, "decision": input.decision }),
    ))
}

async fn list_projects(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    Ok(Json(json!({ "projects": remote_projects(&db)? })))
}

fn remote_projects(db: &Database) -> Result<Vec<Value>, AppError> {
    let projects = ProjectService::new().get_all(&db)?;
    let conn = db.conn.lock().unwrap();
    let projects = projects
        .into_iter()
        .map(|project| {
            let conversation_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM conversations WHERE project_id=?1",
                    rusqlite::params![&project.id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0);
            let active_task_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE project_id=?1 AND state IN ('starting','running','queued','awaiting_info','awaiting_approval','paused')",
                    rusqlite::params![&project.id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0);
            let mut value = serde_json::to_value(project).unwrap_or_else(|_| json!({}));
            if let Some(object) = value.as_object_mut() {
                object.insert("conversationCount".into(), json!(conversation_count));
                object.insert("activeTaskCount".into(), json!(active_task_count));
            }
            value
        })
        .collect::<Vec<_>>();
    Ok(projects)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRemoteProject {
    name: String,
    description: Option<String>,
    objective: Option<String>,
    local_path: Option<String>,
    default_mode: Option<String>,
    custom_instructions: Option<String>,
    language: Option<String>,
    memory_enabled: Option<bool>,
    #[serde(default)]
    plugin_ids: Vec<String>,
    #[serde(default)]
    skill_slugs: Vec<String>,
    #[serde(default)]
    integration_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRemoteProject {
    name: Option<String>,
    description: Option<String>,
    objective: Option<String>,
    default_mode: Option<String>,
    custom_instructions: Option<String>,
    language: Option<String>,
    memory_enabled: Option<bool>,
    plugin_ids: Option<Vec<String>>,
    skill_slugs: Option<Vec<String>>,
    integration_ids: Option<Vec<String>>,
}

async fn create_project(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(input): Json<CreateRemoteProject>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    if input.name.trim().is_empty() {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Le nom du projet est requis.".into(),
        ));
    }
    let db = state.app.state::<Database>();
    let mut project = ProjectService::new().create(
        &db,
        CreateProjectInput {
            name: input.name.trim().to_string(),
            description: input.description,
            objective: input.objective,
            local_path: input.local_path,
            custom_instructions: input.custom_instructions,
            language: input.language,
            default_mode: input.default_mode,
            ..Default::default()
        },
    )?;
    let mut allowed_plugins = input.plugin_ids;
    allowed_plugins.extend(
        input
            .skill_slugs
            .into_iter()
            .map(|slug| format!("skill:{slug}")),
    );
    project = ProjectService::new().update(
        &db,
        &project.id,
        UpdateProjectInput {
            memory_enabled: input.memory_enabled,
            allowed_plugins: Some(allowed_plugins),
            allowed_integrations: Some(input.integration_ids),
            ..Default::default()
        },
    )?;
    let _ = state.app.emit("project-updated", &project.id);
    Ok(Json(json!({ "project": project })))
}

async fn update_remote_project(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<UpdateRemoteProject>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    if input
        .name
        .as_deref()
        .is_some_and(|name| name.trim().is_empty())
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Le nom du projet est requis.".into(),
        ));
    }

    let db = state.app.state::<Database>();
    let current = ProjectService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Projet introuvable.".into()))?;

    let allowed_plugins = if input.plugin_ids.is_some() || input.skill_slugs.is_some() {
        let current_plugin_ids = current
            .allowed_plugins
            .iter()
            .filter(|value| !value.starts_with("skill:"))
            .cloned()
            .collect::<Vec<_>>();
        let current_skill_slugs = current
            .allowed_plugins
            .iter()
            .filter_map(|value| value.strip_prefix("skill:").map(str::to_string))
            .collect::<Vec<_>>();
        let mut values = input.plugin_ids.unwrap_or(current_plugin_ids);
        values.extend(
            input
                .skill_slugs
                .unwrap_or(current_skill_slugs)
                .into_iter()
                .map(|slug| format!("skill:{slug}")),
        );
        Some(values)
    } else {
        None
    };

    let project = ProjectService::new().update(
        &db,
        &id,
        UpdateProjectInput {
            name: input.name.map(|value| value.trim().to_string()),
            description: input.description,
            objective: input.objective,
            custom_instructions: input.custom_instructions,
            language: input.language,
            memory_enabled: input.memory_enabled,
            allowed_plugins,
            allowed_integrations: input.integration_ids,
            default_mode: input.default_mode,
            ..Default::default()
        },
    )?;
    let _ = state.app.emit("project-updated", &project.id);
    Ok(Json(json!({ "project": project })))
}

async fn delete_remote_project(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    if ProjectService::new().get_by_id(&db, &id)?.is_none() {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "Projet introuvable.".into(),
        ));
    }
    ProjectService::new().delete(&db, &id)?;
    // The macOS sidebar already refreshes on this event. The remote stream
    // forwards the same signal so both interfaces converge on the same SQLite
    // state immediately after a mobile deletion.
    let _ = state.app.emit("project-updated", &id);
    Ok(Json(json!({ "deleted": true, "projectId": id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationQuery {
    project_id: Option<String>,
    archived: Option<bool>,
}

async fn list_conversations(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(query): Query<ConversationQuery>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let conversations = if query.archived.unwrap_or(false) {
        remote_archived_conversations(&db, query.project_id.as_deref())?
    } else {
        remote_conversations(&db, query.project_id.as_deref())?
    };
    Ok(Json(json!({
        "conversations": conversations
    })))
}

fn remote_conversations(db: &Database, project_id: Option<&str>) -> Result<Vec<Value>, AppError> {
    let conversations = ConversationService::new().get_all(db, project_id)?;
    remote_conversation_items(db, conversations, None)
}

fn remote_archived_conversations(
    db: &Database,
    project_id: Option<&str>,
) -> Result<Vec<Value>, AppError> {
    let ids = {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id FROM conversations
             WHERE archived=1
               AND (?1 IS NULL OR project_id=?1)
               AND EXISTS (SELECT 1 FROM messages WHERE conversation_id=conversations.id AND author='user')
             ORDER BY pinned DESC,date DESC LIMIT 1000",
        )?;
        let rows = stmt.query_map(rusqlite::params![project_id], |row| row.get::<_, String>(0))?;
        rows.filter_map(Result::ok).collect::<Vec<_>>()
    };
    let service = ConversationService::new();
    let conversations = ids
        .into_iter()
        .filter_map(|id| service.get_by_id(db, &id).ok().flatten())
        .collect::<Vec<_>>();
    remote_conversation_items(db, conversations, None)
}

fn remote_conversation_items(
    db: &Database,
    conversations: Vec<crate::models::conversation::Conversation>,
    snippets: Option<&HashMap<String, String>>,
) -> Result<Vec<Value>, AppError> {
    let conn = db.conn.lock().unwrap();
    let items = conversations
        .into_iter()
        .map(|conversation| {
            let latest_task = conn
                .query_row(
                    "SELECT state,schedule_id IS NOT NULL FROM tasks WHERE conversation_id=?1 ORDER BY updated_at DESC LIMIT 1",
                    rusqlite::params![&conversation.id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1).unwrap_or(false))),
                )
                .ok();
            let match_snippet = snippets.and_then(|values| values.get(&conversation.id));
            json!({
                "conversation": conversation,
                "taskState": latest_task.as_ref().map(|task| task.0.as_str()),
                "scheduled": latest_task.map(|task| task.1).unwrap_or(false),
                "matchSnippet": match_snippet,
            })
        })
        .collect::<Vec<_>>();
    Ok(items)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationSearchQuery {
    q: String,
    project_id: Option<String>,
    limit: Option<i64>,
}

async fn search_conversations(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(query): Query<ConversationSearchQuery>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let value = query.q.trim();
    if value.is_empty() {
        return Ok(Json(json!({ "conversations": [] })));
    }
    if value.len() > 200 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "La recherche est trop longue.".into(),
        ));
    }
    let db = state.app.state::<Database>();
    let results = WorkspaceService::new().search(&db, value, query.limit.unwrap_or(60))?;
    let mut seen = HashSet::new();
    let mut conversations = Vec::new();
    let mut snippets = HashMap::new();
    for result in results {
        if !matches!(result.entity_type.as_str(), "conversation" | "message")
            || !seen.insert(result.entity_id.clone())
        {
            continue;
        }
        let Some(conversation) = ConversationService::new().get_by_id(&db, &result.entity_id)?
        else {
            continue;
        };
        if conversation.archived
            || query
                .project_id
                .as_deref()
                .is_some_and(|project_id| conversation.project_id.as_deref() != Some(project_id))
        {
            continue;
        }
        snippets.insert(
            conversation.id.clone(),
            result.snippet.replace("<mark>", "").replace("</mark>", ""),
        );
        conversations.push(conversation);
    }
    Ok(Json(json!({
        "conversations": remote_conversation_items(&db, conversations, Some(&snippets))?
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRemoteConversation {
    title: Option<String>,
    pinned: Option<bool>,
    archived: Option<bool>,
    project_id: Option<String>,
}

async fn update_remote_conversation(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(input): Json<UpdateRemoteConversation>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let service = ConversationService::new();
    service
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Conversation introuvable.".into()))?;
    if input.archived == Some(true) && conversation_has_active_task(&db, &id)? {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Arrêtez la tâche avant d’archiver cette conversation.".into(),
        ));
    }
    if let Some(title) = input.title {
        let title = title.trim();
        if title.is_empty() || title.len() > 200 {
            return Err(ApiError(StatusCode::BAD_REQUEST, "Titre invalide.".into()));
        }
        service.update_title(&db, &id, title)?;
    }
    if let Some(pinned) = input.pinned {
        service.set_pinned(&db, &id, pinned)?;
    }
    if let Some(archived) = input.archived {
        service.set_archived(&db, &id, archived)?;
    }
    if let Some(project_id) = input.project_id {
        let project_id = project_id.trim();
        if !project_id.is_empty() && ProjectService::new().get_by_id(&db, project_id)?.is_none() {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "Projet introuvable.".into(),
            ));
        }
        service.set_project_id(&db, &id, (!project_id.is_empty()).then_some(project_id))?;
    }
    let conversation = service
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Conversation introuvable.".into()))?;
    let _ = state.app.emit("conversation-updated", &id);
    Ok(Json(json!({ "conversation": conversation })))
}

async fn delete_remote_conversation(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    if ConversationService::new().get_by_id(&db, &id)?.is_none() {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "Conversation introuvable.".into(),
        ));
    }
    if conversation_has_active_task(&db, &id)? {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Arrêtez la tâche avant de supprimer cette conversation.".into(),
        ));
    }
    ConversationService::new().delete(&db, &id)?;
    let _ = state.app.emit("conversation-updated", &id);
    Ok(Json(json!({ "deleted": true, "conversationId": id })))
}

fn conversation_has_active_task(db: &Database, conversation_id: &str) -> Result<bool, AppError> {
    let count = db.conn.lock().unwrap().query_row(
        "SELECT COUNT(*) FROM tasks WHERE conversation_id=?1 AND state IN ('queued','starting','running','awaiting_info','awaiting_approval','paused')",
        rusqlite::params![conversation_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRemoteConversation {
    project_id: Option<String>,
    title: Option<String>,
    mode: Option<String>,
}

async fn create_conversation(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(input): Json<CreateRemoteConversation>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let conversation = ConversationService::new().create(
        &db,
        CreateConversationInput {
            project_id: input.project_id,
            title: input
                .title
                .unwrap_or_else(|| "Nouvelle conversation".into()),
            conversation_type: Some("chat".into()),
            business_mode: None,
            bob_mode: input.mode,
        },
    )?;
    // Drafts remain hidden from the desktop sidebar until the first user
    // prompt, matching native Bob Work behavior. The event still lets every
    // open surface invalidate its snapshot immediately.
    let _ = state.app.emit("conversation-updated", &conversation.id);
    Ok(Json(json!({ "conversation": conversation })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageQuery {
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn list_messages(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<MessageQuery>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let mut messages = ConversationService::new().get_messages(&db, &id)?;
    messages.reverse();
    let start = query
        .cursor
        .as_deref()
        .and_then(|cursor| messages.iter().position(|message| message.id == cursor))
        .map(|index| index + 1)
        .unwrap_or(0);
    let limit = query.limit.unwrap_or(8).clamp(1, 32);
    let page = messages
        .into_iter()
        .skip(start)
        .take(limit + 1)
        .collect::<Vec<_>>();
    let has_more = page.len() > limit;
    let page = page.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = has_more
        .then(|| page.last().map(|message| message.id.clone()))
        .flatten();
    let task_state = db
        .conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT state FROM tasks WHERE conversation_id=?1 ORDER BY updated_at DESC LIMIT 1",
            rusqlite::params![&id],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let artifact_service = ArtifactService::new();
    let mut artifact_catalog = HashMap::new();
    for id in page.iter().flat_map(message_artifact_ids) {
        if artifact_catalog.contains_key(&id) {
            continue;
        }
        if let Some(artifact) = artifact_service.get_by_id(&db, &id)? {
            artifact_catalog.insert(id, artifact);
        }
    }
    let messages = page
        .into_iter()
        .map(|message| remote_message(message, &artifact_catalog))
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "messages": messages,
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "taskState": task_state,
    })))
}

fn remote_message(
    message: crate::models::conversation::Message,
    artifacts: &HashMap<String, Artifact>,
) -> Value {
    let artifact_ids = message_artifact_ids(&message);
    let sources = message
        .sources
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?.to_string();
                    Some(json!({
                        "id": id,
                        "title": item.get("title").and_then(Value::as_str).unwrap_or("Fichier"),
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let remote_artifacts = artifact_ids
        .into_iter()
        .filter_map(|id| artifacts.get(&id))
        .map(remote_artifact_metadata)
        .collect::<Vec<_>>();
    let attachments = message
        .attachments
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    json!({
                        "name": item.get("name").and_then(Value::as_str).unwrap_or("Pièce jointe"),
                        "type": item.get("type").and_then(Value::as_str),
                        "mimeType": item.get("mimeType").and_then(Value::as_str),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut value = serde_json::to_value(message).unwrap_or_else(|_| json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert("sources".into(), json!(sources));
        object.insert("attachments".into(), json!(attachments));
        object.insert("artifacts".into(), json!(remote_artifacts));
    }
    value
}

fn message_artifact_ids(message: &crate::models::conversation::Message) -> HashSet<String> {
    let mut ids = message
        .sources
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<HashSet<_>>();
    ids.extend(
        message
            .associated_artifacts
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string),
    );
    ids
}

fn remote_artifact_metadata(artifact: &Artifact) -> Value {
    let path = Path::new(&artifact.file_path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&artifact.title);
    json!({
        "id": artifact.id,
        "type": artifact.artifact_type,
        "title": artifact.title,
        "fileName": file_name,
        "mimeType": artifact_content_type(path),
        "size": artifact.size,
        "inlinePreview": is_inline_artifact(path),
        "category": artifact_category(path, &artifact.artifact_type),
        "version": artifact.version,
        "validationStatus": artifact.validation_status,
        "validationNotes": artifact.validation_notes,
        "exported": artifact.exported,
        "createdAt": artifact.created_at,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactQuery {
    q: Option<String>,
    category: Option<String>,
    project_id: Option<String>,
    conversation_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Clone, Default)]
struct ArtifactOrigin {
    conversation_id: Option<String>,
    conversation_title: Option<String>,
    project_id: Option<String>,
    project_name: Option<String>,
}

async fn list_artifacts(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Query(query): Query<ArtifactQuery>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let artifacts = ArtifactService::new().get_all_for_remote(&db)?;
    let origins = artifact_origins(&db)?;
    let groups = artifact_version_groups(&artifacts);
    let search = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let category = query.category.as_deref().filter(|value| *value != "all");

    let filtered = artifacts
        .iter()
        .filter(|artifact| {
            if groups
                .get(&artifact_version_key(artifact))
                .and_then(|versions| versions.first())
                .is_some_and(|latest| latest.id != artifact.id)
            {
                return false;
            }
            let origin = origins.get(&artifact.id).cloned().unwrap_or_default();
            if query
                .conversation_id
                .as_deref()
                .is_some_and(|id| origin.conversation_id.as_deref() != Some(id))
            {
                return false;
            }
            if query
                .project_id
                .as_deref()
                .is_some_and(|id| origin.project_id.as_deref() != Some(id))
            {
                return false;
            }
            let path = Path::new(&artifact.file_path);
            if category
                .is_some_and(|wanted| artifact_category(path, &artifact.artifact_type) != wanted)
            {
                return false;
            }
            search.as_ref().is_none_or(|needle| {
                let file_name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("");
                [
                    artifact.title.as_str(),
                    file_name,
                    origin.conversation_title.as_deref().unwrap_or(""),
                    origin.project_name.as_deref().unwrap_or(""),
                ]
                .iter()
                .any(|value| value.to_lowercase().contains(needle))
            })
        })
        .collect::<Vec<_>>();

    let offset = query
        .cursor
        .as_deref()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let limit = query.limit.unwrap_or(40).clamp(1, 100);
    let end = (offset + limit).min(filtered.len());
    let values = filtered[offset.min(filtered.len())..end]
        .iter()
        .map(|artifact| enriched_artifact_metadata(artifact, origins.get(&artifact.id), &groups))
        .collect::<Vec<_>>();
    let has_more = end < filtered.len();
    Ok(Json(json!({
        "artifacts": values,
        "nextCursor": has_more.then(|| end.to_string()),
        "hasMore": has_more,
        "total": filtered.len(),
    })))
}

fn artifact_origins(db: &Database) -> Result<HashMap<String, ArtifactOrigin>, AppError> {
    let projects = ProjectService::new()
        .get_all(db)?
        .into_iter()
        .map(|project| (project.id, project.name))
        .collect::<HashMap<_, _>>();
    let conversations = {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id,title,project_id FROM conversations")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?),
            ))
        })?;
        rows.filter_map(Result::ok).collect::<HashMap<_, _>>()
    };
    let artifacts = ArtifactService::new().get_all_for_remote(db)?;
    Ok(artifacts
        .into_iter()
        .map(|artifact| {
            let conversation_id = artifact
                .origin
                .as_deref()
                .and_then(|origin| origin.strip_prefix("bob-shell:"))
                .map(str::to_string)
                .or_else(|| {
                    artifact
                        .origin
                        .as_ref()
                        .filter(|id| conversations.contains_key(*id))
                        .cloned()
                });
            let (conversation_title, project_id) = conversation_id
                .as_ref()
                .and_then(|id| conversations.get(id))
                .map(|(title, project_id)| (Some(title.clone()), project_id.clone()))
                .unwrap_or_default();
            let project_name = project_id.as_ref().and_then(|id| projects.get(id)).cloned();
            (
                artifact.id,
                ArtifactOrigin {
                    conversation_id,
                    conversation_title,
                    project_id,
                    project_name,
                },
            )
        })
        .collect())
}

fn artifact_version_key(artifact: &Artifact) -> String {
    let title = artifact
        .title
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect::<String>();
    format!(
        "{}:{title}",
        artifact_category(Path::new(&artifact.file_path), &artifact.artifact_type)
    )
}

fn artifact_version_groups(artifacts: &[Artifact]) -> HashMap<String, Vec<&Artifact>> {
    let mut groups: HashMap<String, Vec<&Artifact>> = HashMap::new();
    for artifact in artifacts {
        groups
            .entry(artifact_version_key(artifact))
            .or_default()
            .push(artifact);
    }
    for versions in groups.values_mut() {
        versions.sort_by(|left, right| {
            right
                .version
                .cmp(&left.version)
                .then_with(|| right.created_at.cmp(&left.created_at))
        });
    }
    groups
}

fn enriched_artifact_metadata(
    artifact: &Artifact,
    origin: Option<&ArtifactOrigin>,
    groups: &HashMap<String, Vec<&Artifact>>,
) -> Value {
    let mut value = remote_artifact_metadata(artifact);
    let Some(object) = value.as_object_mut() else {
        return value;
    };
    if let Some(origin) = origin {
        object.insert(
            "conversation".into(),
            origin
                .conversation_id
                .as_ref()
                .map(|id| json!({ "id": id, "title": origin.conversation_title }))
                .unwrap_or(Value::Null),
        );
        object.insert(
            "project".into(),
            origin
                .project_id
                .as_ref()
                .map(|id| json!({ "id": id, "name": origin.project_name }))
                .unwrap_or(Value::Null),
        );
    }
    let versions = groups
        .get(&artifact_version_key(artifact))
        .into_iter()
        .flatten()
        .map(|version| {
            json!({
                "id": version.id,
                "version": version.version,
                "createdAt": version.created_at,
                "validationStatus": version.validation_status,
            })
        })
        .collect::<Vec<_>>();
    object.insert("versions".into(), json!(versions));
    value
}

async fn delete_artifact(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    if ArtifactService::new().get_by_id(&db, &id)?.is_none() {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "Artefact introuvable.".into(),
        ));
    }
    ArtifactService::new().delete(&db, &id)?;
    let _ = state.app.emit("artifacts-updated", &id);
    Ok(Json(json!({ "deleted": true, "artifactId": id })))
}

async fn get_artifact(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let artifact = ArtifactService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Artefact introuvable.".into()))?;
    let artifacts = ArtifactService::new().get_all_for_remote(&db)?;
    let origins = artifact_origins(&db)?;
    let groups = artifact_version_groups(&artifacts);
    Ok(Json(enriched_artifact_metadata(
        &artifact,
        origins.get(&artifact.id),
        &groups,
    )))
}

#[derive(Deserialize)]
struct ArtifactContentQuery {
    download: Option<bool>,
}

async fn get_artifact_content(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<ArtifactContentQuery>,
) -> Result<Response, ApiError> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let artifact = ArtifactService::new()
        .get_by_id(&db, &id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Artefact introuvable.".into()))?;
    let path = PathBuf::from(&artifact.file_path);
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|_| ApiError(StatusCode::NOT_FOUND, "Fichier introuvable.".into()))?;
    if !metadata.is_file() {
        return Err(ApiError(
            StatusCode::NOT_FOUND,
            "Fichier introuvable.".into(),
        ));
    }
    if metadata.len() > MAX_ARTIFACT_BYTES {
        return Err(ApiError(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Ce fichier dépasse la limite mobile de 100 Mo.".into(),
        ));
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let disposition = if query.download.unwrap_or(false) {
        "attachment"
    } else {
        "inline"
    };
    let file_name = safe_download_name(
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("artifact"),
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, artifact_content_type(&path))
        .header(CONTENT_LENGTH, bytes.len().to_string())
        .header(CACHE_CONTROL, "private, no-store")
        .header(
            CONTENT_DISPOSITION,
            format!("{disposition}; filename=\"{file_name}\""),
        )
        .body(Body::from(bytes))
        .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

fn is_inline_artifact(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "avif" | "gif" | "jpg" | "jpeg" | "png" | "svg" | "webp"
            )
        })
}

fn artifact_category(path: &Path, artifact_type: &str) -> &'static str {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or(artifact_type)
        .to_ascii_lowercase();
    match extension.as_str() {
        "pdf" => "pdf",
        "avif" | "gif" | "jpg" | "jpeg" | "png" | "svg" | "webp" => "images",
        "doc" | "docx" => "word",
        "xls" | "xlsx" | "csv" => "excel",
        "ppt" | "pptx" => "powerpoint",
        "md" | "markdown" | "txt" | "json" | "html" | "htm" | "d2" | "dot" => "text",
        _ => "other",
    }
}

fn artifact_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "avif" => "image/avif",
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "json" => "application/json",
        "html" | "htm" => "text/html; charset=utf-8",
        "md" | "txt" | "d2" | "dot" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn safe_download_name(name: &str) -> String {
    let value = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if value.is_empty() {
        "artifact".into()
    } else {
        value
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteAttachment {
    name: String,
    mime_type: Option<String>,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRemotePrompt {
    prompt: String,
    mode: Option<String>,
    project_id: Option<String>,
    resume_task_id: Option<String>,
    #[serde(default)]
    plugin_ids: Vec<String>,
    #[serde(default)]
    skill_slugs: Vec<String>,
    #[serde(default)]
    attachments: Vec<RemoteAttachment>,
}

async fn send_prompt(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath(conversation_id): AxumPath<String>,
    Json(input): Json<SendRemotePrompt>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    dispatch_remote_prompt(&state, conversation_id, input).await
}

async fn resend_prompt(
    State(state): State<ApiState>,
    headers: HeaderMap,
    AxumPath((conversation_id, message_id)): AxumPath<(String, String)>,
    Json(input): Json<SendRemotePrompt>,
) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let result = ConversationService::new().rewind_conversation_from_message(
        &db,
        state.app.state::<BobService>().inner(),
        &conversation_id,
        &message_id,
    )?;
    let _ = state
        .app
        .emit("conversation-messages-changed", &conversation_id);
    if result.title_reset {
        let _ = state.app.emit("conversation-updated", &conversation_id);
    }
    dispatch_remote_prompt(&state, conversation_id, input).await
}

async fn dispatch_remote_prompt(
    state: &ApiState,
    conversation_id: String,
    input: SendRemotePrompt,
) -> ApiResult<Value> {
    let prompt = input.prompt.trim();
    if prompt.is_empty() || prompt.len() > MAX_PROMPT_BYTES {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Le prompt est vide ou trop volumineux.".into(),
        ));
    }

    let db = state.app.state::<Database>();
    let conversation = ConversationService::new()
        .get_by_id(&db, &conversation_id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Conversation introuvable.".into()))?;
    let project_id = input.project_id.or(conversation.project_id);
    let attachment_paths = save_attachments(&state.upload_dir, &input.attachments).await?;
    let mentions = capability_mentions(&input.plugin_ids, &input.skill_slugs);
    let message = if mentions.is_empty() {
        prompt.to_string()
    } else {
        format!("{}\n\n{}", mentions.join(" "), prompt)
    };
    let result = crate::commands::bob::send_message(
        state.app.clone(),
        conversation_id,
        message,
        input.mode.unwrap_or_else(|| "agent".into()),
        project_id,
        (!attachment_paths.is_empty()).then_some(attachment_paths),
        input.resume_task_id,
        Some(input.plugin_ids),
        state.app.state::<BobService>(),
        state.app.state::<Database>(),
    )
    .await?;
    Ok(Json(json!({ "session": result })))
}

fn capability_mentions(plugin_ids: &[String], skill_slugs: &[String]) -> Vec<String> {
    plugin_ids
        .iter()
        .map(|id| format!("@plugin:{id}"))
        .chain(skill_slugs.iter().map(|slug| format!("@skill:{slug}")))
        .collect()
}

async fn save_attachments(
    root: &Path,
    attachments: &[RemoteAttachment],
) -> Result<Vec<String>, ApiError> {
    if attachments.is_empty() {
        return Ok(vec![]);
    }
    let batch = root.join(uuid::Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&batch)
        .await
        .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut total = 0usize;
    let mut paths = vec![];
    for attachment in attachments {
        let data = attachment
            .data_base64
            .split_once(',')
            .map(|(_, data)| data)
            .unwrap_or(&attachment.data_base64);
        let bytes = STANDARD
            .decode(data)
            .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Pièce jointe invalide.".into()))?;
        total += bytes.len();
        if total > MAX_UPLOAD_BYTES {
            return Err(ApiError(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Les pièces jointes dépassent 12 Mo.".into(),
            ));
        }
        let fallback_extension = mime_extension(attachment.mime_type.as_deref());
        let file_name = safe_file_name(&attachment.name, fallback_extension);
        let path = batch.join(file_name);
        tokio::fs::write(&path, bytes)
            .await
            .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(paths)
}

fn safe_file_name(name: &str, fallback_extension: &str) -> String {
    let name = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment")
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let name = name.trim_matches(['.', ' ']);
    let base = if name.is_empty() { "attachment" } else { name };
    if Path::new(base).extension().is_none() && !fallback_extension.is_empty() {
        format!("{base}.{fallback_extension}")
    } else {
        base.to_string()
    }
}

fn mime_extension(mime: Option<&str>) -> &'static str {
    match mime.unwrap_or("") {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        _ => "",
    }
}

async fn catalog(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let db = state.app.state::<Database>();
    let plugins = PluginService::new()
        .get_all(&db)?
        .into_iter()
        .filter(|plugin| plugin.install_state == "installed")
        .map(|plugin| {
            let builtin = plugin
                .manifest
                .get("builtin")
                .and_then(Value::as_bool)
                .unwrap_or_else(|| plugin.id.starts_with("builtin-"));
            json!({
                "id": plugin.id,
                "name": plugin.name,
                "description": plugin.description,
                "category": plugin.category,
                "scope": plugin.scope,
                "builtin": builtin,
            })
        })
        .collect::<Vec<_>>();
    let skills = WorkspaceService::new()
        .list_skills(None)
        .into_iter()
        .filter(|skill| skill.enabled)
        .map(|skill| {
            json!({
                "slug": skill.slug,
                "name": skill.name,
                "description": skill.description,
                "scope": skill.scope,
            })
        })
        .collect::<Vec<_>>();
    let bob = state.app.state::<BobService>();
    let oauth = IntegrationOAuthService::new();
    let integrations = [
        ("outlook-mail", "Outlook Mail"),
        ("teams", "Microsoft Teams"),
        ("outlook-calendar", "Outlook Calendar"),
        ("onedrive", "OneDrive"),
        ("onenote", "OneNote"),
        ("github", "GitHub"),
        ("slack", "Slack"),
        ("monday", "monday.com"),
    ]
    .into_iter()
    .map(|(id, name)| {
        let legacy_secret = match id {
            "github" => Some(crate::services::bob::SECRET_GITHUB),
            "slack" => Some(crate::services::bob::SECRET_SLACK),
            "monday" => Some(crate::services::bob::SECRET_MONDAY),
            _ => None,
        }
        .and_then(|secret| bob.has_session_secret(secret).ok())
        .unwrap_or(false);
        let status = oauth.connection_status(id, legacy_secret);
        json!({ "id": id, "name": name, "connected": status.connected })
    })
    .collect::<Vec<_>>();
    Ok(Json(
        json!({ "plugins": plugins, "skills": skills, "integrations": integrations }),
    ))
}

async fn list_modes(State(state): State<ApiState>, headers: HeaderMap) -> ApiResult<Value> {
    authorize(&headers, &state.token)?;
    let bob = state.app.state::<BobService>();
    let mut modes = vec![
        json!({ "id": "agent", "name": "Agent" }),
        json!({ "id": "plan", "name": "Plan" }),
        json!({ "id": "ask", "name": "Ask" }),
    ];
    modes.extend(
        bob.discover_modes(None)
            .into_iter()
            .filter(|mode| !matches!(mode.slug.as_str(), "agent" | "plan" | "ask"))
            .map(|mode| json!({ "id": mode.slug, "name": mode.name, "description": mode.description })),
    );
    Ok(Json(json!({ "modes": modes })))
}

#[cfg(test)]
mod tests {
    use super::{
        artifact_category, artifact_content_type, artifact_version_groups, artifact_version_key,
        capability_mentions, constant_time_equal, is_valid_expo_push_token,
        remote_archived_conversations, remote_conversations, remote_message, remote_projects,
        safe_download_name, safe_file_name,
    };
    use crate::db::Database;
    use crate::models::artifact::Artifact;
    use crate::models::conversation::{AddMessageInput, CreateConversationInput, Message};
    use crate::models::project::CreateProjectInput;
    use crate::models::task::CreateTaskInput;
    use crate::services::conversation::ConversationService;
    use crate::services::project::ProjectService;
    use crate::services::task::TaskService;
    use crate::services::workspace::WorkspaceService;

    #[test]
    fn access_tokens_are_compared_without_prefix_acceptance() {
        assert!(constant_time_equal(b"same", b"same"));
        assert!(!constant_time_equal(b"same", b"same-more"));
        assert!(!constant_time_equal(b"same", b"diff"));
    }

    #[test]
    fn expo_push_tokens_are_strictly_validated() {
        assert!(is_valid_expo_push_token("ExpoPushToken[device-token]"));
        assert!(is_valid_expo_push_token(
            "ExponentPushToken[legacy-device-token]"
        ));
        assert!(!is_valid_expo_push_token("device-token"));
        assert!(!is_valid_expo_push_token("ExpoPushToken[unterminated"));
        assert!(!is_valid_expo_push_token(&format!(
            "ExpoPushToken[{}]",
            "a".repeat(260)
        )));
    }

    #[test]
    fn upload_names_cannot_escape_the_batch_directory() {
        assert_eq!(safe_file_name("../../secret.png", ""), "secret.png");
        assert_eq!(safe_file_name("photo", "jpg"), "photo.jpg");
    }

    #[test]
    fn artifact_responses_hide_mac_paths_and_keep_download_metadata() {
        let artifact = Artifact {
            id: "artifact-1".into(),
            artifact_type: "png".into(),
            title: "Architecture cible".into(),
            file_path: "/Users/example/private/architecture.png".into(),
            version: 1,
            preview_path: None,
            origin: Some("bob-shell:conversation-1".into()),
            sources: serde_json::json!([]),
            validation_status: "valid".into(),
            validation_notes: None,
            exported: false,
            created_at: "2026-08-25T00:00:00Z".into(),
            size: Some(42),
        };
        let message = Message {
            id: "message-1".into(),
            conversation_id: "conversation-1".into(),
            author: "assistant".into(),
            content: "Schéma prêt".into(),
            attachments: serde_json::json!([]),
            sources: serde_json::json!([{
                "id": artifact.id.clone(),
                "title": artifact.title.clone(),
                "path": artifact.file_path.clone(),
            }]),
            citations: serde_json::json!([]),
            tools_used: serde_json::json!([]),
            send_state: "sent".into(),
            errors: serde_json::json!([]),
            associated_artifacts: serde_json::json!([]),
            associated_approvals: serde_json::json!([]),
            created_at: "2026-08-25T00:00:00Z".into(),
        };
        let value = remote_message(
            message,
            &std::collections::HashMap::from([(artifact.id.clone(), artifact)]),
        );

        assert_eq!(value["artifacts"][0]["fileName"], "architecture.png");
        assert_eq!(value["artifacts"][0]["inlinePreview"], true);
        assert_eq!(value["artifacts"][0]["category"], "images");
        assert_eq!(value["artifacts"][0]["version"], 1);
        assert_eq!(value["artifacts"][0]["validationStatus"], "valid");
        assert!(value["sources"][0].get("path").is_none());
        assert!(!value.to_string().contains("/Users/example/private"));
        assert_eq!(
            artifact_content_type(std::path::Path::new("document.docx")),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        assert_eq!(safe_download_name("plan été.pdf"), "plan__t_.pdf");
    }

    #[test]
    fn artifact_versions_group_by_document_type_and_title() {
        let latest = Artifact {
            id: "architecture-v2".into(),
            artifact_type: "pdf".into(),
            title: "Architecture cible".into(),
            file_path: "/tmp/architecture-v2.pdf".into(),
            version: 2,
            preview_path: None,
            origin: None,
            sources: serde_json::json!([]),
            validation_status: "valid".into(),
            validation_notes: None,
            exported: false,
            created_at: "2026-08-25T02:00:00Z".into(),
            size: Some(42),
        };
        let mut previous = latest.clone();
        previous.id = "architecture-v1".into();
        previous.version = 1;
        previous.created_at = "2026-08-25T01:00:00Z".into();
        let mut image = latest.clone();
        image.id = "architecture-image".into();
        image.artifact_type = "png".into();
        image.file_path = "/tmp/architecture.png".into();

        let artifacts = vec![previous, image, latest.clone()];
        let groups = artifact_version_groups(&artifacts);
        let versions = groups.get(&artifact_version_key(&latest)).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].id, "architecture-v2");
        assert_eq!(
            artifact_category(std::path::Path::new("report.xlsx"), "xlsx"),
            "excel"
        );
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn mobile_plugin_and_skill_choices_reach_bob_as_explicit_mentions() {
        let mentions = capability_mentions(
            &[
                "builtin-cloud-architect".into(),
                "bob-work-cto-invest".into(),
            ],
            &["newer-custom".into()],
        );

        assert_eq!(
            mentions,
            [
                "@plugin:builtin-cloud-architect",
                "@plugin:bob-work-cto-invest",
                "@skill:newer-custom",
            ]
        );
    }

    #[test]
    fn mobile_history_comes_from_the_desktop_sqlite_database() {
        let db = Database::new_in_memory().expect("database");
        db.run_migrations().expect("migrations");
        let project = ProjectService::new()
            .create(
                &db,
                CreateProjectInput {
                    name: "Projet partagé".into(),
                    ..Default::default()
                },
            )
            .expect("project");
        let conversation = ConversationService::new()
            .create(
                &db,
                CreateConversationInput {
                    project_id: Some(project.id.clone()),
                    title: "Conversation mobile".into(),
                    conversation_type: Some("chat".into()),
                    business_mode: None,
                    bob_mode: Some("agent".into()),
                },
            )
            .expect("conversation");
        ConversationService::new()
            .add_message(
                &db,
                AddMessageInput {
                    conversation_id: conversation.id.clone(),
                    author: "user".into(),
                    content: "Bonjour depuis iOS".into(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("message");
        TaskService::new()
            .create(
                &db,
                CreateTaskInput {
                    objective: "Synchroniser".into(),
                    project_id: Some(project.id.clone()),
                    conversation_id: Some(conversation.id.clone()),
                    mode: Some("agent".into()),
                    permission_policy: None,
                    budget: None,
                    max_time: None,
                    schedule_id: None,
                },
            )
            .expect("task");

        let projects = remote_projects(&db).expect("mobile projects");
        let conversations = remote_conversations(&db, None).expect("mobile conversations");
        let tasks = TaskService::new().get_all(&db, None).expect("mobile tasks");
        assert_eq!(projects.len(), 1);
        assert_eq!(conversations.len(), 1);
        assert_eq!(tasks.len(), 1);
        assert_eq!(conversations[0]["conversation"]["id"], conversation.id);
        assert_eq!(
            tasks[0].conversation_id.as_deref(),
            Some(conversation.id.as_str())
        );

        let service = ConversationService::new();
        service
            .update_title(&db, &conversation.id, "Titre renommé")
            .expect("rename");
        service
            .set_pinned(&db, &conversation.id, true)
            .expect("pin");
        service
            .set_project_id(&db, &conversation.id, None)
            .expect("move out of project");
        let updated = service
            .get_by_id(&db, &conversation.id)
            .expect("read updated")
            .expect("updated conversation");
        assert_eq!(updated.title, "Titre renommé");
        assert!(updated.pinned);
        assert!(updated.project_id.is_none());
        assert!(WorkspaceService::new()
            .search(&db, "Bonjour iOS", 10)
            .expect("message search")
            .iter()
            .any(|result| result.entity_type == "message" && result.entity_id == conversation.id));

        service
            .set_archived(&db, &conversation.id, true)
            .expect("archive");
        assert!(remote_conversations(&db, None)
            .expect("active conversations")
            .is_empty());
        assert_eq!(
            remote_archived_conversations(&db, None)
                .expect("archived conversations")
                .len(),
            1
        );
    }
}
