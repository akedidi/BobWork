// ============================================================
// Bob Work - Task Service
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::task::{CreateTaskInput, Task, TaskDetail, TaskEvent, TaskIo, TaskRun};
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

pub struct TaskService;

impl TaskService {
    pub fn new() -> Self {
        Self
    }

    pub fn get_all(&self, db: &Database, project_id: Option<&str>) -> AppResult<Vec<Task>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, objective, project_id, conversation_id, mode, permission_policy,
             budget, max_time, bob_process_id, start_date, end_date, summary, progress,
             errors, resumable, schedule_id, shell_task_id, last_event_at,
             state, created_at, updated_at, pinned
             FROM tasks ORDER BY pinned DESC, created_at DESC LIMIT 100",
        )?;

        let all_tasks: Vec<Task> = stmt
            .query_map([], |row| Self::row_to_task(row))?
            .filter_map(|r| r.ok())
            .collect();

        if let Some(pid) = project_id {
            Ok(all_tasks
                .into_iter()
                .filter(|t| t.project_id.as_deref() == Some(pid))
                .collect())
        } else {
            Ok(all_tasks)
        }
    }

    pub fn get_by_id(&self, db: &Database, id: &str) -> AppResult<Option<Task>> {
        let conn = db.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, objective, project_id, conversation_id, mode, permission_policy,
             budget, max_time, bob_process_id, start_date, end_date, summary, progress,
             errors, resumable, schedule_id, shell_task_id, last_event_at,
             state, created_at, updated_at, pinned
             FROM tasks WHERE id = ?1",
            params![id],
            |row| Self::row_to_task(row),
        );
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn create(&self, db: &Database, input: CreateTaskInput) -> AppResult<Task> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let policy = input
            .permission_policy
            .clone()
            .unwrap_or_else(|| "always_ask".to_string());

        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, objective, project_id, conversation_id, mode,
             permission_policy, budget, max_time, schedule_id, state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', ?10, ?11)",
            params![
                id,
                input.objective,
                input.project_id,
                input.conversation_id,
                input.mode,
                policy,
                input.budget,
                input.max_time,
                input.schedule_id,
                now,
                now,
            ],
        )?;

        Ok(Task {
            id,
            objective: input.objective,
            project_id: input.project_id,
            conversation_id: input.conversation_id,
            mode: input.mode,
            permission_policy: input
                .permission_policy
                .unwrap_or_else(|| "always_ask".to_string()),
            budget: input.budget,
            max_time: input.max_time,
            bob_process_id: None,
            start_date: None,
            end_date: None,
            summary: None,
            progress: 0.0,
            errors: serde_json::Value::Array(vec![]),
            resumable: false,
            schedule_id: input.schedule_id,
            shell_task_id: None,
            last_event_at: None,
            pinned: false,
            state: "draft".to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_state(&self, db: &Database, id: &str, state: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        let start_date = if matches!(state, "starting" | "running") {
            Some(now.clone())
        } else {
            None
        };
        let end_date = if matches!(state, "completed" | "failed" | "cancelled" | "expired") {
            Some(now.clone())
        } else {
            None
        };
        conn.execute(
            "UPDATE tasks SET state = ?1,
             start_date = coalesce(start_date, ?2),
             end_date = coalesce(?3, end_date),
             updated_at = ?4 WHERE id = ?5",
            params![state, start_date, end_date, now, id],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, db: &Database, id: &str, pinned: bool) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE tasks SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![pinned, now, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Tâche introuvable".to_string()));
        }
        Ok(())
    }

    pub fn start_run(&self, db: &Database, task_id: &str, session_id: &str) -> AppResult<TaskRun> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        let attempt: i64 = conn.query_row(
            "SELECT coalesce(max(attempt), 0) + 1 FROM task_runs WHERE task_id = ?1",
            params![task_id],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO task_runs (id, task_id, attempt, state, shell_session_id, started_at, created_at)
             VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?5)",
            params![id, task_id, attempt, session_id, now],
        )?;
        conn.execute(
            "UPDATE tasks SET state='running', start_date=coalesce(start_date, ?1),
             end_date=NULL, bob_process_id=?2, last_event_at=?1, updated_at=?1 WHERE id=?3",
            params![now, session_id, task_id],
        )?;
        Ok(TaskRun {
            id,
            task_id: task_id.to_string(),
            attempt,
            state: "running".to_string(),
            shell_session_id: Some(session_id.to_string()),
            shell_task_id: None,
            process_id: None,
            started_at: Some(now.clone()),
            ended_at: None,
            summary: None,
            error: None,
            created_at: now,
        })
    }

    pub fn finish_run(
        &self,
        db: &Database,
        task_id: &str,
        run_id: Option<&str>,
        success: bool,
        summary: &str,
        error: Option<&str>,
        shell_task_id: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let state = if success { "completed" } else { "failed" };
        let conn = db.conn.lock().unwrap();
        if let Some(run_id) = run_id {
            conn.execute(
                "UPDATE task_runs SET state=?1, ended_at=?2, summary=?3, error=?4,
                 shell_task_id=coalesce(?5, shell_task_id) WHERE id=?6",
                params![state, now, summary, error, shell_task_id, run_id],
            )?;
        }
        conn.execute(
            "UPDATE tasks SET state=CASE WHEN state='cancelled' THEN state ELSE ?1 END, end_date=?2, summary=?3, errors=?4,
             progress=CASE WHEN ?1='completed' AND state!='cancelled' THEN 100 ELSE progress END,
             resumable=?5, shell_task_id=coalesce(?6, shell_task_id),
             last_event_at=?2, updated_at=?2 WHERE id=?7",
            params![
                state,
                now,
                summary,
                error.map(|e| serde_json::json!([{ "message": e, "timestamp": now }]).to_string()).unwrap_or_else(|| "[]".to_string()),
                shell_task_id.is_some(),
                shell_task_id,
                task_id,
            ],
        )?;
        Ok(())
    }

    pub fn add_event(
        &self,
        db: &Database,
        task_id: &str,
        run_id: Option<&str>,
        event_type: &str,
        title: Option<&str>,
        content: Option<&str>,
        tool_name: Option<&str>,
        payload: &serde_json::Value,
    ) -> AppResult<TaskEvent> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        let sequence: i64 = conn.query_row(
            "SELECT coalesce(max(sequence), 0) + 1 FROM task_events WHERE task_id=?1",
            params![task_id],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO task_events
             (id, task_id, run_id, sequence, event_type, title, content, tool_name, payload, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![id, task_id, run_id, sequence, event_type, title, content, tool_name, payload.to_string(), now],
        )?;
        conn.execute(
            "UPDATE tasks SET last_event_at=?1, updated_at=?1 WHERE id=?2",
            params![now, task_id],
        )?;
        Ok(TaskEvent {
            id,
            task_id: task_id.to_string(),
            run_id: run_id.map(str::to_string),
            sequence,
            event_type: event_type.to_string(),
            title: title.map(str::to_string),
            content: content.map(str::to_string),
            tool_name: tool_name.map(str::to_string),
            payload: payload.clone(),
            created_at: now,
        })
    }

    pub fn add_io(
        &self,
        db: &Database,
        task_id: &str,
        run_id: Option<&str>,
        direction: &str,
        io_type: &str,
        name: &str,
        path_or_url: Option<&str>,
        mime_type: Option<&str>,
        size: Option<i64>,
        sha256: Option<&str>,
        metadata: &serde_json::Value,
    ) -> AppResult<TaskIo> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO task_io
             (id, task_id, run_id, direction, io_type, name, path_or_url, mime_type, size, sha256, metadata, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![id, task_id, run_id, direction, io_type, name, path_or_url, mime_type, size, sha256, metadata.to_string(), now],
        )?;
        Ok(TaskIo {
            id,
            task_id: task_id.to_string(),
            run_id: run_id.map(str::to_string),
            direction: direction.to_string(),
            io_type: io_type.to_string(),
            name: name.to_string(),
            path_or_url: path_or_url.map(str::to_string),
            mime_type: mime_type.map(str::to_string),
            size,
            sha256: sha256.map(str::to_string),
            metadata: metadata.clone(),
            created_at: now,
        })
    }

    pub fn get_detail(&self, db: &Database, id: &str) -> AppResult<Option<TaskDetail>> {
        let Some(task) = self.get_by_id(db, id)? else {
            return Ok(None);
        };
        let conn = db.conn.lock().unwrap();

        let mut run_stmt = conn.prepare(
            "SELECT id,task_id,attempt,state,shell_session_id,shell_task_id,process_id,
             started_at,ended_at,summary,error,created_at FROM task_runs WHERE task_id=?1 ORDER BY attempt DESC"
        )?;
        let runs = run_stmt
            .query_map(params![id], |row| {
                Ok(TaskRun {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    attempt: row.get(2)?,
                    state: row.get(3)?,
                    shell_session_id: row.get(4)?,
                    shell_task_id: row.get(5)?,
                    process_id: row.get(6)?,
                    started_at: row.get(7)?,
                    ended_at: row.get(8)?,
                    summary: row.get(9)?,
                    error: row.get(10)?,
                    created_at: row.get(11)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();

        let mut event_stmt = conn.prepare(
            "SELECT id,task_id,run_id,sequence,event_type,title,content,tool_name,payload,created_at
             FROM task_events WHERE task_id=?1 ORDER BY sequence ASC"
        )?;
        let events = event_stmt
            .query_map(params![id], |row| {
                Ok(TaskEvent {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    run_id: row.get(2)?,
                    sequence: row.get(3)?,
                    event_type: row.get(4)?,
                    title: row.get(5)?,
                    content: row.get(6)?,
                    tool_name: row.get(7)?,
                    payload: serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or_default(),
                    created_at: row.get(9)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();

        let mut io_stmt = conn.prepare(
            "SELECT id,task_id,run_id,direction,io_type,name,path_or_url,mime_type,size,sha256,metadata,created_at
             FROM task_io WHERE task_id=?1 ORDER BY created_at ASC"
        )?;
        let all_io: Vec<TaskIo> = io_stmt
            .query_map(params![id], |row| {
                Ok(TaskIo {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    run_id: row.get(2)?,
                    direction: row.get(3)?,
                    io_type: row.get(4)?,
                    name: row.get(5)?,
                    path_or_url: row.get(6)?,
                    mime_type: row.get(7)?,
                    size: row.get(8)?,
                    sha256: row.get(9)?,
                    metadata: serde_json::from_str(&row.get::<_, String>(10)?).unwrap_or_default(),
                    created_at: row.get(11)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();
        let inputs = all_io
            .iter()
            .filter(|io| io.direction == "input")
            .cloned()
            .collect();
        let outputs = all_io
            .into_iter()
            .filter(|io| io.direction == "output")
            .collect();

        Ok(Some(TaskDetail {
            task,
            runs,
            events,
            inputs,
            outputs,
        }))
    }

    pub fn cancel(&self, db: &Database, id: &str) -> AppResult<()> {
        self.update_state(db, id, "cancelled")
    }

    fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
        Ok(Task {
            id: row.get(0)?,
            objective: row.get(1)?,
            project_id: row.get(2)?,
            conversation_id: row.get(3)?,
            mode: row.get(4)?,
            permission_policy: row
                .get::<_, String>(5)
                .unwrap_or_else(|_| "always_ask".to_string()),
            budget: row.get(6)?,
            max_time: row.get(7)?,
            bob_process_id: row.get(8)?,
            start_date: row.get(9)?,
            end_date: row.get(10)?,
            summary: row.get(11)?,
            progress: row.get::<_, f64>(12).unwrap_or(0.0),
            errors: serde_json::from_str(
                &row.get::<_, String>(13)
                    .unwrap_or_else(|_| "[]".to_string()),
            )
            .unwrap_or(serde_json::Value::Array(vec![])),
            resumable: row.get::<_, bool>(14).unwrap_or(false),
            schedule_id: row.get(15)?,
            shell_task_id: row.get(16)?,
            last_event_at: row.get(17)?,
            state: row.get(18)?,
            created_at: row.get(19)?,
            updated_at: row.get(20)?,
            pinned: row.get::<_, bool>(21).unwrap_or(false),
        })
    }
}
