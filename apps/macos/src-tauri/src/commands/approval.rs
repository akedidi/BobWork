use crate::db::Database;
use crate::error::AppError;
use crate::models::approval::{Approval, ResolveApprovalInput};
use crate::models::workspace::CreatePermissionGrantInput;
use crate::services::audit::AuditService;
use crate::services::workspace::WorkspaceService;
use chrono::Utc;
use rusqlite::params;
use tauri::State;

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
    db: State<'_, Database>,
    bob_service: State<'_, crate::services::bob::BobService>,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let (risk_level, task_id, action_type, resource) = {
        let conn = db.conn.lock().unwrap();
        conn.query_row(
            "SELECT risk_level,task_id,action_type,coalesce(network_destination,command_or_change,human_description) FROM approvals WHERE id=?1",
            params![&approval_id],
            |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, String>(2)?,r.get::<_, String>(3)?)),
        ).unwrap_or_else(|_| ("unknown".into(),"".into(),"unknown".into(),"unknown".into()))
    };

    let conn = db.conn.lock().unwrap();
    conn.execute(
        "UPDATE approvals SET decision = ?1, permission_duration = ?2, decided_at = ?3 WHERE id = ?4",
        params![input.decision, input.permission_duration, now, approval_id],
    )?;
    drop(conn);

    // Audit log
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

    // Send the decision to the active Bob session associated with this task.
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
