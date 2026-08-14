use crate::db::Database;
use crate::error::AppError;
use crate::models::approval::{Approval, ResolveApprovalInput};
use crate::models::workspace::CreatePermissionGrantInput;
use crate::services::audit::AuditService;
use crate::services::permission_governance::ACTION_SESSION_START;
use crate::services::workspace::WorkspaceService;
use chrono::Utc;
use rusqlite::params;
use tauri::{AppHandle, Emitter, State};

fn e2e_data_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("BOB_WORK_E2E_DATA_DIR").map(std::path::PathBuf::from)
}

fn consume_e2e_fail_next_approval() -> bool {
    let Some(dir) = e2e_data_dir() else {
        return false;
    };
    let marker = dir.join("e2e-fail-next-approval");
    if marker.exists() {
        let _ = std::fs::remove_file(&marker);
        true
    } else {
        false
    }
}

fn require_e2e_data_dir() -> Result<std::path::PathBuf, AppError> {
    e2e_data_dir().ok_or_else(|| {
        AppError::ValidationFailed("Cette commande est réservée aux builds E2E.".into())
    })
}

#[tauri::command]
pub async fn get_pending_approvals(db: State<'_, Database>) -> Result<Vec<Approval>, AppError> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, task_id, action_type, human_description, command_or_change,
         data_accessed, files_affected, network_destination, risk_level,
         decision, permission_duration, decided_by, decided_at, undo_possible, created_at
         FROM approvals WHERE decision = 'pending' ORDER BY created_at DESC",
    )?;

    let approvals = stmt
        .query_map([], |row| {
            Ok(Approval {
                id: row.get(0)?,
                task_id: row.get(1)?,
                action_type: row.get(2)?,
                human_description: row.get(3)?,
                command_or_change: row.get(4)?,
                data_accessed: serde_json::from_str(
                    &row.get::<_, String>(5).unwrap_or("[]".to_string()),
                )
                .unwrap_or_default(),
                files_affected: serde_json::from_str(
                    &row.get::<_, String>(6).unwrap_or("[]".to_string()),
                )
                .unwrap_or_default(),
                network_destination: row.get(7)?,
                risk_level: row.get(8)?,
                decision: row.get(9)?,
                permission_duration: row.get(10)?,
                decided_by: row.get(11)?,
                decided_at: row.get(12)?,
                undo_possible: row.get::<_, bool>(13).unwrap_or(false),
                created_at: row.get(14)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(approvals)
}

#[tauri::command]
pub async fn resolve_approval(
    approval_id: String,
    input: ResolveApprovalInput,
    app_handle: AppHandle,
    db: State<'_, Database>,
    bob_service: State<'_, crate::services::bob::BobService>,
) -> Result<(), AppError> {
    if consume_e2e_fail_next_approval() {
        return Err(AppError::ValidationFailed(
            "Impossible d’enregistrer votre décision.".into(),
        ));
    }
    let now = Utc::now().to_rfc3339();
    let (risk_level, task_id, action_type, resource) = {
        let conn = db.conn.lock().unwrap();
        conn.query_row(
            "SELECT risk_level,task_id,action_type,coalesce(network_destination,command_or_change,human_description) FROM approvals WHERE id=?1",
            params![&approval_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .unwrap_or_else(|_| ("unknown".into(), "".into(), "unknown".into(), "unknown".into()))
    };

    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE approvals SET decision = ?1, permission_duration = ?2, decided_at = ?3 WHERE id = ?4",
            params![input.decision, input.permission_duration, now, approval_id],
        )?;
    }

    let _ = AuditService::new().approval_event(&db, &approval_id, &input.decision, &risk_level);

    if input.decision == "approved" {
        if let Some(duration) = input
            .permission_duration
            .as_deref()
            .filter(|value| matches!(*value, "task" | "always"))
        {
            let _ = WorkspaceService::new().create_permission_grant(
                &db,
                CreatePermissionGrantInput {
                    action_type: action_type.clone(),
                    resource: resource.clone(),
                    scope: duration.to_string(),
                    scope_id: (duration == "task").then(|| task_id.clone()),
                    decision: "allow".into(),
                    expires_at: None,
                },
            );
        }
    }

    // Preflight session start: launch deferred bob run after approval.
    if action_type == ACTION_SESSION_START {
        if input.decision == "approved" {
            if let Some(mut launch) = bob_service.take_pending_launch(&approval_id) {
                let sandbox = crate::services::settings::SettingsService::new()
                    .get(&db)
                    .map(|s| s.sandbox_mode)
                    .unwrap_or(false);
                launch.options.trust_workspace = !sandbox;
                bob_service.start_streaming_session(
                    app_handle,
                    launch.session_id,
                    launch.conversation_id,
                    launch.mode,
                    launch.prompt,
                    launch.project_path,
                    launch.options,
                )?;
                if !task_id.is_empty() {
                    let _ = crate::services::task::TaskService::new()
                        .update_state(&db, &task_id, "running");
                }
            }
        } else {
            let _ = bob_service.take_pending_launch(&approval_id);
            if !task_id.is_empty() {
                let _ = crate::services::task::TaskService::new().update_state(
                    &db,
                    &task_id,
                    "cancelled",
                );
            }
        }
        return Ok(());
    }

    // Legacy path: try to forward y/n to an active Bob stdin (usually unavailable headless).
    if !task_id.is_empty() {
        let decision_str = if input.decision == "approved" {
            "y"
        } else {
            "n"
        };
        let session_id = {
            let conn = db.conn.lock().unwrap();
            conn.query_row(
                "SELECT bob_process_id FROM tasks WHERE id=?1",
                params![&task_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
        };
        if let Some(session_id) = session_id {
            let _ = bob_service.send_input(&session_id, decision_str);
        }
        if input.decision == "approved" {
            let _ =
                crate::services::task::TaskService::new().update_state(&db, &task_id, "running");
        } else {
            let _ =
                crate::services::task::TaskService::new().update_state(&db, &task_id, "cancelled");
        }
    }

    Ok(())
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_seed_approval(
    app_handle: AppHandle,
    db: State<'_, Database>,
    human_description: Option<String>,
    risk_level: Option<String>,
    command_or_change: Option<String>,
) -> Result<Approval, AppError> {
    let _ = require_e2e_data_dir()?;
    let now = Utc::now().to_rfc3339();
    let task_id = format!("task_e2e_{}", uuid::Uuid::new_v4());
    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, objective, state, created_at, updated_at)
             VALUES (?1, ?2, 'awaiting_approval', ?3, ?3)",
            params![task_id, "Tâche E2E d’approbation", now],
        )?;
    }
    let approval = Approval {
        id: format!("appr_e2e_{}", uuid::Uuid::new_v4()),
        task_id,
        action_type: "file.write".into(),
        human_description: human_description
            .unwrap_or_else(|| "Bob souhaite écrire un fichier local pour le parcours E2E.".into()),
        command_or_change: Some(command_or_change.unwrap_or_else(|| "write notes-e2e.md".into())),
        data_accessed: serde_json::json!([]),
        files_affected: serde_json::json!(["notes-e2e.md"]),
        network_destination: None,
        risk_level: risk_level.unwrap_or_else(|| "medium".into()),
        decision: "pending".into(),
        permission_duration: None,
        decided_by: None,
        decided_at: None,
        undo_possible: true,
        created_at: Utc::now().to_rfc3339(),
    };
    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO approvals (id, task_id, action_type, human_description, command_or_change, data_accessed, files_affected, network_destination, risk_level, decision, permission_duration, decided_by, decided_at, undo_possible, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                approval.id,
                approval.task_id,
                approval.action_type,
                approval.human_description,
                approval.command_or_change,
                approval.data_accessed.to_string(),
                approval.files_affected.to_string(),
                approval.network_destination,
                approval.risk_level,
                approval.decision,
                approval.permission_duration,
                approval.decided_by,
                approval.decided_at,
                approval.undo_possible,
                approval.created_at
            ],
        )?;
    }
    let _ = app_handle.emit("approval-required", &approval);
    crate::services::notify::notify_approval_required(
        &app_handle,
        &approval.human_description,
        None,
    );
    Ok(approval)
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_fail_next_approval_resolve() -> Result<(), AppError> {
    let dir = require_e2e_data_dir()?;
    std::fs::write(dir.join("e2e-fail-next-approval"), "1")?;
    Ok(())
}
